import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import assert from 'node:assert/strict';
import {
  CSV_HEADERS,
  exportSchemaToCsvFile,
  importSchemaFromCsvFile,
} from '../src/utils/schema-csv.js';
import { resolveDefaultSchemaPath } from '../src/commands/schema.js';

async function run() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-cli-schema-'));
  const sourceJsonPath = path.join(tmpDir, 'form.schema.json');
  const csvPath = path.join(tmpDir, 'form.schema.csv');
  const roundtripJsonPath = path.join(tmpDir, 'roundtrip.schema.json');

  const sampleSchema = {
    form: {
      name: 'CSV Demo',
      description: 'Schema round-trip test',
      location_enabled: true,
      location_required: false,
      events: {
        code: 'ON("load-record", function () { ALERT("Loaded!"); });',
      },
      status_field: {
        type: 'StatusField',
        key: '@status',
        data_name: 'status',
        label: 'Status',
        display: 'default',
        enabled: true,
        visible: true,
        visible_conditions: null,
        read_only: false,
        read_only_conditions: null,
        default_value: 'pending',
        choices: [
          { label: 'Pending', value: 'pending', color: '#FFA500' },
          { label: 'Approved', value: 'approved', color: '#00FF00' },
        ],
      },
      title_field: {
        type: 'TitleField',
        key: '@title',
        data_name: 'title',
        label: 'Title',
        display: 'default',
        enabled: true,
        visible: true,
        visible_conditions: null,
        read_only: true,
        read_only_conditions: null,
        elements: ['first_name', 'favorite_city'],
      },
      elements: [
        {
          type: 'Section',
          key: 'section_personal',
          data_name: 'personal_section',
          label: 'Personal',
          display: 'inline',
          description: null,
          description_mode: null,
          visible: true,
          visible_conditions: null,
          elements: [
            {
              type: 'TextField',
              key: 'first_name_key',
              data_name: 'first_name',
              label: 'First Name',
              display: 'default',
              description: 'Given name',
              description_mode: 'default',
              required: true,
              required_conditions: null,
              visible: true,
              visible_conditions: null,
              read_only: false,
              read_only_conditions: null,
              default_value: null,
              pattern: '^[A-Za-z]+$',
              pattern_description: 'Letters only',
              supporting_image: false,
              supporting_image_path: null,
              supporting_image_display: null,
            },
            {
              type: 'SingleChoiceField',
              key: 'favorite_city_key',
              data_name: 'favorite_city',
              label: 'Favorite City',
              display: 'default',
              description: null,
              description_mode: null,
              required: false,
              required_conditions: null,
              visible: true,
              visible_conditions: null,
              read_only: false,
              read_only_conditions: null,
              default_value: null,
              allow_other: false,
              choices: [
                { label: 'Bogota', value: 'bogota' },
                { label: 'Recanati', value: 'recanati' },
              ],
              supporting_image: false,
              supporting_image_path: null,
              supporting_image_display: null,
              is_searchable: true,
              is_searchable_mode: 'default',
            },
            {
              type: 'CalculatedField',
              key: 'score_calc',
              data_name: 'score',
              label: 'Score',
              display: { style: 'numeric' },
              description: null,
              description_mode: null,
              required: false,
              visible: true,
              visible_conditions: null,
              read_only: true,
              calculate: 'IF($favorite_city == "bogota", 10, 5)',
              supporting_image: false,
              supporting_image_path: null,
              supporting_image_display: null,
            },
          ],
        },
      ],
    },
  };

  await fs.writeJson(sourceJsonPath, sampleSchema, { spaces: 2 });

  await exportSchemaToCsvFile(sourceJsonPath, { outputPath: csvPath });
  assert.ok(await fs.pathExists(csvPath), 'CSV export file should exist');

  const expectedHeaders = [
    'entry_type',
    'form_meta_attribute',
    'form_meta_value',
    'data_name',
    'label',
    'type',
    'parent_section_data_name',
    'description',
    'description_mode',
    'default_value',
    'visible',
    'visible_conditions',
    'read_only',
    'read_only_conditions',
    'required',
    'required_conditions',
    'choices',
    'choice_allow_other',
    'choice_is_searchable',
    'choice_is_searchable_mode',
    'boolean_third_option_enabled',
    'calculate',
    'display',
    'regex_pattern',
    'regex_pattern_description',
    'numeric_format',
    'numeric_min',
    'numeric_max',
    'media_min_length',
    'media_max_length',
    'supporting_image',
    'supporting_image_display',
    'supporting_image_path',
    'signature_agreement_text',
    'linked_form_id',
    'allow_creating_records',
    'allow_existing_records',
    'allow_multiple_records',
    'allow_updating_records',
    'linked_record_conditions',
    'linked_record_defaults',
    'repeatable_location_enabled',
    'repeatable_location_required',
    'title_elements',
    'status_title_enabled',
    'building_plan_node_overrides',
    'ai',
    'supporting_image_asset_id',
  ];

  assert.deepEqual(CSV_HEADERS, expectedHeaders, 'CSV headers should match expected order');

  const csvContent = await fs.readFile(csvPath, 'utf8');
  const headerLine = csvContent.split('\n')[0].trim();
  assert.equal(headerLine, expectedHeaders.join(','), 'CSV file should use the expected headers');

  await importSchemaFromCsvFile(csvPath, { outputPath: roundtripJsonPath });
  const imported = await fs.readJson(roundtripJsonPath);

  assert.ok(imported?.form, 'Imported schema should contain form');
  assert.equal(imported.form.name, sampleSchema.form.name, 'Form name should round-trip');
  assert.equal(imported.form.status_field.choices.length, 2, 'Status choices preserved');
  assert.equal(
    imported.form.title_field.elements.join(','),
    sampleSchema.form.title_field.elements.join(','),
    'Title field elements preserved'
  );
  assert.strictEqual(
    imported.form.location_enabled,
    sampleSchema.form.location_enabled,
    'location_enabled metadata preserved'
  );
  assert.strictEqual(
    imported.form.location_required,
    sampleSchema.form.location_required,
    'location_required metadata preserved'
  );
  assert.strictEqual(
    imported.form.events.code,
    sampleSchema.form.events.code,
    'events.code metadata preserved'
  );

  const formKeys = Object.keys(imported.form);
  const indexOfKey = (key) => {
    const idx = formKeys.indexOf(key);
    assert.ok(idx !== -1, `Expected ${key} in form keys`);
    return idx;
  };
  const eventsKeyIdx = indexOfKey('events');
  assert.ok(
    eventsKeyIdx > indexOfKey('location_required'),
    'events should come after location metadata'
  );
  assert.ok(eventsKeyIdx > indexOfKey('status_field'), 'events should come after status_field');
  assert.ok(eventsKeyIdx > indexOfKey('title_field'), 'events should come after title_field');
  assert.ok(eventsKeyIdx < indexOfKey('elements'), 'events should come before elements');

  const eventKeys = Object.keys(imported.form.events || {});
  assert.ok(eventKeys.length > 0, 'events object should not be empty');
  assert.equal(eventKeys[eventKeys.length - 1], 'code', 'events.code should be listed last');

  const section = imported.form.elements.find((el) => el.data_name === 'personal_section');
  assert.ok(section, 'Section should round-trip');
  assert.equal(section.elements.length, 3, 'Section children preserved');

  const calcField = section.elements.find((el) => el.data_name === 'score');
  assert.ok(calcField, 'Calculated field should remain');
  assert.equal(calcField.calculate, 'IF($favorite_city == "bogota", 10, 5)');

  assert.equal(
    resolveDefaultSchemaPath('form.schema.v2.csv'),
    'form.schema.v2.json',
    'Default output path should follow CSV basename'
  );
  const nestedCsv = path.join('schemas', 'forms', 'demo.csv');
  assert.equal(
    resolveDefaultSchemaPath(nestedCsv),
    path.join('schemas', 'forms', 'demo.json'),
    'Default output path should remain alongside CSV'
  );

  await fs.remove(tmpDir);
  console.log('Schema CSV round-trip test passed.');
}

run().catch((err) => {
  console.error('Schema CSV round-trip test failed:', err);
  process.exitCode = 1;
});
