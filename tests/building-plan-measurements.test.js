import test from 'node:test';
import assert from 'node:assert/strict';
import { expandBuildingPlanSchema } from 'form0-core';
import { FormRenderer } from '../src/server/static/form-renderer.js';
import { FormStateManager } from '../src/server/static/form-state-manager.js';

test('CLI controls convert displayed millimetres while managed values remain metres', () => {
  const schema = {
    form: {
      name: 'Units',
      measurement_system: 'si',
      elements: [
        {
          type: 'BuildingPlanSection',
          key: 'plan',
          data_name: 'plan',
          node_overrides: {},
        },
      ],
    },
  };
  const expanded = expandBuildingPlanSchema(schema);
  const renderer = new FormRenderer();
  renderer.locale = 'es';
  renderer.setSchema(expanded.schema, { buildingPlanMeta: expanded.buildingPlanMeta });
  const state = new FormStateManager(renderer);
  const field =
    expanded.buildingPlanMeta[0].repeatablesByNodeKey.floors.fieldsByOriginalDataName
      .floor_exterior_wall_thickness.field;
  assert.equal(state.parseFieldValue(field, '300'), 0.3);
  let shown;
  state.setStandardFieldValue = (_field, _container, value) => {
    shown = value;
  };
  state.updateFieldValue(field, {}, 0.3);
  assert.equal(shown, 300);
  assert.match(renderer.presentation.field(field).label, /Espesor.*\[mm\]/);
  assert.equal(state.parseFieldValue(field, ''), null);
  const imperial = { form: { ...schema.form, measurement_system: 'imperial' } };
  renderer.setSchema(imperial, { buildingPlanMeta: expanded.buildingPlanMeta });
  assert.equal(state.parseFieldValue(field, '1'), 0.0254);
});

test('an untouched displayed measurement preserves its exact accepted value on blur', () => {
  const renderer = new FormRenderer();
  const expanded = expandBuildingPlanSchema({
    form: { elements: [{ type: 'BuildingPlanSection', key: 'plan', data_name: 'plan' }] },
  });
  renderer.setSchema(expanded.schema, { buildingPlanMeta: expanded.buildingPlanMeta });
  const state = new FormStateManager(renderer);
  const field =
    expanded.buildingPlanMeta[0].repeatablesByNodeKey.walls.fieldsByOriginalDataName.wall_thickness
      .field;
  const input = { value: '' },
    container = { querySelector: () => input };
  state.setStandardFieldValue = (_field, _container, value) => {
    input.value = String(value);
  };
  const accepted = 0.23456789123456789;
  state.updateFieldValue(field, container, accepted);
  assert.equal(state.readFieldValue(field, container), accepted);
  input.value = '300';
  assert.equal(state.readFieldValue(field, container), 0.3);
});
