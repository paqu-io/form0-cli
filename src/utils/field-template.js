import { FIELD_SPECS, generateValueFromLabel } from 'form0-core';

/**
 * Build a complete, valid-by-shape field template from form0-core's field registry.
 * Callers may override the generated values after construction.
 */
export function createFieldTemplate(type, options = {}) {
  const spec = FIELD_SPECS[type];
  if (!spec) {
    return null;
  }

  const labelDefault = type.replace(/Field|Section/g, '').trim() || type;
  const label = options.label || `New ${labelDefault}`;
  const dataName = options.dataName || generateValueFromLabel(label) || 'new_field';
  const template = { type };

  for (const [attrName, attrDef] of Object.entries(spec.attributes)) {
    if (attrName === 'type') {
      template.type = type;
      continue;
    }

    if (attrName === 'elements' || attrName === 'key') {
      continue;
    }

    if (attrDef.value !== undefined) {
      template[attrName] = attrDef.value;
      continue;
    }

    if (!attrDef.required) {
      continue;
    }

    if (attrName === 'label') {
      template[attrName] = label;
      continue;
    }

    if (attrName === 'data_name') {
      template[attrName] = dataName;
      continue;
    }

    if (Array.isArray(attrDef.allowedValues) && attrDef.allowedValues.length > 0) {
      template[attrName] = attrDef.allowedValues[0];
      continue;
    }

    if (attrDef.nullable) {
      template[attrName] = null;
      continue;
    }

    if (attrName === 'visible') {
      template[attrName] = true;
      continue;
    }

    if (
      attrName === 'required' ||
      attrName === 'read_only' ||
      attrName === 'location_enabled' ||
      attrName === 'location_required'
    ) {
      template[attrName] = false;
      continue;
    }

    switch (attrDef.type) {
      case 'boolean':
        template[attrName] = false;
        break;
      case 'array':
        template[attrName] = [];
        break;
      case 'object':
        template[attrName] = {};
        break;
      case 'number':
        template[attrName] = 0;
        break;
      case 'string':
      default:
        template[attrName] = '';
        break;
    }
  }

  for (const [attrName, attrDef] of Object.entries(spec.attributes)) {
    if (!attrDef.dependentOn) {
      continue;
    }
    const dependencyValue = template[attrDef.dependentOn];
    if (dependencyValue === null || dependencyValue === undefined) {
      template[attrName] = null;
    }
  }

  return template;
}
