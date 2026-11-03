// Optional pointer-driven gate; reuse existing Playwright and Chromium installations.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  expandBuildingPlanSchema,
  createBuildingPlanSession,
  writeBuildingPlanRecord,
  readBuildingPlanRecord,
  SAFE_SECURITY_CONFIG,
  FIELD_SPECS,
} from 'form0-core';
import { createApp } from '../src/server/express-server.js';
import { createWebSocketServer } from '../src/server/websocket.js';

const { chromium } = await import(process.env.FORM0_PLAYWRIGHT_MODULE || 'playwright');
const schema = {
  form: {
    name: 'BuildingPlan canvas ownership',
    elements: [
      {
        type: 'BuildingPlanSection',
        key: 'plan',
        data_name: 'plan',
        label: 'Plan',
        description: null,
        description_mode: null,
        visible: true,
        visible_conditions: null,
        read_only: false,
        read_only_conditions: null,
        node_overrides: null,
      },
    ],
  },
};
const { buildingPlanMeta } = expandBuildingPlanSchema(schema);
const observationSchema = structuredClone(schema);
const measured = Object.fromEntries(
  Object.entries(FIELD_SPECS.NumericField.attributes)
    .filter(([, attribute]) => attribute.required)
    .map(([name, attribute]) => [
      name,
      attribute.value ??
        (attribute.nullable
          ? null
          : (attribute.allowedValues?.[0] ??
            { string: '', boolean: false, array: [], object: {}, number: 0 }[attribute.type])),
    ])
);
observationSchema.form.elements[0].node_overrides = {
  walls: {
    extra_elements: [
      {
        ...measured,
        type: 'NumericField',
        key: 'measured_thickness',
        data_name: 'measured_thickness',
        label: 'Observed thickness (m)',
        format: 'float',
        visible: true,
      },
    ],
    field_bindings: { measured_thickness: { scope: 'observation' } },
  },
};
const observationMeta = expandBuildingPlanSchema(observationSchema).buildingPlanMeta[0];
let activeSchema = schema;
const nodes = buildingPlanMeta[0].repeatablesByNodeKey;
const key = (name) => nodes[name].preferredKey;
const name = (node, field) => nodes[node].fieldsByOriginalDataName[field].dataName;
const floorValues = () => ({
  [name('floors', 'floor_name')]: {
    choice: [{ value: 'ground_floor', label: 'Ground Floor' }],
    other: [],
  },
  [name('floors', 'floor_elevation_m')]: 0,
  [name('floors', 'floor_height_m')]: 3,
});
const seed = () => {
  const session = createBuildingPlanSession();
  session.apply({ type: 'create_floor', values: { floor_elevation_m: 0, floor_height_m: 3 } });
  session.apply({ type: 'create_floor', values: { floor_elevation_m: 0, floor_height_m: 3 } });
  const record = writeBuildingPlanRecord({
    meta: buildingPlanMeta[0],
    plan: session.getSnapshot(),
  });
  record.repeatable[key('floors')].forEach((floor, index) => {
    floor.id = index ? 'sibling' : 0;
    Object.assign(floor.values, floorValues());
    floor.custom = index ? 'sibling metadata' : 'floor metadata';
  });
  return record;
};
const sharedSeed = (height = 3, observation = false) => {
  const session = createBuildingPlanSession();
  const floorId = session.apply({ type: 'create_floor', defaults: { wall_height_m: height } })
    .created.id;
  for (const rectangle of [
    { x: 0, y: 0, width: 5, height: 3 },
    { x: 3, y: 3.2, width: 5, height: 3 },
  ])
    session.apply({ type: 'create_room', floorId, rectangle });
  const floor = session.getSnapshot().floors[0];
  assert.equal(
    session.apply({
      type: 'bind_faces',
      floorId,
      referenceFaceId: floor.rooms[0].faces[2].id,
      faceId: floor.rooms[1].faces[0].id,
    }).status,
    'applied'
  );
  if (observation)
    assert.equal(
      session.apply({
        type: 'add_observation',
        floorId,
        subject: { type: 'room_face', id: floor.rooms[0].faces[2].id },
        observedAt: '2026-11-02',
        evidence: ['fixture-evidence'],
      }).status,
      'applied'
    );
  const record = writeBuildingPlanRecord({
    meta: buildingPlanMeta[0],
    plan: session.getSnapshot(),
  });
  record.repeatable[key('floors')][0].id = 0;
  Object.assign(record.repeatable[key('floors')][0].values, floorValues());
  return record;
};
const directory = await mkdtemp(path.join(os.tmpdir(), 'form0-building-plan-'));
const safe = process.env.FORM0_PREVIEW_SAFE === '1';
const app = createApp(
  () => activeSchema,
  () => 'BuildingPlan fixture',
  directory,
  { diagnostics: false, engineOptions: safe ? { security: SAFE_SECURITY_CONFIG } : {} }
);
const server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const sockets = createWebSocketServer(
  server,
  () => activeSchema,
  () => 'BuildingPlan fixture',
  {}
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.FORM0_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.FORM0_CHROMIUM_EXECUTABLE }
    : {}),
});
const evidence = [];
const settle = (page) =>
  page.evaluate(() => window.form0PreviewEvents.dispatch({ type: 'validate-record' }));
const row = (page, id) => page.locator(`.repeatable-instance[data-instance-id="${id}"]`);
const control = (item, action) =>
  item.locator(`:scope > .repeatable-instance-header [data-preview-row-action="${action}"]`);
async function command(page, action, run) {
  const response = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/preview-events') &&
      response.request().postDataJSON()?.action === action
  );
  response.catch(() => {}); // Report a failed click through its scenario, without an orphaned wait.
  await run();
  const result = await (await response).json();
  assert.deepEqual(result.issues || [], []);
  await settle(page);
  return result;
}
async function draw(page, tool, start, end) {
  await page.getByRole('button', { name: tool, exact: true }).click();
  const canvas = page.locator('.building-plan-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  return command(page, 'building-plan-operation', async () => {
    await page.mouse.move(box.x + box.width * start[0], box.y + box.height * start[1]);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * end[0], box.y + box.height * end[1], { steps: 8 });
    await page.mouse.up();
  }).catch((error) => {
    throw new Error(`${tool}: ${error.message}`);
  });
}
async function place(page, tool, point, { meters = false } = {}) {
  await page.getByRole('button', { name: tool, exact: true }).click();
  const canvas = page.locator('.building-plan-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  return command(page, 'building-plan-operation', () =>
    page.mouse.click(
      box.x + (meters ? point[0] * 20 : box.width * point[0]),
      box.y + (meters ? point[1] * 20 : box.height * point[1])
    )
  ).catch((error) => {
    throw new Error(`${tool}: ${error.message}`);
  });
}
async function answerRoom(page, room) {
  const item = row(page, room.id);
  await command(page, 'open-row', () => control(item, 'edit').click());
  await item.locator(`[data-name="${name('rooms', 'room_name')}"] select`).selectOption('bedroom');
  await settle(page);
  for (const wall of room.repeatable[key('walls')]) {
    const wallRow = row(page, wall.id);
    await command(page, 'open-row', () => control(wallRow, 'edit').click());
    for (const [field, value] of [
      ['wall_label', 'Wall'],
      ['wall_height_m', '3'],
      ['wall_thickness_m', '0.2'],
    ])
      await wallRow.locator(`[data-name="${name('walls', field)}"] input`).fill(value);
    await settle(page);
    const saved = await command(page, 'accept-row', () => control(wallRow, 'save').click());
    assert.equal(
      saved.eligible,
      true,
      JSON.stringify({
        status: saved.status,
        summary: saved.validationSummary,
        diagnostics: saved.diagnostics,
        validationIssues: saved.validationIssues,
        issues: saved.issues,
      })
    );
  }
  const saved = await command(page, 'accept-row', () => control(item, 'save').click());
  assert.equal(
    saved.eligible,
    true,
    JSON.stringify({
      status: saved.status,
      summary: saved.validationSummary,
      diagnostics: saved.diagnostics,
      validationIssues: saved.validationIssues,
      issues: saved.issues,
    })
  );
}
async function scenario(lifecycle, label, initial, readonly, run, scenarioSchema = schema) {
  if (process.env.FORM0_BROWSER_SCENARIO && !label.includes(process.env.FORM0_BROWSER_SCENARIO))
    return;
  activeSchema = scenarioSchema;
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const result = { lifecycle, label, errors: [] };
  evidence.push(result);
  page.setDefaultTimeout(7000);
  page.on('pageerror', (error) => result.errors.push(error.stack || error.message));
  page.on('dialog', (dialog) => dialog.accept());
  await page.addInitScript(
    (config) => localStorage.setItem('form0-preview-events', JSON.stringify(config)),
    { lifecycle, recordKind: 'existing', readonly, fieldInteractions: [] }
  );
  await page.route('**/api/preview-session', async (route) => {
    const data = route.request().postDataJSON();
    data.state = initial;
    await route.continue({ postData: JSON.stringify(data) });
  });
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.form0PreviewEvents);
    await run(page);
    assert.deepEqual(result.errors, []);
    result.passed = true;
  } catch (error) {
    result.passed = false;
    result.failure = error.stack || error.message;
  } finally {
    await page.close();
    activeSchema = schema;
  }
}
try {
  for (const lifecycle of [false, true]) {
    const savedSeed = seed();
    await scenario(
      lifecycle,
      'new canvas floor and child geometry cancel together',
      { values: {}, repeatable: {} },
      false,
      async (page) => {
        const created = await command(page, 'open-row', () =>
          page.getByRole('button', { name: 'Draw Floor', exact: true }).click()
        );
        const floor = created.state.repeatable[key('floors')][0];
        assert.ok(created.scopes.some((scope) => scope.instancePath.length === 1));
        const changed = await draw(page, 'Draw Room', [0.2, 0.2], [0.6, 0.6]);
        const room = changed.state.repeatable[key('floors')][0].repeatable[key('rooms')][0];
        assert.equal(room.repeatable[key('walls')].length, 4);
        await place(page, 'Place Column', [0.35, 0.35]);
        await draw(page, 'Draw Beam', [0.3, 0.3], [0.5, 0.4]);
        // Target the drawn wall itself: responsive canvas sizes must not turn viewport
        // fractions into a click several pixels away from the snapped room boundary.
        const [start, end] = JSON.parse(room.values[name('rooms', 'room_vertices')]).vertices;
        const alongWall = (ratio) => [
          start.x + (end.x - start.x) * ratio,
          start.y + (end.y - start.y) * ratio,
        ];
        await place(page, 'Place Door', alongWall(0.35), { meters: true });
        const withOpenings = await place(page, 'Place Window', alongWall(0.7), { meters: true });
        const completeRoom =
          withOpenings.state.repeatable[key('floors')][0].repeatable[key('rooms')][0];
        assert.equal(completeRoom.repeatable[key('columns')].length, 1);
        assert.equal(completeRoom.repeatable[key('beams')].length, 1);
        const walls = completeRoom.repeatable[key('walls')];
        assert.equal(
          walls.reduce((sum, wall) => sum + (wall.repeatable[key('face_doors')]?.length || 0), 0),
          1
        );
        assert.equal(
          walls.reduce((sum, wall) => sum + (wall.repeatable[key('face_windows')]?.length || 0), 0),
          1
        );
        await command(page, 'cancel', () => control(row(page, floor.id), 'cancel').click());
        const cancelled = await settle(page);
        assert.equal(cancelled.state.repeatable[key('floors')]?.length || 0, 0);
        assert.equal(await page.locator('.repeatable-instance').count(), 0);
        assert.equal(
          await page.getByRole('button', { name: 'Draw Room', exact: true }).isDisabled(),
          true
        );
      }
    );
    await scenario(
      lifecycle,
      'drawing auto-edits a saved floor, saves answers and preserves siblings',
      savedSeed,
      false,
      async (page) => {
        const before = savedSeed;
        let release, held;
        const blocked = new Promise((resolve) => {
          held = resolve;
        });
        const gate = new Promise((resolve) => {
          release = resolve;
        });
        let holdFirstCanvas = true;
        await page.route('**/api/preview-events', async (route) => {
          if (
            holdFirstCanvas &&
            route.request().postDataJSON()?.action === 'building-plan-operation'
          ) {
            holdFirstCanvas = false;
            held();
            await gate;
          }
          await route.continue();
        });
        const drawing = draw(page, 'Draw Room', [0.2, 0.2], [0.6, 0.6]);
        drawing.catch(() => {});
        try {
          await Promise.race([blocked, drawing]);
          assert.equal(await control(row(page, 0), 'save').isDisabled(), true);
          assert.equal(await control(row(page, 0), 'cancel').isDisabled(), true);
          assert.equal(await page.locator('#submit-btn').isDisabled(), true);
          assert.equal(await page.locator('.building-plan-floor-tab').last().isDisabled(), true);
          assert.equal(
            await page.getByRole('button', { name: 'Draw Room', exact: true }).isDisabled(),
            true
          );
        } finally {
          release();
        }
        let changed = await drawing;
        assert.ok(changed.scopes.some((scope) => scope.instancePath.at(-1)?.instanceId === 0));
        assert.equal(
          changed.committedState.repeatable[key('floors')][0].repeatable[key('rooms')].length,
          0
        );
        changed = await draw(page, 'Draw Wall', [0.3, 0.4], [0.5, 0.4]);
        const room = changed.state.repeatable[key('floors')][0].repeatable[key('rooms')][0];
        assert.equal(room.repeatable[key('walls')].length, 5);
        assert.deepEqual(
          changed.state.repeatable[key('floors')][1].values,
          before.repeatable[key('floors')][1].values
        );
        await answerRoom(page, room);
        const saved = await command(page, 'accept-row', () =>
          control(row(page, 0), 'save').click()
        );
        assert.equal(
          saved.eligible,
          true,
          JSON.stringify({
            status: saved.status,
            summary: saved.validationSummary,
            diagnostics: saved.diagnostics,
            validationIssues: saved.validationIssues,
            issues: saved.issues,
          })
        );
        assert.equal(saved.state.repeatable[key('floors')][0].repeatable[key('rooms')].length, 1);
        await draw(page, 'Draw Room', [0.65, 0.2], [0.85, 0.5]);
        await command(page, 'cancel', () => control(row(page, 0), 'cancel').click());
        const cancelled = await settle(page);
        assert.equal(
          cancelled.state.repeatable[key('floors')][0].repeatable[key('rooms')].length,
          1
        );
        assert.equal(
          cancelled.state.repeatable[key('floors')][0].repeatable[key('rooms')][0].repeatable[
            key('walls')
          ].length,
          5
        );
        assert.equal(cancelled.state.repeatable[key('floors')][0].custom, 'floor metadata');
        assert.equal(cancelled.state.repeatable[key('floors')][1].custom, 'sibling metadata');
      }
    );
    await scenario(
      lifecycle,
      'dragging remains active when released outside the canvas',
      seed(),
      false,
      async (page) => {
        const drawn = await draw(page, 'Draw Room', [0.2, 0.2], [0.6, 0.6]);
        const before = JSON.parse(
          drawn.state.repeatable[key('floors')][0].repeatable[key('rooms')][0].values[
            name('rooms', 'room_vertices')
          ]
        ).vertices[0].x;
        await page.getByRole('button', { name: 'Select / Move / Resize', exact: true }).click();
        const canvas = page.locator('.building-plan-canvas');
        await canvas.scrollIntoViewIfNeeded();
        const box = await canvas.boundingBox();
        await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width + 20, box.y + box.height * 0.4, { steps: 12 });
        await page.mouse.up();
        const after = await settle(page);
        const x = JSON.parse(
          after.state.repeatable[key('floors')][0].repeatable[key('rooms')][0].values[
            name('rooms', 'room_vertices')
          ]
        ).vertices[0].x;
        assert.ok(x > before, 'Releasing outside the canvas must commit the completed drag.');
      }
    );
    await scenario(
      lifecycle,
      'shared face gestures change the neighbour atomically and floor Cancel restores both',
      sharedSeed(),
      false,
      async (page) => {
        const opened = await command(page, 'open-row', () => control(row(page, 0), 'edit').click());
        const before = readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: opened.state });
        const canvas = page.locator('.building-plan-canvas');
        await canvas.scrollIntoViewIfNeeded();
        const box = await canvas.boundingBox();
        let operations = 0;
        page.on('request', (request) => {
          if (
            request.url().endsWith('/api/preview-events') &&
            request.postDataJSON()?.action === 'building-plan-operation'
          )
            operations++;
        });
        await page.mouse.move(box.x + 80, box.y + 60);
        await page.mouse.down();
        await page.mouse.move(box.x + 80, box.y + 70, { steps: 8 });
        assert.equal(
          operations,
          0,
          'A preview must not send accepted geometry or run form evaluation.'
        );
        const result = await command(page, 'building-plan-operation', () => page.mouse.up());
        const after = readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: result.state });
        assert.ok(after.floors[0].rooms[1].vertices.length > 4);
        assert.equal(operations, 1);
        assert.equal(result.scopes.length, 2, 'Dragging must not open a child editor.');
        await page.getByRole('button', { name: 'Draw Room', exact: true }).click();
        await page.mouse.move(box.x + 20, box.y + 20);
        await page.mouse.down();
        await page.mouse.move(box.x + 60, box.y + 40, { steps: 6 });
        await page.mouse.up();
        await page.locator('.building-plan-conflict').waitFor({ state: 'visible' });
        assert.equal(
          operations,
          1,
          'An overlapping room must retain the valid layout and inline conflict without submitting an operation.'
        );

        const cancelled = await command(page, 'cancel', () =>
          control(row(page, 0), 'cancel').click()
        );
        assert.deepEqual(
          readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: cancelled.state }),
          before
        );
      }
    );
    await scenario(
      lifecycle,
      'physical requiredness navigates through existing floor, room, and wall editors',
      sharedSeed(null),
      false,
      async (page) => {
        const prepared = await command(page, 'prepare', () => page.locator('#submit-btn').click());
        assert.equal(prepared.eligible, false);
        const issue = prepared.validationSummary.orderedIssues.find(
          (issue) => issue.fieldName === name('walls', 'wall_height_m')
        );
        assert.ok(
          issue?.canonical,
          'A physical finding needs an ordinary room-side navigation target.'
        );
        const displayed = page
          .locator('#preview-validation-findings button')
          .filter({ hasText: issue.fieldName })
          .first();
        await displayed.click();
        const item = row(page, issue.instancePath.at(-1).instanceId);
        const input = item.locator(`[data-name="${issue.fieldName}"] input`);
        await input.waitFor({ state: 'visible' });
        await input.fill('3');
        const changed = await settle(page);
        assert.ok(changed.scopes.some((scope) => scope.instancePath.length === 3));
        const source = readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: changed.state });
        const wallRow = changed.state.repeatable[key('floors')][0].repeatable[
          key('physical_walls')
        ].find((row) => row.id === issue.canonical.instancePath.at(-1).instanceId);
        const model = JSON.parse(wallRow.values[name('physical_walls', 'wall_model')]);
        assert.equal(
          source.floors[0].walls.find((wall) => wall.id === model.id).properties.wall_height_m,
          3
        );
      }
    );
    await scenario(
      lifecycle,
      'contextual floor Remove describes observation loss before the cascade',
      sharedSeed(3, true),
      false,
      async (page) => {
        let description;
        page.once('dialog', (dialog) => {
          description = dialog.message();
        });
        const response = page.waitForResponse(
          (response) =>
            response.url().endsWith('/api/preview-events') &&
            response.request().postDataJSON()?.allowObservationDeletion === true
        );
        await row(page, 0)
          .locator(':scope > .repeatable-instance-header .repeatable-instance-remove')
          .click();
        const removed = await (await response).json();
        assert.deepEqual(removed.issues, []);
        assert.match(description, /observation/i);
        assert.equal(removed.state.repeatable[key('floors')].length, 0);
      }
    );
    await scenario(
      lifecycle,
      'nested editors stay readable across desktop and compact window widths',
      sharedSeed(3, true),
      false,
      async (page) => {
        let result = await command(page, 'open-row', () => control(row(page, 0), 'edit').click());
        for (const node of ['physical_walls', 'observations'])
          assert.equal(
            await page.locator(`.repeatable-section[data-name="${nodes[node].dataName}"]`).count(),
            0,
            'Canonical storage must not introduce separate floor-level editors.'
          );
        assert.equal(
          result.state.repeatable[key('floors')][0].repeatable[key('physical_walls')].length,
          7
        );
        assert.equal(
          result.state.repeatable[key('floors')][0].repeatable[key('observations')].length,
          1
        );
        const roomRecord = result.state.repeatable[key('floors')][0].repeatable[key('rooms')][0];
        result = await command(page, 'open-row', () =>
          control(row(page, roomRecord.id), 'edit').click()
        );
        const wallRecord = roomRecord.repeatable[key('walls')][0];
        result = await command(page, 'open-row', () =>
          control(row(page, wallRecord.id), 'edit').click()
        );
        for (const node of ['face_doors', 'face_windows'])
          assert.equal(
            await row(page, wallRecord.id)
              .locator(`.repeatable-section[data-name="${nodes[node].dataName}"]`)
              .count(),
            1,
            'Doors and windows stay inside the ordinary room wall editor.'
          );
        assert.equal(
          await page
            .locator(`.repeatable-section[data-name="${nodes.face_observations.dataName}"]`)
            .count(),
          0,
          'An unconfigured observation collection has no row editor.'
        );
        const before = readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: result.state });
        const input = row(page, wallRecord.id).locator(
          `[data-name="${name('walls', 'wall_height_m')}"] input`
        );
        for (const width of [1600, 1280, 1024, 768, 390]) {
          await page.setViewportSize({ width, height: 1000 });
          await input.scrollIntoViewIfNeeded();
          const sizes = await input.evaluate((input) => {
            const rect = (element) => {
              const box = element.getBoundingClientRect();
              return { width: box.width, y: box.y, bottom: box.bottom };
            };
            return {
              layout: rect(document.querySelector('.building-plan-layout')),
              canvas: rect(document.querySelector('.building-plan-canvas-panel')),
              detail: rect(document.querySelector('.building-plan-detail-panel')),
              input: rect(input),
              viewport: innerWidth,
              page: document.documentElement.scrollWidth,
            };
          });
          assert.ok(sizes.page <= sizes.viewport + 1, `No horizontal page overflow at ${width}px`);
          if (width >= 1200) {
            assert.ok(
              sizes.detail.width >= sizes.layout.width * 0.55,
              `The editor needs the larger desktop pane at ${width}px`
            );
            assert.ok(
              sizes.input.width >= 400,
              `Nested questions need a readable width at ${width}px`
            );
          } else {
            assert.ok(
              sizes.detail.width >= sizes.layout.width - 1,
              `Compact windows need a full-width editor at ${width}px`
            );
            assert.ok(
              sizes.detail.y >= sizes.canvas.bottom,
              `Place the editor below the canvas at ${width}px`
            );
            assert.ok(
              sizes.input.width >= 200,
              `Nested questions need a usable compact width at ${width}px`
            );
          }
        }
        assert.deepEqual(
          readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: (await settle(page)).state }),
          before
        );
      }
    );
    await scenario(
      lifecycle,
      'configured observations stay in the room wall workflow and persist once',
      (() => {
        const record = sharedSeed(3, true);
        const plan = readBuildingPlanRecord({ meta: buildingPlanMeta[0], record });
        plan.floors[0].observations[0].values.measured_thickness = 0.19;
        return writeBuildingPlanRecord({ meta: observationMeta, plan, record });
      })(),
      false,
      async (page) => {
        let result = await command(page, 'open-row', () => control(row(page, 0), 'edit').click());
        for (const node of ['physical_walls', 'observations'])
          assert.equal(
            await page.locator(`.repeatable-section[data-name="${nodes[node].dataName}"]`).count(),
            0
          );
        const floor = result.state.repeatable[key('floors')][0];
        const roomRecord = floor.repeatable[key('rooms')][0];
        result = await command(page, 'open-row', () =>
          control(row(page, roomRecord.id), 'edit').click()
        );
        const wallRecord = roomRecord.repeatable[key('walls')][2];
        result = await command(page, 'open-row', () =>
          control(row(page, wallRecord.id), 'edit').click()
        );
        const observations = row(page, wallRecord.id).locator(
          `.repeatable-section[data-name="${nodes.face_observations.dataName}"]`
        );
        assert.equal(await observations.count(), 1);
        const observation = observations.locator('.repeatable-instance').first();
        result = await command(page, 'open-row', () => control(observation, 'edit').click());
        const observedName =
          observationMeta.repeatablesByNodeKey.face_observations.fieldsByOriginalDataName
            .measured_thickness.dataName;
        const input = observation.locator(`[data-name="${observedName}"] input`);
        assert.equal(Number(await input.inputValue()), 0.19);
        await input.fill('0.21');
        await input.press('Tab');
        result = await command(page, 'accept-row', () => control(observation, 'save').click());
        const plan = readBuildingPlanRecord({ meta: observationMeta, record: result.state });
        assert.equal(plan.floors[0].observations.length, 1);
        assert.equal(plan.floors[0].observations[0].values.measured_thickness, 0.21);
        const wallId = plan.floors[0].rooms[0].faces[2].wallId;
        assert.equal(
          plan.floors[0].walls.find((wall) => wall.id === wallId).properties.wall_thickness_m,
          0.2
        );
      },
      observationSchema
    );
    await scenario(
      lifecycle,
      'record readonly disables all canvas writes',
      seed(),
      true,
      async (page) => {
        for (const tool of [
          'Draw Floor',
          'Draw Room',
          'Draw Wall',
          'Place Column',
          'Draw Beam',
          'Place Door',
          'Place Window',
        ])
          assert.equal(
            await page.getByRole('button', { name: tool, exact: true }).isDisabled(),
            true
          );
        assert.equal((await settle(page)).scopes.length, 1);
      }
    );
  }
  console.log(
    JSON.stringify(
      {
        safe,
        scenarios: evidence,
        passed: evidence.filter((item) => item.passed).length,
        failed: evidence.filter((item) => !item.passed).length,
      },
      null,
      2
    )
  );
  if (evidence.some((item) => !item.passed)) process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((resolve) => sockets.wss.close(resolve));
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
