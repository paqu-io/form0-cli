import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSchemaAuthoringTree,
  buildSchemaAuthoringIndex,
} from '../src/utils/schema-authoring-tree.js';
import { createFieldTemplate } from '../src/utils/field-template.js';
import { formatSchemaPreviewLines } from '../src/utils/display-utils.js';

test('virtual predefined, system-routing and inherited-placement entries leave raw definitions intact', () => {
  const field = createFieldTemplate('NumericField', { dataName: 'default_rating' });
  field.key = 'default_rating';
  field.building_plan = { property: 'fire_rating', scope: 'physical_wall', inherit_to: 'walls' };
  const plan = createFieldTemplate('BuildingPlanSection', { dataName: 'plan' });
  plan.key = 'plan';
  plan.node_overrides = { floors: { extra_elements: [field] } };
  const schema = { form: { name: 'Authoring', elements: [plan] } };
  const before = JSON.stringify(schema),
    tree = createSchemaAuthoringTree(schema.form.elements),
    index = buildSchemaAuthoringIndex(schema.form.elements);
  assert.equal(JSON.stringify(schema), before);
  assert.equal(tree.elements[0].elements.length, 8);
  assert.ok(index.nodes.some((node) => node.virtual?.kind === 'system'));
  const inherited = index.nodes.find(
    (node) => node.virtual?.kind === 'property' && node.virtual.property === 'fire_rating'
  );
  assert.ok(inherited);
  inherited.virtual.config().property_overrides = { fire_rating: { label: 'Wall fire rating' } };
  assert.equal(plan.node_overrides.walls.extra_elements, undefined);
  assert.ok(!JSON.stringify(schema).includes('bp_walls_system'));
  const lines = formatSchemaPreviewLines(schema, { showIds: true });
  assert.ok(lines.some((line) => line.includes('inherited placement')));
  assert.ok(lines.some((line) => line.includes('System fields')));
});
