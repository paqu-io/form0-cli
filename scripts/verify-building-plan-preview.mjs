// Optional pointer-driven gate; reuse existing Playwright and Chromium installations.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expandBuildingPlanSchema, SAFE_SECURITY_CONFIG } from 'form0-core';
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
const seed = () => ({
  values: {},
  repeatable: {
    [key('floors')]: [
      {
        id: 0,
        values: floorValues(),
        repeatable: { [key('rooms')]: [] },
        custom: 'floor metadata',
      },
      {
        id: 'sibling',
        values: floorValues(),
        repeatable: { [key('rooms')]: [] },
        custom: 'sibling metadata',
      },
    ],
  },
});
const directory = await mkdtemp(path.join(os.tmpdir(), 'form0-building-plan-'));
const safe = process.env.FORM0_PREVIEW_SAFE === '1';
const app = createApp(
  () => schema,
  () => 'BuildingPlan fixture',
  directory,
  { diagnostics: false, engineOptions: safe ? { security: SAFE_SECURITY_CONFIG } : {} }
);
const server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const sockets = createWebSocketServer(
  server,
  () => schema,
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
  return command(page, 'canvas-update', async () => {
    await page.mouse.move(box.x + box.width * start[0], box.y + box.height * start[1]);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * end[0], box.y + box.height * end[1], { steps: 8 });
    await page.mouse.up();
  }).catch((error) => {
    throw new Error(`${tool}: ${error.message}`);
  });
}
async function place(page, tool, point) {
  await page.getByRole('button', { name: tool, exact: true }).click();
  const canvas = page.locator('.building-plan-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  return command(page, 'canvas-update', () =>
    page.mouse.click(box.x + box.width * point[0], box.y + box.height * point[1])
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
    assert.equal(saved.eligible, true);
  }
  const saved = await command(page, 'accept-row', () => control(item, 'save').click());
  assert.equal(saved.eligible, true);
}
async function scenario(lifecycle, label, initial, readonly, run) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const result = { lifecycle, label, errors: [] };
  evidence.push(result);
  page.setDefaultTimeout(7000);
  page.on('pageerror', (error) => result.errors.push(error.message));
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
    result.failure = error.message;
  } finally {
    await page.close();
  }
}
try {
  for (const lifecycle of [false, true]) {
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
        await place(page, 'Place Door', [0.4, 0.2]);
        const withOpenings = await place(page, 'Place Window', [0.5, 0.2]);
        const completeRoom =
          withOpenings.state.repeatable[key('floors')][0].repeatable[key('rooms')][0];
        assert.equal(completeRoom.repeatable[key('columns')].length, 1);
        assert.equal(completeRoom.repeatable[key('beams')].length, 1);
        const walls = completeRoom.repeatable[key('walls')];
        assert.equal(
          walls.reduce((sum, wall) => sum + (wall.repeatable[key('doors')]?.length || 0), 0),
          1
        );
        assert.equal(
          walls.reduce((sum, wall) => sum + (wall.repeatable[key('windows')]?.length || 0), 0),
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
      seed(),
      false,
      async (page) => {
        const before = seed();
        let release, held;
        const blocked = new Promise((resolve) => {
          held = resolve;
        });
        const gate = new Promise((resolve) => {
          release = resolve;
        });
        let holdFirstCanvas = true;
        await page.route('**/api/preview-events', async (route) => {
          if (holdFirstCanvas && route.request().postDataJSON()?.action === 'canvas-update') {
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
        assert.equal(saved.eligible, true);
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
