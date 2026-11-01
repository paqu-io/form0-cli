export const testScriptTemplate = `import { createFormEngine } from 'form0-core';
import fs from 'fs';

const schema = JSON.parse(fs.readFileSync('./form.schema.json', 'utf8'));

console.log('🧪 Testing form0 engine with generated schema...');
console.log('📋 Schema:', schema.form.name);
console.log('📝 Description:', schema.form.description);
console.log();

// Test with sample data
const initialValues = {
  building_ref: 'BLD-001',
  building_name: 'Riverside Community Hall',
  assessor: 'Alex Morgan',
  overall_condition: 'good',
  building_length_m: 12,
  building_width_m: 8,
  allowance_per_m2: 25,
};
console.log('🔧 Initial values:', JSON.stringify(initialValues, null, 2));
console.log();

const engine = createFormEngine({ schema, initialValues });
engine.eval();

// Core returns event operations; a host applies them. The CLI preview and app renderers
// do this automatically. Here we apply the contact-copy action explicitly.
engine.setValue('copy_assessor', 'yes');
for (const operation of engine.trigger('change', 'copy_assessor')) {
  if (operation.operation === 'SETVALUE') {
    engine.setValue(operation.params.fieldDataName, operation.params.valueToSet);
  }
}

console.log('🧠 Engine state after evaluation:');
const state = engine.getState();
console.log(JSON.stringify(state, null, 2));
console.log();

// For later input updates, use engine.setValue(dataName, value) or engine.setValues(updates).
// Setters evaluate automatically; dispatch change events explicitly when your host needs them.
// Choice IDs are strings: SingleChoice/Boolean accept one ID; MultiChoice accepts an array.

// Check validation results
const hasErrors = Object.keys(state.errors).length > 0;
console.log('✅ Form validation result:', hasErrors ? 'INVALID' : 'VALID');

if (hasErrors) {
  console.log('❌ Validation errors:');
  for (const [field, error] of Object.entries(state.errors)) {
    console.log('   ' + field + ': ' + error);
  }
} else {
  console.log('🎉 All fields passed validation!');
}

if (hasErrors) process.exitCode = 1;
`;
