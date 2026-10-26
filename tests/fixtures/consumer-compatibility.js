// Portable audit fixtures: consumer tests copy this file without importing implementation internals.
export const BUILTIN_CASES = [
  ['IF', 'IF($amount > 0, "yes", "no")', 'yes'],
  ['AND', 'AND(true, $amount === 4)', true],
  ['OR', 'OR(false, $amount === 4)', true],
  ['COUNT', 'COUNT(ARRAY(0, 2, null, "3"))', 2],
  ['COUNTA', 'COUNTA(ARRAY(0, false, null, "x"))', 4],
  ['COUNTBLANK', 'COUNTBLANK(ARRAY(null, "", 0, false))', 2],
  ['ARRAY', 'ARRAY($amount, 0, false)', [4, 0, false]],
  ['EVAL', 'EVAL("$amount")', 4],
  ['CHOICEVALUE', 'CHOICEVALUE($single)', 'red'],
  ['CHOICELABEL', 'CHOICELABEL($single)', 'Red'],
  ['HASOTHER', 'HASOTHER($multiple)', true],
  ['OTHER', 'OTHER($multiple)', 'Teal'],
  ['CHOICEVALUES', 'CHOICEVALUES($multiple)', ['red', 'blue']],
  ['CHOICELABELS', 'CHOICELABELS($multiple)', ['Red', 'Blue']],
  ['DATANAMES', 'DATANAMES("NumericField")', ['amount', 'cost']],
  ['ABS', 'ABS(-4)', 4],
  ['CEILING', 'CEILING(2.1)', 3],
  ['COS', 'COS(0)', 1],
  ['SIN', 'SIN(0)', 0],
  ['ROUND', 'ROUND(1.236, 2)', 1.24],
  ['DATEADD', 'DATEADD("2026-10-26", 2)', '2026-10-28'],
  ['DAYS', 'DAYS("2026-10-28", "2026-10-26")', 2],
  ['UPPER', 'UPPER("audit")', 'AUDIT'],
  ['SETRESULT', 'SETRESULT($amount + 1)', 5],
  ['REPEATABLEVALUES', "REPEATABLEVALUES($rows, 'cost')", [10, 20]],
  ['REPEATABLESUM', "REPEATABLESUM($rows, 'cost')", 30],
];
export const SPECIAL_BUILTINS = {
  FORM: {
    status: 'existing-placeholder',
    reason: 'FORM() explicitly throws in the current implementation',
  },
  ON: { status: 'supported', case: 'registration' },
  OFF: { status: 'supported', case: 'remove-handler' },
  ALERT: { status: 'supported', case: 'presentation-once' },
  SETVALUE: { status: 'supported', case: 'field-operations' },
  INVALID: { status: 'supported', case: 'scoped-validation' },
};
export const FIELD_CASES = {
  TextField: 'text',
  NumericField: 'number',
  SingleChoiceField: 'single',
  MultiChoiceField: 'multiple',
  BooleanField: 'boolean',
  DateField: 'date',
  TimeField: 'time',
  CalculatedField: 'derived',
  Section: 'section',
  RepeatableSection: 'rows',
  BuildingPlanSection: 'plan',
  LabelField: 'label',
  SignatureField: 'signature',
  PhotoField: 'photos',
  VideoField: 'videos',
  FormLinkField: 'links',
  StatusField: 'status',
  TitleField: 'title',
};
export function auditField(specs, type, name, extra = {}) {
  const result = {};
  for (const [key, rule] of Object.entries(specs[type].attributes)) {
    if (!rule.required) continue;
    result[key] = Object.hasOwn(rule, 'value')
      ? rule.value
      : rule.nullable
        ? null
        : (rule.allowedValues?.[0] ??
          { boolean: false, string: name, number: 0, integer: 0, array: [], object: {} }[
            rule.type
          ]);
  }
  Object.assign(result, { key: name, data_name: name, label: name, visible: true }, extra);
  if (['SingleChoiceField', 'MultiChoiceField'].includes(type))
    Object.assign(result, {
      allow_other: true,
      choices: [
        { value: 'red', label: 'Red' },
        { value: 'blue', label: 'Blue' },
      ],
      ...extra,
    });
  if (type === 'BooleanField')
    Object.assign(result, {
      choices: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ],
      ...extra,
    });
  if (type === 'CalculatedField')
    Object.assign(result, {
      display: { style: 'text' },
      read_only: true,
      calculate: '$amount * 2',
      ...extra,
    });
  return result;
}
export function builtinFixture(specs) {
  const f = (type, name, extra) => auditField(specs, type, name, extra);
  return {
    schema: {
      form: {
        name: 'Compatibility builtin audit',
        elements: [
          f('NumericField', 'amount'),
          f('SingleChoiceField', 'single'),
          f('MultiChoiceField', 'multiple'),
          ...BUILTIN_CASES.map(([name, calculate]) =>
            f('CalculatedField', 'builtin_' + name.toLowerCase(), { calculate })
          ),
          f('RepeatableSection', 'rows', { elements: [f('NumericField', 'cost')] }),
        ],
      },
    },
    snapshot: {
      values: {
        amount: 4,
        single: { choice: [{ value: 'red', label: 'Red' }], other: [] },
        multiple: {
          choices: [
            { value: 'red', label: 'Red' },
            { value: 'blue', label: 'Blue' },
          ],
          other: [{ label: 'Teal' }],
        },
      },
      repeatable: {
        rows: [
          { id: 0, values: { cost: 10 }, repeatable: {} },
          { id: 'B', values: { cost: 20 }, repeatable: {} },
        ],
      },
    },
  };
}
export const media = {
  signature: {
    signature_id: 'sig',
    media_id: 'sig',
    data: 'c2lnbmF0dXJl',
    mime_type: 'image/png',
    signed_at_client: '2026-10-26T10:00:00.000Z',
    upload_status: 'ready',
  },
  photos: [
    {
      photo_id: 'photo',
      media_id: 'photo',
      asset_id: 'asset-photo',
      mime_type: 'image/png',
      filename: 'photo.png',
      size_bytes: 12,
      attached_at_client: '2026-10-26T10:00:00.000Z',
      caption: 'Front',
    },
  ],
  videos: [
    {
      video_id: 'video',
      media_id: 'video',
      asset_id: 'asset-video',
      mime_type: 'video/mp4',
      filename: 'video.mp4',
      size_bytes: 24,
      duration: 2,
      attached_at_client: '2026-10-26T10:00:00.000Z',
      caption: 'Clip',
    },
  ],
};
export function fieldFixture(specs) {
  const f = (type, name, extra) => auditField(specs, type, name, extra);
  const fields = [
    f('TextField', 'text'),
    f('NumericField', 'amount'),
    f('SingleChoiceField', 'single'),
    f('MultiChoiceField', 'multiple'),
    f('BooleanField', 'boolean'),
    f('DateField', 'date'),
    f('TimeField', 'time'),
    f('SignatureField', 'signature'),
    f('PhotoField', 'photos'),
    f('VideoField', 'videos'),
    f('FormLinkField', 'links', {
      form_id: 'linked',
      allow_existing_records: true,
      allow_multiple_records: true,
    }),
    f('CalculatedField', 'derived'),
    f('LabelField', 'label'),
    f('Section', 'section', { elements: [f('TextField', 'section_note')] }),
    f('RepeatableSection', 'rows', {
      elements: [f('TextField', 'row_text'), f('NumericField', 'cost')],
    }),
    f('BuildingPlanSection', 'plan'),
  ];
  const title = f('TitleField', 'title', { key: '@title', elements: ['text'] });
  const status = f('StatusField', 'status', {
    key: '@status',
    enabled: true,
    choices: [
      { value: 'open', label: 'Open', color: '#000000' },
      { value: 'done', label: 'Done', color: '#008000' },
    ],
    default_value: 'open',
  });
  return {
    schema: {
      form: {
        name: 'Compatibility field audit',
        elements: fields,
        title_field: title,
        status_field: status,
      },
    },
    snapshot: {
      values: {
        text: 'Accepted',
        amount: 4,
        single: { choice: [{ value: 'red', label: 'Red' }], other: [] },
        multiple: {
          choices: [
            { value: 'red', label: 'Red' },
            { value: 'blue', label: 'Blue' },
          ],
          other: [],
        },
        boolean: { choice: [{ value: 'no', label: 'No' }], other: [] },
        date: '2026-10-26',
        time: '12:34:56',
        ...structuredClone(media),
        links: [{ record_id: '0', label: 'Linked', custom: 'keep' }],
        section_note: 'Section',
        status: 'open',
      },
      repeatable: {
        rows: [
          {
            id: 0,
            values: { row_text: 'Accepted row', cost: 10 },
            repeatable: {},
            custom: 'row metadata',
          },
        ],
      },
    },
  };
}
export function attachAuditEvents(specs, fixture, kind = 'fields') {
  const f = (type, name, extra) => auditField(specs, type, name, extra);
  if (kind === 'builtins') {
    fixture.schema.form.elements.push(
      f('TextField', 'event_summary'),
      f('TextField', 'event_trace', { default_value: '' })
    );
    const pairs = BUILTIN_CASES.filter(
      ([name]) => !['SETRESULT', 'REPEATABLEVALUES', 'REPEATABLESUM'].includes(name)
    ).map(([name, expression]) => JSON.stringify(name) + ':' + expression);
    fixture.schema.form.events = {
      code: `
function retired() { SETVALUE('event_trace', 'retired'); }
ON('change', 'amount', retired);
OFF('change', 'amount', retired);
ON('change', 'amount', function() {
  SETVALUE('event_trace', ($event_trace || '') + 'x');
  SETVALUE('event_summary', JSON.stringify({${pairs.join(',')}}));
  ALERT('Audit', 'One presentation');
});
ON('validate-record', function() { if ($amount < 0) INVALID('Root amount is invalid'); });
ON('validate-repeatable', 'rows', function() { if ($cost < 0) INVALID('Row cost is invalid'); });
`,
    };
  } else {
    fixture.schema.form.elements.push(f('NumericField', 'stage', { default_value: 0 }));
    fixture.snapshot.values.stage = 0;
    fixture.schema.form.elements.find((x) => x.data_name === 'text').required = true;
    fixture.schema.form.elements.find((x) => x.data_name === 'single').required = true;
    const changed = {
      ...fixture.snapshot.values,
      text: 'Changed',
      amount: 0,
      date: '2026-10-28',
      time: '01:02:03',
      status: 'done',
    };
    const cleared = {
      text: '',
      amount: null,
      single: { choice: [], other: [] },
      multiple: { choices: [], other: [] },
      boolean: { choice: [], other: [] },
      date: null,
      time: null,
      signature: null,
      photos: [],
      videos: [],
      links: [],
      status: 'open',
    };
    const write = (values) =>
      Object.entries(values)
        .filter(([name]) => !['section_note', 'stage'].includes(name))
        .map(([name, value]) => `SETVALUE(${JSON.stringify(name)}, ${JSON.stringify(value)});`)
        .join('\n');
    fixture.schema.form.events = {
      code: `ON('change', 'stage', function() { if ($stage === 1) { ${write(changed)} } else if ($stage === 2) { ${write(cleared)} } else { ${write(fixture.snapshot.values)} } });`,
    };
    fixture.changed = changed;
    fixture.cleared = cleared;
  }
  return fixture;
}

// Traverse the actual schema too: a manifest entry alone must not count as field coverage.
export function fixtureFieldTypes(schema) {
  const types = new Set();
  const visit = (field) => {
    if (!field) return;
    types.add(field.type);
    if (field.type !== 'TitleField') for (const child of field.elements || []) visit(child);
  };
  for (const field of schema.form.elements) visit(field);
  visit(schema.form.title_field);
  visit(schema.form.status_field);
  return [...types].sort();
}
