import { FIELD_SPECS } from 'form0-core';

export function field(type, name, overrides = {}) {
  const result = {};
  for (const [key, spec] of Object.entries(FIELD_SPECS[type].attributes)) {
    if (!spec.required) continue;
    result[key] =
      spec.value ??
      (spec.nullable
        ? null
        : (spec.allowedValues?.[0] ??
          (spec.type === 'boolean'
            ? false
            : spec.type === 'array'
              ? []
              : spec.type === 'object'
                ? {}
                : name)));
  }
  return {
    ...result,
    type,
    key: name,
    data_name: name,
    label: name,
    visible: true,
    ...overrides,
  };
}

export function calculation(name, calculate) {
  return field('CalculatedField', name, { calculate, display: { style: 'text' } });
}

export function schemaWithCalculation(calculate, name = 'result') {
  return {
    form: {
      name: 'Diagnostics',
      description: null,
      elements: [
        field('NumericField', 'input', { default_value: 3 }),
        calculation(name, calculate),
      ],
    },
  };
}

export const failureExpression =
  '(() => { if ($input === 0) throw new Error("input must not be zero"); return 12 / $input; })()';

export function intermediateSchema() {
  return {
    form: {
      name: 'Intermediate failure',
      description: null,
      elements: [
        calculation(
          'target',
          'const value = EVAL("$" + $selector);\nif (value === null) { throw new Error("not ready"); }\nSETRESULT(value);'
        ),
        calculation('source', '23'),
        field('TextField', 'selector', { default_value: 'source' }),
      ],
    },
  };
}

export function nestedSchema({ counted = false } = {}) {
  const count = (name, expression) =>
    counted ? '(globalThis.__form0DiagCount("' + name + '"), ' + expression + ')' : expression;
  return {
    form: {
      name: 'Nested diagnostics',
      description: null,
      version: '1',
      title_field: null,
      status_field: null,
      events: {
        code: 'ON("change", "input", function () { SETVALUE("input", 7); ALERT("Test", "ok"); });',
      },
      elements: [
        field('NumericField', 'input', { default_value: 3 }),
        calculation('root_total', count('root_total', '$input * 2')),
        field('RepeatableSection', 'rows', {
          elements: [
            field('NumericField', 'amount', { default_value: 2 }),
            calculation(
              'row_total',
              count(
                'row_total',
                '(() => { if ($amount === 0) throw new Error("row amount is zero"); return $amount * $input; })()'
              )
            ),
            field('RepeatableSection', 'children', {
              elements: [
                field('NumericField', 'quantity', { default_value: 1 }),
                calculation(
                  'child_total',
                  count(
                    'child_total',
                    '(() => { if ($quantity === 0) throw new Error("child quantity is zero"); return $row_total + $quantity; })()'
                  )
                ),
              ],
            }),
          ],
        }),
      ],
    },
  };
}

export const nestedInput = {
  values: { input: 4 },
  repeatable: {
    rows: [
      {
        id: 'row-a',
        values: { amount: 5 },
        repeatable: { children: [{ id: 'child-a', values: { quantity: 2 }, repeatable: {} }] },
      },
      {
        id: 'row-b',
        values: { amount: 0 },
        repeatable: { children: [{ values: { quantity: 0 }, repeatable: {} }] },
      },
    ],
  },
  eventType: 'change',
  fieldKey: 'input',
};
