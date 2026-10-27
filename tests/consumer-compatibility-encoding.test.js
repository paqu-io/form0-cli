import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormEngine, FIELD_SPECS } from 'form0-core';
import { fieldFixture, attachAuditEvents } from './fixtures/consumer-compatibility.js';

const text =
  `Quotes ' " and slash \\; </script><script>globalThis.fixtureBreakout = true</script>; ` +
  '<!-- <>& \u2028\u2029 \0\b\f\n\r\t 🙂';
const metadataKey = `metadata ' " \\ </script> \u2028\u2029`;

function fixtureWithSpecialCharacters() {
  const fixture = fieldFixture(FIELD_SPECS);
  fixture.snapshot.values.text = text;
  fixture.snapshot.values.photos[0].filename = text + '.png';
  fixture.snapshot.values.photos[0].caption = text;
  fixture.snapshot.values.photos[0].custom = { [metadataKey]: [text, 0, false, null] };
  fixture.snapshot.values.links[0].label = text;
  return attachAuditEvents(FIELD_SPECS, fixture, 'fields');
}

test('generated field audit handlers encode HTML delimiters and Unicode separators in literal data', () => {
  const fixture = fixtureWithSpecialCharacters();
  assert.doesNotMatch(fixture.schema.form.events.code, /[<>&\u2028\u2029]/);
});

for (const security of [undefined, { mode: 'safe' }]) {
  test(`encoded audit handlers preserve exact values and media metadata (${security?.mode || 'trusted'})`, () => {
    const fixture = fixtureWithSpecialCharacters();
    const original = structuredClone(fixture);
    const engine = createFormEngine({
      schema: fixture.schema,
      initialValues: { ...fixture.snapshot.values, stage: 3 },
      security,
    });
    const result = engine.triggerDetailed('change', 'stage');
    assert.deepEqual(result.issues, []);
    const writes = new Map(
      result.operations.map((operation) => [
        operation.params.fieldDataName,
        operation.params.valueToSet,
      ])
    );
    for (const name of ['text', 'photos', 'links'])
      assert.deepEqual(writes.get(name), fixture.snapshot.values[name], name);
    assert.deepEqual(fixture, original);
  });
}
