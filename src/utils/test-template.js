export const testScriptTemplate = `import { createFormEngine } from 'form0-core';
import fs from 'fs';

const schema = JSON.parse(fs.readFileSync('./form.schema.json', 'utf8'));

console.log('🧪 Testing form0 engine with generated schema...');
console.log('📋 Schema:', schema.form.name);
console.log('📝 Description:', schema.form.description);
console.log();

// Test with sample data
const initialValues = { first_name: 'Alice', age: 21 };
console.log('🔧 Initial values:', JSON.stringify(initialValues, null, 2));
console.log();

const engine = createFormEngine({ schema, initialValues });
engine.eval();

console.log('🧠 Engine state after evaluation:');
const state = engine.getState();
console.log(JSON.stringify(state, null, 2));
console.log();

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
`;
