// Optional real-pointer gate. Uses an existing Playwright/Chromium installation.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  readBuildingPlanRecord,
  createBuildingPlanSession,
  writeBuildingPlanRecord,
} from 'form0-core';
import { fixture } from '../tests/fixtures/building-plan-v2.js';
import { createApp } from '../src/server/express-server.js';
import { createWebSocketServer } from '../src/server/websocket.js';

const { chromium } = await import(process.env.FORM0_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.FORM0_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.FORM0_CHROMIUM_EXECUTABLE }
    : {}),
});
const until = async (check) => {
  const deadline = Date.now() + 10000;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, 'The preview did not settle.');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};
try {
  // Each batch gets fresh assets and sessions without disturbing manual previews.
  const scenarios = [
    { providers: ['interior'], wall: 'W2', distances: [4, -2, -2, 5, -5] },
    { providers: ['exterior'], wall: 'W2', distances: [4, -2, -2, 5, -5] },
    ...[[], ['exterior'], ['interior'], ['exterior', 'interior']].map((providers) => ({
      providers,
      wall: 'W3',
      distances: [-0.3, 0.3],
    })),
  ];
  scenarios.push(
    ...[[], ['exterior'], ['exterior', 'interior']].map((providers) => ({
      providers,
      wall: 'W3.2',
      distances: [0.3, 0.3, -0.1],
    }))
  );
  for (const scenario of scenarios.filter(
    (scenario) =>
      !process.env.FORM0_BUILDING_PLAN_WALL ||
      scenario.wall === process.env.FORM0_BUILDING_PLAN_WALL
  )) {
    const f = fixture({}),
      nodes = f.nodes,
      fields = nodes.floors.fieldsByOriginalDataName;
    const domain = createBuildingPlanSession({
      snapshot: readBuildingPlanRecord({ meta: f.meta, record: f.record }),
      properties: f.meta.properties,
    });
    const shared = domain
      .getSnapshot()
      .floors[0].walls.find((wall) => wall.exposure === 'interior');
    if (scenario.wall === 'W2')
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
    const directory = await mkdtemp(path.join(os.tmpdir(), 'form0-default-boundaries-'));
    const server = createApp(
      () => f.schema,
      () => 'Automatic boundary regression',
      directory,
      { diagnostics: false }
    ).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const sockets = createWebSocketServer(
      server,
      () => f.schema,
      () => 'Automatic boundary regression',
      {}
    );
    try {
      for (const choice of scenario.wall === 'W3.2' ? ['apply'] : ['apply', 'preserve'])
        for (const alt of [false, true]) {
          const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
          page.setDefaultTimeout(10000);
          let latest = record;
          const replies = [],
            errors = [];
          page.on('pageerror', (error) => errors.push(error.message));
          page.on('response', async (response) => {
            if (!response.url().endsWith('/api/preview-events')) return;
            const result = await response.json().catch(() => null);
            if (!result) return;
            if (result.state) latest = result.state;
            const request = response.request().postDataJSON();
            replies.push({ action: request.action, operation: request.operation, ...result });
          });
          await page.addInitScript(() =>
            localStorage.setItem(
              'form0-preview-events',
              JSON.stringify({
                lifecycle: false,
                recordKind: 'existing',
                readonly: false,
                fieldInteractions: [],
              })
            )
          );
          await page.route('**/api/preview-session', (route) =>
            route.continue({
              postData: JSON.stringify({ ...route.request().postDataJSON(), state: record }),
            })
          );
          try {
            await page.goto(`http://127.0.0.1:${server.address().port}`);
            await page.waitForFunction(() => window.form0PreviewEvents);
            const row = page.locator(
              `.repeatable-instance[data-instance-id="${record.repeatable[nodes.floors.preferredKey][0].id}"]`
            );
            await row
              .locator(':scope > .repeatable-instance-header [data-preview-row-action="edit"]')
              .click();
            const model = () => readBuildingPlanRecord({ meta: f.meta, record: latest });
            for (const provider of scenario.providers) {
              const name = fields[`floor_${provider}_wall_thickness`].dataName;
              const pendingUpdate = page.waitForResponse((response) => {
                if (!response.url().endsWith('/api/preview-events')) return false;
                const request = response.request().postDataJSON();
                return request.action === 'update' && request.fieldKey === name;
              });
              await row.locator(`input[name="${name}"]`).fill('500');
              await pendingUpdate;
              // Keep focus in the numeric input until the update has been painted.
              // A mixed pending-value/accepted-geometry record used to show a false
              // thickness conflict here, even though the subsequent blur succeeded.
              await page.evaluate(
                () =>
                  new Promise((resolve) =>
                    requestAnimationFrame(() => requestAnimationFrame(resolve))
                  )
              );
              assert.equal(
                await page.locator('.building-plan-conflict:visible').count(),
                0,
                'Pending thickness input must not produce a geometry conflict.'
              );
              await row.locator(`input[name="${fields.floor_elevation.dataName}"]`).click();
              await until(() => {
                // Field updates arrive before the changed/valid blur transaction.
                // Wait for accepted geometry, rather than parsing that pending edit
                // as if it were already a complete semantic record.
                try {
                  const floor = model().floors[0];
                  return (
                    floor.values[`floor_${provider}_wall_thickness`] === 0.5 &&
                    floor.walls
                      .filter((wall) => wall.exposure === provider)
                      .every((wall) => wall.properties.wall_thickness_m === 0.5)
                  );
                } catch (error) {
                  if (error.issues?.every((issue) => issue.code === 'binding_thickness_mismatch'))
                    return false;
                  throw error;
                }
              });
            }
            if (scenario.wall !== 'W2') {
              // Small drags must exceed magnetic attraction at the current zoom.
              const canvas = page.locator('.building-plan-canvas');
              await canvas.scrollIntoViewIfNeeded();
              const box = await canvas.boundingBox();
              const camera = await canvas.evaluate((element) => {
                const m = element.getContext('2d').getTransform();
                return { x: m.e, y: m.f, z: m.a };
              });
              const floor = model().floors[0],
                room = floor.rooms[0];
              const face = room.faces.find(
                (face) =>
                  floor.walls.find((wall) => wall.id === face.wallId).autoLabel === scenario.wall
              );
              const edge = room.edges.find((edge) => face.edgeIds.includes(edge.id));
              const a = room.vertices.find((p) => p.id === edge.startId),
                b = room.vertices.find((p) => p.id === edge.endId);
              await page.mouse.move(
                box.x + camera.x + ((a.x + b.x) / 2) * 20 * camera.z,
                box.y + camera.y + ((a.y + b.y) / 2) * 20 * camera.z
              );
              await page.mouse.wheel(0, -1500);
              await until(() =>
                canvas.evaluate((element) => element.getContext('2d').getTransform().a >= 3.9)
              );
            }
            let protectedReturn = false;
            // Recompute screen transforms after every accepted operation and scroll.
            for (const distance of !alt && scenario.wall === 'W3'
              ? [-1, 1]
              : !alt && scenario.wall === 'W3.2'
                ? [1, 0.5, -0.8]
                : scenario.distances) {
              const floor = model().floors[0],
                room = floor.rooms[0],
                face = room.faces.find(
                  (face) =>
                    floor.walls.find((wall) => wall.id === face.wallId).autoLabel === scenario.wall
                );
              const edge = room.edges.find((edge) => face.edgeIds.includes(edge.id));
              const a = room.vertices.find((vertex) => vertex.id === edge.startId),
                b = room.vertices.find((vertex) => vertex.id === edge.endId);
              const length = Math.hypot(b.x - a.x, b.y - a.y);
              const delta = {
                x: ((b.y - a.y) / length) * distance,
                y: -((b.x - a.x) / length) * distance,
              };
              let expected = { x: (a.x + b.x) / 2 + delta.x, y: (a.y + b.y) / 2 + delta.y };
              const canvas = page.locator('.building-plan-canvas');
              await canvas.scrollIntoViewIfNeeded();
              let box = await canvas.boundingBox(),
                transform = await canvas.evaluate((element) => {
                  const m = element.getContext('2d').getTransform();
                  return { x: m.e, y: m.f, z: m.a };
                });
              if (scenario.wall !== 'W2') {
                // Center each target with a real pan so neither drag enters the
                // edge-autopan strip or depends on the previous managed dialog.
                const target = {
                  x: box.x + transform.x + ((a.x + b.x) / 2) * 20 * transform.z,
                  y: box.y + transform.y + ((a.y + b.y) / 2) * 20 * transform.z,
                };
                await page.mouse.move(target.x, target.y);
                await page.keyboard.down('Shift');
                await page.mouse.down();
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 });
                await page.mouse.up();
                await page.keyboard.up('Shift');
                await canvas.evaluate(
                  () =>
                    new Promise((resolve) =>
                      requestAnimationFrame(() => requestAnimationFrame(resolve))
                    )
                );
                box = await canvas.boundingBox();
                transform = await canvas.evaluate((element) => {
                  const m = element.getContext('2d').getTransform();
                  return { x: m.e, y: m.f, z: m.a };
                });
              }
              const start = {
                x: box.x + transform.x + ((a.x + b.x) / 2) * 20 * transform.z,
                y: box.y + transform.y + ((a.y + b.y) / 2) * 20 * transform.z,
              };
              const beforeDrag = model();
              replies.length = 0;
              if (alt) await page.keyboard.down('Alt');
              await page.mouse.move(start.x, start.y);
              await page.mouse.down();
              await page.mouse.move(
                start.x + delta.x * 20 * transform.z,
                start.y + delta.y * 20 * transform.z,
                { steps: 40 }
              );
              await page.mouse.up();
              if (alt) await page.keyboard.up('Alt');
              await until(
                async () =>
                  replies.some((reply) => reply.action === 'building-plan-operation') ||
                  (await page.locator('.building-plan-conflict:visible').count()) > 0
              );
              if (await page.locator('.building-plan-conflict:visible').count()) {
                assert.equal(scenario.wall, 'W3');
                assert.equal(choice, 'preserve');
                assert.equal(scenario.providers.length, 1);
                assert.ok(distance > 0, 'Only retirement of the preserved return is blocked.');
                assert.match(
                  await page.locator('.building-plan-conflict:visible').textContent(),
                  /distinct accepted answers/
                );
                assert.deepEqual(
                  model(),
                  beforeDrag,
                  'Blocked retirement preserves the complete accepted record.'
                );
                protectedReturn = true;
                continue;
              }
              let result = replies.find((reply) => reply.action === 'building-plan-operation');
              const gesture = result.operation;
              assert.equal(
                gesture.faceId,
                face.id,
                'The pointer selects the intended wall portion.'
              );
              assert.ok(
                Math.abs(gesture.distance) > 1e-6,
                'The drag must produce actual movement.'
              );
              assert.equal(Math.sign(gesture.distance), Math.sign(distance));
              if (alt || scenario.wall === 'W2')
                assert.ok(Math.abs(gesture.distance - distance) < 1e-6);
              // Snapping can select a nearby material alignment. The accepted
              // geometry must match that explicit operation; Alt checks exact targets.
              expected = {
                x: (a.x + b.x) / 2 + (delta.x * gesture.distance) / distance,
                y: (a.y + b.y) / 2 + (delta.y * gesture.distance) / distance,
              };

              assert.equal(
                result.operation.type,
                'resize_face',
                'The gesture must edit a wall, not translate its room.'
              );
              for (let question = 0; result.status === 'pending' && question < 3; question++) {
                const dialog = page.getByRole('alertdialog');
                await dialog.waitFor();
                let button = dialog.getByRole('button', {
                  name: choice === 'preserve' ? /^Keep previous values/ : /^Use new defaults/,
                });
                if (!(await button.count()))
                  button = dialog.getByRole('button', { name: 'Copy answers', exact: true });
                const count = replies.length;
                await button.click();
                await until(() =>
                  replies.slice(count).some((reply) => reply.action === 'ui-response')
                );
                result = replies.slice(count).find((reply) => reply.action === 'ui-response');
              }
              assert.equal(result.status, 'applied', JSON.stringify(result.issues));
              await until(() => {
                const accepted = model().floors[0];
                const selected = accepted.rooms[0].faces.find((entry) => entry.id === face.id);
                if (!selected) return false;
                const segment = accepted.rooms[0].edges.find((entry) =>
                  selected.edgeIds.includes(entry.id)
                );
                if (!segment) return false;
                const point = accepted.rooms[0].vertices.find(
                  (vertex) => vertex.id === segment.startId
                );
                return (
                  Math.abs((point.x - expected.x) * delta.x + (point.y - expected.y) * delta.y) <
                  1e-7
                );
              });
              if (scenario.wall === 'W3.2') {
                for (const room of model().floors[0].rooms) {
                  const points = room.vertices;
                  const bends = points.filter((b, index) => {
                    const a = points[(index + points.length - 1) % points.length],
                      c = points[(index + 1) % points.length];
                    const dot =
                      ((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)) /
                      (Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(c.x - b.x, c.y - b.y));
                    return Math.abs(dot - 1) > 1e-7;
                  }).length;
                  assert.ok(bends <= 6, 'Repeated drags must not add cap notches.');
                }
              }
              for (const provider of scenario.providers)
                assert.equal(model().floors[0].values[`floor_${provider}_wall_thickness`], 0.5);
              assert.ok(
                model().floors[0].rooms[0].vertices.some(
                  (point) => Math.abs(point.x) < 1e-7 && Math.abs(point.y) < 1e-7
                ),
                'The opposite room corner remains fixed.'
              );
              assert.equal(
                model().floors[0].walls.flatMap((wall) => wall.doors).length,
                scenario.wall === 'W2' ? 1 : 0
              );
              assert.equal(await page.getByRole('alertdialog').count(), 0);
            }
            await row.getByRole('button', { name: 'Save row', exact: true }).click();
            await row
              .locator(':scope > .repeatable-instance-header [data-preview-row-action="edit"]')
              .waitFor();
            assert.ok(
              model().floors[0].rooms[0].vertices.some((vertex) => Math.abs(vertex.x - 5) < 1e-7)
            );
            assert.deepEqual(errors, []);
            console.log(
              `${protectedReturn ? 'Preserved-answer retirement guard and ordinary Save' : 'Outward/return drags and ordinary Save'} passed: ${scenario.wall}, ${scenario.providers.join('+') || 'uniform 200'}, ${choice}, Alt=${alt}`
            );
          } finally {
            await page.close();
          }
        }
    } finally {
      sockets.wss.close();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    }
  }
} finally {
  await browser.close();
}
