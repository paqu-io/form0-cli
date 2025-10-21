import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import assert from 'node:assert/strict';
import { exportSchemaToCsvFile, importSchemaFromCsvFile } from '../src/utils/schema-csv.js';

async function run() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-cli-schema-'));
  const sourceJsonPath = path.join(tmpDir, 'form.schema.json');
  const csvPath = path.join(tmpDir, 'form.schema.csv');
  const roundtripJsonPath = path.join(tmpDir, 'roundtrip.schema.json');

  const sampleSchema = {
    form: {
      name: 'CSV Demo',
      description: 'Schema round-trip test',
      status: 'active',
      version: 3,
      location_enabled: true,
      location_required: false,
      form_links: {
        to: [
          { form_link_field_key: 'link_field', form_id: '123e4567-e89b-12d3-a456-426614174000' },
        ],
        from: [],
      },
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

  const section = imported.form.elements.find((el) => el.data_name === 'personal_section');
  assert.ok(section, 'Section should round-trip');
  assert.equal(section.elements.length, 3, 'Section children preserved');

  const calcField = section.elements.find((el) => el.data_name === 'score');
  assert.ok(calcField, 'Calculated field should remain');
  assert.equal(calcField.calculate, 'IF($favorite_city == "bogota", 10, 5)');

  const exportedLinks = imported.form.form_links?.to ?? [];
  assert.equal(exportedLinks.length, 1, 'Form links should persist');

  await fs.remove(tmpDir);
  console.log('Schema CSV round-trip test passed.');
}

run().catch((err) => {
  console.error('Schema CSV round-trip test failed:', err);
  process.exitCode = 1;
});
