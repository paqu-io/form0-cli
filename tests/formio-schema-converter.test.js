import assert from 'node:assert/strict';
import { validateSchema } from 'form0-core';
import {
  convertFormioSchema,
  defaultFormioOutputPath,
} from '../src/utils/formio-schema-converter.js';

function findElement(elements, dataName) {
  for (const element of elements || []) {
    if (element.data_name === dataName) return element;
    const nested = findElement(element.elements, dataName);
    if (nested) return nested;
  }
  return null;
}

function assertValid(result) {
  assert.doesNotThrow(() => validateSchema(result.schema.form));
  assert.equal(result.report.targetValidation.valid, true);
}

function testCoreMappingsAndReferences() {
  const result = convertFormioSchema({
    title: 'Order Form',
    description: 'Imported order',
    components: [
      {
        type: 'radio',
        key: 'customerKind',
        label: 'Customer kind',
        input: true,
        values: [
          { label: 'Business', value: 'Business Customer' },
          { label: 'Person', value: 'person' },
        ],
      },
      {
        type: 'textfield',
        key: 'companyName',
        label: 'Company',
        input: true,
        validate: { required: true, pattern: '^[A-Z]' },
        conditional: { show: true, when: 'customerKind', eq: 'Business Customer' },
      },
      {
        type: 'number',
        key: 'unitPrice',
        label: 'Unit price',
        input: true,
        defaultValue: 5,
        validate: { min: 0 },
      },
      {
        type: 'number',
        key: 'quantity',
        label: 'Quantity',
        input: true,
        validate: { integer: true, min: 1 },
      },
      {
        type: 'number',
        key: 'totalPrice',
        label: 'Total',
        input: true,
        calculateValue: 'value = data.unitPrice * data.quantity;',
      },
      {
        type: 'checkbox',
        key: 'accepted',
        label: 'Accepted',
        input: true,
        defaultValue: false,
      },
    ],
  });

  assertValid(result);
  assert.equal(result.report.outcome, 'convertible');
  assert.equal(result.schema.form.name, 'Order Form');
  assert.equal(result.schema.form.status_field, undefined);

  const customerKind = findElement(result.schema.form.elements, 'customer_kind');
  const company = findElement(result.schema.form.elements, 'company_name');
  const total = findElement(result.schema.form.elements, 'total_price');
  assert.equal(customerKind.type, 'SingleChoiceField');
  assert.equal(customerKind.choices[0].value, 'business_customer');
  assert.equal(company.visible_conditions.field_id, customerKind.key);
  assert.equal(company.visible_conditions.value, 'business_customer');
  assert.equal(total.type, 'CalculatedField');
  assert.equal(total.calculate, '($unit_price * $quantity)');
  assert.equal(total.display.style, 'numeric');
  assert.equal(findElement(result.schema.form.elements, 'quantity').format, 'integer');
  assert.equal(findElement(result.schema.form.elements, 'accepted').default_value, 'false');
}

function testNestedWizardAndRepeatables() {
  const result = convertFormioSchema({
    title: 'Wizard',
    display: 'wizard',
    components: [
      {
        type: 'panel',
        title: 'People',
        components: [
          {
            type: 'columns',
            columns: [
              {
                components: [{ type: 'textfield', key: 'ownerName', label: 'Owner', input: true }],
              },
            ],
          },
          {
            type: 'datagrid',
            key: 'people',
            label: 'People',
            input: true,
            components: [
              { type: 'number', key: 'age', label: 'Age', input: true },
              {
                type: 'number',
                key: 'ageNextYear',
                label: 'Age next year',
                input: true,
                calculateValue: 'value = row.age + 1;',
              },
              {
                type: 'editgrid',
                key: 'contacts',
                label: 'Contacts',
                input: true,
                components: [{ type: 'textfield', key: 'email', label: 'Email', input: true }],
              },
            ],
          },
        ],
      },
    ],
  });

  assertValid(result);
  assert.equal(result.report.outcome, 'completed_with_loss');
  const page = result.schema.form.elements[0];
  assert.equal(page.type, 'Section');
  assert.equal(page.display, 'drilldown');
  const people = page.elements.find((element) => element.type === 'RepeatableSection');
  const contacts = findElement(page.elements, 'contacts');
  assert.equal(people.type, 'RepeatableSection');
  assert.equal(contacts.type, 'RepeatableSection');
  assert.equal(findElement(page.elements, 'age_next_year').calculate, '($age + 1)');
  assert.ok(
    result.report.diagnostics.some((item) => item.code === 'WIZARD_NAVIGATION_APPROXIMATED')
  );
  assert.ok(result.report.diagnostics.some((item) => item.code === 'LAYOUT_FLATTENED'));
}

function testTabsTableAndIdentifierNormalization() {
  const longKey = 'Résumé.customerVeryLongIdentifierThatExceedsTheTargetLimit';
  const result = convertFormioSchema({
    components: [
      {
        type: 'tabs',
        components: [
          {
            label: 'Details',
            key: 'details',
            components: [
              {
                type: 'table',
                rows: [
                  [
                    {
                      components: [
                        { type: 'textfield', key: longKey, label: 'First', input: true },
                        { type: 'textfield', key: longKey, label: 'Second', input: true },
                      ],
                    },
                  ],
                ],
              },
            ],
          },
        ],
      },
    ],
  });

  assertValid(result);
  const section = result.schema.form.elements[0];
  assert.equal(section.type, 'Section');
  assert.equal(section.display, 'inline');
  assert.equal(section.elements.length, 2);
  assert.ok(section.elements[0].data_name.length <= 42);
  assert.ok(section.elements[1].data_name.endsWith('_2'));
  assert.notEqual(section.elements[0].key, section.elements[1].key);
}

function testStrictAndLossyBehavior() {
  const source = {
    components: [
      { type: 'password', key: 'password', label: 'Password', input: true },
      { type: 'address', key: 'address', label: 'Address', input: true },
      {
        type: 'textfield',
        key: 'deliveryNote',
        label: 'Delivery note',
        input: true,
        conditional: { show: true, when: 'address', eq: 'Paris' },
      },
      {
        type: 'number',
        key: 'unsafeTotal',
        label: 'Unsafe total',
        input: true,
        calculateValue: 'value = fetch("https://example.com");',
      },
    ],
  };

  const strict = convertFormioSchema(source);
  assert.equal(strict.report.outcome, 'blocked');
  assert.equal(findElement(strict.schema.form.elements, 'password'), null);
  assert.ok(strict.report.diagnostics.some((item) => item.code === 'PASSWORD_MASK_LOSS'));
  assert.ok(strict.report.diagnostics.some((item) => item.code === 'UNTRANSLATABLE_CALCULATION'));

  const lossy = convertFormioSchema(source, { allowLossy: true });
  assertValid(lossy);
  assert.equal(lossy.report.outcome, 'completed_with_loss');
  assert.equal(findElement(lossy.schema.form.elements, 'password').type, 'TextField');
  assert.equal(findElement(lossy.schema.form.elements, 'address'), null);
  const placeholder = findElement(lossy.schema.form.elements, 'unsafe_total');
  assert.equal(placeholder.type, 'CalculatedField');
  assert.equal(placeholder.calculate, 'null');
  assert.equal(lossy.report.summary.placeholders, 1);
  assert.equal(findElement(lossy.schema.form.elements, 'delivery_note').visible_conditions, null);
  assert.ok(lossy.report.diagnostics.some((item) => item.code === 'CONDITION_DROPPED_WITH_FIELD'));
}

function testConditionsAndLogic() {
  const result = convertFormioSchema({
    components: [
      { type: 'number', key: 'age', label: 'Age', input: true },
      {
        type: 'textfield',
        key: 'guardian',
        label: 'Guardian',
        input: true,
        logic: [
          {
            trigger: {
              type: 'json',
              json: { '<': [{ var: 'data.age' }, 18] },
            },
            actions: [
              {
                type: 'property',
                property: { value: 'validate.required' },
                state: true,
              },
            ],
          },
        ],
      },
    ],
  });
  assertValid(result);
  const guardian = findElement(result.schema.form.elements, 'guardian');
  assert.equal(guardian.required, false);
  assert.equal(guardian.required_conditions.operator, 'less_than');
}

function testRemainingSupportedComponents() {
  const result = convertFormioSchema({
    components: [
      { type: 'textarea', key: 'notes', label: 'Notes', input: true },
      { type: 'email', key: 'email', label: 'Email', input: true },
      { type: 'url', key: 'website', label: 'Website', input: true },
      { type: 'phoneNumber', key: 'phone', label: 'Phone', input: true },
      { type: 'currency', key: 'amount', label: 'Amount', input: true },
      {
        type: 'select',
        key: 'colors',
        label: 'Colors',
        input: true,
        multiple: true,
        dataSrc: 'values',
        data: { values: [{ label: 'Red', value: 'RED' }] },
        defaultValue: ['RED'],
      },
      {
        type: 'selectboxes',
        key: 'features',
        label: 'Features',
        input: true,
        values: [{ label: 'Fast', value: 'FAST' }],
        defaultValue: { FAST: true },
      },
      { type: 'date', key: 'birthday', label: 'Birthday', input: true },
      { type: 'time', key: 'arrival', label: 'Arrival', input: true },
      {
        type: 'datetime',
        key: 'dateOnly',
        label: 'Date only',
        input: true,
        enableTime: false,
      },
      { type: 'signature', key: 'signature', label: 'Signature', input: true },
      { type: 'content', key: 'instructions', label: 'Instructions', html: 'Read this' },
      { type: 'button', key: 'submit', label: 'Submit', action: 'submit' },
    ],
  });

  assertValid(result);
  assert.notEqual(result.report.outcome, 'blocked');
  assert.equal(findElement(result.schema.form.elements, 'colors').type, 'MultiChoiceField');
  assert.deepEqual(findElement(result.schema.form.elements, 'colors').default_value, ['red']);
  assert.deepEqual(findElement(result.schema.form.elements, 'features').default_value, ['fast']);
  assert.equal(findElement(result.schema.form.elements, 'date_only').type, 'DateField');
  assert.equal(findElement(result.schema.form.elements, 'signature').type, 'SignatureField');
  assert.equal(findElement(result.schema.form.elements, 'instructions').type, 'LabelField');
  assert.ok(result.report.diagnostics.some((item) => item.code === 'BUTTON_OMITTED'));
}

function testJsonCalculationsAndUnsafeAst() {
  const jsonResult = convertFormioSchema({
    components: [
      { type: 'number', key: 'a', label: 'A', input: true },
      { type: 'number', key: 'b', label: 'B', input: true },
      {
        type: 'number',
        key: 'largest',
        label: 'Largest',
        input: true,
        calculateValue: {
          if: [
            { '>': [{ var: 'data.a' }, { var: 'data.b' }] },
            { var: 'data.a' },
            { var: 'data.b' },
          ],
        },
      },
    ],
  });
  assertValid(jsonResult);
  assert.match(findElement(jsonResult.schema.form.elements, 'largest').calculate, /\$a > \$b/);

  const rejectedSources = [
    'const x = 1; value = x;',
    'value = [data.a];',
    'value = { a: data.a };',
    'value = data[key];',
    'value = (() => data.a)();',
  ];
  for (const calculateValue of rejectedSources) {
    const rejected = convertFormioSchema({
      components: [
        { type: 'number', key: 'a', label: 'A', input: true },
        { type: 'number', key: 'result', label: 'Result', input: true, calculateValue },
      ],
    });
    assert.equal(rejected.report.outcome, 'blocked');
    assert.ok(
      rejected.report.diagnostics.some((item) => item.code === 'UNTRANSLATABLE_CALCULATION')
    );
  }
}

function testCollapsibleSelectboxesReferencesAndReportCounts() {
  const result = convertFormioSchema({
    components: [
      {
        type: 'selectboxes',
        key: 'features',
        label: 'Features',
        input: true,
        values: [{ label: 'Fast mode', value: 'fastMode' }],
      },
      {
        type: 'collapsible',
        key: 'details',
        label: 'Details',
        input: false,
        collapsed: true,
        conditional: { show: true, json: { var: 'data.features.fastMode' } },
        components: [
          {
            type: 'textfield',
            key: 'notes',
            label: 'Notes',
            input: true,
            validate: { custom: '', customPrivate: false },
          },
          {
            type: 'number',
            key: 'score',
            label: 'Score',
            input: true,
            calculateValue: { if: [{ var: 'data.features.fastMode' }, 1, 0] },
          },
        ],
      },
    ],
  });

  assertValid(result);
  const details = findElement(result.schema.form.elements, 'details');
  const features = findElement(result.schema.form.elements, 'features');
  assert.equal(details.type, 'Section');
  assert.equal(details.display, 'drilldown');
  assert.equal(details.visible_conditions.field_id, features.key);
  assert.equal(details.visible_conditions.operator, 'contains');
  assert.equal(details.visible_conditions.value, 'fast_mode');
  assert.match(
    findElement(result.schema.form.elements, 'score').calculate,
    /CHOICEVALUES\(\$features\)\.includes\("fast_mode"\)/
  );
  assert.equal(
    result.report.diagnostics.some((item) => item.code === 'UNSUPPORTED_CUSTOM_VALIDATION'),
    false
  );
  assert.ok(
    result.report.diagnostics.some((item) => item.code === 'COLLAPSIBLE_NAVIGATION_APPROXIMATED')
  );
  assert.equal(result.report.summary.sourceComponents, 4);
  assert.equal(result.report.summary.sourceDataFields, 3);
  assert.equal(result.report.summary.sourceStructuralComponents, 1);
  assert.equal(result.report.summary.convertedDataFields, 3);
  assert.equal(result.report.summary.convertedStructuralElements, 1);
  assert.equal(result.report.target.fieldCount, 3);
  assert.equal(result.report.target.structuralElementCount, 1);
  assert.equal(result.report.target.elementCount, 4);
}

function testUnknownStructuralWrapperDoesNotHideChildren() {
  const source = {
    components: [
      {
        type: 'futurelayout',
        key: 'wrapper',
        input: false,
        components: [{ type: 'textfield', key: 'name', label: 'Name', input: true }],
      },
    ],
  };

  const strict = convertFormioSchema(source);
  assert.equal(strict.report.outcome, 'blocked');
  assert.equal(findElement(strict.schema.form.elements, 'name').type, 'TextField');
  assert.ok(
    strict.report.mappings.some(
      (mapping) => mapping.sourceType === 'futurelayout' && mapping.disposition === 'blocked'
    )
  );
  assert.ok(strict.report.mappings.some((mapping) => mapping.sourceKey === 'name'));

  const lossy = convertFormioSchema(source, { allowLossy: true });
  assertValid(lossy);
  assert.equal(lossy.report.outcome, 'completed_with_loss');
  assert.equal(findElement(lossy.schema.form.elements, 'name').type, 'TextField');
}

function testMalformedInputAndOutputName() {
  assert.throws(() => convertFormioSchema({ data: { name: 'submission' } }), /Submission JSON/);
  assert.throws(() => convertFormioSchema([]), /object/);
  assert.equal(defaultFormioOutputPath('forms/source.json'), 'forms/source.form0.schema.json');
  assert.equal(defaultFormioOutputPath('source'), 'source.form0.schema.json');
}

testCoreMappingsAndReferences();
testNestedWizardAndRepeatables();
testTabsTableAndIdentifierNormalization();
testStrictAndLossyBehavior();
testConditionsAndLogic();
testRemainingSupportedComponents();
testJsonCalculationsAndUnsafeAst();
testCollapsibleSelectboxesReferencesAndReportCounts();
testUnknownStructuralWrapperDoesNotHideChildren();
testMalformedInputAndOutputName();
console.log('Form.io schema converter tests passed.');
