export const field = (type, name, extra = {}) => ({
  type,
  key: name,
  data_name: name,
  label: name,
  display: type === 'CalculatedField' ? { style: 'text' } : 'default',
  description: null,
  description_mode: null,
  required: false,
  visible: true,
  visible_conditions: null,
  read_only: type === 'CalculatedField',
  supporting_image: false,
  supporting_image_path: null,
  supporting_image_display: null,
  ...(type === 'CalculatedField'
    ? { calculate: '1' }
    : { default_value: null, required_conditions: null, read_only_conditions: null }),
  ...(type === 'NumericField' ? { min: null, max: null, format: 'integer' } : {}),
  ...(type === 'TextField' ? { pattern: null, pattern_description: null } : {}),
  ...extra,
  ...(type === 'CalculatedField' && /\b(return|throw|const)\b/.test(extra.calculate || '')
    ? { calculate: extra.calculate.replaceAll('; ', ';\n') + '\n' }
    : {}),
});
export const repeatable = (name, elements) => ({
  type: 'RepeatableSection',
  key: name,
  data_name: name,
  label: name,
  display: 'drilldown',
  description: null,
  description_mode: null,
  visible: true,
  visible_conditions: null,
  location_enabled: false,
  location_required: false,
  elements,
});
export const schema = {
  form: {
    name: 'Diagnostics',
    elements: [
      field('NumericField', 'input', { default_value: 0 }),
      field('CalculatedField', 'result', {
        calculate:
          "if ($input == null || $input === 0) { throw new Error('input must not be zero'); } return 12 / $input;",
      }),
    ],
  },
};
export const nestedSchema = {
  form: {
    name: 'Nested diagnostics',
    elements: [
      ...schema.form.elements,
      repeatable('rows', [
        field('NumericField', 'amount', { default_value: 4 }),
        field('CalculatedField', 'row_total', {
          calculate:
            "if ($amount === 0) { throw new Error('row amount is zero'); } return $amount * 2;",
        }),
        repeatable('children', [
          field('NumericField', 'quantity', { default_value: 4 }),
          field('CalculatedField', 'child_total', {
            calculate:
              "if ($quantity === 0) { throw new Error('child quantity is zero'); } return $quantity * 3;",
          }),
        ]),
      ]),
    ],
  },
};
