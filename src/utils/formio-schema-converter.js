import * as acorn from 'acorn';
import { analyzeCalculationExpression, generateKey, validateSchema } from 'form0-core';
import { createFieldTemplate } from './field-template.js';

const MAX_DATA_NAME_LENGTH = 42;
const TEXT_TYPES = new Set(['textfield', 'textarea', 'email', 'url', 'phonenumber', 'password']);
const FLATTEN_TYPES = new Set(['well', 'columns', 'table']);
const SOURCE_STRUCTURE_TYPES = new Set([
  'panel',
  'fieldset',
  'collapsible',
  'well',
  'columns',
  'tabs',
  'table',
  'datagrid',
  'editgrid',
  'container',
  '__tab',
]);
const TARGET_STRUCTURE_TYPES = new Set(['Section', 'RepeatableSection']);
const UNSUPPORTED_DATA_TYPES = new Set([
  'hidden',
  'datamap',
  'address',
  'day',
  'tags',
  'survey',
  'file',
  'resource',
  'nestedform',
  'form',
  'datasource',
  'datatable',
  'captcha',
  'tagpad',
  'sketchpad',
  'reviewpage',
  'custom',
]);
const BINARY_OPERATORS = new Set([
  '+',
  '-',
  '*',
  '/',
  '%',
  '**',
  '==',
  '===',
  '!=',
  '!==',
  '>',
  '>=',
  '<',
  '<=',
]);
const LOGICAL_OPERATORS = new Set(['&&', '||', '??']);
const UNARY_OPERATORS = new Set(['+', '-', '!']);
const CONDITION_OPERATORS = Object.freeze({
  '==': 'equal_to',
  '===': 'equal_to',
  '!=': 'not_equal_to',
  '!==': 'not_equal_to',
  '>': 'greater_than',
  '>=': 'greater_or_equal_than',
  '<': 'less_than',
  '<=': 'less_or_equal_than',
});
const INVERTED_CONDITION_OPERATORS = Object.freeze({
  equal_to: 'not_equal_to',
  not_equal_to: 'equal_to',
  greater_than: 'less_or_equal_than',
  greater_or_equal_than: 'less_than',
  less_than: 'greater_or_equal_than',
  less_or_equal_than: 'greater_than',
  is_empty: 'is_not_empty',
  is_not_empty: 'is_empty',
});

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasValue(value) {
  if (typeof value === 'string') return value.trim().length > 0;
  if (isObject(value)) return Object.keys(value).length > 0;
  return false;
}

function normalizeIdentifier(value, fallback = 'field') {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return (normalized || fallback).slice(0, MAX_DATA_NAME_LENGTH);
}

function uniqueIdentifier(base, used) {
  let candidate = base.slice(0, MAX_DATA_NAME_LENGTH);
  let counter = 2;
  while (used.has(candidate)) {
    const suffix = `_${counter}`;
    candidate = `${base.slice(0, MAX_DATA_NAME_LENGTH - suffix.length)}${suffix}`;
    counter += 1;
  }
  used.add(candidate);
  return candidate;
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function createDiagnostic(code, severity, record, message, remediation, extra = {}) {
  return {
    code,
    severity,
    sourcePath: record?.sourcePath || '$',
    componentKey: record?.component?.key ?? null,
    message,
    remediation: remediation || null,
    fatal: extra.fatal === true,
  };
}

function childContexts(component, sourcePath) {
  const type = String(component?.type || '').toLowerCase();
  if (type === 'columns') {
    return (component.columns || []).flatMap((column, columnIndex) =>
      (column.components || []).map((child, childIndex) => ({
        component: child,
        sourcePath: `${sourcePath}.columns[${columnIndex}].components[${childIndex}]`,
      }))
    );
  }
  if (type === 'table') {
    return (component.rows || []).flatMap((row, rowIndex) =>
      (row || []).flatMap((cell, cellIndex) =>
        (cell?.components || []).map((child, childIndex) => ({
          component: child,
          sourcePath: `${sourcePath}.rows[${rowIndex}][${cellIndex}].components[${childIndex}]`,
        }))
      )
    );
  }
  return (component.components || []).map((child, index) => ({
    component: child,
    sourcePath: `${sourcePath}.components[${index}]`,
  }));
}

function isDataBearing(component) {
  const type = String(component?.type || '').toLowerCase();
  if (
    [
      'button',
      'content',
      'htmlelement',
      'panel',
      'fieldset',
      'collapsible',
      'well',
      'columns',
      'tabs',
      'table',
    ].includes(type)
  ) {
    return false;
  }
  return component?.input === true || Boolean(component?.key) || UNSUPPORTED_DATA_TYPES.has(type);
}

function collectRecords(components, options = {}) {
  const records = [];

  const visit = (component, sourcePath, context = {}) => {
    if (!isObject(component)) return;
    const type = String(component.type || '').toLowerCase();
    const record = {
      component,
      sourcePath,
      type,
      virtual: false,
      isWizardPage: options.isWizard === true && context.isRoot === true && type === 'panel',
      repeatableAncestors: [...(context.repeatableAncestors || [])],
    };
    records.push(record);

    const nextAncestors =
      type === 'datagrid' || type === 'editgrid'
        ? [...record.repeatableAncestors, sourcePath]
        : record.repeatableAncestors;

    if (type === 'tabs') {
      (component.components || []).forEach((tab, tabIndex) => {
        const tabPath = `${sourcePath}.components[${tabIndex}]`;
        const tabRecord = {
          component: { ...tab, type: '__tab' },
          sourcePath: tabPath,
          type: '__tab',
          virtual: true,
          isWizardPage: false,
          repeatableAncestors: [...nextAncestors],
        };
        records.push(tabRecord);
        (tab.components || []).forEach((child, childIndex) => {
          visit(child, `${tabPath}.components[${childIndex}]`, {
            repeatableAncestors: nextAncestors,
          });
        });
      });
      return;
    }

    const children = childContexts(component, sourcePath);
    children.forEach(({ component: child, sourcePath: childPath }) => {
      visit(child, childPath, {
        repeatableAncestors: nextAncestors,
      });
    });
  };

  if (!Array.isArray(components)) return records;
  components.forEach((component, index) =>
    visit(component, `components[${index}]`, { isRoot: true })
  );
  return records;
}

function recordNeedsIdentity(record) {
  return !['button', 'well', 'columns', 'tabs', 'table'].includes(record.type);
}

function assignIdentities(records, diagnostics, allowLossy) {
  const usedDataNames = new Set();
  const usedKeys = new Set();
  const identities = new Map();
  const sourceKeyRecords = new Map();
  const rowReferenceMaps = new Map();

  for (const record of records) {
    if (!recordNeedsIdentity(record)) continue;
    const component = record.component;
    const sourceKey = typeof component.key === 'string' ? component.key.trim() : '';
    const requiresKey = isDataBearing(component);
    if (!sourceKey && requiresKey) {
      diagnostics.push(
        createDiagnostic(
          'MISSING_COMPONENT_KEY',
          'error',
          record,
          'Data-bearing Form.io components must have a key.',
          'Add a Form.io key or use --allow-lossy to generate one.'
        )
      );
      if (!allowLossy) continue;
    }

    const fallback = component.label || component.title || component.type || 'field';
    const base = normalizeIdentifier(sourceKey || fallback);
    const dataName = uniqueIdentifier(base, usedDataNames);
    let targetKey = generateKey(dataName);
    let keyAttempt = 2;
    while (usedKeys.has(targetKey)) {
      targetKey = generateKey(`${dataName}:${record.sourcePath}:${keyAttempt}`);
      keyAttempt += 1;
    }
    usedKeys.add(targetKey);

    const identity = {
      sourceKey: sourceKey || null,
      dataName,
      targetKey,
      choiceValueMap: new Map(),
      record,
    };
    identities.set(record.sourcePath, identity);

    if (sourceKey) {
      const matches = sourceKeyRecords.get(sourceKey) || [];
      matches.push(identity);
      sourceKeyRecords.set(sourceKey, matches);
      const nearestRepeatable = record.repeatableAncestors.at(-1);
      if (nearestRepeatable) {
        if (!rowReferenceMaps.has(nearestRepeatable))
          rowReferenceMaps.set(nearestRepeatable, new Map());
        rowReferenceMaps.get(nearestRepeatable).set(sourceKey, identity);
      }
    }
  }

  return { identities, sourceKeyRecords, rowReferenceMaps };
}

function buildChoiceList(record, identity, diagnostics) {
  const component = record.component;
  const type = record.type;
  let sourceChoices = [];
  if (type === 'select') {
    const dataSource = component.dataSrc || 'values';
    if (dataSource !== 'values' || !Array.isArray(component.data?.values)) {
      diagnostics.push(
        createDiagnostic(
          'DYNAMIC_CHOICE_SOURCE',
          'error',
          record,
          `Select data source "${dataSource}" is not an embedded static value list.`,
          'Replace it with embedded values before conversion.'
        )
      );
      return null;
    }
    sourceChoices = component.data.values;
  } else {
    sourceChoices = component.values || component.data?.values || [];
  }

  if (!Array.isArray(sourceChoices) || sourceChoices.length === 0) {
    diagnostics.push(
      createDiagnostic(
        'EMPTY_CHOICE_LIST',
        'error',
        record,
        'Choice components require at least one embedded choice.',
        'Add static choices in Form.io.'
      )
    );
    return null;
  }

  const used = new Set();
  return sourceChoices.map((choice, index) => {
    const rawValue = isObject(choice) && 'value' in choice ? choice.value : choice;
    const label = isObject(choice) ? String(choice.label ?? rawValue) : String(choice);
    const normalized = uniqueIdentifier(normalizeIdentifier(rawValue, `option_${index + 1}`), used);
    identity.choiceValueMap.set(String(rawValue), normalized);
    return { label, value: normalized };
  });
}

function referenceMap(reference, record, context) {
  const sourceKey = String(reference || '').replace(/^(data|row)\./, '');
  if (String(reference).startsWith('row.')) {
    const nearestRepeatable = record.repeatableAncestors.at(-1);
    return {
      sourceKey,
      find: (key) =>
        nearestRepeatable
          ? context.rowReferenceMaps.get(nearestRepeatable)?.get(key) || null
          : null,
    };
  }
  return {
    sourceKey,
    find: (key) => {
      const matches = context.sourceKeyRecords.get(key) || [];
      return matches.length === 1 ? matches[0] : null;
    },
  };
}

function resolveReferenceDescriptor(reference, record, context) {
  const lookup = referenceMap(reference, record, context);
  const directIdentity = lookup.find(lookup.sourceKey);
  if (directIdentity) return { identity: directIdentity, choiceValue: null };

  const parts = lookup.sourceKey.split('.');
  for (let index = parts.length - 1; index > 0; index -= 1) {
    const fieldKey = parts.slice(0, index).join('.');
    const sourceChoiceValue = parts.slice(index).join('.');
    const identity = lookup.find(fieldKey);
    if (
      identity?.record?.type === 'selectboxes' &&
      identity.choiceValueMap.has(sourceChoiceValue)
    ) {
      return {
        identity,
        choiceValue: identity.choiceValueMap.get(sourceChoiceValue),
      };
    }
  }
  return null;
}

function resolveReference(reference, record, context) {
  return resolveReferenceDescriptor(reference, record, context)?.identity || null;
}

function normalizeConditionValue(identity, value) {
  if (!identity || identity.choiceValueMap.size === 0) return value;
  return identity.choiceValueMap.get(String(value)) ?? value;
}

function invertCondition(condition) {
  if (condition.and) return { or: condition.and.map(invertCondition) };
  if (condition.or) return { and: condition.or.map(invertCondition) };
  const operator = INVERTED_CONDITION_OPERATORS[condition.operator];
  if (!operator) throw new Error(`Cannot invert operator ${condition.operator}`);
  return { ...condition, operator };
}

function translateSimpleCondition(simple, record, context) {
  if (!simple?.when) throw new Error('Simple condition does not reference a component key.');
  const identity = resolveReference(`data.${simple.when}`, record, context);
  if (!identity) throw new Error(`Condition reference "${simple.when}" is missing or ambiguous.`);
  const condition = {
    field_id: identity.targetKey,
    operator: 'equal_to',
    value: normalizeConditionValue(identity, simple.eq),
  };
  return simple.show === false ? invertCondition(condition) : condition;
}

function jsonLogicVariable(node) {
  if (!isObject(node) || !('var' in node)) return null;
  const value = Array.isArray(node.var) ? node.var[0] : node.var;
  return typeof value === 'string' ? value : null;
}

function translateJsonCondition(node, record, context) {
  if (!isObject(node) || Object.keys(node).length !== 1) {
    throw new Error('JSON Logic conditions must contain exactly one operator.');
  }
  const [operator, rawArgs] = Object.entries(node)[0];
  const args = Array.isArray(rawArgs) ? rawArgs : [rawArgs];
  if (operator === 'var') {
    const reference = Array.isArray(rawArgs) ? rawArgs[0] : rawArgs;
    if (typeof reference !== 'string') {
      throw new Error('JSON Logic var must contain a static field path.');
    }
    const resolved = resolveReferenceDescriptor(reference, record, context);
    if (!resolved) throw new Error(`Condition reference "${reference}" is missing or ambiguous.`);
    if (resolved.choiceValue === null) {
      throw new Error('A bare JSON Logic var is supported only for a selectboxes choice.');
    }
    return {
      field_id: resolved.identity.targetKey,
      operator: 'contains',
      value: resolved.choiceValue,
    };
  }
  if (operator === 'and' || operator === 'or') {
    if (args.length === 0) throw new Error(`${operator} requires at least one condition.`);
    return { [operator]: args.map((arg) => translateJsonCondition(arg, record, context)) };
  }
  if (operator === '!') {
    return invertCondition(translateJsonCondition(args[0], record, context));
  }
  const targetOperator = CONDITION_OPERATORS[operator];
  if (!targetOperator || args.length !== 2) {
    throw new Error(`Unsupported JSON Logic condition operator "${operator}".`);
  }

  let variable = jsonLogicVariable(args[0]);
  let literal = args[1];
  let effectiveOperator = targetOperator;
  if (!variable) {
    variable = jsonLogicVariable(args[1]);
    literal = args[0];
    const reversed = {
      greater_than: 'less_than',
      greater_or_equal_than: 'less_or_equal_than',
      less_than: 'greater_than',
      less_or_equal_than: 'greater_or_equal_than',
    };
    effectiveOperator = reversed[effectiveOperator] || effectiveOperator;
  }
  if (!variable || isObject(literal) || Array.isArray(literal)) {
    throw new Error('Conditions must compare one field reference with one literal value.');
  }
  const resolved = resolveReferenceDescriptor(variable, record, context);
  if (!resolved) throw new Error(`Condition reference "${variable}" is missing or ambiguous.`);
  if (resolved.choiceValue !== null) {
    const selectsChoice =
      (['==', '==='].includes(operator) && literal === true) ||
      (['!=', '!=='].includes(operator) && literal === false);
    if (!selectsChoice) {
      throw new Error(
        `Condition reference "${variable}" requires a selectboxes membership test that form0 cannot invert.`
      );
    }
    return {
      field_id: resolved.identity.targetKey,
      operator: 'contains',
      value: resolved.choiceValue,
    };
  }
  return {
    field_id: resolved.identity.targetKey,
    operator: effectiveOperator,
    value: normalizeConditionValue(resolved.identity, literal),
  };
}

function translateTrigger(trigger, record, context) {
  if (trigger?.type === 'simple') return translateSimpleCondition(trigger.simple, record, context);
  if (trigger?.type === 'json' && trigger.json) {
    return translateJsonCondition(trigger.json, record, context);
  }
  throw new Error(`Unsupported logic trigger type "${trigger?.type || 'unknown'}".`);
}

function applyConditions(field, record, context) {
  const component = record.component;
  if (component.conditional && (component.conditional.when || component.conditional.json)) {
    try {
      field.visible_conditions = component.conditional.json
        ? translateJsonCondition(component.conditional.json, record, context)
        : translateSimpleCondition(component.conditional, record, context);
      field.visible = false;
    } catch (error) {
      context.diagnostics.push(
        createDiagnostic(
          'UNSUPPORTED_CONDITION',
          'error',
          record,
          error.message,
          'Rewrite the condition using a supported field-to-literal comparison.'
        )
      );
    }
  }

  const assignedProperties = new Set(field.visible_conditions ? ['visible_conditions'] : []);
  for (const logic of component.logic || []) {
    let trigger;
    try {
      trigger = translateTrigger(logic.trigger, record, context);
    } catch (error) {
      context.diagnostics.push(
        createDiagnostic(
          'UNSUPPORTED_LOGIC_TRIGGER',
          'error',
          record,
          error.message,
          'Use a simple or supported JSON Logic trigger.'
        )
      );
      continue;
    }

    for (const action of logic.actions || []) {
      if (action.type !== 'property') {
        context.diagnostics.push(
          createDiagnostic(
            action.type === 'value' ? 'UNSUPPORTED_VALUE_ACTION' : 'UNSUPPORTED_LOGIC_ACTION',
            'error',
            record,
            `Logic action type "${action.type || 'unknown'}" cannot be represented in form0.`,
            'Rewrite it as a supported property condition or calculation.'
          )
        );
        continue;
      }

      const property = action.property?.value;
      const target = {
        'validate.required': ['required', 'required_conditions'],
        disabled: ['read_only', 'read_only_conditions'],
        hidden: ['visible', 'visible_conditions'],
      }[property];
      if (!target || !(target[1] in field)) {
        context.diagnostics.push(
          createDiagnostic(
            'UNSUPPORTED_PROPERTY_ACTION',
            'error',
            record,
            `Property action "${property || 'unknown'}" is not supported for this field.`,
            null
          )
        );
        continue;
      }
      if (assignedProperties.has(target[1])) {
        context.diagnostics.push(
          createDiagnostic(
            'COMPETING_PROPERTY_RULES',
            'error',
            record,
            `Multiple dynamic rules target ${property}.`,
            'Keep a single rule for each dynamic property.'
          )
        );
        continue;
      }

      const baseState =
        property === 'hidden' ? component.hidden === true : field[target[0]] === true;
      const actionState = action.state === true;
      if (baseState === actionState) continue;
      let targetCondition = actionState ? trigger : invertCondition(trigger);
      if (property === 'hidden') targetCondition = invertCondition(targetCondition);
      field[target[0]] = false;
      field[target[1]] = targetCondition;
      assignedProperties.add(target[1]);
    }
  }
}

function memberReference(node) {
  const parts = [];
  let current = node;
  while (current?.type === 'MemberExpression' && !current.optional) {
    if (current.computed) {
      if (current.property.type !== 'Literal' || typeof current.property.value !== 'string')
        return null;
      parts.unshift(current.property.value);
    } else if (current.property.type === 'Identifier') {
      parts.unshift(current.property.name);
    } else {
      return null;
    }
    current = current.object;
  }
  if (current?.type !== 'Identifier' || !['data', 'row'].includes(current.name)) return null;
  return `${current.name}.${parts.join('.')}`;
}

function compileJavaScriptNode(node, record, context) {
  switch (node.type) {
    case 'Literal':
      if (node.regex) throw new Error('Regular-expression literals are not supported.');
      return JSON.stringify(node.value);
    case 'MemberExpression': {
      const reference = memberReference(node);
      if (!reference) throw new Error('Only static data.* and row.* references are supported.');
      const resolved = resolveReferenceDescriptor(reference, record, context);
      if (!resolved)
        throw new Error(`Calculation reference "${reference}" is missing or ambiguous.`);
      if (resolved.choiceValue !== null) {
        return `CHOICEVALUES($${resolved.identity.dataName}).includes(${JSON.stringify(resolved.choiceValue)})`;
      }
      return `$${resolved.identity.dataName}`;
    }
    case 'UnaryExpression':
      if (!UNARY_OPERATORS.has(node.operator))
        throw new Error(`Unary operator ${node.operator} is not supported.`);
      return `(${node.operator}${compileJavaScriptNode(node.argument, record, context)})`;
    case 'BinaryExpression':
      if (!BINARY_OPERATORS.has(node.operator))
        throw new Error(`Binary operator ${node.operator} is not supported.`);
      return `(${compileJavaScriptNode(node.left, record, context)} ${node.operator} ${compileJavaScriptNode(node.right, record, context)})`;
    case 'LogicalExpression':
      if (!LOGICAL_OPERATORS.has(node.operator))
        throw new Error(`Logical operator ${node.operator} is not supported.`);
      return `(${compileJavaScriptNode(node.left, record, context)} ${node.operator} ${compileJavaScriptNode(node.right, record, context)})`;
    case 'ConditionalExpression':
      return `(${compileJavaScriptNode(node.test, record, context)} ? ${compileJavaScriptNode(node.consequent, record, context)} : ${compileJavaScriptNode(node.alternate, record, context)})`;
    default:
      throw new Error(`JavaScript AST node ${node.type} is not supported.`);
  }
}

function compileJavaScriptCalculation(source, record, context) {
  let program;
  try {
    program = acorn.parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      locations: true,
    });
  } catch (error) {
    throw new Error(`Invalid JavaScript calculation: ${error.message}`);
  }
  if (program.body.length !== 1 || program.body[0].type !== 'ExpressionStatement') {
    throw new Error('JavaScript calculations must contain exactly one value assignment.');
  }
  const assignment = program.body[0].expression;
  if (
    assignment.type !== 'AssignmentExpression' ||
    assignment.operator !== '=' ||
    assignment.left.type !== 'Identifier' ||
    assignment.left.name !== 'value'
  ) {
    throw new Error('JavaScript calculations must have the form value = expression;.');
  }
  return compileJavaScriptNode(assignment.right, record, context);
}

function compileJsonCalculation(node, record, context) {
  if (node === null || ['string', 'number', 'boolean'].includes(typeof node))
    return JSON.stringify(node);
  if (!isObject(node) || Object.keys(node).length !== 1) {
    throw new Error('JSON Logic calculation nodes must contain exactly one operator.');
  }
  const [operator, rawArgs] = Object.entries(node)[0];
  const args = Array.isArray(rawArgs) ? rawArgs : [rawArgs];
  if (operator === 'var') {
    const reference = Array.isArray(rawArgs) ? rawArgs[0] : rawArgs;
    if (typeof reference !== 'string')
      throw new Error('JSON Logic var must contain a static field path.');
    const resolved = resolveReferenceDescriptor(reference, record, context);
    if (!resolved) throw new Error(`Calculation reference "${reference}" is missing or ambiguous.`);
    if (resolved.choiceValue !== null) {
      return `CHOICEVALUES($${resolved.identity.dataName}).includes(${JSON.stringify(resolved.choiceValue)})`;
    }
    return `$${resolved.identity.dataName}`;
  }
  if (
    ['+', '-', '*', '/', '%', '==', '===', '!=', '!==', '>', '>=', '<', '<='].includes(operator)
  ) {
    if (args.length < 1) throw new Error(`${operator} requires operands.`);
    const compiled = args.map((arg) => compileJsonCalculation(arg, record, context));
    if (operator === '-' && compiled.length === 1) return `(-${compiled[0]})`;
    if (compiled.length < 2) throw new Error(`${operator} requires at least two operands.`);
    return `(${compiled.join(` ${operator} `)})`;
  }
  if (operator === 'and' || operator === 'or') {
    if (args.length < 2) throw new Error(`${operator} requires at least two operands.`);
    const jsOperator = operator === 'and' ? '&&' : '||';
    return `(${args.map((arg) => compileJsonCalculation(arg, record, context)).join(` ${jsOperator} `)})`;
  }
  if (operator === '!') return `(!${compileJsonCalculation(args[0], record, context)})`;
  if (operator === 'cat') {
    if (args.length === 0) return "''";
    return `(${args.map((arg) => compileJsonCalculation(arg, record, context)).join(' + ')})`;
  }
  if (operator === 'if') {
    if (args.length !== 3)
      throw new Error('JSON Logic if requires condition, true, and false operands.');
    return `(${compileJsonCalculation(args[0], record, context)} ? ${compileJsonCalculation(args[1], record, context)} : ${compileJsonCalculation(args[2], record, context)})`;
  }
  throw new Error(`Unsupported JSON Logic calculation operator "${operator}".`);
}

function calculatedDisplayStyle(record) {
  if (['number'].includes(record.type)) return 'numeric';
  if (record.type === 'currency') return 'currency';
  if (
    record.type === 'date' ||
    (record.type === 'datetime' && record.component.enableTime === false)
  )
    return 'date';
  if (TEXT_TYPES.has(record.type) || record.type === 'content' || record.type === 'htmlelement')
    return 'text';
  return null;
}

function createBaseField(type, record, identity) {
  const label = String(record.component.label || record.component.title || identity.dataName);
  const field = createFieldTemplate(type, { label, dataName: identity.dataName });
  field.key = identity.targetKey;
  if ('description' in field) {
    const description = record.component.description || record.component.tooltip || null;
    field.description = description ? String(description) : null;
    field.description_mode = description ? 'default' : null;
  }
  if ('visible' in field) field.visible = record.component.hidden !== true;
  if ('read_only' in field && type !== 'CalculatedField' && type !== 'LabelField') {
    field.read_only = record.component.disabled === true;
  }
  if ('required' in field && type !== 'CalculatedField' && type !== 'LabelField') {
    field.required = record.component.validate?.required === true;
  }
  return field;
}

function applyStaticDefault(field, record, context) {
  const component = record.component;
  if (hasValue(component.customDefaultValue)) {
    context.diagnostics.push(
      createDiagnostic(
        'UNSUPPORTED_CUSTOM_DEFAULT',
        'error',
        record,
        'Custom default values cannot be translated safely.',
        'Replace the custom default with a static default or calculation.'
      )
    );
  }
  if (
    !('defaultValue' in component) ||
    component.defaultValue === null ||
    component.defaultValue === ''
  )
    return;
  const value = component.defaultValue;
  if (field.type === 'TextField' && typeof value === 'string') field.default_value = value;
  else if (field.type === 'NumericField' && typeof value === 'number') field.default_value = value;
  else if (field.type === 'BooleanField') field.default_value = value === true ? 'true' : 'false';
  else if (field.type === 'SingleChoiceField') {
    field.default_value =
      context.identities.get(record.sourcePath)?.choiceValueMap.get(String(value)) ?? null;
  } else if (field.type === 'MultiChoiceField' && Array.isArray(value)) {
    const valueMap = context.identities.get(record.sourcePath)?.choiceValueMap;
    field.default_value = value.map((item) => valueMap?.get(String(item))).filter(Boolean);
  } else if (field.type === 'MultiChoiceField' && isObject(value)) {
    const valueMap = context.identities.get(record.sourcePath)?.choiceValueMap;
    field.default_value = Object.entries(value)
      .filter(([, selected]) => selected === true)
      .map(([item]) => valueMap?.get(String(item)))
      .filter(Boolean);
  } else if (field.type === 'DateField' || field.type === 'TimeField') {
    if (value === 'now') field.default_value = 'now';
    else {
      context.diagnostics.push(
        createDiagnostic(
          'UNSUPPORTED_DATE_DEFAULT',
          'error',
          record,
          'Only the dynamic "now" default is supported for form0 date and time fields.',
          'Remove the fixed default or use --allow-lossy.'
        )
      );
      field.default_value = null;
    }
  } else {
    context.diagnostics.push(
      createDiagnostic(
        'UNSUPPORTED_DEFAULT_VALUE',
        'error',
        record,
        'The source default value is not compatible with the target field.',
        'Remove or rewrite the default value.'
      )
    );
  }
}

function applyValidation(field, record, context) {
  const validation = record.component.validate || {};
  if ('pattern' in field && typeof validation.pattern === 'string' && validation.pattern) {
    field.pattern = validation.pattern;
    field.pattern_description = validation.customMessage || 'Imported Form.io pattern';
  }
  if (field.type === 'NumericField') {
    field.min = typeof validation.min === 'number' ? validation.min : null;
    field.max =
      typeof validation.max === 'number'
        ? validation.max
        : field.min !== null
          ? Number.MAX_VALUE
          : null;
  }
  if (hasValue(validation.custom) || hasValue(validation.customPrivate)) {
    context.diagnostics.push(
      createDiagnostic(
        'UNSUPPORTED_CUSTOM_VALIDATION',
        'error',
        record,
        'Custom JavaScript validation cannot be translated.',
        'Replace it with native form0 validation.'
      )
    );
  }
  if (validation.unique || validation.minWords || validation.maxWords) {
    context.diagnostics.push(
      createDiagnostic(
        'VALIDATION_NOT_PRESERVED',
        'warning',
        record,
        'One or more Form.io validation rules have no form0 equivalent.',
        'Review the generated field validation manually.'
      )
    );
  }
}

function addMapping(context, record, identity, target, disposition = 'converted') {
  context.mappings.push({
    sourcePath: record.sourcePath,
    sourceType: record.component.type || record.type,
    sourceKey: identity?.sourceKey ?? record.component.key ?? null,
    targetPath: target ? target.data_name : null,
    targetType: target?.type || null,
    targetDataName: target?.data_name || null,
    targetKey: target?.key || null,
    disposition,
  });
}

function convertCalculated(record, identity, context) {
  const style = calculatedDisplayStyle(record);
  if (!style) {
    context.diagnostics.push(
      createDiagnostic(
        'UNSUPPORTED_CALCULATED_OUTPUT',
        'error',
        record,
        `Calculated output type "${record.component.type}" has no form0 display equivalent.`,
        null
      )
    );
    if (!context.allowLossy) {
      addMapping(context, record, identity, null, 'blocked');
      return null;
    }
  }
  let expression;
  let placeholder = false;
  try {
    expression =
      typeof record.component.calculateValue === 'string'
        ? compileJavaScriptCalculation(record.component.calculateValue, record, context)
        : compileJsonCalculation(record.component.calculateValue, record, context);
  } catch (error) {
    context.diagnostics.push(
      createDiagnostic(
        'UNTRANSLATABLE_CALCULATION',
        'error',
        record,
        error.message,
        'Rewrite the calculation using the documented safe subset.'
      )
    );
    if (!context.allowLossy) {
      addMapping(context, record, identity, null, 'blocked');
      return null;
    }
    expression = 'null';
    placeholder = true;
  }
  const field = createBaseField('CalculatedField', record, identity);
  field.display = { style: style || 'text' };
  field.calculate = expression;
  field.visible = record.component.hidden !== true;
  if (hasValue(record.component.customDefaultValue)) {
    context.diagnostics.push(
      createDiagnostic(
        'UNSUPPORTED_CUSTOM_DEFAULT',
        'error',
        record,
        'Custom defaults are not calculations and cannot be translated safely.',
        'Remove the custom default and keep calculateValue as the single value source.'
      )
    );
  }
  applyValidation(field, record, context);
  applyConditions(field, record, context);
  if (record.component.allowCalculateOverride === true) {
    context.diagnostics.push(
      createDiagnostic(
        'CALCULATION_OVERRIDE_NOT_PRESERVED',
        'warning',
        record,
        'form0 calculated fields are always read-only.',
        null
      )
    );
  }
  if (record.component.calculateServer === true) {
    context.diagnostics.push(
      createDiagnostic(
        'SERVER_CALCULATION_NOT_PRESERVED',
        'warning',
        record,
        'The calculation is converted for form0 runtime evaluation; Form.io server evaluation is not applicable.',
        null
      )
    );
  }
  if (placeholder) context.placeholders += 1;
  addMapping(context, record, identity, field, placeholder ? 'placeholder' : 'converted');
  return field;
}

function convertLeaf(record, identity, context) {
  const component = record.component;
  if (hasValue(component.calculateValue)) return convertCalculated(record, identity, context);

  let targetType = null;
  let warning = null;
  if (TEXT_TYPES.has(record.type)) {
    if (record.type === 'password' && !context.allowLossy) {
      context.diagnostics.push(
        createDiagnostic(
          'PASSWORD_MASK_LOSS',
          'error',
          record,
          'Password input would become an ordinary visible text field.',
          'Use --allow-lossy only after reviewing the security impact.'
        )
      );
      addMapping(context, record, identity, null, 'blocked');
      return null;
    }
    const widget = isObject(component.widget) ? component.widget.type : component.widget;
    if (widget === 'calendar') {
      if (component.enableDate !== false && component.enableTime === false)
        targetType = 'DateField';
      else if (component.enableDate === false && component.enableTime === true)
        targetType = 'TimeField';
    }
    targetType ||= 'TextField';
    if (record.type !== 'textfield')
      warning = `${component.type} presentation is represented as TextField.`;
  } else if (record.type === 'number' || record.type === 'currency') {
    targetType = 'NumericField';
    if (record.type === 'currency') warning = 'Currency presentation is not preserved.';
  } else if (record.type === 'checkbox') targetType = 'BooleanField';
  else if (record.type === 'radio') targetType = 'SingleChoiceField';
  else if (record.type === 'select')
    targetType = component.multiple === true ? 'MultiChoiceField' : 'SingleChoiceField';
  else if (record.type === 'selectboxes') targetType = 'MultiChoiceField';
  else if (record.type === 'date') targetType = 'DateField';
  else if (record.type === 'time') targetType = 'TimeField';
  else if (record.type === 'datetime') {
    if (component.enableTime === false) targetType = 'DateField';
    else if (context.allowLossy) {
      targetType = 'DateField';
      warning = 'Date/time value was downgraded to a date-only field.';
    } else {
      context.diagnostics.push(
        createDiagnostic(
          'DATETIME_NOT_REPRESENTABLE',
          'error',
          record,
          'Date/time and timezone semantics cannot be represented by DateField.',
          'Disable time input or use --allow-lossy.'
        )
      );
      addMapping(context, record, identity, null, 'blocked');
      return null;
    }
  } else if (record.type === 'signature') targetType = 'SignatureField';
  else if (record.type === 'content' || record.type === 'htmlelement') {
    const content = component.html || component.content || component.label || '';
    if (/<[^>]+>/.test(content) && !context.allowLossy) {
      context.diagnostics.push(
        createDiagnostic(
          'RICH_CONTENT_NOT_REPRESENTABLE',
          'error',
          record,
          'Rich HTML content cannot be represented safely as a LabelField.',
          'Use --allow-lossy to convert it to plain text.'
        )
      );
      addMapping(context, record, identity, null, 'blocked');
      return null;
    }
    if (/<[^>]+>/.test(content)) warning = 'Rich HTML content was reduced to plain text.';
    targetType = 'LabelField';
  }

  if (!targetType) {
    const code =
      UNSUPPORTED_DATA_TYPES.has(record.type) || isDataBearing(component)
        ? 'UNSUPPORTED_DATA_COMPONENT'
        : 'UNSUPPORTED_COMPONENT';
    context.diagnostics.push(
      createDiagnostic(
        code,
        'error',
        record,
        `Form.io component type "${component.type || 'unknown'}" is not supported.`,
        'Remove it, replace it with a supported component, or use --allow-lossy.'
      )
    );
    addMapping(context, record, identity, null, context.allowLossy ? 'omitted' : 'blocked');
    return null;
  }

  if (component.multiple === true && !['select', 'selectboxes'].includes(record.type)) {
    context.diagnostics.push(
      createDiagnostic(
        'UNSUPPORTED_MULTIPLE_VALUE',
        'error',
        record,
        'This multiple-value component has no defined form0 array mapping.',
        null
      )
    );
    addMapping(context, record, identity, null, context.allowLossy ? 'omitted' : 'blocked');
    return null;
  }

  const field = createBaseField(targetType, record, identity);
  if (targetType === 'NumericField') {
    field.format = component.validate?.integer === true ? 'integer' : 'float';
  }
  if (targetType === 'BooleanField') {
    field.choices = [
      { label: 'Yes', value: 'true' },
      { label: 'No', value: 'false' },
    ];
    field.third_option_enabled = false;
    identity.choiceValueMap.set('true', 'true');
    identity.choiceValueMap.set('false', 'false');
  }
  if (targetType === 'SingleChoiceField' || targetType === 'MultiChoiceField') {
    const choices = identity.preparedChoices;
    if (!choices) {
      addMapping(context, record, identity, null, context.allowLossy ? 'omitted' : 'blocked');
      return null;
    }
    field.choices = choices;
    field.allow_other = component.allowOther === true;
    field.is_searchable = targetType === 'SingleChoiceField' && record.type === 'select';
    field.is_searchable_mode = field.is_searchable ? 'default' : null;
    field.display = record.type === 'radio' ? 'radio' : 'default';
  }
  if (targetType === 'LabelField') {
    const content = component.html || component.content || component.label || identity.dataName;
    field.label = stripHtml(content) || identity.dataName;
    field.default_value = null;
  }
  applyStaticDefault(field, record, context);
  applyValidation(field, record, context);
  applyConditions(field, record, context);
  if (warning) {
    context.diagnostics.push(
      createDiagnostic('PRESENTATION_NOT_PRESERVED', 'warning', record, warning, null)
    );
  }
  addMapping(context, record, identity, field);
  return field;
}

function convertComponent(record, context, recordsByPath) {
  const component = record.component;
  const identity = context.identities.get(record.sourcePath);
  if (record.type === 'button') {
    context.diagnostics.push(
      createDiagnostic(
        'BUTTON_OMITTED',
        'info',
        record,
        'Form.io action/navigation button was omitted.',
        null
      )
    );
    addMapping(context, record, identity, null, 'omitted');
    return [];
  }
  if (FLATTEN_TYPES.has(record.type)) {
    if (record.type !== 'well') {
      context.diagnostics.push(
        createDiagnostic(
          'LAYOUT_FLATTENED',
          'warning',
          record,
          `${component.type} layout was flattened in source traversal order.`,
          null
        )
      );
    }
    return childContexts(component, record.sourcePath).flatMap(({ sourcePath }) => {
      const childRecord = recordsByPath.get(sourcePath);
      return childRecord ? convertComponent(childRecord, context, recordsByPath) : [];
    });
  }
  if (record.type === 'tabs') {
    return (component.components || []).flatMap((tab, index) => {
      const tabRecord = recordsByPath.get(`${record.sourcePath}.components[${index}]`);
      return tabRecord ? convertComponent(tabRecord, context, recordsByPath) : [];
    });
  }

  const isSection = ['panel', 'fieldset', 'collapsible', '__tab'].includes(record.type);
  const isRepeatable = ['datagrid', 'editgrid'].includes(record.type);
  const isContainer = record.type === 'container';
  if (isSection || isRepeatable || isContainer) {
    if (isContainer) {
      context.diagnostics.push(
        createDiagnostic(
          'CONTAINER_SCOPE_LOSS',
          'error',
          record,
          'Form.io Container object scoping has no form0 equivalent.',
          'Use --allow-lossy to preserve its children in an inline Section.'
        )
      );
      if (!context.allowLossy) {
        addMapping(context, record, identity, null, 'blocked');
        return [];
      }
    }
    const childRecords =
      record.type === '__tab'
        ? (component.components || []).map((_, index) =>
            recordsByPath.get(`${record.sourcePath}.components[${index}]`)
          )
        : childContexts(component, record.sourcePath).map(({ sourcePath }) =>
            recordsByPath.get(sourcePath)
          );
    const elements = childRecords
      .filter(Boolean)
      .flatMap((child) => convertComponent(child, context, recordsByPath));
    if (elements.length === 0) {
      context.diagnostics.push(
        createDiagnostic(
          'EMPTY_STRUCTURE_OMITTED',
          'warning',
          record,
          `${component.type || 'Tab'} produced no convertible child elements and was omitted.`,
          null
        )
      );
      addMapping(context, record, identity, null, 'omitted');
      return [];
    }
    const type = isRepeatable ? 'RepeatableSection' : 'Section';
    const field = createBaseField(type, record, identity);
    field.display =
      isRepeatable || record.isWizardPage || record.type === 'collapsible' ? 'drilldown' : 'inline';
    field.elements = elements;
    if (isRepeatable) {
      field.location_enabled = false;
      field.location_required = false;
    }
    applyConditions(field, record, context);
    if (record.type === 'collapsible') {
      context.diagnostics.push(
        createDiagnostic(
          'COLLAPSIBLE_NAVIGATION_APPROXIMATED',
          'warning',
          record,
          'Form.io collapsible content is represented as a drilldown Section; its initial expanded/collapsed state is not preserved.',
          null
        )
      );
    }
    addMapping(context, record, identity, field, isContainer ? 'lossy' : 'converted');
    return [field];
  }

  const unknownStructuralChildren =
    component.input !== true ? childContexts(component, record.sourcePath) : [];
  if (unknownStructuralChildren.length > 0) {
    context.diagnostics.push(
      createDiagnostic(
        'UNSUPPORTED_STRUCTURAL_COMPONENT',
        'error',
        record,
        `Form.io structural component type "${component.type || 'unknown'}" is not supported.`,
        'Replace it with a supported layout component or use --allow-lossy to flatten its children.'
      )
    );
    const elements = unknownStructuralChildren.flatMap(({ sourcePath }) => {
      const childRecord = recordsByPath.get(sourcePath);
      return childRecord ? convertComponent(childRecord, context, recordsByPath) : [];
    });
    addMapping(context, record, identity, null, context.allowLossy ? 'lossy' : 'blocked');
    return elements;
  }

  if (!identity) return [];
  const leaf = convertLeaf(record, identity, context);
  return leaf ? [leaf] : [];
}

function buildReport(source, context, schema, targetValidation) {
  const errors = context.diagnostics.filter((item) => item.severity === 'error').length;
  const warnings = context.diagnostics.filter((item) => item.severity === 'warning').length;
  const fatal = context.diagnostics.some((item) => item.fatal);
  const blocked = fatal || (!context.allowLossy && errors > 0);
  const omitted = context.mappings.filter((item) => item.disposition === 'omitted').length;
  const converted = context.mappings.filter((item) => item.disposition === 'converted').length;
  const blockedCount = context.mappings.filter((item) => item.disposition === 'blocked').length;
  const targetMappings = context.mappings.filter((item) => item.targetType);
  const convertedDataFields = targetMappings.filter(
    (item) => !TARGET_STRUCTURE_TYPES.has(item.targetType)
  ).length;
  const convertedStructuralElements = targetMappings.filter((item) =>
    TARGET_STRUCTURE_TYPES.has(item.targetType)
  ).length;
  const sourceRecords = context.records.filter((record) => !record.virtual);
  const sourceDataFields = sourceRecords.filter(
    (record) => !SOURCE_STRUCTURE_TYPES.has(record.type) && isDataBearing(record.component)
  ).length;
  const sourceStructuralComponents = sourceRecords.filter((record) =>
    SOURCE_STRUCTURE_TYPES.has(record.type)
  ).length;
  const outcome = blocked
    ? 'blocked'
    : errors > 0 || warnings > 0
      ? 'completed_with_loss'
      : 'convertible';
  return {
    source: {
      format: 'formio',
      name: source.title || source.name || source.path || schema?.form?.name || null,
      display: source.display || 'form',
    },
    target: {
      name: schema?.form?.name || null,
      fieldCount: convertedDataFields,
      structuralElementCount: convertedStructuralElements,
      elementCount: targetMappings.length,
    },
    outcome,
    summary: {
      converted,
      warnings,
      errors,
      omitted,
      placeholders: context.placeholders,
      blocked: blockedCount,
      sourceComponents: sourceRecords.length,
      sourceDataFields,
      sourceStructuralComponents,
      convertedDataFields,
      convertedStructuralElements,
    },
    mappings: context.mappings,
    choiceValueMappings: [...context.identities.values()]
      .filter((identity) => identity.choiceValueMap.size > 0)
      .map((identity) => ({
        sourcePath: identity.record.sourcePath,
        componentKey: identity.sourceKey,
        values: Object.fromEntries(identity.choiceValueMap),
      })),
    diagnostics: context.diagnostics,
    targetValidation,
  };
}

function populateTargetPaths(elements, context, basePath = 'form.elements') {
  (elements || []).forEach((field, index) => {
    const targetPath = `${basePath}[${index}]`;
    const mapping = context.mappings.find(
      (item) => item.targetDataName && item.targetDataName === field.data_name
    );
    if (mapping) mapping.targetPath = targetPath;
    if (Array.isArray(field.elements)) {
      populateTargetPaths(field.elements, context, `${targetPath}.elements`);
    }
  });
}

function analyzeCalculations(schema, recordsByDataName, context) {
  const visit = (elements) => {
    for (const field of elements || []) {
      if (field.type === 'CalculatedField' && field.calculate !== 'null') {
        const analysis = analyzeCalculationExpression({
          expression: field.calculate,
          schema,
          fieldDataName: field.data_name,
        });
        if (!analysis.valid) {
          const record = recordsByDataName.get(field.data_name);
          for (const issue of analysis.issues.filter((item) => item.severity === 'error')) {
            context.diagnostics.push(
              createDiagnostic(
                'TARGET_CALCULATION_INVALID',
                'error',
                record,
                issue.message,
                'Rewrite the source calculation to use accessible fields.'
              )
            );
          }
          if (context.allowLossy) {
            field.calculate = 'null';
            context.placeholders += 1;
            const mapping = context.mappings.find(
              (item) => item.targetDataName === field.data_name
            );
            if (mapping) mapping.disposition = 'placeholder';
          }
        }
      }
      if (Array.isArray(field.elements)) visit(field.elements);
    }
  };
  visit(schema.form.elements);
}

function dropDanglingConditions(schema, recordsByDataName, context) {
  const targetKeys = new Set(
    context.mappings.filter((mapping) => mapping.targetKey).map((mapping) => mapping.targetKey)
  );
  const hasMissingReference = (condition) => {
    if (!condition || typeof condition !== 'object') return false;
    if (Array.isArray(condition)) return condition.some(hasMissingReference);
    if (condition.field_id && !targetKeys.has(condition.field_id)) return true;
    return ['and', 'or'].some(
      (key) => Array.isArray(condition[key]) && condition[key].some(hasMissingReference)
    );
  };

  const visit = (elements) => {
    for (const field of elements || []) {
      const record = recordsByDataName.get(field.data_name);
      for (const [conditionKey, baseKey, sourceValue] of [
        ['visible_conditions', 'visible', record?.component?.hidden !== true],
        ['required_conditions', 'required', record?.component?.validate?.required === true],
        ['read_only_conditions', 'read_only', record?.component?.disabled === true],
      ]) {
        if (!hasMissingReference(field[conditionKey])) continue;
        context.diagnostics.push(
          createDiagnostic(
            'CONDITION_DROPPED_WITH_FIELD',
            'error',
            record,
            `${conditionKey} referenced an omitted component and was removed.`,
            'Review the field after lossy conversion.'
          )
        );
        field[conditionKey] = null;
        field[baseKey] = sourceValue;
      }
      if (Array.isArray(field.elements)) visit(field.elements);
    }
  };
  visit(schema.form.elements);
}

/**
 * Convert an exported Form.io form schema into a form0 schema without I/O.
 */
export function convertFormioSchema(source, options = {}) {
  const allowLossy = options.allowLossy === true;
  const diagnostics = [];
  if (!isObject(source) || Array.isArray(source)) {
    throw new TypeError('Expected a Form.io form JSON object.');
  }
  if (isObject(source.data) && !Array.isArray(source.components)) {
    throw new TypeError('Submission JSON is not a Form.io form schema.');
  }
  if (!Array.isArray(source.components)) {
    throw new TypeError('Form.io schema must contain a components array.');
  }

  const isWizard = source.display === 'wizard';
  const records = collectRecords(source.components, { isWizard });
  const identityState = assignIdentities(records, diagnostics, allowLossy);
  const context = {
    allowLossy,
    diagnostics,
    mappings: [],
    placeholders: 0,
    records,
    ...identityState,
  };
  for (const record of records) {
    const identity = context.identities.get(record.sourcePath);
    if (!identity) continue;
    if (['radio', 'select', 'selectboxes'].includes(record.type)) {
      identity.preparedChoices = buildChoiceList(record, identity, diagnostics);
    } else if (record.type === 'checkbox') {
      identity.choiceValueMap.set('true', 'true');
      identity.choiceValueMap.set('false', 'false');
    }
  }
  const recordsByPath = new Map(records.map((record) => [record.sourcePath, record]));
  const schema = {
    form: {
      name: String(
        source.title || source.name || source.path || options.sourceName || 'Imported Form.io form'
      ),
      description: source.description ? String(source.description) : null,
      id: null,
      status: 'active',
      version: '1',
      elements: source.components.flatMap((_, index) => {
        const record = recordsByPath.get(`components[${index}]`);
        return record ? convertComponent(record, context, recordsByPath) : [];
      }),
    },
  };

  if (isWizard) {
    diagnostics.push(
      createDiagnostic(
        'WIZARD_NAVIGATION_APPROXIMATED',
        'warning',
        null,
        'Wizard pages were converted to drilldown Sections; linear Next/Previous behavior is not preserved.',
        null
      )
    );
  }

  const recordsByDataName = new Map(
    [...context.identities.values()].map((identity) => [identity.dataName, identity.record])
  );
  if (allowLossy) dropDanglingConditions(schema, recordsByDataName, context);
  analyzeCalculations(schema, recordsByDataName, context);
  populateTargetPaths(schema.form.elements, context);

  let targetValidation = { valid: true, error: null };
  try {
    validateSchema(schema.form);
  } catch (error) {
    targetValidation = { valid: false, error: error.message };
    diagnostics.push(
      createDiagnostic(
        'TARGET_SCHEMA_INVALID',
        'error',
        null,
        error.message,
        'This indicates a converter defect or an unsupported target combination.',
        { fatal: true }
      )
    );
  }

  const report = buildReport(source, context, schema, targetValidation);
  return { schema, report };
}

export function defaultFormioOutputPath(sourcePath) {
  const extensionIndex = sourcePath.toLowerCase().endsWith('.json')
    ? sourcePath.length - 5
    : sourcePath.length;
  return `${sourcePath.slice(0, extensionIndex)}.form0.schema.json`;
}
