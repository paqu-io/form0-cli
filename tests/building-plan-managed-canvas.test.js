import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBuildingPlanSession,
  readBuildingPlanRecord,
  writeBuildingPlanRecord,
} from 'form0-core';
import { fixture } from './fixtures/building-plan-v2.js';
import { createFieldTemplate } from '../src/utils/field-template.js';
import { createPreviewSessionManager } from '../src/server/preview-events/editor.js';
import { createPreviewEventClient } from '../src/server/static/preview-event-client.js';
import { createManagedBuildingPlanController } from '../src/server/static/building-plan-preview.js';
import { createSharedBuildingPlanController } from '../src/server/static/building-plan-shared-controller.js';

for (const security of ['safe', 'trusted'])
  for (const automatic of [false, true])
    for (const choice of automatic ? ['apply'] : ['apply', 'cancel'])
      test(`canvas completes a required copy decision through its managed host (${security}, ${choice}, auto-copy=${automatic})`, async () => {
        const note = createFieldTemplate('TextField', { dataName: 'survey_note' });
        note.building_plan = { scope: 'physical_wall', on_split: 'confirm' };
        const f = fixture({ walls: { extra_elements: [note] } });
        const domain = createBuildingPlanSession({
          snapshot: readBuildingPlanRecord({ meta: f.meta, record: f.record }),
          properties: f.meta.properties,
        });
        assert.equal(
          domain.apply({
            type: 'set_property',
            floorId: f.floorId,
            faceId: f.faceId,
            property: 'survey_note',
            value: 'Keep this inspection answer',
          }).status,
          'applied'
        );
        const initial = domain.getSnapshot();
        const record = writeBuildingPlanRecord({ meta: f.meta, record: f.record, plan: initial });
        const manager = createPreviewSessionManager({
          getSchema: () => f.schema,
          serializeRecord: (_schema, state) => state,
          evaluationOptions: { security: { mode: security } },
        });
        const renderer = { activeRepeatableState: record.repeatable };
        const shown = [],
          requests = [];
        const client = createPreviewEventClient({
          getBuildingPlanEditingPolicy: () => ({ copyCustomAnswersAutomatically: automatic }),
          fetch: async (url, options) => {
            const input = JSON.parse(options.body);
            requests.push(input);
            const result = url.endsWith('preview-session')
              ? await manager.create(input)
              : url.endsWith('preview-dispose')
                ? (manager.disposeAll(), {})
                : await manager.command(input);
            return { ok: true, json: async () => result };
          },
          accept: (result) => {
            if (result.state) renderer.activeRepeatableState = result.state.repeatable;
          },
          present: async (operations, respond) => {
            for (const operation of operations) {
              shown.push(operation);
              assert.equal(operation.operation, 'MESSAGEBOX');
              assert.match(operation.params.message, /copies explicit custom answers/);
              assert.deepEqual(
                readBuildingPlanRecord({ meta: f.meta, record: client.getState() }),
                initial
              );
              await respond(operation, { value: choice });
            }
          },
        });
        let controller;
        try {
          await client.start(
            { lifecycle: false, recordKind: 'existing', fieldInteractions: [] },
            record
          );
          const originalDocument = globalThis.document;
          try {
            globalThis.document = { createElement: () => ({ dataset: {}, setAttribute() {} }) };
            controller = createSharedBuildingPlanController(
              renderer,
              {},
              f.schema.form.elements[0],
              [],
              f.meta
            );
          } finally {
            if (originalDocument === undefined) delete globalThis.document;
            else globalThis.document = originalDocument;
          }
          const target = (path) => {
            const instancePath = client.resolvePath(path);
            const scope = client
              .getScopes()
              .find((entry) => JSON.stringify(entry.instancePath) === JSON.stringify(instancePath));
            return { instancePath, scopeId: scope?.scopeId };
          };
          const managed = createManagedBuildingPlanController({
            controller,
            client,
            renderer,
            stateManager: {},
            configuration: () => ({ readonly: false }),
            session: () => client.isActive(),
            target,
            edit: (path) =>
              client.request({ action: 'open-row', instancePath: client.resolvePath(path) }),
            report: (result) => {
              assert.deepEqual(result.issues, []);
              return result;
            },
          });
          const result = await managed.apply({
            type: 'resize_face',
            floorId: f.floorId,
            faceId: initial.floors[0].rooms[0].faces[1].id,
            distance: 1,
          });
          assert.equal(
            shown.length,
            automatic ? 0 : 1,
            'Only explicit auto-copy authorization bypasses the transfer decision'
          );
          assert.equal(
            requests.filter((request) => request.action === 'building-plan-operation').length,
            1
          );
          assert.equal(
            requests.filter((request) => request.action === 'ui-response').length,
            automatic ? 0 : 1
          );
          const final = readBuildingPlanRecord({ meta: f.meta, record: client.getState() });
          if (choice === 'cancel') {
            assert.equal(result, null);
            assert.deepEqual(final, initial);
          } else {
            assert.equal(result.status, 'applied');
            assert.equal(Math.max(...final.floors[0].rooms[0].vertices.map((point) => point.x)), 6);
            assert.deepEqual(
              readBuildingPlanRecord({ meta: f.meta, record: client.getCommittedState() }),
              initial
            );
            assert.ok(
              final.floors[0].walls.some(
                (wall) => wall.overrides.survey_note === 'Keep this inspection answer'
              )
            );
            await managed.history('undo');
            assert.deepEqual(
              readBuildingPlanRecord({ meta: f.meta, record: client.getState() }),
              initial
            );
          }
        } finally {
          controller?.dispose();
          client.dispose();
          manager.disposeAll();
        }
      });
