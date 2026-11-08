// Optional real-pointer gate. Reuses supplied Playwright/Chromium; installs nothing.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createBuildingPlanSession,
  readBuildingPlanRecord,
  writeBuildingPlanRecord,
  buildingPlanCanvasSnapshot,
} from 'form0-core';
import { fixture } from '../tests/fixtures/building-plan-v2.js';
import { createFieldTemplate } from '../src/utils/field-template.js';
import { createApp } from '../src/server/express-server.js';
import { createWebSocketServer } from '../src/server/websocket.js';

// Each scope gets a fresh server so cold page loads respect the existing asset limiter.
const scope = process.env.FORM0_DRAG_SCOPE;
if (!scope) {
  for (const name of ['floor', 'room', 'wall']) {
    const child = spawnSync(
      process.execPath,
      [...process.execArgv, fileURLToPath(import.meta.url)],
      {
        env: { ...process.env, FORM0_DRAG_SCOPE: name },
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      }
    );
    process.stdout.write(child.stdout || '');
    process.stderr.write(child.stderr || '');
    if (child.status !== 0) process.exit(child.status || 1);
  }
  console.log('Continuous pointer drag: all 18 exact-endpoint cases passed.');
  process.exit(0);
}
assert.ok(['floor', 'room', 'wall'].includes(scope));
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
    value: 'Site inspection',
  }).status,
  'applied'
);
const shared = domain
  .getSnapshot()
  .floors[0].walls.find((wall) => wall.sides.every((side) => side.roomId));
assert.equal(
  domain.apply({
    type: 'create_opening',
    floorId: f.floorId,
    wallId: shared.id,
    kind: 'door',
    offset: 0.5,
    width: 0.9,
    height: 2.1,
  }).status,
  'applied'
);
const record = writeBuildingPlanRecord({
  meta: f.meta,
  record: f.record,
  plan: domain.getSnapshot(),
});
const before = readBuildingPlanRecord({ meta: f.meta, record });
const scene = buildingPlanCanvasSnapshot({ meta: f.meta, record, plan: before, gridSize: 1 });
const directory = await mkdtemp(path.join(os.tmpdir(), 'form0-continuous-drag-'));
const server = createApp(
  () => f.schema,
  () => 'Continuous drag regression',
  directory,
  { diagnostics: false }
).listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const sockets = createWebSocketServer(
  server,
  () => f.schema,
  () => 'Continuous drag regression',
  {}
);
const { chromium } = await import(process.env.FORM0_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.FORM0_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.FORM0_CHROMIUM_EXECUTABLE }
    : {}),
});
const openingPositions = (plan) =>
  plan.floors[0].walls.flatMap((wall) =>
    [...wall.doors, ...wall.windows].map((opening) => {
      const span = wall.segments[0],
        length = Math.hypot(span.end.x - span.start.x, span.end.y - span.start.y);
      return {
        id: opening.id,
        width: opening.width,
        height: opening.height,
        x: span.start.x + ((span.end.x - span.start.x) * opening.offset) / length,
        y: span.start.y + ((span.end.y - span.start.y) * opening.offset) / length,
      };
    })
  );
const cases = [
  ['W3.2', 0, [1.5, 3], [1.5, 5], false],
  ['W3.2', 0, [1.5, 3], [1.5, 5], true],
  ['W3.1', 1, [6.5, 3.2], [6.5, 1.2], false],
  ['W3.1', 1, [6.5, 3.2], [6.5, 1.2], true],
  ['W2', 0, [5, 1.5], [7, 1.5], true],
  ['W8', 1, [3, 4.7], [1, 4.7], true],
];
const control = (page, id, action) =>
  page
    .locator(`.repeatable-instance[data-instance-id="${id}"]`)
    .locator(`:scope > .repeatable-instance-header [data-preview-row-action="${action}"]`);
async function command(page, action, perform) {
  const pending = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/preview-events') &&
      response.request().postDataJSON().action === action
  );
  await perform();
  const response = await pending,
    result = await response.json();
  assert.ok(response.ok(), `${action}: HTTP ${response.status()} ${JSON.stringify(result)}`);
  assert.deepEqual(result.issues, []);
  return { result, request: response.request().postDataJSON() };
}
try {
  for (const [label, roomIndex, from, to, alt] of cases) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem(
        'form0-preview-events',
        JSON.stringify({
          lifecycle: false,
          recordKind: 'existing',
          readonly: false,
          fieldInteractions: [],
        })
      );
      localStorage.setItem(
        'form0-cli-building-plan-editing',
        JSON.stringify({ copyCustomAnswersAutomatically: true, inheritedChangePolicy: 'apply' })
      );
    });
    await page.route('**/api/preview-session', (route) =>
      route.continue({
        postData: JSON.stringify({ ...route.request().postDataJSON(), state: record }),
      })
    );
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const floorRow = record.repeatable[f.nodes.floors.preferredKey][0];
    const roomRow = floorRow.repeatable[f.nodes.rooms.preferredKey][roomIndex];
    const selected = scene.walls.find(
      (wall) => wall.roomId === before.floors[0].rooms[roomIndex].id && wall.displayLabel === label
    );
    assert.ok(selected);
    await command(page, 'open-row', () => control(page, floorRow.id, 'edit').click());
    if (scope !== 'floor')
      await command(page, 'open-row', () => control(page, roomRow.id, 'edit').click());
    if (scope === 'wall') {
      const storage = f.nodes.walls.fields.find(
        (field) => field.binding?.role === 'storage'
      ).dataName;
      const wallRow = roomRow.repeatable[f.nodes.walls.preferredKey].find(
        (row) => JSON.parse(row.values[storage]).id === selected.id
      );
      await command(page, 'open-row', () => control(page, wallRow.id, 'edit').click());
    }
    const canvas = page.locator('.building-plan-canvas');
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox(),
      matrix = await canvas.evaluate((el) => {
        const m = el.getContext('2d').getTransform();
        return { x: m.e, y: m.f, z: m.a };
      });
    const point = ([x, y]) => ({
      x: box.x + matrix.x + x * 20 * matrix.z,
      y: box.y + matrix.y + y * 20 * matrix.z,
    });
    const a = point(from),
      b = point(to);
    const { result, request } = await command(page, 'building-plan-operation', async () => {
      if (alt) await page.keyboard.down('Alt');
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      // One rendered frame per sample makes a disappearing preview face observable.
      for (let step = 1; step <= 40; step++) {
        await page.mouse.move(a.x + ((b.x - a.x) * step) / 40, a.y + ((b.y - a.y) * step) / 40);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
      }
      await page.mouse.up();
      if (alt) await page.keyboard.up('Alt');
    });
    assert.equal(request.operation.faceId, selected.id);
    assert.ok(
      Math.abs(Math.abs(request.operation.distance) - 2) < 1e-6,
      'The full 2 m displacement must reach the domain operation'
    );
    assert.equal(result.status, 'applied');
    const after = readBuildingPlanRecord({ meta: f.meta, record: result.state });
    const coordinate = label === 'W2' || label === 'W8' ? 'x' : 'y';
    const increasing = to[coordinate === 'x' ? 0 : 1] > from[coordinate === 'x' ? 0 : 1];
    const extent = after.floors[0].rooms[roomIndex].vertices.map((point) => point[coordinate]);
    assert.ok(
      Math.abs(
        (increasing ? Math.max(...extent) : Math.min(...extent)) - to[coordinate === 'x' ? 0 : 1]
      ) < 1e-6,
      'Accepted geometry must reach the requested endpoint'
    );
    const stationary = before.floors[0].rooms[1 - roomIndex];
    const stationaryAfter = after.floors[0].rooms[1 - roomIndex];
    for (const point of stationary.vertices.filter(
      (point) => !point.physicalBoundaryId || point.editingCutId
    ))
      assert.deepEqual(
        stationaryAfter.vertices.find((other) => other.id === point.id),
        point
      );
    // Adjacency stations may coalesce or appear while the neighbouring outline stays fixed.
    for (const point of stationaryAfter.vertices)
      assert.ok(
        stationary.vertices.some((a, i) => {
          const b = stationary.vertices[(i + 1) % stationary.vertices.length];
          const dx = b.x - a.x,
            dy = b.y - a.y,
            length = Math.hypot(dx, dy);
          const along = ((point.x - a.x) * dx + (point.y - a.y) * dy) / length;
          const offset = ((point.x - a.x) * dy - (point.y - a.y) * dx) / length;
          return Math.abs(offset) < 1e-6 && along >= -1e-6 && along <= length + 1e-6;
        }),
        'The stationary room outline must stay fixed'
      );
    assert.deepEqual(openingPositions(after), openingPositions(before));
    assert.ok(after.floors[0].walls.every((wall) => wall.segments.length === 1));
    assert.equal(await page.getByRole('alertdialog').count(), 0);
    const undone = await command(page, 'building-plan-history', () =>
      page.getByRole('button', { name: 'Undo', exact: true }).click()
    );
    assert.deepEqual(
      readBuildingPlanRecord({ meta: f.meta, record: undone.result.state }),
      before,
      'One Undo must restore the whole gesture'
    );
    const redone = await command(page, 'building-plan-history', () =>
      page.getByRole('button', { name: 'Redo', exact: true }).click()
    );
    assert.deepEqual(readBuildingPlanRecord({ meta: f.meta, record: redone.result.state }), after);
    assert.deepEqual(errors, []);
    console.log(
      `Exact 2 m drag and Undo/Redo passed: ${scope}, Room ${roomIndex + 1} ${label}, Alt=${alt}`
    );
    await page.close();
  }
} finally {
  await browser.close();
  await new Promise((resolve) => sockets.wss.close(resolve));
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
