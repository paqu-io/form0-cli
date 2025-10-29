import fs from 'fs-extra';
import path from 'path';
import { FIELD_SPECS, validateSchema, generateKey } from 'form0-core';
import { parseCsv, rowsToObjects, stringifyCsv } from './csv.js';
import { ensureKeysForSchema } from './ensure-keys.js';

const CSV_DELIMITER = ';;';

// Row kinds handled by the transformer
const ROW_KINDS = {
  FORM_META: 'form-meta',
  FIELD: 'field',
};

const CONTAINER_TYPES = new Set(['Section', 'RepeatableSection', 'BuildingPlanSection']);
const STATUS_TYPE = 'StatusField';
const TITLE_TYPE = 'TitleField';

// Metadata keys allowed for root-level form properties (ordered for export consistency)
const FORM_METADATA_KEYS = [
  'name',
  'description',
  'ai',
  'location_enabled',
  'location_required',
  'events.code',
];
const FORM_METADATA_KEY_SET = new Set(FORM_METADATA_KEYS);

const WARNED_METADATA_ATTRIBUTES = new Set();

const FORM_KEY_ORDER = [
  'name',
  'description',
  'ai',
  'location_enabled',
  'location_required',
  'status_field',
  'title_field',
  'form_links',
  'events',
  'elements',
];

const BASE_HEADERS = ['entry_type', 'form_meta_attribute', 'form_meta_value'];

const ATTRIBUTE_COLUMN_MAP = new Map([
  ['elements', null],
  ['agreement_text', 'signature_agreement_text'],
  ['allow_other', 'choice_allow_other'],
  ['form_id', 'linked_form_id'],
  ['format', 'numeric_format'],
  ['is_searchable', 'choice_is_searchable'],
  ['is_searchable_mode', 'choice_is_searchable_mode'],
  ['location_enabled', 'repeatable_location_enabled'],
  ['location_required', 'repeatable_location_required'],
  ['max', 'numeric_max'],
  ['min', 'numeric_min'],
  ['max_length', 'media_max_length'],
  ['min_length', 'media_min_length'],
  ['node_overrides', 'building_plan_node_overrides'],
  ['pattern', 'regex_pattern'],
  ['pattern_description', 'regex_pattern_description'],
  ['third_option_enabled', 'boolean_third_option_enabled'],
  ['enabled', 'status_title_enabled'],
  ['record_conditions', 'linked_record_conditions'],
  ['record_defaults', 'linked_record_defaults'],
  ['building_plan', null],
]);

const ATTRIBUTE_COLUMN_TYPE_OVERRIDES = {
  TitleField: new Map([['elements', 'title_elements']]),
};

const DESIRED_FIELD_COLUMNS = [
  'data_name',
  'label',
  'type',
  'parent_section_data_name',
  'description',
  'description_mode',
  'default_value',
  'visible',
  'visible_conditions',
  'read_only',
  'read_only_conditions',
  'required',
  'required_conditions',
  'choices',
  'choice_allow_other',
  'choice_is_searchable',
  'choice_is_searchable_mode',
  'boolean_third_option_enabled',
  'calculate',
  'display',
  'regex_pattern',
  'regex_pattern_description',
  'numeric_format',
  'numeric_min',
  'numeric_max',
  'media_min_length',
  'media_max_length',
  'supporting_image',
  'supporting_image_display',
  'supporting_image_path',
  'signature_agreement_text',
  'linked_form_id',
  'allow_creating_records',
  'allow_existing_records',
  'allow_multiple_records',
  'allow_updating_records',
  'linked_record_conditions',
  'linked_record_defaults',
  'repeatable_location_enabled',
  'repeatable_location_required',
  'title_elements',
  'status_title_enabled',
  'building_plan_node_overrides',
];

function resolveColumnName(attributeName, typeName) {
  const typeOverrides = ATTRIBUTE_COLUMN_TYPE_OVERRIDES[typeName];
  if (typeOverrides && typeOverrides.has(attributeName)) {
    return typeOverrides.get(attributeName);
  }
  if (ATTRIBUTE_COLUMN_MAP.has(attributeName)) {
    return ATTRIBUTE_COLUMN_MAP.get(attributeName);
  }
  return attributeName;
}

const FIELD_ATTRIBUTE_COLUMNS = (() => {
  const columnSet = new Set();
  for (const [typeName, spec] of Object.entries(FIELD_SPECS)) {
    for (const attributeName of Object.keys(spec.attributes)) {
      if (attributeName === 'key') continue;
      const columnName = resolveColumnName(attributeName, typeName);
      if (columnName) {
        columnSet.add(columnName);
      }
    }
  }

  columnSet.add('parent_section_data_name');

  const columns = Array.from(columnSet);
  const desiredIndex = new Map();
  DESIRED_FIELD_COLUMNS.forEach((name, index) => desiredIndex.set(name, index));

  return columns.sort((a, b) => {
    const ap = desiredIndex.has(a) ? desiredIndex.get(a) : Number.MAX_SAFE_INTEGER;
    const bp = desiredIndex.has(b) ? desiredIndex.get(b) : Number.MAX_SAFE_INTEGER;
    if (ap !== bp) return ap - bp;
    return a.localeCompare(b);
  });
})();

export const CSV_HEADERS = [...BASE_HEADERS, ...FIELD_ATTRIBUTE_COLUMNS];

function normalizeRowKind(rowKind) {
  const value = (rowKind || ROW_KINDS.FIELD).toString().trim().toLowerCase();
  return value === ROW_KINDS.FORM_META ? ROW_KINDS.FORM_META : ROW_KINDS.FIELD;
}

function splitMultiline(value) {
  if (!value) return [];
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function splitDelimited(line) {
  return line.split(CSV_DELIMITER).map((token) => token.trim());
}

function reorderFormKeys(form) {
  const ordered = {};
  const added = new Set();

  for (const key of FORM_KEY_ORDER) {
    if (Object.prototype.hasOwnProperty.call(form, key)) {
      if (key === 'events' && form.events && typeof form.events === 'object') {
        const eventOrdered = {};
        Object.keys(form.events).forEach((eventKey) => {
          if (eventKey !== 'code') {
            eventOrdered[eventKey] = form.events[eventKey];
          }
        });
        if (Object.prototype.hasOwnProperty.call(form.events, 'code')) {
          eventOrdered.code = form.events.code;
        }
        ordered.events = eventOrdered;
      } else {
        ordered[key] = form[key];
      }
      added.add(key);
    }
  }

  Object.keys(form).forEach((key) => {
    if (!added.has(key)) {
      ordered[key] = form[key];
    }
  });

  return ordered;
}

function parseMetadataValue(raw) {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (/^(null)$/i.test(trimmed)) return null;
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true';
  if (!Number.isNaN(Number(trimmed)) && trimmed !== '') {
    return Number(trimmed);
  }
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Fall through to raw string
    }
  }
  if (/\r|\n/.test(trimmed)) {
    return splitMultiline(trimmed);
  }
  if (trimmed.includes(CSV_DELIMITER)) {
    return splitDelimited(trimmed).filter((token) => token.length > 0);
  }
  return raw;
}

function parseChoices(value, type) {
  const lines = splitMultiline(value);
  const requireColor = type === STATUS_TYPE;
  const choices = lines.map((line, index) => {
    const [label, choiceValue, color, ...rest] = splitDelimited(line);
    if (!label || !choiceValue) {
      throw new Error(`Choice definition must provide label and value (line ${index + 1})`);
    }
    const choice = { label, value: choiceValue };
    if (requireColor) {
      if (!color) {
        throw new Error(`StatusField choices must provide a color (line ${index + 1})`);
      }
      choice.color = color;
    } else if (color) {
      choice.color = color;
    }

    if (rest.length > 0) {
      const extra = rest.join(CSV_DELIMITER).trim();
      if (extra) {
        try {
          const parsed = JSON.parse(extra);
          Object.assign(choice, parsed);
        } catch {
          // Treat as custom metadata bucket
          choice.metadata = extra;
        }
      }
    }
    return choice;
  });
  return choices;
}

function parseArrayValue(value) {
  const lines = splitMultiline(value);
  if (lines.length === 0) return [];
  const result = [];
  lines.forEach((line) => {
    const tokens = splitDelimited(line).filter((token) => token.length > 0);
    if (tokens.length === 0) return;
    if (tokens.length === 1) {
      result.push(tokens[0]);
    } else {
      result.push(tokens);
    }
  });
  return result;
}

function parseAttributeValue(cell, attributeName, attributeSpec, typeName) {
  const raw = cell ?? '';
  const trimmed = raw.trim();
  const hasValue = trimmed.length > 0;

  if (attributeSpec.value !== undefined) {
    // Spec-defined constant value wins
    return attributeSpec.value;
  }

  if (!hasValue) {
    if (attributeSpec.nullable) {
      return null;
    }
    if (attributeSpec.required && !attributeSpec.nullable) {
      throw new Error(`Missing value for required attribute "${attributeName}" on ${typeName}`);
    }
    return null;
  }

  switch (attributeSpec.type) {
    case 'string':
      return raw;
    case 'boolean':
      if (/^(true|false)$/i.test(trimmed)) {
        return trimmed.toLowerCase() === 'true';
      }
      throw new Error(`Invalid boolean value "${cell}" for attribute "${attributeName}"`);
    case 'number': {
      const num = Number(trimmed);
      if (Number.isNaN(num)) {
        throw new Error(`Invalid number value "${cell}" for attribute "${attributeName}"`);
      }
      return num;
    }
    case 'object':
      try {
        return JSON.parse(trimmed);
      } catch {
        throw new Error(`Invalid JSON object for attribute "${attributeName}"`);
      }
    case 'array':
      if (attributeName === 'choices') {
        return parseChoices(cell, typeName);
      }
      // Fall back to JSON parsing first
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed);
          return Array.isArray(parsed) ? parsed : [parsed];
        } catch {
          throw new Error(`Invalid JSON array for attribute "${attributeName}"`);
        }
      }
      return parseArrayValue(cell);
    default:
      return trimmed;
  }
}

function stringifyChoices(choices) {
  if (!Array.isArray(choices) || choices.length === 0) return '';
  return choices
    .map((choice) => {
      const tokens = [choice.label ?? '', choice.value ?? ''];
      if (choice.color) tokens.push(choice.color);
      if (choice.metadata) tokens.push(choice.metadata);
      return tokens.join(CSV_DELIMITER);
    })
    .join('\n');
}

function stringifyArray(value) {
  if (!Array.isArray(value) || value.length === 0) return '';
  return value
    .map((entry) => {
      if (Array.isArray(entry)) {
        return entry.join(CSV_DELIMITER);
      }
      if (typeof entry === 'object' && entry !== null) {
        return JSON.stringify(entry);
      }
      return String(entry);
    })
    .join('\n');
}

function formatAttributeValue(value, attributeName) {
  if (value === undefined || value === null) return '';
  if (attributeName === 'choices') {
    return stringifyChoices(value);
  }
  if (Array.isArray(value)) {
    return stringifyArray(value);
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return String(value);
}

function parseMetadataRows(rows, form) {
  rows.forEach((row) => {
    const attribute = row.form_meta_attribute?.trim();
    if (!attribute) return;
    if (!FORM_METADATA_KEY_SET.has(attribute)) {
      if (!WARNED_METADATA_ATTRIBUTES.has(attribute)) {
        console.warn(`[form0 schema] Ignoring unsupported form-meta attribute "${attribute}"`);
        WARNED_METADATA_ATTRIBUTES.add(attribute);
      }
      return;
    }

    const value = parseMetadataValue(row.form_meta_value ?? '');

    if (attribute === 'events.code') {
      if (!form.events) form.events = {};
      form.events.code = value == null ? '' : String(value);
      return;
    }

    if (value === null) {
      delete form[attribute];
    } else {
      form[attribute] = value;
    }
  });
}

function buildFieldFromRow(row) {
  const typeName = row.type?.trim();
  if (!typeName) {
    throw new Error('Each field row must include a type');
  }

  const spec = FIELD_SPECS[typeName];
  if (!spec) {
    throw new Error(`Unknown field type "${typeName}"`);
  }

  const field = {};

  for (const attributeName of Object.keys(spec.attributes)) {
    if (attributeName === 'key') continue;
    if (attributeName === 'elements' && CONTAINER_TYPES.has(typeName)) {
      field.elements = [];
      continue;
    }
    const columnName = resolveColumnName(attributeName, typeName);
    if (!columnName) continue;
    const attributeSpec = spec.attributes[attributeName];
    const rawValue = row[columnName];
    const parsedValue = parseAttributeValue(rawValue, attributeName, attributeSpec, typeName);
    if (parsedValue !== undefined) {
      if (attributeName === 'ai' && parsedValue == null) {
        continue;
      }
      field[attributeName] = parsedValue;
    }
  }

  return field;
}

function attachFieldToForm(field, parentSectionName, form, sectionLookup) {
  if (!field.data_name) {
    throw new Error(`Field of type ${field.type} is missing data_name`);
  }
  if (field.type === STATUS_TYPE) {
    form.status_field = {
      key: '@status',
      data_name: 'status',
      ...field,
    };
    return;
  }

  if (field.type === TITLE_TYPE) {
    form.title_field = {
      key: '@title',
      data_name: 'title',
      ...field,
    };
    return;
  }

  if (!parentSectionName) {
    form.elements.push(field);
  } else {
    const parent = sectionLookup.get(parentSectionName);
    if (!parent) {
      throw new Error(`Unable to find parent section "${parentSectionName}"`);
    }
    if (!Array.isArray(parent.elements)) {
      parent.elements = [];
    }
    parent.elements.push(field);
  }

  if (CONTAINER_TYPES.has(field.type)) {
    sectionLookup.set(field.data_name, field);
  }
}

function ensureGeneratedKeys(form) {
  if (Array.isArray(form.elements)) {
    ensureKeysForSchema(form.elements);
  }

  if (form.status_field && !form.status_field.key) {
    form.status_field.key = '@status';
  }

  if (form.title_field && !form.title_field.key) {
    form.title_field.key = '@title';
  }

  const populateKeys = (fields) => {
    fields.forEach((field) => {
      if (!field.key && field.data_name) {
        field.key = generateKey(field.data_name);
      }
      if (CONTAINER_TYPES.has(field.type) && Array.isArray(field.elements)) {
        populateKeys(field.elements);
      }
    });
  };

  populateKeys(form.elements || []);
}

export async function importSchemaFromCsvFile(csvPath, { outputPath } = {}) {
  WARNED_METADATA_ATTRIBUTES.clear();
  const targetPath = outputPath || 'form.schema.json';
  const csvText = await fs.readFile(csvPath, 'utf8');
  const rows = rowsToObjects(parseCsv(csvText));

  const form = { elements: [] };
  const metadataRows = rows.filter((row) => normalizeRowKind(row.entry_type) === ROW_KINDS.FORM_META);
  const fieldRows = rows.filter((row) => normalizeRowKind(row.entry_type) === ROW_KINDS.FIELD);

  parseMetadataRows(metadataRows, form);

  const sectionLookup = new Map();

  fieldRows.forEach((row) => {
    const field = buildFieldFromRow(row);
    const parentSectionName = row.parent_section_data_name?.trim() || '';
    attachFieldToForm(field, parentSectionName, form, sectionLookup);
  });

  ensureGeneratedKeys(form);
  validateSchema(form);

  const orderedForm = reorderFormKeys(form);

  const outputDir = path.dirname(path.resolve(targetPath));
  await fs.ensureDir(outputDir);
  await fs.writeJson(targetPath, { form: orderedForm }, { spaces: 2 });

  return { form: orderedForm, schemaPath: targetPath };
}

function collectFieldRows(form, parentSectionName = '') {
  const rows = [];
  const processField = (field, parentName) => {
    const spec = FIELD_SPECS[field.type];
    if (!spec) {
      return;
    }
    const row = {
      entry_type: ROW_KINDS.FIELD,
      parent_section_data_name: parentName,
    };

    for (const attributeName of Object.keys(spec.attributes)) {
      if (attributeName === 'key') continue;
      if (attributeName === 'elements' && CONTAINER_TYPES.has(field.type)) {
        continue;
      }
      const columnName = resolveColumnName(attributeName, field.type);
      if (!columnName) continue;
      const value = field[attributeName];
      row[columnName] = formatAttributeValue(value, attributeName);
    }

    rows.push(row);

    if (CONTAINER_TYPES.has(field.type) && Array.isArray(field.elements)) {
      field.elements.forEach((child) => processField(child, field.data_name));
    }
  };

  if (Array.isArray(form.elements)) {
    form.elements.forEach((field) => processField(field, parentSectionName));
  }

  if (form.status_field) {
    processField(form.status_field, '');
  }

  if (form.title_field) {
    processField(form.title_field, '');
  }

  return rows;
}

function buildMetadataRows(form) {
  const rows = [];
  for (const attribute of FORM_METADATA_KEYS) {
    let value;
    if (attribute === 'events.code') {
      value = form?.events?.code ?? '';
    } else {
      value = formatAttributeValue(form?.[attribute], attribute);
    }

    if (value !== '' && value != null) {
      rows.push({
        entry_type: ROW_KINDS.FORM_META,
        form_meta_attribute: attribute,
        form_meta_value: value,
      });
    }
  }
  return rows;
}

export async function exportSchemaToCsvFile(schemaPath, { outputPath } = {}) {
  const text = await fs.readFile(schemaPath, 'utf8');
  const json = JSON.parse(text);
  const form = json.form || json;

  const metadataRows = buildMetadataRows(form);
  const fieldRows = collectFieldRows(form);
  const rows = [...metadataRows, ...fieldRows];

  const csvText = stringifyCsv(CSV_HEADERS, rows);
  const targetPath = outputPath || 'form.schema.csv';
  const outDir = path.dirname(path.resolve(targetPath));
  await fs.ensureDir(outDir);
  await fs.writeFile(targetPath, csvText, 'utf8');
  return { csvPath: targetPath };
}
