// Optional browser audit: reuses caller-supplied Playwright/Chromium and installs nothing.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FIELD_SPECS, validateSchema } from 'form0-core';
import { createApp } from '../src/server/express-server.js';
import { createWebSocketServer } from '../src/server/websocket.js';
import {
  builtinFixture,
  fieldFixture,
  attachAuditEvents,
  BUILTIN_CASES,
} from '../tests/fixtures/consumer-compatibility.js';
const { chromium } = await import(process.env.FORM0_PLAYWRIGHT_MODULE || 'playwright');
const directory = await mkdtemp(path.join(os.tmpdir(), 'form0-compatibility-browser-'));
let fixture;
const safe = process.env.FORM0_PREVIEW_SAFE === '1';
const app = createApp(
  () => fixture.schema,
  () => 'Compatibility fixture',
  directory,
  { diagnostics: false, engineOptions: { security: safe ? { mode: 'safe' } : undefined } }
);
const server = await new Promise((resolve) => {
  const value = app.listen(0, '127.0.0.1', () => resolve(value));
});
const sockets = createWebSocketServer(
  server,
  () => fixture.schema,
  () => 'Compatibility fixture',
  {}
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.FORM0_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.FORM0_CHROMIUM_EXECUTABLE }
    : {}),
});
const report = { safe, cases: [], pageErrors: [] };
const settle = (page) =>
  page.evaluate(() => window.form0PreviewEvents.dispatch({ type: 'focus', fieldKey: 'amount' }));
try {
  for (const kind of ['builtins', 'fields']) {
    fixture = attachAuditEvents(
      FIELD_SPECS,
      kind === 'builtins' ? builtinFixture(FIELD_SPECS) : fieldFixture(FIELD_SPECS),
      kind
    );
    validateSchema(fixture.schema.form);
    const page = await browser.newPage();
    page.setDefaultTimeout(6000);
    page.on('pageerror', (e) => report.pageErrors.push(e.message));
    const item = { kind, checks: [] };
    report.cases.push(item);
    await page.addInitScript(() =>
      localStorage.setItem(
        'form0-preview-events',
        JSON.stringify({
          lifecycle: true,
          recordKind: 'existing',
          readonly: false,
          fieldInteractions: [],
        })
      )
    );
    await page.route('**/api/preview-session', async (route) => {
      const body = route.request().postDataJSON();
      body.state = fixture.snapshot;
      await route.continue({ postData: JSON.stringify(body) });
    });
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(() => window.form0PreviewEvents);
      if (kind === 'builtins') {
        const initial = await settle(page);
        for (const [name, , expected] of BUILTIN_CASES)
          assert.deepEqual(initial.state.values['builtin_' + name.toLowerCase()], expected, name);
        for (const trace of ['x', 'xx']) {
          await page.evaluate(() => {
            window.dispatching = window.form0PreviewEvents.dispatch({
              type: 'change',
              fieldKey: 'amount',
            });
          });
          await page.locator('.alert-dialog-ok-btn').click();
          const updated = await page.evaluate(() => window.dispatching);
          assert.deepEqual(updated.issues, []);
          assert.equal(updated.state.values.event_trace, trace);
          const results = JSON.parse(updated.state.values.event_summary);
          for (const [name, , expected] of BUILTIN_CASES.filter(
            ([n]) => !['SETRESULT', 'REPEATABLEVALUES', 'REPEATABLESUM'].includes(n)
          ))
            assert.deepEqual(results[name], expected, name + ' event');
        }
        item.checks.push('26 calculations, 23 event expressions, ON/OFF, SETVALUE, ALERT once');
        await page.locator('[data-name="amount"] input').fill('-1');
        await page.locator('.alert-dialog-ok-btn').click();
        await settle(page);
        const invalid = await page.evaluate(() =>
          window.form0PreviewEvents.prepareSave({ intent: 'submit' })
        );
        assert.equal(invalid.eligible, false);
        assert.match(JSON.stringify(invalid.validationSummary), /Root amount is invalid/);
        const draft = await page.evaluate(() =>
          window.form0PreviewEvents.prepareSave({ intent: 'draft' })
        );
        assert.equal(draft.eligible, true);
        item.checks.push('INVALID and invalid root draft');
      } else {
        for (const stage of [1, 2, 3]) {
          await page.locator('[data-name="stage"] input').fill(String(stage));
          const updated = await settle(page);
          assert.deepEqual(updated.issues, []);
          const expected =
            stage === 1 ? fixture.changed : stage === 2 ? fixture.cleared : fixture.snapshot.values;
          for (const [name, value] of Object.entries(expected).filter(([name]) => name !== 'stage'))
            assert.deepEqual(updated.state.values[name], value, name + ' stage ' + stage);
          if (stage === 2) {
            const invalid = await page.evaluate(() =>
              window.form0PreviewEvents.prepareSave({ intent: 'submit' })
            );
            assert.equal(invalid.eligible, false);
            const draft = await page.evaluate(() =>
              window.form0PreviewEvents.prepareSave({ intent: 'draft' })
            );
            assert.equal(draft.eligible, true);
          }
          item.checks.push('SETVALUE stage ' + stage);
        }
        await page.locator('[data-name="amount"] input').fill('0');
        await settle(page);
        const saved = await page.evaluate(() =>
          window.form0PreviewEvents.prepareSave({ intent: 'submit' })
        );
        assert.equal(saved.eligible, true, JSON.stringify(saved.issues));
        assert.equal(saved.payload.form_values.amount, 0);
        assert.deepEqual(saved.payload.form_values.links, [{ record_id: '0' }]);
        assert.equal(saved.payload.form_values.signature.signature_id, 'sig');
        assert.equal(saved.payload.form_values.rows[0].id, 0);
        assert.equal(await page.locator('[data-name="single"] select').inputValue(), 'red');
        await page.locator('[data-name="single"] select').selectOption('__other__');
        const other = page.locator('[data-name="single"] .single-choice-field-other');
        await settle(page);
        await other.fill('Teal');
        await settle(page);
        await other.fill('');
        await settle(page);
        assert.equal(await other.isVisible(), true);
        item.checks.push('zero, media/links/row ID payload preservation and Other editing');
        const mediaUpdates = [];
        await page.route('**/api/preview-events', async (route) => {
          const body = route.request().postDataJSON();
          if (body.action === 'update') mediaUpdates.push(body.fieldKey);
          await route.continue();
        });
        await page.locator('[data-name="photos"] input[type="file"]').setInputFiles({
          name: 'audit.png',
          mimeType: 'image/png',
          buffer: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
            'base64'
          ),
        });
        await settle(page);
        assert.equal(await page.locator('[data-name="photos"] .file-preview-item').count(), 1);
        const canvas = page.locator('[data-name="signature"] canvas');
        await canvas.scrollIntoViewIfNeeded();
        const box = await canvas.boundingBox();
        await page.mouse.move(box.x + 20, box.y + 20);
        await page.mouse.down();
        await page.mouse.move(box.x + 100, box.y + 50, { steps: 3 });
        await page.mouse.up();
        await settle(page);
        await page.locator('[data-name="stage"] input').fill('2');
        const cleared = await settle(page);
        assert.deepEqual(cleared.state.values.photos, []);
        assert.equal(cleared.state.values.signature, null);
        assert.equal(await page.locator('[data-name="photos"] .file-preview-item').count(), 0);
        assert.equal(
          await canvas.evaluate((value) => {
            const blank = document.createElement('canvas');
            blank.width = value.width;
            blank.height = value.height;
            return value.toDataURL() === blank.toDataURL();
          }),
          true
        );
        assert.equal(
          mediaUpdates.filter((key) => !key).length,
          0,
          'Auxiliary file controls must not enqueue stale whole-form updates'
        );
        item.checks.push('photo upload, signature drawing and event-driven visual reset');
        // Control metadata readiness deterministically; decoding/device capture are separate acceptance.
        await page.evaluate(() => {
          window.auditVideos = [];
          const create = document.createElement.bind(document);
          document.createElement = (name, ...args) => {
            const element = create(name, ...args);
            if (name === 'video') {
              let source = '';
              Object.defineProperty(element, 'src', {
                get: () => source,
                set: (value) => {
                  source = value;
                },
              });
              Object.defineProperty(element, 'duration', { value: 2 });
              window.auditVideos.push(element);
            }
            return element;
          };
        });
        const videoInput = page.locator('[data-name="videos"] input[type="file"]');
        await videoInput.setInputFiles({
          name: 'first.webm',
          mimeType: 'video/webm',
          buffer: Buffer.from('metadata adapter'),
        });
        await page.evaluate(() => window.auditVideos.at(-1).onloadedmetadata());
        await page.waitForFunction(
          () => document.querySelectorAll('[data-name="videos"] .file-preview-item').length === 1
        );
        await settle(page);
        await page.locator('[data-name="stage"] input').fill('2');
        await settle(page);
        assert.equal(await page.locator('[data-name="videos"] .file-preview-item').count(), 0);
        await page.locator('[data-name="stage"] input').fill('3');
        await settle(page);
        await videoInput.setInputFiles({
          name: 'pending.webm',
          mimeType: 'video/webm',
          buffer: Buffer.from('metadata adapter'),
        });
        await page.locator('[data-name="stage"] input').fill('2');
        await settle(page);
        await page.evaluate(() => window.auditVideos.at(-1).onloadedmetadata());
        const afterPending = await settle(page);
        assert.deepEqual(
          afterPending.state.values.videos,
          [],
          'Metadata from an earlier selection must not revive cleared videos'
        );
        assert.equal(await page.locator('[data-name="videos"] .file-preview-item').count(), 0);
        item.checks.push('video visual reset and obsolete metadata completion');
      }
      item.passed = true;
    } catch (error) {
      item.passed = false;
      item.error = error.message;
    } finally {
      await page.close();
    }
  }
  console.log(JSON.stringify(report, null, 2));
  if (report.cases.some((x) => !x.passed) || report.pageErrors.length) process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((resolve) => sockets.wss.close(resolve));
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
