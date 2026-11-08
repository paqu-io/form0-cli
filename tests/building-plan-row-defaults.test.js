import test from 'node:test';
import assert from 'node:assert/strict';
import { readBuildingPlanRecord } from 'form0-core';
import { createPreviewSessionManager } from '../src/server/preview-events/editor.js';
import { fixture, part, at } from './fixtures/building-plan-v2.js';

// Current v2 acceptance replaces the archived pre-model canvas adapter contract.
for (const mode of ['trusted', 'safe'])
  for (const node of ['rooms', 'walls', 'columns', 'beams', 'doors', 'windows'])
    test(`Add ${node} owns generated geometry in its cancellable draft (${mode})`, async () => {
      const f = fixture();
      const manager = createPreviewSessionManager({
        getSchema: () => f.schema,
        serializeRecord: (_schema, state) => state,
        evaluationOptions: { security: { mode } },
      });
      try {
        const started = await manager.create({
          state: f.record,
          configuration: { lifecycle: true, recordKind: 'existing' },
        });
        let sequence = 0;
        const command = (request) =>
          manager.command({ sessionId: started.sessionId, sequence: ++sequence, ...request });
        let path = [],
          scopeId = started.scopes[0].scopeId,
          result;
        const parents =
          node === 'rooms'
            ? ['floors']
            : ['doors', 'windows'].includes(node)
              ? ['floors', 'rooms', 'walls']
              : ['floors', 'rooms'];
        for (const key of parents) {
          const row = at(f.record, path).repeatable[f.nodes[key].preferredKey][0];
          path = [...path, part(f.nodes[key].preferredKey, row)];
          result = await command({
            action: 'open-row',
            instancePath: path,
            parentScopeId: scopeId,
          });
          assert.deepEqual(result.issues, []);
          scopeId = result.scopes.find(
            (scope) => scope.instancePath.length === path.length
          ).scopeId;
        }
        const before = readBuildingPlanRecord({ meta: f.meta, record: result.state });
        const view = f.nodes['face_' + node] || f.nodes[node];
        const childPath = [
          ...path,
          {
            repeatableKey: view.preferredKey,
            index: at(result.state, path).repeatable[view.preferredKey]?.length || 0,
            instanceId: 'new-' + node,
            identity: 'id',
          },
        ];
        result = await command({
          action: 'open-row',
          instancePath: childPath,
          parentScopeId: scopeId,
          recordKind: 'new',
          row: { id: 'new-' + node, values: {}, repeatable: {} },
        });
        assert.deepEqual(result.issues, []);
        const child = result.scopes.find((scope) => scope.instancePath.length === childPath.length);
        assert.ok(child);
        const plan = readBuildingPlanRecord({ meta: f.meta, record: result.state });
        const count = (plan) =>
          node === 'rooms'
            ? plan.floors[0].rooms.length
            : node === 'walls'
              ? plan.floors[0].walls.length
              : ['doors', 'windows'].includes(node)
                ? plan.floors[0].walls.flatMap((w) => w[node]).length
                : plan.floors[0].rooms[0][node].length;
        assert.ok(count(plan) > count(before));
        assert.deepEqual(
          readBuildingPlanRecord({ meta: f.meta, record: result.committedState }),
          readBuildingPlanRecord({ meta: f.meta, record: f.record })
        );
        result = await command({
          action: 'cancel',
          instancePath: child.instancePath,
          scopeId: child.scopeId,
        });
        assert.deepEqual(result.issues, []);
        assert.deepEqual(readBuildingPlanRecord({ meta: f.meta, record: result.state }), before);
      } finally {
        manager.disposeAll();
      }
    });
