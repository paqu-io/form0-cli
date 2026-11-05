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
async function startPreviewServer() {
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
  return { server, sockets };
}
let { server, sockets } = await startPreviewServer();
async function stopPreviewServer() {
  await new Promise((resolve) => sockets.wss.close(resolve));
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
const browser = await chromium.launch({
  headless: true,
  ...(process.env.FORM0_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.FORM0_CHROMIUM_EXECUTABLE }
    : {}),
});
async function canvasBox(canvas) {
  const box = await canvas.boundingBox();
  const offset = await canvas.evaluate((element) => {
    const matrix = element.getContext('2d').getTransform();
    return { x: matrix.e, y: matrix.f };
  });
  return { ...box, x: box.x + offset.x, y: box.y + offset.y };
}
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
  const box = await canvasBox(canvas);
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
  const box = await canvasBox(canvas);
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
let scenarioCount = 0;
async function scenario(lifecycle, label, initial, readonly, run, scenarioSchema = schema) {
  if (process.env.FORM0_BROWSER_SCENARIO && !label.includes(process.env.FORM0_BROWSER_SCENARIO))
    return;
  if (scenarioCount && scenarioCount % 10 === 0) {
    await stopPreviewServer();
    ({ server, sockets } = await startPreviewServer());
  }
  scenarioCount++;
  activeSchema = scenarioSchema;
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const result = { lifecycle, label, errors: [] };
  evidence.push(result);
  page.setDefaultTimeout(7000);
  page.on('pageerror', (error) => result.errors.push(error.stack || error.message));
  page.on('response', (response) => {
    if (response.status() === 429) result.errors.push(`HTTP 429: ${response.url()}`);
  });
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
    // Each group uses its own preview server: repeated cache-free browser startups must
    // not exhaust the real server's asset limiter. Production limits remain unchanged.
    if (lifecycle) {
      await stopPreviewServer();
      ({ server, sockets } = await startPreviewServer());
    }
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
        const box = await canvasBox(canvas);
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
        const box = await canvasBox(canvas);
        let operations = 0;
        page.on('request', (request) => {
          if (
            request.url().endsWith('/api/preview-events') &&
            request.postDataJSON()?.action === 'building-plan-operation'
          )
            operations++;
        });
        await page.keyboard.down('Alt');
        await page.mouse.move(box.x + 80, box.y + 60);
        await page.mouse.down();
        await page.mouse.move(box.x + 80, box.y + 70, { steps: 8 });
        assert.equal(
          operations,
          0,
          'A preview must not send accepted geometry or run form evaluation.'
        );
        const result = await command(page, 'building-plan-operation', () => page.mouse.up());
        await page.keyboard.up('Alt');
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
    for (const axis of ['x', 'y'])
      await scenario(
        lifecycle,
        `stationary extension realignment and Rejoin (${axis})`,
        (() => {
          const record = sharedSeed();
          const domain = createBuildingPlanSession({
            snapshot: readBuildingPlanRecord({ meta: buildingPlanMeta[0], record }),
          });
          const floor = domain.getSnapshot().floors[0];
          assert.equal(
            domain.apply({
              type: 'split_face',
              floorId: floor.id,
              faceId: floor.rooms[0].faces[axis === 'x' ? 3 : 0].id,
              offset: axis === 'x' ? 1.5 : 2,
            }).status,
            'applied'
          );
          return writeBuildingPlanRecord({
            meta: buildingPlanMeta[0],
            record,
            plan: domain.getSnapshot(),
          });
        })(),
        false,
        async (page) => {
          const opened = await command(page, 'open-row', () =>
            control(row(page, 0), 'edit').click()
          );
          const original = readBuildingPlanRecord({
            meta: buildingPlanMeta[0],
            record: opened.state,
          });
          const canvas = page.locator('.building-plan-canvas');
          const drag = async (from, to, bypass = false) => {
            await canvas.scrollIntoViewIfNeeded();
            const box = await canvasBox(canvas);
            if (bypass) await page.keyboard.down('Alt');
            await page.mouse.move(box.x + from[0], box.y + from[1]);
            await page.mouse.down();
            await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 8 });
            const result = await command(page, 'building-plan-operation', () => page.mouse.up());
            if (bypass) await page.keyboard.up('Alt');
            return readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: result.state });
          };
          await drag(axis === 'x' ? [0, 45] : [20, 0], axis === 'x' ? [12, 45] : [20, 12], true);
          const aligned = await drag(
            axis === 'x' ? [12, 45] : [20, 12],
            axis === 'x' ? [2, 45] : [20, 2]
          );
          assert.deepEqual(
            aligned.floors[0].rooms[0].vertices.map(({ x, y }) => [x, y]),
            original.floors[0].rooms[0].vertices.map(({ x, y }) => [x, y])
          );
          assert.equal(aligned.floors[0].rooms[0].faces.length, 5);
          await page.getByRole('button', { name: 'Rejoin', exact: true }).click();
          const box = await canvasBox(canvas),
            point = axis === 'x' ? [0, 30] : [40, 0];
          await page.mouse.move(box.x + point[0], box.y + point[1]);
          await page.mouse.down();
          const result = await command(page, 'building-plan-operation', () => page.mouse.up());
          assert.equal(
            readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: result.state }).floors[0]
              .rooms[0].faces.length,
            4
          );
          await command(page, 'cancel', () => control(row(page, 0), 'cancel').click());
        }
      );
    await scenario(
      lifecycle,
      'single thickness field edits a split portion with reset and nested Cancel',
      (() => {
        const record = sharedSeed(),
          domain = createBuildingPlanSession({
            snapshot: readBuildingPlanRecord({ meta: buildingPlanMeta[0], record }),
          });
        const floor = domain.getSnapshot().floors[0];
        assert.equal(
          domain.apply({
            type: 'split_face',
            floorId: floor.id,
            faceId: floor.rooms[1].faces[0].id,
            offset: 2,
          }).status,
          'applied'
        );
        return writeBuildingPlanRecord({
          meta: buildingPlanMeta[0],
          record,
          plan: domain.getSnapshot(),
        });
      })(),
      false,
      async (page) => {
        let result = await command(page, 'open-row', () => control(row(page, 0), 'edit').click());
        const room = result.state.repeatable[key('floors')][0].repeatable[key('rooms')][1];
        await command(page, 'open-row', () => control(row(page, room.id), 'edit').click());
        await row(page, room.id)
          .locator(`[data-name="${name('rooms', 'room_name')}"] select`)
          .selectOption('bedroom');
        const wall = room.repeatable[key('walls')][1],
          wallRow = row(page, wall.id);
        await command(page, 'open-row', () => control(wallRow, 'edit').click());
        const field = wallRow.locator(`[data-name="${name('walls', 'wall_thickness_m')}"]`);
        assert.equal(await field.locator('input').count(), 1);
        await field.locator('input').fill('0.4');
        await field.locator('input').press('Tab');
        result = await settle(page);
        let floor = readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: result.state })
          .floors[0];
        assert.equal(floor.walls.length, 7);
        assert.ok(
          floor.walls
            .flatMap((wall) => wall.segments)
            .some((segment) => segment.overrides?.wall_thickness_m === 0.4)
        );
        assert.equal(
          result.state.repeatable[key('floors')][0].repeatable[key('rooms')][1].repeatable[
            key('walls')
          ][0].values[name('walls', 'wall_thickness_m')],
          0.2
        );
        assert.match(await field.innerText(), /this wall portion/);
        result = await command(page, 'building-plan-reset', () =>
          field.locator('[data-building-plan-reset]').click()
        );
        assert.equal(Number(await field.locator('input').inputValue()), 0.2);
        await field.locator('input').fill('0.4');
        await field.locator('input').press('Tab');
        await command(page, 'accept-row', () => control(wallRow, 'save').click());
        result = await command(page, 'cancel', () => control(row(page, room.id), 'cancel').click());
        floor = readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: result.state })
          .floors[0];
        assert.ok(
          floor.walls
            .flatMap((wall) => wall.segments)
            .every((segment) => !Object.hasOwn(segment.overrides || {}, 'wall_thickness_m'))
        );
        await command(page, 'cancel', () => control(row(page, 0), 'cancel').click());
      }
    );
    await scenario(
      lifecycle,
      'explicit Split and Rejoin preserve shared rows and exact placement',
      sharedSeed(),
      false,
      async (page) => {
        await command(page, 'open-row', () => control(row(page, 0), 'edit').click());
        const canvas = page.locator('.building-plan-canvas');
        await page.getByRole('button', { name: 'Split', exact: true }).click();
        await canvas.scrollIntoViewIfNeeded();
        let box = await canvasBox(canvas);
        await page.keyboard.down('Alt');
        await page.mouse.move(box.x + 70, box.y + 60);
        await page.mouse.down();
        const split = await command(page, 'building-plan-operation', () => page.mouse.up());
        await page.keyboard.up('Alt');
        let plan = readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: split.state });
        assert.ok(plan.floors[0].rooms.every((room) => room.faces.length === 5));
        assert.equal(plan.floors[0].walls.length, 7);
        await page.getByRole('button', { name: 'Rejoin', exact: true }).click();
        box = await canvasBox(canvas);
        await page.mouse.move(box.x + 70, box.y + 60);
        await page.mouse.down();
        const joined = await command(page, 'building-plan-operation', () => page.mouse.up());
        plan = readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: joined.state });
        assert.ok(plan.floors[0].rooms.every((room) => room.faces.length === 4));
        await page.getByRole('button', { name: 'Split', exact: true }).click();
        box = await canvasBox(canvas);
        await page.mouse.move(box.x + 40, box.y);
        await page.mouse.down();
        await page.keyboard.press('Escape');
        await page.mouse.up();
        assert.equal(
          await page
            .getByRole('button', { name: 'Split', exact: true })
            .getAttribute('aria-pressed'),
          'false'
        );
        await page.getByRole('button', { name: 'Split', exact: true }).click();
        box = await canvasBox(canvas);
        await page.mouse.move(box.x + 40, box.y);
        await page.getByLabel('Split distance (m)', { exact: true }).fill('2.25');
        const exact = await command(page, 'building-plan-operation', () =>
          page.getByRole('button', { name: 'Split at distance', exact: true }).click()
        );
        plan = readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: exact.state });
        assert.ok(plan.floors[0].rooms[0].vertices.some((v) => v.x === 2.25 && v.y === 0));
        assert.equal(plan.floors[0].rooms[0].faces.length, 5);
        await command(page, 'cancel', () => control(row(page, 0), 'cancel').click());
      }
    );
    await scenario(
      lifecycle,
      'split partition gestures and magnetic Rejoin',
      (() => {
        const record = sharedSeed();
        const domain = createBuildingPlanSession({
          snapshot: readBuildingPlanRecord({ meta: buildingPlanMeta[0], record }),
        });
        const floor = domain.getSnapshot().floors[0];
        assert.equal(
          domain.apply({
            type: 'create_wall',
            floorId: floor.id,
            roomId: floor.rooms[0].id,
            vertices: [
              { x: 1, y: 1 },
              { x: 4, y: 1 },
            ],
          }).status,
          'applied'
        );
        return writeBuildingPlanRecord({
          meta: buildingPlanMeta[0],
          record,
          plan: domain.getSnapshot(),
        });
      })(),
      false,
      async (page) => {
        await command(page, 'open-row', () => control(row(page, 0), 'edit').click());
        const canvas = page.locator('.building-plan-canvas');
        await page.getByRole('button', { name: 'Split', exact: true }).click();
        await canvas.scrollIntoViewIfNeeded();
        let box = await canvasBox(canvas);
        await page.mouse.move(box.x + 40, box.y + 20);
        await page.mouse.down();
        await command(page, 'building-plan-operation', () => page.mouse.up());
        await page.getByRole('button', { name: 'Select / Move / Resize', exact: true }).click();
        const drag = async (from, to, bypass = false) => {
          box = await canvasBox(canvas);
          if (bypass) await page.keyboard.down('Alt');
          await page.mouse.move(box.x + from[0], box.y + from[1]);
          await page.mouse.down();
          await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 8 });
          const response = await command(page, 'building-plan-operation', () => page.mouse.up());
          if (bypass) await page.keyboard.up('Alt');
          return readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: response.state });
        };
        let plan = await drag([60, 20], [66, 32], true);
        assert.equal(plan.floors[0].rooms[0].faces.filter((face) => face.freePath).length, 3);
        plan = await drag([60, 32], [60, 21]);
        assert.equal(plan.floors[0].rooms[0].faces.filter((face) => face.freePath).length, 2);
        await page.getByRole('button', { name: 'Rejoin', exact: true }).click();
        box = await canvasBox(canvas);
        await page.mouse.move(box.x + 40, box.y + 20);
        await page.mouse.down();
        const joined = await command(page, 'building-plan-operation', () => page.mouse.up());
        plan = readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: joined.state });
        assert.equal(plan.floors[0].rooms[0].faces.filter((face) => face.freePath).length, 1);
        await command(page, 'cancel', () => control(row(page, 0), 'cancel').click());
      }
    );
    await scenario(
      lifecycle,
      'physical wall material, one opening and active-room overlap selection',
      (() => {
        const record = sharedSeed();
        const plan = readBuildingPlanRecord({ meta: buildingPlanMeta[0], record });
        const domain = createBuildingPlanSession({ snapshot: plan });
        assert.equal(
          domain.apply({
            type: 'create_opening',
            floorId: plan.floors[0].id,
            wallId: plan.floors[0].rooms[0].faces[2].wallId,
            kind: 'door',
            offset: 3.5,
            width: 0.9,
          }).status,
          'applied'
        );
        return writeBuildingPlanRecord({
          meta: buildingPlanMeta[0],
          plan: domain.getSnapshot(),
          record,
        });
      })(),
      false,
      async (page) => {
        await command(page, 'open-row', () => control(row(page, 0), 'edit').click());
        const canvas = page.locator('.building-plan-canvas');
        await canvas.scrollIntoViewIfNeeded();
        const colors = await canvas.evaluate((element) => {
          const ctx = element.getContext('2d');
          const m = ctx.getTransform();
          const pixel = (x, y) =>
            [
              ...ctx.getImageData(Math.round(x * m.a + m.e), Math.round(y * m.d + m.f), 1, 1).data,
            ].slice(0, 3);
          return {
            exterior: pixel(-2, -2),
            material: pixel(30, 62),
            door: pixel(81, 62),
            above: pixel(81, 57),
            below: pixel(81, 67),
          };
        });
        assert.deepEqual(colors.exterior, [68, 68, 68]);
        assert.deepEqual(colors.material, [68, 68, 68]);
        assert.deepEqual(colors.door, [43, 138, 62]);
        assert.notDeepEqual(colors.above, colors.door);
        assert.notDeepEqual(colors.below, colors.door);
        const box = await canvasBox(canvas);
        await page.keyboard.down('Alt');
        await page.mouse.move(box.x + 40, box.y + 60);
        await page.mouse.down();
        await page.mouse.move(box.x + 40, box.y + 72, { steps: 8 });
        const changed = await command(page, 'building-plan-operation', () => page.mouse.up());
        await page.keyboard.up('Alt');
        const plan = readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: changed.state });
        const room2 = plan.floors[0].rooms[1];
        const recordRoom = changed.state.repeatable[key('floors')][0].repeatable[key('rooms')][1];
        const returnFace = room2.faces.find((face) =>
          face.edgeIds.some((id) => {
            const edge = room2.edges.find((edge) => edge.id === id);
            const a = room2.vertices.find((v) => v.id === edge.startId),
              b = room2.vertices.find((v) => v.id === edge.endId);
            return Math.abs(a.x - 5.2) < 1e-6 && Math.abs(b.x - 5.2) < 1e-6;
          })
        );
        assert.ok(returnFace);
        const returnRow = recordRoom.repeatable[key('walls')].find(
          (wall) =>
            JSON.parse(
              wall.values[
                buildingPlanMeta[0].repeatablesByNodeKey.walls.fields.find(
                  (f) => f.binding?.role === 'storage'
                ).dataName
              ]
            ).id === returnFace.id
        );
        await command(page, 'open-row', () => control(row(page, recordRoom.id), 'edit').click());
        await canvas.scrollIntoViewIfNeeded();
        const current = await canvasBox(canvas);
        await page.mouse.click(current.x + 104, current.y + 68);
        await page.getByRole('button', { name: 'Pin / unpin', exact: true }).click();
        const returnPixels = await canvas.evaluate((element) => {
          const ctx = element.getContext('2d'),
            m = ctx.getTransform();
          const pixel = (x, y) =>
            [
              ...ctx.getImageData(Math.round(x * m.a + m.e), Math.round(y * m.d + m.f), 1, 1).data,
            ].slice(0, 3);
          return { material: pixel(102, 68), interior: pixel(98, 68) };
        });
        assert.deepEqual(returnPixels.material, [209, 45, 45]);
        assert.notDeepEqual(returnPixels.interior, [68, 68, 68]);
        await page.waitForTimeout(250);
        const offset = await row(page, returnRow.id).evaluate(
          (element) =>
            element.querySelector(':scope > .repeatable-instance-header').getBoundingClientRect()
              .top - element.closest('.building-plan-detail-panel').getBoundingClientRect().top
        );
        assert.ok(
          Math.abs(offset) < 24,
          `Room 2 return row must receive the overlapping hit; offset ${offset}`
        );
        if (process.env.FORM0_BUILDING_PLAN_SCREENSHOT)
          await canvas.screenshot({ path: process.env.FORM0_BUILDING_PLAN_SCREENSHOT });
      }
    );
    await scenario(
      lifecycle,
      'reversal contact and direct corners preserve physical bands and optional pins',
      sharedSeed(3, true),
      false,
      async (page) => {
        const opened = await command(page, 'open-row', () => control(row(page, 0), 'edit').click());
        const initial = readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: opened.state });
        const canvas = page.locator('.building-plan-canvas');
        async function drag(from, to, bypass = true) {
          await canvas.scrollIntoViewIfNeeded();
          const box = await canvas.boundingBox();
          const m = await canvas.evaluate((element) => {
            const m = element.getContext('2d').getTransform();
            return { x: m.e, y: m.f, z: m.a };
          });
          if (bypass) await page.keyboard.down('Alt');
          await page.mouse.move(box.x + m.x + from[0] * 20 * m.z, box.y + m.y + from[1] * 20 * m.z);
          await page.mouse.down();
          await page.mouse.move(box.x + m.x + to[0] * 20 * m.z, box.y + m.y + to[1] * 20 * m.z, {
            steps: 24,
          });
          let result;
          try {
            result = await command(page, 'building-plan-operation', () => page.mouse.up());
          } catch (error) {
            throw new Error(
              `${error.message}; ${JSON.stringify({ from, to, conflicts: await page.locator('.building-plan-conflict').allTextContents() })}`
            );
          }
          if (bypass) await page.keyboard.up('Alt');
          return readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: result.state });
        }
        await drag([7, 3.2], [7, 3.8]);
        const reversed = await drag([7, 3.8], [7, 2.6]);
        assert.ok(reversed.floors[0].rooms[0].vertices.some((v) => v.x === 2.8 && v.y === 2.4));
        await command(page, 'cancel', () => control(row(page, 0), 'cancel').click());
        await command(page, 'open-row', () => control(row(page, 0), 'edit').click());
        await drag([7, 3.2], [7, 2.6]);
        await drag([7, 2.6], [7, 3.8]);
        let box = await canvasBox(canvas);
        await page.mouse.move(box.x + 20, box.y + 66);
        await page.mouse.wheel(0, -1600);
        await page.waitForTimeout(100);
        const aligned = await drag([1, 3], [1, 3.8], false);
        assert.equal(aligned.floors[0].rooms[0].vertices.length, 4);
        assert.ok(aligned.floors[0].rooms[0].vertices.some((v) => v.y === 3.6));
        await command(page, 'cancel', () => control(row(page, 0), 'cancel').click());
        await command(page, 'open-row', () => control(row(page, 0), 'edit').click());
        await page.getByRole('button', { name: 'Reset view', exact: true }).click();
        await canvas.scrollIntoViewIfNeeded();
        box = await canvasBox(canvas);
        await page.getByRole('button', { name: 'Pin / unpin', exact: true }).click();
        await page.mouse.click(box.x + 140, box.y + 64);
        await page.getByRole('button', { name: 'Select / Move / Resize', exact: true }).click();
        const reshaped = await drag([8, 6.2], [9, 6.25], false);
        assert.deepEqual(reshaped.floors[0].rooms[1].vertices[2], {
          ...initial.floors[0].rooms[1].vertices[2],
          x: 9,
        });
        assert.deepEqual(reshaped.floors[0].rooms[0].vertices, initial.floors[0].rooms[0].vertices);
        const restored = await command(page, 'cancel', () =>
          control(row(page, 0), 'cancel').click()
        );
        assert.deepEqual(
          readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: restored.state }).floors[0]
            .rooms,
          initial.floors[0].rooms
        );
      }
    );
    await scenario(
      lifecycle,
      'jog corner preserves stationary walls and reverses with an optional pin',
      sharedSeed(3, true),
      false,
      async (page) => {
        const canvas = page.locator('.building-plan-canvas');
        async function drag(from, to, bypass = false) {
          await canvas.scrollIntoViewIfNeeded();
          const box = await canvasBox(canvas);
          if (bypass) await page.keyboard.down('Alt');
          await page.mouse.move(box.x + from[0] * 20, box.y + from[1] * 20);
          await page.mouse.down();
          await page.mouse.move(box.x + to[0] * 20, box.y + to[1] * 20, { steps: 24 });
          const response = await command(page, 'building-plan-operation', () => page.mouse.up());
          if (bypass) await page.keyboard.up('Alt');
          return readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: response.state });
        }
        for (const pin of [false, true]) {
          await command(page, 'open-row', () => control(row(page, 0), 'edit').click());
          await drag([8, 4], [5, 4], true);
          const before = await drag([4, 3.2], [4, 2.2], true);
          if (pin) {
            await page.getByRole('button', { name: 'Pin / unpin', exact: true }).click();
            await canvas.scrollIntoViewIfNeeded();
            const box = await canvasBox(canvas);
            await page.mouse.click(box.x + 25, box.y + 60);
            await page.getByRole('button', { name: 'Select / Move / Resize', exact: true }).click();
          }
          const moved = await drag([3, 2.2], [3, 1.4]);
          for (const old of before.floors[0].rooms[0].vertices.filter((v) => v.y === 3))
            assert.deepEqual(
              moved.floors[0].rooms[0].vertices.find((v) => v.id === old.id),
              old
            );
          for (const room of moved.floors[0].rooms)
            for (const vertex of room.vertices.filter((v) => v.x > 4.9)) assert.equal(vertex.x, 5);
          const colors = await canvas.evaluate((element) => {
            const ctx = element.getContext('2d'),
              m = ctx.getTransform();
            const pixel = (x, y) =>
              [
                ...ctx.getImageData(Math.round(x * m.a + m.e), Math.round(y * m.d + m.f), 1, 1)
                  .data,
              ].slice(0, 3);
            return { band: pixel(102, 54), outside: pixel(106, 40) };
          });
          assert.deepEqual(colors.band, [68, 68, 68]);
          assert.notDeepEqual(colors.outside, [68, 68, 68]);
          if (!pin && process.env.FORM0_BUILDING_PLAN_CORNER_SCREENSHOT)
            await canvas.screenshot({ path: process.env.FORM0_BUILDING_PLAN_CORNER_SCREENSHOT });
          const restored = await drag([3, 1.4], [3, 2.18]);
          assert.deepEqual(
            restored.floors[0].rooms.map((r) => r.vertices),
            before.floors[0].rooms.map((r) => r.vertices)
          );
          await command(page, 'cancel', () => control(row(page, 0), 'cancel').click());
        }
      }
    );
    await scenario(
      lifecycle,
      'shared diagonal junctions preserve alignment and guided wall movement',
      sharedSeed(3, true),
      false,
      async (page) => {
        const canvas = page.locator('.building-plan-canvas');
        async function drag(from, to, bypass = false) {
          await canvas.scrollIntoViewIfNeeded();
          const box = await canvasBox(canvas);
          if (bypass) await page.keyboard.down('Alt');
          await page.mouse.move(box.x + from[0] * 20, box.y + from[1] * 20);
          await page.mouse.down();
          await page.mouse.move(box.x + to[0] * 20, box.y + to[1] * 20, { steps: 24 });
          const result = await command(page, 'building-plan-operation', () => page.mouse.up());
          if (bypass) await page.keyboard.up('Alt');
          const plan = readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: result.state });
          assert.deepEqual(createBuildingPlanSession({ snapshot: plan }).validate(), []);
          return plan;
        }
        await command(page, 'open-row', () => control(row(page, 0), 'edit').click());
        await drag([8, 3.2], [8, 2.6], true);
        const moved = await drag([6, 2.84], [7, 2.86]);
        assert.ok(Math.abs(moved.floors[0].rooms[1].vertices[1].y - 2.72) < 1e-5);
        assert.ok(Math.abs(moved.floors[0].rooms[1].vertices[0].x - 3) < 1e-6);
        assert.ok(Math.abs(moved.floors[0].rooms[1].vertices[1].x - 8) < 1e-6);
        await command(page, 'cancel', () => control(row(page, 0), 'cancel').click());
        await command(page, 'open-row', () => control(row(page, 0), 'edit').click());
        const down = await drag([3, 3.2], [3, 3.8], true);
        const returns = down.floors[0].rooms[0].faces
          .flatMap((face) =>
            down.floors[0].walls.filter((w) => w.id === face.wallId).flatMap((w) => w.segments)
          )
          .filter(
            (segment) =>
              Math.abs(segment.start.x - 2.9) < 1e-6 && Math.abs(segment.end.x - 2.9) < 1e-6
          );
        assert.equal(returns.length, 1);
      }
    );
    await scenario(
      lifecycle,
      'opposite jog thickness and detachment remove unbound tails',
      sharedSeed(3, true),
      false,
      async (page) => {
        const opened = await command(page, 'open-row', () => control(row(page, 0), 'edit').click());
        const initial = readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: opened.state });
        const canvas = page.locator('.building-plan-canvas');
        await canvas.scrollIntoViewIfNeeded();
        let box = await canvasBox(canvas);
        await page.keyboard.down('Alt');
        await page.mouse.move(box.x + 140, box.y + 64);
        await page.mouse.down();
        await page.mouse.move(box.x + 140, box.y + 52, { steps: 8 });
        const jog = await command(page, 'building-plan-operation', () => page.mouse.up());
        await page.keyboard.up('Alt');
        const p = readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: jog.state });
        const originalLeft = initial.floors[0].rooms[1].faces[3].wallId;
        assert.ok(p.floors[0].rooms[0].vertices.some((v) => v.x === 2.8));
        assert.ok(p.floors[0].rooms[0].faces.some((f) => f.wallId === originalLeft));
        await page.getByRole('button', { name: 'Clear Selection', exact: true }).click();
        await page.getByRole('button', { name: 'Pin / unpin', exact: true }).click();
        const colors = await canvas.evaluate((element) => {
          const ctx = element.getContext('2d'),
            m = ctx.getTransform();
          const pixel = (x, y) =>
            [
              ...ctx.getImageData(Math.round(x * m.a + m.e), Math.round(y * m.d + m.f), 1, 1).data,
            ].slice(0, 3);
          return { band: pixel(58, 56), interior: pixel(62, 56) };
        });
        assert.deepEqual(colors.band, [68, 68, 68]);
        assert.notDeepEqual(colors.interior, [68, 68, 68]);
        await command(page, 'cancel', () => control(row(page, 0), 'cancel').click());
        await command(page, 'open-row', () => control(row(page, 0), 'edit').click());
        await page.getByRole('button', { name: 'Select / Move / Resize', exact: true }).click();
        await canvas.scrollIntoViewIfNeeded();
        box = await canvasBox(canvas);
        await page.keyboard.down('Alt');
        await page.mouse.move(box.x + 40, box.y + 25);
        await page.mouse.down();
        await page.mouse.move(box.x - 160, box.y + 25, { steps: 8 });
        const detached = await command(page, 'building-plan-operation', () => page.mouse.up());
        await page.keyboard.up('Alt');
        const next = readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: detached.state });
        const wallId = initial.floors[0].rooms[1].faces[0].wallId;
        const stationary = next.floors[0].walls.find((w) => w.id === wallId);
        assert.deepEqual([stationary.segments[0].start.x, stationary.segments[0].end.x], [8, 3]);
        assert.deepEqual(next.floors[0].observations, initial.floors[0].observations);
        const tail = await canvas.evaluate((element) => {
          const ctx = element.getContext('2d'),
            m = ctx.getTransform();
          return [
            ...ctx.getImageData(Math.round(20 * m.a + m.e), Math.round(62 * m.d + m.f), 1, 1).data,
          ].slice(0, 3);
        });
        assert.notDeepEqual(tail, [68, 68, 68]);
      }
    );
    await scenario(
      lifecycle,
      'jog feedback: six rows, compound paths, magnetic realignment, header scrolling and conflicts',
      sharedSeed(),
      false,
      async (page) => {
        const opened = await command(page, 'open-row', () => control(row(page, 0), 'edit').click());
        const initial = readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: opened.state });
        const wallRecord =
          opened.state.repeatable[key('floors')][0].repeatable[key('rooms')][0].repeatable[
            key('walls')
          ][2];
        const canvas = page.locator('.building-plan-canvas');
        await canvas.scrollIntoViewIfNeeded();
        const box = await canvasBox(canvas);
        for (const direction of ['above', 'below']) {
          await page.evaluate((direction) => {
            const pane = document.querySelector('.building-plan-detail-panel');
            pane.scrollTop = direction === 'above' ? 0 : pane.scrollHeight;
          }, direction);
          await page.mouse.click(box.x + 40, box.y + 60);
          await page.waitForTimeout(700);
          const offset = await row(page, wallRecord.id).evaluate(
            (element) =>
              element.querySelector(':scope > .repeatable-instance-header').getBoundingClientRect()
                .top - element.closest('.building-plan-detail-panel').getBoundingClientRect().top
          );
          assert.ok(
            Math.abs(offset) < 24,
            `${direction}: wall header offset ${offset}, pane ${await page.locator('.building-plan-detail-panel').evaluate((p) => JSON.stringify({ scroll: p.scrollTop, max: p.scrollHeight - p.clientHeight, height: p.clientHeight }))}`
          );
        }
        async function drag(from, to, bypass = true) {
          if (bypass) await page.keyboard.down('Alt');
          await page.mouse.move(box.x + 40, box.y + from);
          await page.mouse.down();
          await page.mouse.move(box.x + 40, box.y + to, { steps: 8 });
          const result = await command(page, 'building-plan-operation', () => page.mouse.up());
          if (bypass) await page.keyboard.up('Alt');
          return readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: result.state });
        }
        let plan = await drag(60, 64);
        assert.equal(plan.floors[0].rooms[1].faces.length, 6);
        assert.equal(plan.floors[0].walls.length, 9);
        plan = await drag(64, 56);
        assert.equal(plan.floors[0].rooms[1].faces.length, 6);
        for (const wall of plan.floors[0].walls)
          for (const segment of wall.segments)
            assert.ok(
              Math.abs(segment.start.x - segment.end.x) < 1e-6 ||
                Math.abs(segment.start.y - segment.end.y) < 1e-6
            );
        // Magnetic capture aligns to the neighbouring face, accounting for thickness.
        plan = await drag(56, 62, false);
        assert.equal(plan.floors[0].rooms[1].faces.length, 4);
        assert.equal(plan.floors[0].walls.length, 7);
        assert.deepEqual(
          plan.floors[0].rooms.map((room) => room.vertices.map(({ x, y }) => ({ x, y }))),
          initial.floors[0].rooms.map((room) => room.vertices.map(({ x, y }) => ({ x, y })))
        );
        const before = (await settle(page)).state;
        await page.keyboard.down('Alt');
        await page.mouse.move(box.x + 40, box.y + 60);
        await page.mouse.down();
        await page.mouse.move(box.x + 40, box.y + 124, { steps: 8 });
        await page.mouse.up();
        await page.keyboard.up('Alt');
        const conflict = page.locator('.building-plan-conflict');
        await conflict.waitFor({ state: 'visible' });
        assert.match(await conflict.textContent(), /smaller drag|shorter|back|cancel/i);
        assert.doesNotMatch(await conflict.textContent(), /invalid extent/);
        assert.deepEqual((await settle(page)).state.repeatable, before.repeatable);
      }
    );
    await scenario(
      lifecycle,
      'editor settings apply to future gestures and edge pan commits once',
      sharedSeed(),
      false,
      async (page) => {
        const opened = await command(page, 'open-row', () => control(row(page, 0), 'edit').click());
        await page.getByRole('button', { name: 'Open settings', exact: true }).click();
        await page.locator('#settings-building-plan-preserveWallGrouping').check();
        await page.locator('.settings-modal-footer button.primary-button').click();
        const canvas = page.locator('.building-plan-canvas');
        await canvas.scrollIntoViewIfNeeded();
        const box = await canvasBox(canvas);
        await page.keyboard.down('Alt');
        await page.mouse.move(box.x + 40, box.y + 60);
        await page.mouse.down();
        await page.mouse.move(box.x + 40, box.y + 64, { steps: 8 });
        const result = await command(page, 'building-plan-operation', () => page.mouse.up());
        await page.keyboard.up('Alt');
        const plan = readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: result.state });
        assert.equal(plan.floors[0].walls.length, 7);
        assert.equal(plan.floors[0].rooms[1].faces.length, 6);
        await command(page, 'cancel', () => control(row(page, 0), 'cancel').click());
        await command(page, 'open-row', () => control(row(page, 0), 'edit').click());
        let operations = 0;
        page.on('request', (request) => {
          if (
            request.url().endsWith('/api/preview-events') &&
            request.postDataJSON()?.action === 'building-plan-operation'
          )
            operations++;
        });
        await page.mouse.move(box.x + 40, box.y + 30);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width - 3, box.y + 30, { steps: 8 });
        await page.waitForTimeout(420);
        assert.equal(operations, 0);
        const moved = await command(page, 'building-plan-operation', () => page.mouse.up());
        assert.equal(operations, 1);
        const after = readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: moved.state });
        const original = readBuildingPlanRecord({
          meta: buildingPlanMeta[0],
          record: opened.state,
        });
        assert.ok(
          after.floors[0].rooms[0].vertices[0].x - original.floors[0].rooms[0].vertices[0].x >
            (box.width - 43) / 20,
          'Holding near the edge must continue moving through a panned viewport'
        );
      }
    );
    await scenario(
      lifecycle,
      'same-line room alignment and the supplied shared corner sequence',
      sharedSeed(),
      false,
      async (page) => {
        await command(page, 'open-row', () => control(row(page, 0), 'edit').click());
        const canvas = page.locator('.building-plan-canvas');
        await canvas.scrollIntoViewIfNeeded();
        let box = await canvasBox(canvas);
        let lastOperation;
        page.on('request', (request) => {
          if (request.url().endsWith('/api/preview-events') && request.postDataJSON()?.operation)
            lastOperation = request.postDataJSON().operation;
        });
        async function drag(from, to, bypass = true) {
          await canvas.scrollIntoViewIfNeeded();
          box = await canvasBox(canvas);
          if (bypass) await page.keyboard.down('Alt');
          await page.mouse.move(box.x + from[0], box.y + from[1]);
          await page.mouse.down();
          await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 8 });
          const result = await command(page, 'building-plan-operation', () => page.mouse.up());
          if (bypass) await page.keyboard.up('Alt');
          return readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: result.state });
        }
        let plan = await drag([40, 60], [40, 72]);
        plan = await drag([100, 30], [92, 30]);
        plan = await drag([92, 30], [96, 30], true);
        assert.equal(plan.floors[0].rooms[0].vertices[1].x, 4.8);
        plan = await drag([40, 72], [40, 56]);
        assert.equal(plan.floors[0].rooms[1].vertices.length, 6);
        await command(page, 'cancel', () => control(row(page, 0), 'cancel').click());
        await command(page, 'open-row', () => control(row(page, 0), 'edit').click());
        plan = await drag([75, 112], [17.4, 112], false);
        assert.equal(plan.floors[0].rooms[1].vertices[0].x, 0, JSON.stringify(lastOperation));
        assert.equal(plan.floors[0].rooms[1].vertices[0].y, 3.2);
      }
    );
    await scenario(
      lifecycle,
      'opening cut confirmation cancels or removes with one reversible operation',
      (() => {
        const record = sharedSeed();
        const snapshot = readBuildingPlanRecord({ meta: buildingPlanMeta[0], record });
        const session = createBuildingPlanSession({ snapshot });
        const floor = snapshot.floors[0],
          wallId = floor.rooms[0].faces[2].wallId;
        const created = session.apply({
          type: 'create_opening',
          floorId: floor.id,
          wallId,
          kind: 'door',
          offset: 3.5,
          width: 0.9,
          height: 2,
          values: { door_label: 'Shared door' },
        });
        assert.equal(created.status, 'applied');
        session.apply({
          type: 'add_observation',
          floorId: floor.id,
          subject: { type: 'door', id: created.created.id },
          observedAt: '2026-11-03',
          evidence: ['opening-photo'],
        });
        return writeBuildingPlanRecord({
          meta: buildingPlanMeta[0],
          plan: session.getSnapshot(),
          record,
        });
      })(),
      false,
      async (page) => {
        const opened = await command(page, 'open-row', () => control(row(page, 0), 'edit').click());
        const before = readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: opened.state });
        const canvas = page.locator('.building-plan-canvas');
        await canvas.scrollIntoViewIfNeeded();
        const box = await canvasBox(canvas);
        let accept = false,
          prompts = 0;
        page.removeAllListeners('dialog');
        page.on('dialog', (dialog) => {
          prompts++;
          assert.match(dialog.message(), /Shared door/);
          assert.match(dialog.message(), /associated observation/);
          return accept ? dialog.accept() : dialog.dismiss();
        });
        async function startCut() {
          await page.keyboard.down('Alt');
          await page.mouse.move(box.x + 60, box.y + 100);
          await page.mouse.down();
          await page.mouse.move(box.x + 80, box.y + 100, { steps: 8 });
        }
        await startCut();
        await page.mouse.up();
        await page.keyboard.up('Alt');
        await page.locator('.building-plan-conflict').waitFor({ state: 'visible' });
        assert.equal(prompts, 1);
        assert.deepEqual(
          readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: (await settle(page)).state }),
          before
        );
        accept = true;
        await startCut();
        const result = await command(page, 'building-plan-operation', () => page.mouse.up());
        await page.keyboard.up('Alt');
        const after = readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: result.state });
        assert.equal(prompts, 2);
        assert.equal(after.floors[0].walls.flatMap((w) => w.doors).length, 0);
        assert.equal(after.floors[0].observations.length, 0);
        assert.equal(after.floors[0].rooms[1].vertices[0].x, 4);
        const undone = await command(page, 'building-plan-history', () =>
          page.getByRole('button', { name: 'Undo', exact: true }).click()
        );
        assert.deepEqual(
          readBuildingPlanRecord({ meta: buildingPlanMeta[0], record: undone.state }),
          before
        );
      }
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
  await stopPreviewServer();
  await rm(directory, { recursive: true, force: true });
}
