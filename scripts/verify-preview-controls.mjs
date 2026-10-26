// Optional real-browser regression gate. Supply an existing Playwright module/executable;
// this command installs nothing and uses an isolated project without environment/connectors.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateSchema, SAFE_SECURITY_CONFIG } from 'form0-core';
import { createApp } from '../src/server/express-server.js';
import { createWebSocketServer } from '../src/server/websocket.js';
import { field, repeatable } from '../tests/fixtures/preview-event-fields.js';

const { chromium } = await import(process.env.FORM0_PLAYWRIGHT_MODULE || 'playwright');
const choices = [
  { value: 'red', label: 'Red' },
  { value: 'blue', label: 'Blue' },
];
const choice = (type, name, extra = {}) =>
  field(type, name, {
    choices,
    allow_other: true,
    is_searchable: false,
    is_searchable_mode: null,
    ...extra,
  });
const signature = {
  data: 'c2lnbmF0dXJl',
  signature_id: 'preserve',
  media_id: 'preserve',
  mime_type: 'image/png',
};
const schema = {
  form: {
    name: 'Preview control regressions',
    events: {
      code: `
  ON('change', 'trigger', function() {
    SETVALUE('single', 'red');
    SETVALUE('multiple', ['red', 'blue']);
    SETVALUE('note', 'changed');
  });
  ON('change', 'row_trigger', function() { SETVALUE('row_choice', 'blue'); });
`,
    },
    elements: [
      field('NumericField', 'trigger'),
      field('TextField', 'note'),
      choice('SingleChoiceField', 'single'),
      choice('MultiChoiceField', 'multiple'),
      choice('SingleChoiceField', 'radio', { display: 'radio' }),
      choice('MultiChoiceField', 'checks', { display: 'checkbox' }),
      field('SignatureField', 'signature', { required: true, agreement_text: null }),
      repeatable('rows', [
        field('NumericField', 'row_trigger'),
        choice('SingleChoiceField', 'row_choice'),
      ]),
      {
        type: 'Section',
        key: 'conditional_section',
        data_name: 'conditional_section',
        label: 'Conditional section',
        display: 'inline',
        description: null,
        description_mode: null,
        visible: false,
        visible_conditions: { field_id: 'trigger', operator: 'equal_to', value: 1 },
        elements: [field('TextField', 'conditional_note', { required: true })],
      },
    ],
  },
};
for (const name of ['supporting_image', 'supporting_image_path', 'supporting_image_display'])
  delete schema.form.elements.find((item) => item.type === 'SignatureField')[name];
validateSchema(schema.form);
const directory = await mkdtemp(path.join(os.tmpdir(), 'form0-control-browser-'));
const safe = process.env.FORM0_PREVIEW_SAFE === '1';
const app = createApp(
  () => schema,
  () => 'Browser control fixture',
  directory,
  {
    diagnostics: false,
    engineOptions: safe ? { security: SAFE_SECURITY_CONFIG } : {},
  }
);
const server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const sockets = createWebSocketServer(
  server,
  () => schema,
  () => 'Browser control fixture',
  {}
);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.FORM0_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.FORM0_CHROMIUM_EXECUTABLE }
    : {}),
});
const evidence = [];
const base = `http://127.0.0.1:${server.address().port}`;
const settle = (page) =>
  page.evaluate(() => window.form0PreviewEvents.dispatch({ type: 'focus', fieldKey: 'trigger' }));
async function scenario(lifecycle, name, run, values = {}) {
  if (process.argv[2] && !name.includes(process.argv[2])) return;
  const page = await browser.newPage();
  const result = { lifecycle, name, errors: [] };
  evidence.push(result);
  page.setDefaultTimeout(5000);
  page.on('pageerror', (error) => result.errors.push(error.message));
  await page.addInitScript(
    (enabled) =>
      localStorage.setItem(
        'form0-preview-events',
        JSON.stringify({
          lifecycle: enabled,
          recordKind: 'existing',
          readonly: false,
          fieldInteractions: [],
        })
      ),
    lifecycle
  );
  await page.route('**/api/preview-session', async (route) => {
    const data = route.request().postDataJSON();
    data.state = {
      values,
      repeatable: { rows: [{ id: 0, values: { row_trigger: 0 }, repeatable: {} }] },
    };
    await route.continue({ postData: JSON.stringify(data) });
  });
  try {
    await page.goto(base);
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
      'SETVALUE shorthand updates controls and the selected submission',
      async (page) => {
        await page.locator('[data-name="note"] input').fill('original');
        await page.locator('[data-name="trigger"] input').fill('1');
        await settle(page);
        assert.equal(await page.locator('[data-name="single"] select').inputValue(), 'red');
        assert.deepEqual(
          await page
            .locator('[data-name="multiple"] select')
            .evaluate((select) => [...select.selectedOptions].map((option) => option.value)),
          ['red', 'blue']
        );
        assert.equal(await page.locator('[data-name="note"] input').inputValue(), 'changed');
      }
    );
    for (const [name, selector, type] of [
      ['single', 'select', 'single'],
      ['multiple', 'select', 'multi'],
      ['radio', 'input[value="__other__"]', 'single'],
      ['checks', 'input[value="__other__"]', 'multi'],
    ])
      await scenario(
        lifecycle,
        `${name}: empty Other draft survives evaluation, typing and clearing`,
        async (page) => {
          const control = page.locator(`[data-name="${name}"] ${selector}`);
          if (selector === 'select') await control.selectOption('__other__');
          else await control.check();
          await settle(page);
          const other = page.locator(
            `[data-name="${name}"] .${type === 'single' ? 'single' : 'multi'}-choice-field-other`
          );
          assert.equal(
            await other.isVisible(),
            true,
            'Other must stay visible before any custom text'
          );
          await other.fill('Teal');
          await settle(page);
          assert.equal(await other.inputValue(), 'Teal');
          await other.fill('');
          await settle(page);
          assert.equal(await other.isVisible(), true, 'Other must stay visible after clearing');
          await other.fill('Turquoise');
          await settle(page);
          const snapshot = await settle(page);
          assert.equal(snapshot.state.values[name].other[0].label, 'Turquoise');
        }
      );
    await scenario(
      lifecycle,
      'a populated signature has no stale inline required message',
      async (page) => {
        const pad = page.locator('[data-name="signature"]');
        assert.equal(
          await pad
            .locator('input[type="hidden"]')
            .evaluate((input) => JSON.parse(input.value).signature_id),
          'preserve'
        );
        assert.equal(await pad.locator('.error-message').count(), 0);
        await pad.locator('.signature-clear-btn').click();
        await settle(page);
        assert.equal(await pad.locator('.error-message').count(), 1);
        const canvas = pad.locator('canvas');
        await canvas.scrollIntoViewIfNeeded();
        const box = await canvas.boundingBox();
        await page.mouse.move(box.x + 20, box.y + 30);
        await page.mouse.down();
        await page.mouse.move(box.x + 100, box.y + 65, { steps: 5 });
        await page.mouse.up();
        await settle(page);
        assert.equal(await pad.locator('.error-message').count(), 0);
        assert.ok((await settle(page)).state.values.signature.data);
      },
      { signature }
    );
    await scenario(
      lifecycle,
      'row SETVALUE and Other update only the active instance',
      async (page) => {
        await page.locator('[data-preview-row-action="edit"]').first().click();
        await page.locator('[data-name="row_trigger"] input').fill('1');
        await settle(page);
        assert.equal(await page.locator('[data-name="row_choice"] select').inputValue(), 'blue');
        await page.locator('[data-name="row_choice"] select').selectOption('__other__');
        await settle(page);
        const other = page.locator('[data-name="row_choice"] .single-choice-field-other');
        assert.equal(await other.isVisible(), true, 'Other must stay visible in the active row');
        await other.fill('Custom row');
        await settle(page);
        const current = await settle(page);
        assert.equal(
          current.state.repeatable.rows[0].values.row_choice.other[0].label,
          'Custom row'
        );
      }
    );
    await scenario(lifecycle, 'container visibility follows evaluated conditions', async (page) => {
      const section = page.locator('[data-name="conditional_section"]');
      assert.equal(await section.isVisible(), false, 'section must start hidden');
      await page.locator('[data-name="trigger"] input').fill('1');
      await settle(page);
      assert.equal(await section.isVisible(), true);
      await page.locator('[data-name="trigger"] input').fill('0');
      await settle(page);
      assert.equal(await section.isVisible(), false);
    });
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
