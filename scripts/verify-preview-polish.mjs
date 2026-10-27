// Optional Chromium regression gate. Reuses supplied tooling; no credentials or database required.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server/express-server.js';
import { createWebSocketServer } from '../src/server/websocket.js';
import { field, repeatable } from '../tests/fixtures/preview-event-fields.js';
const { chromium } = await import(process.env.FORM0_PLAYWRIGHT_MODULE || 'playwright');
const schema = {
  form: {
    name: 'Preview polish',
    elements: [
      field('NumericField', 'amount', { default_value: 1 }),
      field('NumericField', 'save_count', { default_value: 0 }),
      field('TextField', 'trace', { default_value: '' }),
      field('TextField', 'interaction_trace', { default_value: '' }),
      repeatable('projects', [
        field('TextField', 'project_name'),
        repeatable('tasks', [field('NumericField', 'cost')]),
      ]),
    ],
    events: {
      code: `
ON('load-record', function() { SETVALUE('trace', 'load'); });
ON('new-record', function() { SETVALUE('trace', $trace + '|new'); });
ON('edit-record', function() { SETVALUE('trace', $trace + '|edit'); });
ON('validate-record', function() { if ($amount < 0) INVALID('Positive amount required'); });
ON('save-record', function() { SETVALUE('save_count', $save_count + 1); });
ON('focus', 'amount', function() { SETVALUE('interaction_trace', ($interaction_trace || '') + '|focus'); });
ON('blur', 'amount', function() { SETVALUE('interaction_trace', ($interaction_trace || '') + '|blur'); });
ON('click', 'amount', function() { SETVALUE('interaction_trace', ($interaction_trace || '') + '|click'); });
`,
    },
  },
};
const state = {
  values: { amount: 1, save_count: 0, trace: '' },
  repeatable: {
    projects: [
      {
        id: 'P1',
        values: { project_name: 'One' },
        repeatable: { tasks: [{ id: 'T1', values: { cost: 10 }, repeatable: {} }] },
      },
    ],
  },
};
const directory = await mkdtemp(path.join(os.tmpdir(), 'form0-polish-'));
const app = createApp(
  () => schema,
  () => 'Polish fixture',
  directory,
  {
    diagnostics: false,
    engineOptions: process.env.FORM0_PREVIEW_SAFE === '1' ? { security: { mode: 'safe' } } : {},
  }
);
const server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const { wss } = createWebSocketServer(
  server,
  () => schema,
  () => 'Polish fixture',
  {}
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.FORM0_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.FORM0_CHROMIUM_EXECUTABLE }
    : {}),
});
const cases = [];
async function run(name, check, configuration) {
  const page = await browser.newPage();
  page.setDefaultTimeout(6000);
  const logs = [],
    errors = [];
  let submissions = 0;
  let submittedPayload;
  page.on('console', (message) =>
    logs.push({ type: message.type(), text: message.text(), args: message.args() })
  );
  page.on('pageerror', (error) => errors.push(error.message));
  if (configuration)
    await page.addInitScript(
      (config) => localStorage.setItem('form0-preview-events', JSON.stringify(config)),
      configuration
    );
  await page.route('**/api/preview-session', async (route) => {
    const body = route.request().postDataJSON();
    body.state = state;
    await route.continue({ postData: JSON.stringify(body) });
  });
  page.on('request', (request) => {
    if (request.url().endsWith('/api/submit-record')) {
      submissions++;
      submittedPayload = request.postDataJSON().record;
    }
  });
  const result = { name };
  cases.push(result);
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.form0PreviewEvents);
    await check(
      page,
      logs,
      () => submissions,
      () => submittedPayload
    );
    assert.deepEqual(errors, []);
    result.passed = true;
  } catch (error) {
    result.passed = false;
    result.error = error.message;
  } finally {
    await page.close();
    console.log(JSON.stringify(result));
  }
}
const submit = async (page) => {
  await page.locator('#submit-btn').click();
  await page.waitForFunction(() => !document.querySelector('#submit-btn').disabled);
};
try {
  await run(
    'fresh preview enables lifecycle and keeps advanced controls collapsed',
    async (page) => {
      await page.waitForFunction(
        () => document.querySelector('[name="trace"]')?.value === 'load|new'
      );
      const amount = page.locator('[name="amount"]');
      await amount.focus();
      await page.waitForFunction(() =>
        document.querySelector('[name="interaction_trace"]')?.value.endsWith('|focus')
      );
      await amount.blur();
      await page.waitForFunction(() =>
        document.querySelector('[name="interaction_trace"]')?.value.endsWith('|blur')
      );
      await amount.click();
      await page.waitForFunction(() =>
        document.querySelector('[name="interaction_trace"]')?.value.endsWith('|click')
      );
      assert.equal(await page.locator('#preview-actions').evaluate((x) => x.open), false);
      assert.equal(await page.locator('#preview-draft').isVisible(), false);
      if (process.env.FORM0_SCREENSHOT_DIR)
        await page.screenshot({
          path: path.join(process.env.FORM0_SCREENSHOT_DIR, 'preview.png'),
          fullPage: true,
        });
      await page.locator('.settings-button').click();
      assert.equal(await page.locator('#settings-preview-lifecycle').isChecked(), true);
      for (const type of ['focus', 'blur', 'click'])
        assert.equal(await page.locator('#settings-preview-' + type).isChecked(), true);
      if (process.env.FORM0_SCREENSHOT_DIR)
        await page.screenshot({
          path: path.join(process.env.FORM0_SCREENSHOT_DIR, 'settings.png'),
          fullPage: true,
        });
      assert.equal(await page.locator('#settings-preview-lifecycle').isVisible(), false);
      assert.equal(await page.locator('#settings-preview-recordKind').isVisible(), true);
      assert.equal(await page.locator('#settings-preview-readonly').isVisible(), true);
      assert.equal(
        await page
          .locator('#settings-preview-recordKind')
          .evaluate((x) => Boolean(x.closest('.settings-group'))),
        true
      );
    }
  );
  await run(
    'an explicit legacy opt-out survives the new default',
    async (page) => {
      await page.waitForFunction(() => document.querySelector('[name="trace"]')?.value === 'load');
      assert.equal(
        (await page.evaluate(() => window.form0PreviewEvents.prepareSave({ intent: 'submit' })))
          .payload.form_values.save_count,
        0
      );
    },
    { lifecycle: false, recordKind: 'new', readonly: false, fieldInteractions: [] }
  );
  await run(
    'existing records run load then edit',
    async (page) => {
      await page.waitForFunction(
        () => document.querySelector('[name="trace"]')?.value === 'load|edit'
      );
    },
    { lifecycle: true, recordKind: 'existing', readonly: false, fieldInteractions: [] }
  );
  await run(
    'read-only preview runs load only and explains disabled rows',
    async (page) => {
      await page.waitForFunction(() => document.querySelector('[name="trace"]')?.value === 'load');
      assert.equal(await page.locator('#submit-btn').isDisabled(), true);
      assert.equal(
        await page.locator('[data-preview-row-action="edit"]').first().isDisabled(),
        true
      );
      assert.match(await page.locator('.preview-row-hint').first().textContent(), /read-only/);
    },
    { lifecycle: true, recordKind: 'existing', readonly: true, fieldInteractions: [] }
  );
  await run(
    'advanced draft inspection stays available without persistence',
    async (page, logs, submissions) => {
      await page.locator('[name="amount"]').fill('-1');
      await page.locator('#preview-actions > summary').click();
      await page.locator('#preview-draft').click();
      await page.waitForFunction(
        () => document.querySelector('[name="save_count"]')?.value === '1'
      );
      const draft = logs.find((x) => x.text.includes('[DRAFT PREVIEW]'));
      assert.ok(draft);
      assert.equal(draft.args.length, 2);
      assert.equal((await draft.args[1].jsonValue()).eligible, true);
      assert.equal(submissions(), 0);
      assert.equal(await page.locator('#preview-cancel').isVisible(), true);
      assert.equal(await page.locator('#preview-close').isVisible(), true);
    }
  );
  await run('nested row controls match Remove and explain parent ownership', async (page) => {
    const task = page.locator('[data-repeatable-key="tasks"]');
    const project = page.locator('[data-repeatable-key="projects"]');
    const edit = task.locator('[data-preview-row-action="edit"]');
    assert.equal(await edit.isDisabled(), true);
    const description = await edit.getAttribute('aria-describedby');
    assert.ok(description);
    assert.match(await page.locator('[id="' + description + '"]').textContent(), /projects #1/);
    const styles = await project
      .locator('.repeatable-instance-header-actions')
      .first()
      .locator('button')
      .evaluateAll((nodes) =>
        nodes.map((n) => {
          const s = getComputedStyle(n);
          return [s.padding, s.borderRadius, s.fontSize, s.fontWeight];
        })
      );
    for (const style of styles) assert.deepEqual(style, styles[0]);
    await project.locator('[data-preview-row-action="edit"]').first().click();
    await page.waitForFunction(
      () =>
        !document.querySelector('[data-repeatable-key="tasks"] [data-preview-row-action="edit"]')
          .disabled
    );
    assert.equal(await edit.getAttribute('aria-describedby'), null);
  });
  await run(
    'Submit logs an expandable exact snapshot, runs save once and reports no database',
    async (page, logs, submissions, sentPayload) => {
      await submit(page);
      assert.equal(submissions(), 1);
      const prepared = logs.find((x) => x.text.includes('[STRUCTURED RECORD]'));
      assert.ok(prepared);
      assert.equal(prepared.args.length, 2);
      const payload = await prepared.args[1].jsonValue();
      assert.equal(payload.form_values.save_count, 1);
      assert.deepEqual(payload, sentPayload());
      assert.ok(logs.some((x) => x.text.includes('[RECORD SUBMIT]')));
      assert.ok(logs.some((x) => x.text.includes('No database connector')));
    }
  );
  await run(
    'individual connector success and partial failure remain visible',
    async (page, logs) => {
      for (const success of [true, false]) {
        await page.unroute('**/api/submit-record');
        await page.route('**/api/submit-record', (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success,
              message: success ? 'Stored in test connector' : 'Partial connector failure',
              connectorResults: [
                { connector: 'test-ok', success: true, message: 'Stored' },
                {
                  connector: 'test-other',
                  success,
                  error: success ? undefined : 'Simulated connector error',
                },
              ],
            }),
          })
        );
        logs.length = 0;
        await submit(page);
        assert.ok(logs.some((x) => x.text.includes('✅ test-ok')));
        assert.ok(logs.some((x) => x.text.includes((success ? '✅' : '❌') + ' test-other')));
        if (!success) {
          assert.ok(logs.some((x) => x.type === 'error' && x.text.includes('[RECORD SUBMIT]')));
          assert.match(
            await page.locator('#global-error-message').textContent(),
            /Partial connector failure/
          );
        }
      }
    }
  );
  await run(
    'custom validation blocks without submitting or running save',
    async (page, logs, submissions) => {
      await page.locator('[name="amount"]').fill('-1');
      await submit(page);
      assert.equal(submissions(), 0);
      assert.ok(
        logs.some(
          (x) => x.text.includes('[RECORD SUBMIT]') && x.text.toLowerCase().includes('validation')
        )
      );
      assert.equal(await page.locator('[name="save_count"]').inputValue(), '0');
    }
  );
  await run('HTTP errors are reported without a false success', async (page, logs) => {
    await page.route('**/api/submit-record', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Simulated unavailable storage' }),
      })
    );
    const failureLogged = page.waitForEvent('console', {
      predicate: (message) =>
        message.type() === 'error' && message.text().includes('Simulated unavailable storage'),
    });
    await submit(page);
    await failureLogged;
    assert.ok(
      logs.some((x) => x.type === 'error' && x.text.includes('Simulated unavailable storage'))
    );
    assert.match(
      await page.locator('#global-error-message').textContent(),
      /Simulated unavailable storage/
    );
  });
  if (cases.some((x) => !x.passed)) process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((resolve) => wss.close(resolve));
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
