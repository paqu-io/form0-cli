import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectCalculationIssues,
  printCalculationIssues,
} from '../src/utils/calculation-checks.js';

function createSchema(calculate) {
  return {
    form: {
      name: 'Calculation checks',
      description: null,
      elements: [
        {
          type: 'CalculatedField',
          key: 'result',
          data_name: 'result',
          label: 'Result',
          display: { style: 'text' },
          description: null,
          description_mode: null,
          required: false,
          visible: true,
          visible_conditions: null,
          read_only: true,
          calculate,
          supporting_image: false,
          supporting_image_path: null,
          supporting_image_display: null,
        },
      ],
    },
  };
}

test('reports a multiline calculation without SETRESULT()', () => {
  const issues = collectCalculationIssues(createSchema('IF(\n  true,\n  "a",\n  "b"\n)'));

  assert.equal(issues.length, 1);
  assert.equal(issues[0].dataName, 'result');
  assert.equal(issues[0].code, 'noncanonical_multiline_result');
});

test('reports nothing for valid calculations', () => {
  assert.deepEqual(collectCalculationIssues(createSchema('IF(true, "a", "b")')), []);
  assert.deepEqual(
    collectCalculationIssues(createSchema('SETRESULT(IF(\n  true,\n  "a",\n  "b"\n))')),
    []
  );
});

test('prints a summary line and one line per issue', () => {
  const lines = [];
  const count = printCalculationIssues(createSchema('IF(\n  true,\n  "a",\n  "b"\n)'), (line) =>
    lines.push(line)
  );

  assert.equal(count, 1);
  assert.equal(lines.length, 2);
  assert.match(lines[1], /result: .*\(noncanonical_multiline_result\)/);
});
