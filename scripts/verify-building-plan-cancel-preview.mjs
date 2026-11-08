// Optional real-pointer regression. Reuses supplied Playwright/Chromium; installs nothing.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createBuildingPlanSession,
  readBuildingPlanRecord,
  writeBuildingPlanRecord,
} from 'form0-core';
import { fixture } from '../tests/fixtures/building-plan-v2.js';
import { createFieldTemplate } from '../src/utils/field-template.js';
import { createApp } from '../src/server/express-server.js';
import { createWebSocketServer } from '../src/server/websocket.js';
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
const before = domain.getSnapshot();
const record = writeBuildingPlanRecord({ meta: f.meta, record: f.record, plan: before });
const directory = await mkdtemp(path.join(os.tmpdir(), 'form0-cancel-preview-'));
const server = createApp(
  () => f.schema,
  () => 'BuildingPlan cancellation regression',
  directory,
  { diagnostics: false }
).listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const sockets = createWebSocketServer(
  server,
  () => f.schema,
  () => 'BuildingPlan cancellation regression',
  {}
);
const { chromium } = await import(process.env.FORM0_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.FORM0_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.FORM0_CHROMIUM_EXECUTABLE }
    : {}),
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  for (const scope of ['floor', 'room', 'wall'])
    for (const alt of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
      page.setDefaultTimeout(10000);
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
      // A normal post-release pointer move can precede a slow topology reply.
      await page.route('**/api/preview-events', async (route) => {
        if (route.request().postDataJSON().action === 'building-plan-operation') {
          const response = await route.fetch();
          await sleep(600);
          await route.fulfill({ response });
        } else await route.continue();
      });
      let latest = record;
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('response', async (response) => {
        if (response.url().endsWith('/api/preview-events')) {
          const result = await response.json();
          if (result.state) latest = result.state;
        }
      });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const floor = record.repeatable[f.nodes.floors.preferredKey][0];
      const room = floor.repeatable[f.nodes.rooms.preferredKey][0];
      const open = async (row) =>
        page
          .locator(`.repeatable-instance[data-instance-id="${row.id}"]`)
          .locator(':scope > .repeatable-instance-header [data-preview-row-action="edit"]')
          .click();
      await open(floor);
      if (scope !== 'floor') await open(room);
      if (scope === 'wall') await open(room.repeatable[f.nodes.walls.preferredKey][1]);
      const canvas = page.locator('.building-plan-canvas');
      await canvas.scrollIntoViewIfNeeded();
      const box = await canvas.boundingBox();
      const matrix = await canvas.evaluate((el) => {
        const m = el.getContext('2d').getTransform();
        return { x: m.e, y: m.f, z: m.a };
      });
      const point = (x, y) => ({
        x: box.x + matrix.x + x * 20 * matrix.z,
        y: box.y + matrix.y + y * 20 * matrix.z,
      });
      const start = point(5, 1.5),
        end = point(10, 1.5);
      if (alt) await page.keyboard.down('Alt');
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 12 });
      await page.mouse.up();
      await page.mouse.move(end.x + 8, end.y, { steps: 3 });
      if (alt) await page.keyboard.up('Alt');
      const reply = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/preview-events') &&
          response.request().postDataJSON().action === 'ui-response'
      );
      await page.getByRole('button', { name: 'Cancel operation', exact: true }).click();
      await reply;
      await sleep(100);
      assert.deepEqual(
        readBuildingPlanRecord({ meta: f.meta, record: latest }),
        before,
        'Cancel restores accepted geometry and answers'
      );
      const red = await canvas.evaluate((el) => {
        const c = el.getContext('2d'),
          m = c.getTransform();
        const image = c.getImageData(
          m.e + 9 * 20 * m.a,
          Math.max(0, m.f - 0.2 * 20 * m.a),
          1.8 * 20 * m.a,
          3.5 * 20 * m.a
        );
        let count = 0;
        for (let i = 0; i < image.data.length; i += 4)
          if (
            image.data[i] > 130 &&
            image.data[i + 1] < 100 &&
            image.data[i + 2] < 100 &&
            image.data[i + 3] > 100
          )
            count++;
        return count;
      });
      assert.equal(red, 0, 'Cancel must clear the rejected red wall and handles');
      assert.deepEqual(errors, []);
      console.log(`Cancel preview cleared: ${scope}, Alt=${alt}`);
      await page.close();
    }
  // Exercise the actual Settings checkbox, including persistence without geometry changes.
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  const checkbox = page.locator('#settings-building-plan-copyCustomAnswersAutomatically');
  assert.equal(await checkbox.isChecked(), false);
  await checkbox.check();
  await page.locator('.settings-modal-footer button.primary-button').click();
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  assert.equal(await checkbox.isChecked(), true);
  await checkbox.uncheck();
  await page.locator('.settings-modal-footer button.primary-button').click();
  await page.getByRole('button', { name: 'Open settings', exact: true }).click();
  assert.equal(await checkbox.isChecked(), false);
  await page.close();
  console.log('CLI auto-copy Settings: off/on/off persisted.');
} finally {
  await browser.close();
  await new Promise((resolve) => sockets.wss.close(resolve));
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
