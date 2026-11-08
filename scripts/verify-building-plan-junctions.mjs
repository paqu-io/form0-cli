// Optional real-pointer gate; reuses supplied Playwright/Chromium and installs nothing.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildingPlanCanvasSnapshot,
  createBuildingPlanSession,
  readBuildingPlanRecord,
  writeBuildingPlanRecord,
} from 'form0-core';
import { fixture } from '../tests/fixtures/building-plan-v2.js';
import { createApp } from '../src/server/express-server.js';
import { createWebSocketServer } from '../src/server/websocket.js';

const f = fixture();
const domain = createBuildingPlanSession({
  snapshot: readBuildingPlanRecord({ meta: f.meta, record: f.record }),
  properties: f.meta.properties,
});
const apply = (operation) => {
  const result = domain.apply({ floorId: f.floorId, ...operation });
  assert.equal(result.status, 'applied', JSON.stringify(result.issues));
  return result;
};
const recordFor = () =>
  writeBuildingPlanRecord({ meta: f.meta, record: f.record, plan: domain.getSnapshot() });
for (const [label, distance] of [
  ['W2', 6.2],
  ['W3.2', 3.2],
]) {
  const plan = domain.getSnapshot(),
    record = recordFor();
  const wall = buildingPlanCanvasSnapshot({ meta: f.meta, record, plan }).walls.find(
    (wall) => wall.roomId === plan.floors[0].rooms[0].id && wall.displayLabel === label
  );
  apply({ type: 'resize_face', faceId: wall.id, distance });
}
const base = recordFor();
const shared = domain
  .getSnapshot()
  .floors[0].walls.find((wall) => wall.sides.every((side) => side.roomId));
const room3 = apply({ type: 'create_room', rectangle: { x: 8.7, y: 3.6, width: 3, height: 3 } })
  .created.id;
const detached = recordFor();
const directory = await mkdtemp(path.join(os.tmpdir(), 'form0-junction-pointer-'));
const server = createApp(
  () => f.schema,
  () => 'Junction regression',
  directory,
  { diagnostics: false }
).listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const sockets = createWebSocketServer(
  server,
  () => f.schema,
  () => 'Junction regression',
  {}
);
const { chromium } = await import(process.env.FORM0_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.FORM0_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.FORM0_CHROMIUM_EXECUTABLE }
    : {}),
});
const row = (page, id) => page.locator(`.repeatable-instance[data-instance-id="${id}"]`);
const control = (page, id, action) =>
  row(page, id).locator(
    `:scope > .repeatable-instance-header [data-preview-row-action="${action}"]`
  );
async function command(page, action, perform) {
  const pending = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/preview-events') &&
      response.request().postDataJSON().action === action
  );
  await perform();
  const response = await pending,
    result = await response.json();
  assert.ok(response.ok(), JSON.stringify(result));
  assert.deepEqual(result.issues, []);
  return result;
}
const inside = (point, polygon) => {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      result = !result;
  }
  return result;
};
async function open(record) {
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
      JSON.stringify({ copyCustomAnswersAutomatically: true })
    );
  });
  await page.route('**/api/preview-session', (route) =>
    route.continue({
      postData: JSON.stringify({ ...route.request().postDataJSON(), state: record }),
    })
  );
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const floor = record.repeatable[f.nodes.floors.preferredKey][0];
  await command(page, 'open-row', () => control(page, floor.id, 'edit').click());
  const canvas = page.locator('.building-plan-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox(),
    matrix = await canvas.evaluate((el) => {
      const m = el.getContext('2d').getTransform();
      return { x: m.e, y: m.f, z: m.a };
    });
  const point = (x, y) => ({
    x: box.x + matrix.x + x * 20 * matrix.z,
    y: box.y + matrix.y + y * 20 * matrix.z,
  });
  return { page, floor, canvas, point, errors };
}
try {
  {
    const { page, canvas, point, errors } = await open(detached);
    const before = readBuildingPlanRecord({ meta: f.meta, record: detached });
    const a = point(10.2, 5.1),
      b = point(9.7, 4.7);
    const moved = await command(page, 'building-plan-operation', async () => {
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 20 });
      await page.mouse.up();
    });
    assert.equal(moved.status, 'applied');
    const plan = readBuildingPlanRecord({ meta: f.meta, record: moved.state }),
      floor = plan.floors[0];
    const attached = floor.rooms.find((room) => room.id === room3);
    assert.ok(
      attached.vertices.some((p) => Math.abs(p.x - 8.2) < 1e-6 && Math.abs(p.y - 3.2) < 1e-6)
    );
    assert.ok(
      !floor.walls.some((wall) => {
        const span = wall.segments[0];
        return (
          Math.abs(span.start.y - 3.1) < 1e-6 &&
          Math.abs(span.end.y - 3.1) < 1e-6 &&
          Math.abs(Math.abs(span.end.x - span.start.x) - 0.2) < 1e-6 &&
          Math.max(span.start.x, span.end.x) > 8.1
        );
      }),
      'The divider cap must have no independent physical row'
    );
    const scene = buildingPlanCanvasSnapshot({
      meta: f.meta,
      record: moved.state,
      plan,
      gridSize: 1,
    });
    assert.ok(
      scene.wallFootprints.some((wall) =>
        wall.polygons.some((poly) => inside({ x: 8.1, y: 3.1 }, poly))
      )
    );
    const undo = await command(page, 'building-plan-history', () =>
      page.getByRole('button', { name: 'Undo', exact: true }).click()
    );
    assert.deepEqual(readBuildingPlanRecord({ meta: f.meta, record: undo.state }), before);
    const redo = await command(page, 'building-plan-history', () =>
      page.getByRole('button', { name: 'Redo', exact: true }).click()
    );
    assert.deepEqual(readBuildingPlanRecord({ meta: f.meta, record: redo.state }), plan);
    await canvas.screenshot({ path: '/tmp/form0-junction-room-attachment.png' });
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      'Real-pointer Room 3 attachment: supplied divider cap has material and no physical wall row; Undo/Redo passed.'
    );
  }
  {
    const { page, floor, canvas, errors } = await open(base);
    const room = floor.repeatable[f.nodes.rooms.preferredKey][1];
    const model = f.nodes.walls.fields.find((field) => field.binding?.role === 'storage').dataName;
    const facing = domain
      .getSnapshot()
      .floors[0].rooms[1].faces.find((face) => face.wallId === shared.id);
    const wall = room.repeatable[f.nodes.walls.preferredKey].find(
      (wall) => JSON.parse(wall.values[model]).id === facing.id
    );
    await command(page, 'open-row', () => control(page, room.id, 'edit').click());
    await command(page, 'open-row', () => control(page, wall.id, 'edit').click());
    const thickness = f.nodes.walls.fieldsByOriginalDataName.wall_thickness_m.dataName;
    await row(page, wall.id).locator(`[data-name="${thickness}"] input`).fill('0.8');
    const saved = await command(page, 'accept-row', () => control(page, wall.id, 'save').click());
    const plan = readBuildingPlanRecord({ meta: f.meta, record: saved.state }),
      before = readBuildingPlanRecord({ meta: f.meta, record: base });
    assert.equal(plan.floors[0].walls.length, before.floors[0].walls.length);
    const scene = buildingPlanCanvasSnapshot({
      meta: f.meta,
      record: saved.state,
      plan,
      gridSize: 1,
    });
    const p = { x: 2.9, y: 2.7 };
    assert.ok(scene.wallFootprints.some((wall) => wall.polygons.some((poly) => inside(p, poly))));
    assert.ok(!plan.floors[0].rooms.some((room) => inside(p, room.vertices)));
    assert.deepEqual(plan.floors[0].rooms[1].vertices, before.floors[0].rooms[1].vertices);
    assert.equal(await page.getByRole('alertdialog').count(), 0);
    await canvas.screenshot({ path: '/tmp/form0-junction-thick-corner.png' });
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      'Real-pointer Room 2 focused thickness Save: completed corner, updated clear outline, fixed active face, no extra owner or dialog.'
    );
  }
} finally {
  await browser.close();
  await new Promise((resolve) => sockets.wss.close(resolve));
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
