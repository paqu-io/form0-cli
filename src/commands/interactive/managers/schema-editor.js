import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  FIELD_SPECS,
  generateKey,
  generateValueFromLabel,
  validateSchema,
} from 'form0-core';
import { colors } from '../../../utils/theme.js';
import { t } from '../../../utils/i18n.js';
import { showSchemaPreview } from '../../../utils/display-utils.js';

const CONTAINER_TYPES = new Set(['Section', 'RepeatableSection', 'BuildingPlanSection']);

function isContainerElement(element) {
  return element && CONTAINER_TYPES.has(element.type);
}

function buildElementIndex(elements) {
  const nodes = [];
  const byId = new Map();

  function walk(list, parent, depth) {
    if (!Array.isArray(list)) {
      return;
    }

    list.forEach((element, index) => {
      const node = {
        id: nodes.length + 1,
        element,
        parent,
        parentList: list,
        index,
        depth,
      };
      nodes.push(node);
      byId.set(node.id, node);

      if (isContainerElement(element)) {
        walk(element.elements || [], node, depth + 1);
      }
    });
  }

  walk(elements, null, 0);

  return { nodes, byId };
}

function isDescendant(targetNode, ancestorNode) {
  let current = targetNode.parent;
  while (current) {
    if (current === ancestorNode) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function normalizeType(input) {
  if (!input) {
    return null;
  }
  const types = Object.keys(FIELD_SPECS);
  const match = types.find((type) => type.toLowerCase() === input.toLowerCase());
  return match || null;
}

function getElementLabel(element) {
  return element.label || element.data_name || element.key || element.type || 'Unnamed';
}

function createFieldTemplate(type) {
  const spec = FIELD_SPECS[type];
  if (!spec) {
    return null;
  }

  const template = { type };
  const labelDefault = type.replace(/Field|Section/g, '').trim() || type;
  const label = `New ${labelDefault}`;
  const dataName = generateValueFromLabel(label) || 'new_field';

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

  // Clear dependent attributes when their parent attribute is null/undefined.
  for (const [attrName, attrDef] of Object.entries(spec.attributes)) {
    if (!attrDef.dependentOn) {
      continue;
    }
    const depValue = template[attrDef.dependentOn];
    if (depValue === null || depValue === undefined) {
      template[attrName] = null;
    }
  }

  return template;
}

function updateConditionRefs(conditions, oldKey, newKey, oldDataName) {
  if (!conditions || typeof conditions !== 'object') {
    return;
  }

  if (Array.isArray(conditions)) {
    conditions.forEach((entry) => updateConditionRefs(entry, oldKey, newKey, oldDataName));
    return;
  }

  if (
    conditions.field_id &&
    (conditions.field_id === oldKey || conditions.field_id === oldDataName)
  ) {
    conditions.field_id = newKey;
  }

  if (
    conditions.field_key &&
    (conditions.field_key === oldKey || conditions.field_key === oldDataName)
  ) {
    conditions.field_key = newKey;
  }

  if (Array.isArray(conditions.and)) {
    conditions.and.forEach((entry) => updateConditionRefs(entry, oldKey, newKey, oldDataName));
  }

  if (Array.isArray(conditions.or)) {
    conditions.or.forEach((entry) => updateConditionRefs(entry, oldKey, newKey, oldDataName));
  }
}

function updateFormLinkRefs(form, oldKey, newKey, oldDataName) {
  const { form_links: formLinks } = form || {};
  if (!formLinks || typeof formLinks !== 'object') {
    return;
  }

  const updateKey = (value) => {
    if (value === oldKey || value === oldDataName) {
      return newKey;
    }
    return value;
  };

  if (Array.isArray(formLinks.to)) {
    formLinks.to.forEach((entry) => {
      if (entry && typeof entry === 'object' && entry.form_link_field_key) {
        entry.form_link_field_key = updateKey(entry.form_link_field_key);
      }
    });
  }

  if (Array.isArray(formLinks.from)) {
    formLinks.from.forEach((entry) => {
      if (entry && typeof entry === 'object' && entry.form_link_field_key) {
        entry.form_link_field_key = updateKey(entry.form_link_field_key);
      }
    });
  }
}

function updateSchemaReferences(form, oldKey, newKey, oldDataName) {
  const updateField = (field) => {
    if (!field || typeof field !== 'object') {
      return;
    }

    ['visible_conditions', 'required_conditions', 'read_only_conditions'].forEach((condKey) => {
      if (field[condKey]) {
        updateConditionRefs(field[condKey], oldKey, newKey, oldDataName);
      }
    });

    if (field.type === 'FormLinkField' && Array.isArray(field.record_defaults)) {
      field.record_defaults.forEach((entry) => {
        if (!entry || typeof entry !== 'object') {
          return;
        }
        if (
          entry.source_field_id &&
          (entry.source_field_id === oldKey || entry.source_field_id === oldDataName)
        ) {
          entry.source_field_id = newKey;
        }
        if (
          entry.destination_field_id &&
          (entry.destination_field_id === oldKey || entry.destination_field_id === oldDataName)
        ) {
          entry.destination_field_id = newKey;
        }
      });
    }
  };

  const walk = (fields) => {
    if (!Array.isArray(fields)) {
      return;
    }
    fields.forEach((field) => {
      updateField(field);
      if (isContainerElement(field)) {
        walk(field.elements || []);
      }
    });
  };

  walk(form.elements || []);

  if (form.status_field) {
    updateField(form.status_field);
  }

  if (form.title_field) {
    updateField(form.title_field);
  }

  updateFormLinkRefs(form, oldKey, newKey, oldDataName);
}

export class SchemaEditor {
  constructor(schemaManager, engineRunner, serverManager, readline, shellCore) {
    this.schemaManager = schemaManager;
    this.engineRunner = engineRunner;
    this.serverManager = serverManager;
    this.readline = readline;
    this.shellCore = shellCore;
    this.active = false;
  }

  isActive() {
    return this.active;
  }

  enter() {
    if (!this.schemaManager.getCurrentSchema()) {
      console.log(colors.error(t('common.noSchemaLoaded')));
      return;
    }

    this.active = true;
    if (this.shellCore) {
      this.shellCore.setSchemaMode(true);
    }

    console.log(colors.accent1(t('interactive.schemaEdit.entered')));
    console.log(colors.textSecondary(t('interactive.schemaEdit.helpHint')));
  }

  exit() {
    this.active = false;
    if (this.shellCore) {
      this.shellCore.setSchemaMode(false);
    }
    console.log(colors.success(t('interactive.schemaEdit.exited')));
  }

  async handleCommand(input) {
    const [command, ...args] = input.trim().split(/\s+/);
    const lower = command.toLowerCase();

    switch (lower) {
      case 'help':
      case 'h':
        this.showHelp();
        return;

      case 'preview':
      case 'p':
        this.preview();
        return;

      case 'add':
        await this.handleAdd(args);
        return;

      case 'edit':
        await this.handleEdit(args);
        return;

      case 'remove':
      case 'rm':
      case 'del':
      case 'delete':
        await this.handleRemove(args);
        return;

      case 'move':
      case 'mv':
        await this.handleMove(args);
        return;

      case 'exit':
      case 'quit':
      case 'q':
        this.exit();
        return;

      default:
        console.log(colors.error(t('interactive.schemaEdit.unknownCommand', { command })));
        console.log(colors.textSecondary(t('interactive.schemaEdit.helpHint')));
    }
  }

  showHelp() {
    console.log(colors.header('\n' + t('interactive.schemaEdit.helpTitle')));
    console.log(colors.textSecondary(t('interactive.schemaEdit.helpNotation')));
    console.log();
    console.log(colors.text(t('interactive.schemaEdit.helpPreview')));
    console.log(colors.text(t('interactive.schemaEdit.helpAdd')));
    console.log(colors.text(t('interactive.schemaEdit.helpAddInside')));
    console.log(colors.text(t('interactive.schemaEdit.helpEdit')));
    console.log(colors.text(t('interactive.schemaEdit.helpMove')));
    console.log(colors.text(t('interactive.schemaEdit.helpMoveInside')));
    console.log(colors.text(t('interactive.schemaEdit.helpRemove')));
    console.log(colors.text(t('interactive.schemaEdit.helpExit')));
    console.log();
  }

  preview() {
    const schema = this.schemaManager.getCurrentSchema();
    if (!schema) {
      console.log(colors.error(t('common.noSchemaLoaded')));
      return;
    }
    showSchemaPreview(schema, { showIds: true });
  }

  async handleAdd(args) {
    if (!this.ensureSchema()) {
      return;
    }

    const [typeInput, position, idInput] = args;
    if (!typeInput || !position || !idInput) {
      console.log(colors.error(t('interactive.schemaEdit.usageAdd')));
      return;
    }

    const type = normalizeType(typeInput);
    if (!type) {
      console.log(colors.error(t('interactive.schemaEdit.invalidType', { type: typeInput })));
      console.log(colors.textSecondary(this.getAvailableTypesMessage()));
      return;
    }

    const targetId = Number.parseInt(idInput, 10);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      console.log(colors.error(t('interactive.schemaEdit.invalidId', { id: idInput })));
      return;
    }

    const schema = this.schemaManager.getCurrentSchema();
    const { byId } = buildElementIndex(schema.form.elements || []);
    const targetNode = byId.get(targetId);
    if (!targetNode) {
      console.log(colors.error(t('interactive.schemaEdit.idNotFound', { id: targetId })));
      return;
    }

    let insertList = null;
    let insertIndex = null;
    const positionLower = position.toLowerCase();

    if (positionLower === 'before' || positionLower === 'after') {
      insertList = targetNode.parentList;
      insertIndex = positionLower === 'before' ? targetNode.index : targetNode.index + 1;
    } else if (positionLower === 'inside') {
      if (!isContainerElement(targetNode.element)) {
        console.log(colors.error(t('interactive.schemaEdit.insideRequiresSection')));
        return;
      }
      const elements = Array.isArray(targetNode.element.elements)
        ? targetNode.element.elements
        : [];
      if (elements.length > 0) {
        console.log(colors.warning(t('interactive.schemaEdit.insideRequiresEmpty')));
        return;
      }
      targetNode.element.elements = elements;
      insertList = elements;
      insertIndex = elements.length;
    } else {
      console.log(colors.error(t('interactive.schemaEdit.usageAdd')));
      return;
    }

    const template = createFieldTemplate(type);
    if (!template) {
      console.log(colors.error(t('interactive.schemaEdit.invalidType', { type: typeInput })));
      return;
    }

    const edited = await this.editJson(template);
    if (!edited) {
      return;
    }

    if (!edited || typeof edited !== 'object' || Array.isArray(edited)) {
      console.log(colors.error(t('interactive.schemaEdit.invalidObject')));
      return;
    }

    if (edited.type !== type) {
      console.log(colors.error(t('interactive.schemaEdit.typeLocked')));
      return;
    }

    if (isContainerElement({ type })) {
      edited.elements = edited.elements || [];
    }

    if (edited.data_name) {
      edited.key = generateKey(edited.data_name);
    }

    insertList.splice(insertIndex, 0, edited);

    await this.saveSchema(schema);
    console.log(colors.success(t('interactive.schemaEdit.added', { label: getElementLabel(edited) })));
  }

  async handleEdit(args) {
    if (!this.ensureSchema()) {
      return;
    }

    const [idInput] = args;
    const targetId = Number.parseInt(idInput, 10);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      console.log(colors.error(t('interactive.schemaEdit.invalidId', { id: idInput })));
      return;
    }

    const schema = this.schemaManager.getCurrentSchema();
    const { byId } = buildElementIndex(schema.form.elements || []);
    const targetNode = byId.get(targetId);
    if (!targetNode) {
      console.log(colors.error(t('interactive.schemaEdit.idNotFound', { id: targetId })));
      return;
    }

    const original = targetNode.element;
    const originalType = original.type;
    const originalDataName = original.data_name;
    const originalKey = original.key;

    const editable = { ...original };
    delete editable.key;
    if (isContainerElement(original)) {
      delete editable.elements;
    }

    const edited = await this.editJson(editable);
    if (!edited) {
      return;
    }

    if (!edited || typeof edited !== 'object' || Array.isArray(edited)) {
      console.log(colors.error(t('interactive.schemaEdit.invalidObject')));
      return;
    }

    if (edited.type !== originalType) {
      console.log(colors.error(t('interactive.schemaEdit.typeLocked')));
      return;
    }

    const updated = { ...edited };
    if (isContainerElement(original)) {
      updated.elements = original.elements || [];
    }

    if (updated.data_name && updated.data_name !== originalDataName) {
      updated.key = generateKey(updated.data_name);
      updateSchemaReferences(schema.form, originalKey, updated.key, originalDataName);
    } else {
      updated.key = originalKey || (updated.data_name ? generateKey(updated.data_name) : undefined);
    }

    targetNode.parentList[targetNode.index] = updated;

    await this.saveSchema(schema);
    console.log(colors.success(t('interactive.schemaEdit.edited', { label: getElementLabel(updated) })));
  }

  async handleRemove(args) {
    if (!this.ensureSchema()) {
      return;
    }

    const [idInput] = args;
    const targetId = Number.parseInt(idInput, 10);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      console.log(colors.error(t('interactive.schemaEdit.invalidId', { id: idInput })));
      return;
    }

    const schema = this.schemaManager.getCurrentSchema();
    const { byId } = buildElementIndex(schema.form.elements || []);
    const targetNode = byId.get(targetId);
    if (!targetNode) {
      console.log(colors.error(t('interactive.schemaEdit.idNotFound', { id: targetId })));
      return;
    }

    const descendantCount = this.countDescendants(targetNode.element);
    const label = getElementLabel(targetNode.element);
    const confirmed = await this.confirm(
      t('interactive.schemaEdit.confirmRemove', { label, count: descendantCount })
    );
    if (!confirmed) {
      console.log(colors.textSecondary(t('interactive.schemaEdit.removeCancelled')));
      return;
    }

    targetNode.parentList.splice(targetNode.index, 1);

    await this.saveSchema(schema);
    console.log(colors.success(t('interactive.schemaEdit.removed', { label })));
  }

  async handleMove(args) {
    if (!this.ensureSchema()) {
      return;
    }

    const [sourceInput, position, targetInput] = args;
    const sourceId = Number.parseInt(sourceInput, 10);
    const targetId = Number.parseInt(targetInput, 10);
    if (!Number.isInteger(sourceId) || sourceId <= 0) {
      console.log(colors.error(t('interactive.schemaEdit.invalidId', { id: sourceInput })));
      return;
    }
    if (!Number.isInteger(targetId) || targetId <= 0) {
      console.log(colors.error(t('interactive.schemaEdit.invalidId', { id: targetInput })));
      return;
    }

    if (!position) {
      console.log(colors.error(t('interactive.schemaEdit.usageMove')));
      return;
    }

    const schema = this.schemaManager.getCurrentSchema();
    const { byId } = buildElementIndex(schema.form.elements || []);
    const sourceNode = byId.get(sourceId);
    const targetNode = byId.get(targetId);

    if (!sourceNode) {
      console.log(colors.error(t('interactive.schemaEdit.idNotFound', { id: sourceId })));
      return;
    }

    if (!targetNode) {
      console.log(colors.error(t('interactive.schemaEdit.idNotFound', { id: targetId })));
      return;
    }

    if (sourceNode === targetNode) {
      console.log(colors.error(t('interactive.schemaEdit.moveSameTarget')));
      return;
    }

    if (isDescendant(targetNode, sourceNode)) {
      console.log(colors.error(t('interactive.schemaEdit.moveIntoDescendant')));
      return;
    }

    const positionLower = position.toLowerCase();
    if (positionLower === 'before' || positionLower === 'after') {
      const targetList = targetNode.parentList;
      let insertIndex = positionLower === 'before' ? targetNode.index : targetNode.index + 1;

      sourceNode.parentList.splice(sourceNode.index, 1);

      if (sourceNode.parentList === targetList && sourceNode.index < insertIndex) {
        insertIndex -= 1;
      }

      targetList.splice(insertIndex, 0, sourceNode.element);
    } else if (positionLower === 'inside') {
      if (!isContainerElement(targetNode.element)) {
        console.log(colors.error(t('interactive.schemaEdit.insideRequiresSection')));
        return;
      }
      const elements = Array.isArray(targetNode.element.elements)
        ? targetNode.element.elements
        : [];
      if (elements.length > 0) {
        console.log(colors.warning(t('interactive.schemaEdit.insideRequiresEmpty')));
        return;
      }
      targetNode.element.elements = elements;

      sourceNode.parentList.splice(sourceNode.index, 1);
      elements.push(sourceNode.element);
    } else {
      console.log(colors.error(t('interactive.schemaEdit.usageMove')));
      return;
    }

    await this.saveSchema(schema);
    console.log(
      colors.success(
        t('interactive.schemaEdit.moved', {
          label: getElementLabel(sourceNode.element),
        })
      )
    );
  }

  countDescendants(element) {
    if (!isContainerElement(element) || !Array.isArray(element.elements)) {
      return 0;
    }

    let count = 0;
    element.elements.forEach((child) => {
      count += 1;
      count += this.countDescendants(child);
    });

    return count;
  }

  ensureSchema() {
    if (!this.schemaManager.getCurrentSchema()) {
      console.log(colors.error(t('common.noSchemaLoaded')));
      return false;
    }
    return true;
  }

  getAvailableTypesMessage() {
    const types = Object.keys(FIELD_SPECS).sort();
    return t('interactive.schemaEdit.availableTypes', { types: types.join(', ') });
  }

  async saveSchema(schema) {
    const schemaPath = this.schemaManager.getCurrentSchemaPath();
    if (!schemaPath) {
      console.log(colors.error(t('common.noSchemaLoaded')));
      return;
    }

    await fs.writeJson(schemaPath, schema, { spaces: 2 });
    this.schemaManager.currentSchema = schema;
    if (this.engineRunner) {
      this.engineRunner.resetEngine();
    }
    if (this.serverManager) {
      this.serverManager.updateDevServerSchema();
    }

    try {
      validateSchema(schema.form);
    } catch (err) {
      console.log(colors.warning(t('interactive.schemaEdit.savedWithWarnings')));
      console.log(colors.textSecondary(err.message));
    }
  }

  async editJson(initialValue) {
    const editor = process.env.VISUAL || process.env.EDITOR;
    if (!editor) {
      console.log(colors.error(t('interactive.schemaEdit.noEditor')));
      return null;
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-schema-'));
    const tmpFile = path.join(tmpDir, 'field.json');
    await fs.writeFile(tmpFile, JSON.stringify(initialValue, null, 2) + '\n');

    let parsed = null;
    let keepEditing = true;

    while (keepEditing) {
      if (this.readline) {
        this.readline.pause();
      }
      const result = spawnSync(`${editor} "${tmpFile}"`, {
        stdio: 'inherit',
        shell: true,
      });
      if (result.error) {
        console.log(
          colors.error(
            t('interactive.schemaEdit.editorFailed', { message: result.error.message })
          )
        );
        keepEditing = false;
        break;
      }
      if (this.readline) {
        this.readline.resume();
      }

      const raw = await fs.readFile(tmpFile, 'utf8');
      try {
        parsed = JSON.parse(raw);
        keepEditing = false;
      } catch (err) {
        console.log(colors.error(t('interactive.schemaEdit.invalidJson', { message: err.message })));
        const retry = await this.confirm(t('interactive.schemaEdit.retryEditPrompt'));
        if (!retry) {
          keepEditing = false;
        }
      }
    }

    await fs.remove(tmpDir);
    return parsed;
  }

  async confirm(message) {
    if (!this.readline) {
      return false;
    }
    return new Promise((resolve) => {
      this.readline.question(colors.warning(message), (answer) => {
        resolve(/^y(es)?$/i.test(answer.trim()));
      });
    });
  }
}
