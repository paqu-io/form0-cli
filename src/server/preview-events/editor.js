import { v7 as uuidv7 } from 'uuid';
import {
  createFormEngine,
  createRecordEvaluator,
  buildRepeatableMetadata,
  WarningSystem,
  getBuildingPlanMetadata,
  createBuildingPlanEditor,
  resolveBuildingPlanRow,
} from 'form0-core';
import { randomUUID, createHash } from 'node:crypto';
import {
  createEventSession,
  copyEventData,
  eventDataSignature,
  mergeCustomValidation,
} from './session-dispatcher.js';

import { restorePreviewRecord } from './storage.js';
import { createChangeLabels } from './submission-presentation.js';
import {
  createRecordCoordinator,
  applyRecordState,
  applyClearedFieldUpdates,
} from './record-coordinator.js';
import { normalizeChoiceOperationValue } from '../static/choice-operation-values.js';
import { createCanvasFloorStager } from './building-plan-updates.js';

const maps = ['values', 'errors', 'visible', 'required', 'read_only'];
function savedRows(repeatable) {
  return Object.fromEntries(
    Object.entries(repeatable || {}).map(([key, rows]) => [
      key,
      rows.map((row) => {
        const copy = copyEventData(row);
        for (const property of ['errors', 'visible', 'required', 'read_only'])
          delete copy[property];
        copy.repeatable = savedRows(copy.repeatable);
        return copy;
      }),
    ])
  );
}
const pick = (values, names) =>
  Object.fromEntries(
    names.filter((name) => Object.hasOwn(values || {}, name)).map((name) => [name, values[name]])
  );
const fingerprint = (schema) => createHash('sha256').update(JSON.stringify(schema)).digest('hex');
const samePath = (a, b) =>
  a.length === b.length &&
  a.every(
    (part, index) =>
      part.repeatableKey === b[index].repeatableKey &&
      part.identity === b[index].identity &&
      (part.identity === 'id'
        ? part.instanceId === b[index].instanceId
        : part.index === b[index].index)
  );
const parentPath = (path) => path.slice(0, -1);
const validPath = (path) =>
  Array.isArray(path) &&
  !path.some(
    (part) =>
      !part ||
      typeof part.repeatableKey !== 'string' ||
      !part.repeatableKey ||
      !Number.isSafeInteger(part.index) ||
      part.index < 0 ||
      !['id', 'position'].includes(part.identity) ||
      (part.identity === 'id' &&
        !(
          (typeof part.instanceId === 'string' && part.instanceId.length) ||
          (typeof part.instanceId === 'number' && Number.isFinite(part.instanceId))
        )) ||
      (part.identity === 'position' && part.instanceId != null)
  );

const failed = (code, message) => ({
  status: 'failed',
  eligible: false,
  payload: null,
  operations: [],
  validationIssues: [],
  issues: [{ code, message, instancePath: [] }],
});

/** One browser editor. Stored rows and open draft editors are deliberately distinct. */
export function createPreviewEditor({
  schema,
  initialState = {},
  configuration,
  serializeRecord,
  evaluateRepeatable,
  recordOptions = {},
  createEngine = createFormEngine,
  submissionOptions = {},
  onResolveHiddenValue,
  initialFreshness = null,
  evaluationOptions = {},
}) {
  const dispatcher = createEventSession(configuration);
  const coordinator = createRecordCoordinator({
    ...evaluationOptions,
    schema,
    getOptions: () => ({ submissionOptions, initialFreshness }),
    seed: initialState,
  });
  const metadata = buildRepeatableMetadata(schema.form?.elements || []);
  const stageCanvasFloor = createCanvasFloorStager(schema, metadata);
  const buildingPlans = getBuildingPlanMetadata(schema);
  const planEvaluator = buildingPlans.length
    ? createRecordEvaluator({ schema, ...evaluationOptions, diagnostics: { console: false } })
    : null;
  const rootNames = [...metadata.fieldOwnership]
    .filter(([, field]) => field.parentPath.length === 0)
    .map(([name]) => name);
  if (schema.form?.status_field?.data_name) rootNames.push(schema.form.status_field.data_name);
  const entries = new Map();
  const presentations = [];
  const retired = [];
  let source;
  let prepared = null;
  let alive = true;
  let controller = dispatcher.start();
  const clone = copyEventData;
  let committedDiagnostics = [];
  let committedWarnings = [];
  const root = makeEntry(
    [],
    rootNames,
    null,
    { values: pick(initialState.values, rootNames), repeatable: initialState.repeatable || {} },
    configuration.recordKind
  );

  function planPath(entry) {
    return entry.path.slice(entry.buildingPlan.floorPath.length - 1);
  }
  function attachBuildingPlan(entry) {
    const parent = owner(parentPath(entry.path));
    if (parent?.buildingPlan) entry.buildingPlan = parent.buildingPlan;
    else {
      const meta = buildingPlans.find(
        (candidate) =>
          candidate.repeatablesByNodeKey.floors.preferredKey === entry.path.at(-1)?.repeatableKey
      );
      if (!meta) return;
      const floorsKey = meta.repeatablesByNodeKey.floors.preferredKey;
      entry.buildingPlan = {
        meta,
        floorPath: entry.path,
        editor: createBuildingPlanEditor({
          meta,
          record: {
            values: {},
            repeatable: { [floorsKey]: entry.kind === 'new' ? [] : [clone(entry.row)] },
          },
        }),
      };
    }
    const { editor } = entry.buildingPlan;
    const opened = editor.openRow({
      path: planPath(entry),
      scopeId: entry.scopeId,
      parentScopeId: parent?.buildingPlan === entry.buildingPlan ? parent.scopeId : null,
      row: entry.row,
    });
    if (opened.status !== 'opened')
      throw Object.assign(new TypeError(opened.issues[0]?.message), { issues: opened.issues });
    entry.row = opened.row;
    Object.assign(entry.engine.getState().values, clone(opened.row.values));
  }

  function distributeBuildingPlan(bridge) {
    const floor = owner(bridge.floorPath);
    if (!floor || !bridge.editor.hasEditor(floor.scopeId)) return;
    const row = resolveBuildingPlanRow(bridge.editor.getRecord(), bridge.floorPath.slice(-1));
    if (!row) return;
    const children = [...entries.values()].filter(
      (entry) => entry.buildingPlan === bridge && bridge.editor.hasEditor(entry.scopeId)
    );
    const staged = stageCanvasFloor(
      bridge.floorPath,
      { ...floor.row, ...state(floor) },
      row,
      children
        .filter((entry) => entry !== floor)
        .map((entry) => ({ path: entry.path, row: { ...entry.row, ...state(entry) } }))
    );
    for (const planned of staged.editors) {
      const entry = children.find((candidate) => samePath(candidate.path, planned.path));
      Object.assign(entry.engine.getState().values, clone(planned.row.values));
      entry.row.repeatable = clone(planned.row.repeatable);
      entry.handle?.dataChanged();
    }
    coordinator.changed();
  }

  async function updateBuildingPlan(entry, row = { ...entry.row, ...state(entry) }) {
    if (!entry.buildingPlan) return null;
    const result = entry.buildingPlan.editor.updateRow(entry.scopeId, row);
    if (result.status === 'applied') {
      await entry.buildingPlan.editor.evaluate(planEvaluator, state(root).values);
      distributeBuildingPlan(entry.buildingPlan);
    } else {
      const previous = resolveBuildingPlanRow(
        entry.buildingPlan.editor.getRecord(),
        planPath(entry)
      );
      if (previous) Object.assign(entry.engine.getState().values, clone(previous.values));
    }
    return result;
  }

  async function refreshCommitted() {
    await root.engine.eval();
    coordinator.changed();
  }
  function state(entry) {
    const current = entry.engine.getState();
    return clone({
      ...Object.fromEntries(
        maps.map((key) => [
          key,
          pick(
            current[key],
            key === 'values' || key === 'errors' ? entry.names : entry.conditionNames
          ),
        ])
      ),
      repeatable: clone(entry.row.repeatable || {}),
    });
  }
  function find(path, scopeId) {
    const entry = scopeId
      ? entries.get(scopeId)
      : [...entries.values()].find((item) => samePath(item.path, path));
    if (!entry || !samePath(entry.path, path) || !entry.active || !alive) return null;
    if (entry.path.some((part) => part.identity === 'position') && scopeId !== entry.scopeId)
      return null;
    return entry;
  }
  function definition(path) {
    const keys = path.map((part) => part.repeatableKey);
    return [...metadata.repeatableSectionTree.values()].find(
      (info) =>
        info.currentPath.length === keys.length &&
        info.currentPath.every((key, index) => key === keys[index])
    );
  }
  function owner(path) {
    if (!path.length) return root;
    return [...entries.values()].find((entry) => samePath(entry.path, path));
  }
  function rowsFor(path) {
    let row = root.row;
    for (let index = 0; index < path.length; index++) {
      const part = path[index];
      const opened = owner(path.slice(0, index + 1));
      const rows = row.repeatable?.[part.repeatableKey] || [];
      const selected =
        part.identity === 'id'
          ? rows.find((item) => (item.id ?? item.record_id) === part.instanceId)
          : rows[part.index];
      if (!selected && !opened) return null;
      row = opened?.row || selected;
    }
    return row;
  }
  function summary(entry, snapshot) {
    const requiredFieldErrors = [],
      generalErrors = [];
    for (const name of entry.names) {
      if (snapshot.visible?.[name] === false || !snapshot.errors?.[name]) continue;
      const issue = {
        fieldName: name,
        errorMessage: snapshot.errors[name],
        instancePath: clone(entry.path),
      };
      (snapshot.required?.[name] &&
      (snapshot.values[name] == null ||
        snapshot.values[name] === '' ||
        (Array.isArray(snapshot.values[name]) && !snapshot.values[name].length))
        ? requiredFieldErrors
        : generalErrors
      ).push(issue);
    }
    // Preview already validates committed inline records. Open drafts are not serialized by root save.
    const visit = (repeatable, path = entry.path) =>
      Object.entries(repeatable || {}).forEach(([key, rows]) => {
        for (const [index, row] of (Array.isArray(rows) ? rows : []).entries()) {
          const id = row.id ?? row.record_id ?? null;
          const rowPath = [
            ...path,
            { repeatableKey: key, instanceId: id, index, identity: id == null ? 'position' : 'id' },
          ];
          for (const [name, message] of Object.entries(row.errors || {})) {
            if (!message || row.visible?.[name] === false) continue;
            const issue = { fieldName: name, errorMessage: message, instancePath: clone(rowPath) };
            (row.required?.[name] && (row.values?.[name] == null || row.values[name] === '')
              ? requiredFieldErrors
              : generalErrors
            ).push(issue);
          }
          visit(row.repeatable, rowPath);
        }
      });
    visit(snapshot.repeatable);
    return {
      hasErrors: Boolean(requiredFieldErrors.length || generalErrors.length),
      requiredFieldErrors,
      generalErrors,
      orderedIssues: [...requiredFieldErrors, ...generalErrors],
    };
  }
  function makeEntry(path, names, fieldKey, row, kind) {
    // Containers own conditions in their containing record; nested rows have separate maps.
    const conditionNames = new Set(names);
    const visit = (elements) => {
      for (const field of elements || []) {
        conditionNames.add(field.data_name);
        if (field.type === 'Section' || field.type === 'BuildingPlanSection') visit(field.elements);
      }
    };
    visit(path.length ? definition(path)?.field.elements : schema.form?.elements);
    const entry = {
      scopeId: randomUUID(),
      path: clone(path),
      names,
      conditionNames: [...conditionNames],
      fieldKey,
      row: clone(row),
      kind,
      active: true,
      findings: [],
      diagnostics: [],
      enteredEdit: false,
    };
    const ancestors = {};
    for (const candidate of entries.values())
      if (
        candidate.path.length < path.length &&
        samePath(candidate.path, path.slice(0, candidate.path.length))
      )
        Object.assign(ancestors, state(candidate).values);
    const warnings = new WarningSystem({
      enableConsoleWarnings: false,
      enableCollection: true,
      throttleMs: 0,
    });
    entry.warnings = warnings;
    entry.engine = createEngine({
      schema,
      ...evaluationOptions,
      mode: configuration.readonly ? 'readonly' : 'edit',
      initialValues: { ...ancestors, ...entry.row.values },
      eventScope: { instancePath: entry.path },
      diagnostics: { console: false },
      warningSystem: warnings,
      onDiagnostics: (snapshot) => {
        entry.diagnostics = snapshot
          .filter((finding) => names.includes(finding.fieldName))
          .map((finding) => ({
            ...finding,
            context: { ...finding.context, instancePath: clone(entry.path) },
          }));
      },
    });
    entries.set(entry.scopeId, entry);
    entry.release = coordinator.bind(path, {
      canEdit: () => !configuration.readonly,
      read: () => ({ ...entry.row, ...state(entry) }),
      apply: async (snapshot) => {
        applyRecordState(entry.engine, snapshot);
        entry.row.repeatable = clone(snapshot.repeatable || {});
      },
    });
    entry.engine.recordCoordinator = coordinator;
    // The existing engine owns events. Evaluation always has accepted record context.
    const scalarEval = entry.engine.eval.bind(entry.engine);
    entry.engine.eval = () => {
      if (!coordinator.hasCollections()) {
        scalarEval();
        entry.pending = Promise.resolve();
        return entry.pending;
      }
      const capturedRepeatable = entry.row.repeatable;
      const pending = coordinator
        .evaluate(path, { interactionMode: configuration.readonly ? 'readonly' : 'edit' })
        .then((result) => {
          if (
            !entry.active ||
            entry.pending !== pending ||
            (result.clearedFields?.length && entry.row.repeatable !== capturedRepeatable)
          )
            return;
          if (result.status !== 'evaluated')
            throw new Error(result.issues?.[0]?.message || 'Scope evaluation failed.');
          const updated = applyClearedFieldUpdates(
            { ...result.state, repeatable: entry.row.repeatable || {} },
            result.clearedFields,
            path
          );
          applyRecordState(entry.engine, updated);
          entry.row.repeatable = updated.repeatable;
          entry.diagnostics = result.diagnostics || [];
        });
      entry.pending = pending;
      return pending;
    };
    const read = async () => {
      await entry.pending;
      return state(entry);
    };
    const adapter = {
      recordCoordinator: coordinator,
      isCurrent: () => alive && entry.active && entries.get(entry.scopeId) === entry,
      readableValues: () => state(entry).values,
      refreshReads: async (values) => Object.assign(entry.engine.getState().values, clone(values)),
      settle: read,
      read,
      snapshot: () => state(entry),
      trigger: (type, key, data) =>
        configuration.lifecycle || ['load-record', 'change'].includes(type)
          ? entry.engine.triggerDetailed(type, key, data)
          : { operations: [], validationIssues: [], issues: [] },
      async process(operations, _meta, isCurrent) {
        if (!isCurrent()) throw new Error('Editor has ended.');
        const updates = {};
        for (const operation of operations) {
          if (operation.operation !== 'SETVALUE') continue;
          const { fieldDataName, valueToSet } = operation.params;
          if (!names.includes(fieldDataName))
            throw new TypeError('Operation targets another scope.');
          const field =
            metadata.fieldOwnership.get(fieldDataName)?.field ||
            (fieldDataName === schema.form.status_field?.data_name
              ? schema.form.status_field
              : null);
          updates[fieldDataName] = normalizeChoiceOperationValue(field, valueToSet);
        }
        if (Object.keys(updates).length) {
          // Core commits the complete preflighted batch and calls this entry's scoped evaluator.
          entry.engine.setValues(updates);
          await entry.pending;
          const planResult = await updateBuildingPlan(entry);
          if (planResult?.issues.length) throw new TypeError(planResult.issues[0].message);
          entry.handle?.dataChanged();
          if (!entry.path.length) coordinator.changed();
        }
        for (const operation of operations) {
          if (operation.operation === 'ALERT') presentations.push(clone(operation));
          else if (operation.operation !== 'SETVALUE')
            throw new Error('Unsupported preview operation: ' + operation.operation);
        }
      },
      validate: (snapshot) => summary(entry, snapshot),
      dataSignature: () =>
        eventDataSignature({ values: state(entry).values, repeatable: entry.row.repeatable }),
      canEdit: () => !configuration.readonly,
      onValidation: (findings) => {
        entry.findings = clone(findings);
      },
      endScope: () => {
        if (!entry.active) return;
        entry.active = false;
        entry.release?.();
        entries.delete(entry.scopeId);
        retired.push({ scopeId: entry.scopeId, instancePath: clone(entry.path) });
      },
      async serialize(snapshot, intent, validationSummary) {
        const stamp = new Date().toISOString();
        if (!path.length && !recordOptions.created_at_client)
          recordOptions = {
            ...recordOptions,
            created_at_client: snapshot.values.created_at_client || stamp,
          };
        const timestamps = {
          created_at_client:
            recordOptions.created_at_client || snapshot.values.created_at_client || stamp,
          updated_at_client: stamp,
          created_at_server: null,
          updated_at_server: null,
        };
        const rowSnapshot = {
          ...clone(entry.row),
          values: clone(snapshot.values),
          repeatable: savedRows(snapshot.repeatable),
        };
        for (const property of ['errors', 'visible', 'required', 'read_only'])
          delete rowSnapshot[property];
        const payload = path.length
          ? { ...rowSnapshot, values: clone(snapshot.values), updated_at_client: stamp }
          : intent === 'draft'
            ? {
                raw_values: clone(snapshot.values),
                repeatable: savedRows(snapshot.repeatable),
                timestamps,
              }
            : serializeRecord(
                { values: snapshot.values, repeatable: snapshot.repeatable },
                {
                  ...recordOptions,
                  ...timestamps,
                  '@status': schema.form?.status_field
                    ? snapshot.values[schema.form.status_field.data_name]
                    : recordOptions['@status'],
                }
              );
        return {
          payload,
          meta: {
            rawValues: clone(snapshot.values),
            repeatable: savedRows(snapshot.repeatable),
            timestamps,
            validationSummary,
          },
        };
      },
    };
    entry.handle = dispatcher.register({
      scopeId: entry.scopeId,
      instancePath: entry.path,
      fieldKey,
      adapter,
    });
    return entry;
  }
  async function initialize(entry) {
    await entry.engine.eval();
    const suffix = entry.path.length ? 'repeatable' : 'record';
    const load = await controller.dispatch({
      type: 'load-' + suffix,
      scopeId: entry.scopeId,
      instancePath: entry.path,
      fieldKey: entry.fieldKey,
    });
    if (load.issues.length) return load;
    if (configuration.lifecycle && !configuration.readonly) {
      const result = await controller.dispatch({
        type:
          (entry.path.length ? entry.kind : configuration.recordKind) === 'new'
            ? 'new-' + suffix
            : 'edit-' + suffix,
        scopeId: entry.scopeId,
        instancePath: entry.path,
        fieldKey: entry.fieldKey,
      });
      entry.enteredEdit = true;
      return result;
    }
    return load;
  }
  function response(result = { status: 'completed', issues: [] }) {
    const visible = state(root);
    const drafts = [...entries.values()]
      .filter((entry) => entry.path.length)
      .sort((a, b) => a.path.length - b.path.length);
    for (const entry of drafts) {
      let node = visible;
      for (const [index, part] of entry.path.entries()) {
        const rows = (node.repeatable[part.repeatableKey] ||= []);
        let rowIndex =
          part.identity === 'id'
            ? rows.findIndex((row) => (row.id ?? row.record_id) === part.instanceId)
            : part.index;
        if (rowIndex < 0) rowIndex = rows.length;
        if (index === entry.path.length - 1)
          rows[rowIndex] = { ...clone(entry.row), ...state(entry) };
        node = rows[rowIndex];
      }
    }
    const closedFindings = (root.active ? committedDiagnostics : []).filter(
      (finding) =>
        !drafts.some((entry) =>
          samePath(entry.path, (finding.context?.instancePath || []).slice(0, entry.path.length))
        )
    );
    return {
      ...clone(result),
      persistedFreshness: coordinator.freshness(),
      hiddenValueRecoveryAvailable:
        typeof onResolveHiddenValue === 'function' && !configuration.readonly,
      state: visible,
      ...(drafts.length ? { committedState: state(root) } : {}),
      diagnostics: [
        ...closedFindings,
        ...[...entries.values()].flatMap((entry) => clone(entry.diagnostics)),
      ],
      warnings: [
        ...committedWarnings,
        ...[...entries.values()].flatMap((entry) =>
          entry.warnings.getCollectedWarnings().filter((w) => w.context?.type !== 'calculation')
        ),
      ],
      customValidation: [...entries.values()].flatMap((entry) => clone(entry.findings)),
      scopes: [...entries.values()].map((entry) => ({
        scopeId: entry.scopeId,
        instancePath: clone(entry.path),
        recordKind: entry.kind,
      })),
      planHistory: [
        ...new Set([...entries.values()].map((entry) => entry.buildingPlan).filter(Boolean)),
      ].map((bridge) => ({ instancePath: bridge.floorPath, ...bridge.editor.getState() })),
      presentations: presentations.splice(0),
      retiredScopes: retired.splice(0),
    };
  }
  const ready = initialize(root).then((result) => {
    source = state(root);
    return result;
  });
  return {
    ready,
    async persist(preparationId, save) {
      if (
        !prepared ||
        prepared.result.preparationId !== preparationId ||
        prepared.signature !== coordinator.signature()
      )
        return failed('stale_preparation', 'Prepare the current record before persisting it.');
      const selected = prepared;
      await save(clone(selected.result.payload), clone(selected.result.meta.freshness));
      if (selected !== prepared)
        return failed('stale_preparation', 'The preparation changed while persisting.');
      const result = await controller.acknowledgeSave({ preparationId });
      if (!result.issues.length) prepared = null;
      return result;
    },
    dispose() {
      if (!alive) return;
      dispatcher.end();
      coordinator.dispose();
      alive = false;
    },
    async command(request) {
      await ready;
      if (request.action === 'inspect') return response();
      if (request.action === 'changes') {
        const result = await controller.getSaveChanges(request);
        const label = createChangeLabels(schema, coordinator.capture());
        return {
          ...result,
          changes: result.changes?.map((change) => ({ ...change, label: label(change) })),
          sessionId: request.sessionId,
        };
      }
      if (request.action === 'acknowledge')
        return response(await controller.acknowledgeSave(request));
      if (!root.active) return response(failed('scope_closed', 'The record editor has ended.'));
      const path = request.instancePath ?? [];
      if (!Array.isArray(path))
        return response(failed('invalid_request', 'instancePath must be an array.'));
      if (!validPath(path)) return response(failed('invalid_request', 'Invalid instance path.'));
      const entry = find(path, request.scopeId);
      if (request.buildingPlanEditingPolicy) {
        try {
          // Preferences are scoped to this editor session; schema events cannot write them.
          const plans = new Set(
            [...entries.values()].map((item) => item.buildingPlan).filter(Boolean)
          );
          for (const plan of plans) plan.editor.setEditingPolicy(request.buildingPlanEditingPolicy);
        } catch (error) {
          return response(failed('invalid_editing_policy', error.message));
        }
      }
      if (request.action === 'open-row') {
        if (configuration.readonly)
          return response(failed('readonly_scope', 'The editor is read-only.'));
        const info = definition(path);
        const parent = owner(parentPath(path));
        if (
          !path.length ||
          !info ||
          !parent?.active ||
          (request.parentScopeId !== undefined && request.parentScopeId !== parent.scopeId) ||
          (parent.path.some((part) => part.identity === 'position') &&
            request.parentScopeId !== parent.scopeId)
        )
          return response(failed('invalid_target', 'Open the parent editor first.'));
        if (entry)
          return response(failed('editor_already_open', 'This row editor is already open.'));
        const part = path.at(-1);
        const siblings = parent.row.repeatable?.[part.repeatableKey] || [];
        const matches =
          part.identity === 'id'
            ? siblings.filter((row) => (row.id ?? row.record_id) === part.instanceId)
            : [];
        if (matches.length > 1)
          return response(
            failed('invalid_target', 'This row ID is ambiguous within its collection.')
          );
        if (request.recordKind === 'new' && matches.length)
          return response(failed('invalid_target', 'A new row cannot reuse an existing row ID.'));
        const original = rowsFor(path);
        if (!original && request.recordKind !== 'new')
          return response(failed('invalid_target', 'The row no longer exists.'));
        const draft = makeEntry(
          path,
          [...info.fields.keys()],
          info.field.data_name,
          original || request.row || { values: {}, repeatable: {} },
          original ? 'existing' : 'new'
        );
        try {
          attachBuildingPlan(draft);
          if (draft.buildingPlan) distributeBuildingPlan(draft.buildingPlan);
        } catch (error) {
          draft.handle.retire();
          return response(failed('invalid_building_plan', error.message));
        }
        return response(await initialize(draft));
      }
      if (!entry)
        return response(failed('invalid_target', 'No active editor matches this target.'));
      if (request.action === 'building-plan-reset' || request.action === 'building-plan-history') {
        if (
          !entry.buildingPlan ||
          configuration.readonly ||
          stageCanvasFloor.readOnly(
            entry.buildingPlan.floorPath,
            state(owner(parentPath(entry.buildingPlan.floorPath)) || root)
          )
        )
          return response(failed('readonly_scope', 'Open an editable BuildingPlan row first.'));
        const editor = entry.buildingPlan.editor;
        let result;
        if (request.action === 'building-plan-history')
          result =
            request.direction === 'undo'
              ? editor.undo({ scopeId: entry.scopeId })
              : request.direction === 'redo'
                ? editor.redo({ scopeId: entry.scopeId })
                : failed('invalid_request', 'Choose Undo or Redo.');
        else
          result = editor.updateRow(
            entry.scopeId,
            { ...entry.row, ...state(entry) },
            { resetProperties: [request.property] }
          );
        if (!result.issues.length) {
          await editor.evaluate(planEvaluator, state(root).values);
          distributeBuildingPlan(entry.buildingPlan);
          for (const child of [...entries.values()]
            .filter((candidate) => candidate.buildingPlan === entry.buildingPlan)
            .reverse())
            await child.engine.eval();
        }
        return response({ status: result.status, issues: result.issues });
      }
      if (request.action === 'building-plan-operation') {
        if (
          !entry.buildingPlan ||
          configuration.readonly ||
          stageCanvasFloor.readOnly(
            entry.buildingPlan.floorPath,
            state(owner(parentPath(entry.buildingPlan.floorPath)) || root)
          )
        )
          return response(failed('readonly_scope', 'Open an editable BuildingPlan floor first.'));
        const result = entry.buildingPlan.editor.apply(request.operation, {
          scopeId: entry.scopeId,
        });
        if (!result.issues.length) {
          await entry.buildingPlan.editor.evaluate(planEvaluator, state(root).values);
          distributeBuildingPlan(entry.buildingPlan);
          for (const child of [...entries.values()]
            .filter((candidate) => candidate.buildingPlan === entry.buildingPlan)
            .reverse())
            await child.engine.eval();
        }
        const { record: _record, snapshot: _snapshot, ...details } = result;
        return response(details);
      }
      if (request.action === 'canvas-update') {
        if (entry.buildingPlan)
          return response(
            failed('invalid_request', 'Versioned BuildingPlan edits require a semantic operation.')
          );
        if (
          configuration.readonly ||
          stageCanvasFloor.readOnly(path, state(owner(parentPath(path)) || root))
        )
          return response(failed('readonly_scope', 'The editor is read-only.'));
        const affected = [...entries.values()].filter(
          (child) =>
            child.path.length >= path.length && samePath(path, child.path.slice(0, path.length))
        );
        const before = affected.map((child) => ({
          entry: child,
          state: clone(child.engine.getState()),
          row: clone(child.row),
          diagnostics: clone(child.diagnostics),
        }));
        let staged;
        try {
          staged = stageCanvasFloor(
            path,
            { ...entry.row, ...state(entry) },
            request.row,
            affected
              .filter((child) => child !== entry)
              .map((child) => ({ path: child.path, row: { ...child.row, ...state(child) } }))
          );
        } catch (error) {
          if (!(error instanceof TypeError)) throw error;
          return response(failed('invalid_request', error.message));
        }
        try {
          // Preflight the complete visible floor, then distribute writes to their existing editors.
          // Open children retain their own lifetimes and never enter an accepted parent snapshot.
          for (const planned of staged.editors) {
            const child = affected.find((item) => samePath(item.path, planned.path));
            Object.assign(child.engine.getState().values, clone(planned.row.values));
            child.row.repeatable = planned.row.repeatable;
          }
          // Evaluate changed records from leaves to their owning floor, using the same engines
          // for open rows so calculations and validation do not replay lifecycle events.
          for (const node of staged.nodes) {
            const child = affected.find((item) => samePath(item.path, node.path));
            if (child) await child.engine.eval();
            else {
              const evaluated = await coordinator.evaluate(node.path);
              if (evaluated.status !== 'evaluated')
                throw new Error(
                  evaluated.issues?.[0]?.message || 'Canvas scope evaluation failed.'
                );
              Object.assign(node.row, clone(evaluated.state));
            }
          }
          for (const child of affected) child.handle.dataChanged();
          coordinator.changed();
          return response();
        } catch (error) {
          for (const previous of before) {
            previous.entry.row = previous.row;
            previous.entry.diagnostics = previous.diagnostics;
            applyRecordState(previous.entry.engine, previous.state);
          }
          return response(failed('canvas_update_failed', error.message));
        }
      }
      if (request.action === 'resolve-hidden-value') {
        if (configuration.readonly || path.length)
          return response(
            failed('readonly_scope', 'Resolve hidden values from the editable root record.')
          );
        try {
          const result = await coordinator.resolveHiddenValue(
            request.finding || {},
            onResolveHiddenValue
          );
          root.handle.dataChanged();
          return response(result);
        } catch (error) {
          return response(failed('hidden_value_recovery_failed', error.message));
        }
      }
      if (request.action === 'update') {
        if (request.fieldKey && !entry.names.includes(request.fieldKey))
          return response(failed('invalid_request', 'Field changes use an owned data_name.'));
        if (configuration.readonly)
          return response(failed('readonly_scope', 'The editor is read-only.'));
        const updates = Object.hasOwn(request, 'values') ? request.values : {};
        try {
          if (
            updates &&
            Object.keys(updates).some((name) => entry.engine.getState().read_only?.[name] === true)
          )
            return response(failed('readonly_field', 'The field is read-only.'));
          entry.engine.setValues(updates);
        } catch (error) {
          if (!(error instanceof TypeError)) throw error;
          return response(failed('invalid_request', error.message));
        }
        await entry.pending;
        const planResult = await updateBuildingPlan(entry);
        if (planResult?.issues.length) return response(planResult);
        if (Object.keys(updates).length) {
          entry.handle.dataChanged();
          if (!entry.path.length) coordinator.changed();
        }
        if (request.fieldKey) {
          const field =
            metadata.fieldOwnership.get(request.fieldKey)?.field || schema.form?.status_field;
          const value = state(entry).values[request.fieldKey];
          const detail = await controller.dispatch({
            type: 'change',
            fieldKey: request.fieldKey,
            scopeId: entry.scopeId,
            instancePath: entry.path,
            metadata: { value },
          });
          if (detail.issues.length) return response(detail);
          if (
            !entry.path.length &&
            field === schema.form?.status_field &&
            schema.form.status_field.enabled === true &&
            request.fieldKey === field.data_name
          )
            return response(
              await controller.dispatch({
                type: 'change-status',
                scopeId: entry.scopeId,
                instancePath: [],
                metadata: { value },
              })
            );
          return response(detail);
        }
        return response();
      }
      if (request.action === 'prepare' || request.action === 'accept-row') {
        if (request.recordOptions !== undefined) {
          if (
            !request.recordOptions ||
            typeof request.recordOptions !== 'object' ||
            Array.isArray(request.recordOptions)
          )
            return response(failed('invalid_request', 'Record options must be an object.'));
          recordOptions = { ...recordOptions, ...clone(request.recordOptions) };
        }
        const result = await controller.prepareSave({
          decision: request.decision,
          signal: request.signal,
          intent: request.action === 'accept-row' ? (request.intent ?? 'submit') : request.intent,
          scopeId: entry.scopeId,
          instancePath: entry.path,
        });
        if (request.action === 'accept-row' && result.eligible && entry.path.length) {
          if (entry.buildingPlan) {
            const planned = await updateBuildingPlan(entry, result.payload);
            if (planned.issues.length)
              return response({ ...planned, eligible: false, payload: null });
            result.payload = resolveBuildingPlanRow(
              entry.buildingPlan.editor.getRecord(),
              planPath(entry)
            );
          }
          const parent = owner(parentPath(entry.path));
          const key = entry.path.at(-1).repeatableKey;
          const rows = (parent.row.repeatable[key] ||= []);
          const index =
            entry.path.at(-1).identity === 'id'
              ? rows.findIndex((row) => (row.id ?? row.record_id) === entry.path.at(-1).instanceId)
              : entry.path.at(-1).index;
          const close = await controller.dispatch({
            type: 'unload-repeatable',
            fieldKey: entry.fieldKey,
            scopeId: entry.scopeId,
            instancePath: entry.path,
          });
          if (close.issues.length) return response({ ...close, eligible: false, payload: null });
          if (entry.buildingPlan) {
            const accepted = entry.buildingPlan.editor.acceptRow(entry.scopeId);
            if (accepted.issues.length)
              return response({ ...accepted, eligible: false, payload: null });
            distributeBuildingPlan(entry.buildingPlan);
          }
          if (index < 0 || entry.kind === 'new') rows.push(result.payload);
          else rows[index] = result.payload;
          parent.handle.dataChanged();
          await parent.engine.eval();
          if (!parent.path.length) await refreshCommitted();
          const membership = await controller.dispatch({
            type: 'change',
            fieldKey: entry.fieldKey,
            scopeId: parent.scopeId,
            instancePath: parent.path,
            metadata: {
              action: entry.kind === 'new' ? 'add' : 'edit',
              affectedInstancePath: entry.path,
            },
          });
          if (membership.issues.length)
            return response({ ...result, notificationIssues: membership.issues });
        }
        if (!entry.path.length)
          prepared = result.eligible ? { result, signature: coordinator.signature() } : null;
        return response(result);
      }
      if (request.action === 'cancel') {
        const suffix = entry.path.length ? 'repeatable' : 'record';
        const cancel = await controller.dispatch({
          type: 'cancel-' + suffix,
          scopeId: entry.scopeId,
          instancePath: entry.path,
          fieldKey: entry.fieldKey,
        });
        if (cancel.issues.length) return response(cancel);
        if (entry.buildingPlan) {
          const cancelled = entry.buildingPlan.editor.cancelRow(entry.scopeId);
          if (cancelled.issues.length) return response(cancelled);
          await entry.buildingPlan.editor.evaluate(planEvaluator, state(root).values);
          distributeBuildingPlan(entry.buildingPlan);
        }
        const close = await controller.dispatch({
          type: 'unload-' + suffix,
          scopeId: entry.scopeId,
          instancePath: entry.path,
          fieldKey: entry.fieldKey,
        });
        if (!entry.path.length && !close.issues.length) {
          root.row.repeatable = clone(source.repeatable || {});
          for (const map of maps) {
            const target = root.engine.getState()[map];
            for (const key of Object.keys(target)) delete target[key];
            Object.assign(target, clone(source[map]));
          }
        }
        return response(close);
      }
      if (request.action === 'remove-row') {
        if (configuration.readonly)
          return response(failed('readonly_scope', 'The editor is read-only.'));
        const targetPath = request.affectedPath;
        if (
          !validPath(targetPath) ||
          !targetPath.length ||
          !samePath(entry.path, parentPath(targetPath))
        )
          return response(failed('invalid_target', 'Invalid repeatable owner.'));
        const info = definition(targetPath),
          part = targetPath.at(-1);
        if (!info) return response(failed('invalid_target', 'Unknown repeatable.'));
        const rows = entry.row.repeatable?.[part.repeatableKey] || [];
        if (
          part.identity === 'id' &&
          rows.filter((row) => (row.id ?? row.record_id) === part.instanceId).length > 1
        )
          return response(
            failed('invalid_target', 'This row ID is ambiguous within its collection.')
          );
        const index =
          part.identity === 'id'
            ? rows.findIndex((row) => (row.id ?? row.record_id) === part.instanceId)
            : part.index;
        if (index < 0 || !rows[index])
          return response(failed('invalid_target', 'The row no longer exists.'));
        const floorMeta = buildingPlans.find(
          (candidate) => candidate.repeatablesByNodeKey.floors.preferredKey === part.repeatableKey
        );
        if (floorMeta && !entry.buildingPlan) {
          const guard = createBuildingPlanEditor({
            meta: floorMeta,
            record: { values: {}, repeatable: { [part.repeatableKey]: rows } },
          });
          const proposed = guard.removeRow([part], {
            allowObservationDeletion: request.allowObservationDeletion === true,
            preview: true,
          });
          if (proposed.issues.length) return response(proposed);
        }
        const opened = [...entries.values()].find((item) => samePath(item.path, targetPath));
        if (
          targetPath.some((part) => part.identity === 'position') &&
          request.targetScopeId !== opened?.scopeId
        )
          return response(
            failed('invalid_target', 'A positional row requires its observed active scopeId.')
          );
        if (opened) {
          const close = await controller.dispatch({
            type: 'unload-repeatable',
            fieldKey: opened.fieldKey,
            scopeId: opened.scopeId,
            instancePath: opened.path,
          });
          if (close.issues.length) return response(close);
        }
        if (entry.buildingPlan) {
          const removed = entry.buildingPlan.editor.removeRow(
            targetPath.slice(entry.buildingPlan.floorPath.length - 1),
            {
              scopeId: entry.scopeId,
              allowObservationDeletion: request.allowObservationDeletion === true,
            }
          );
          if (removed.issues.length) return response(removed);
          await entry.buildingPlan.editor.evaluate(planEvaluator, state(root).values);
          distributeBuildingPlan(entry.buildingPlan);
        } else rows.splice(index, 1);
        entry.handle.dataChanged();
        await entry.engine.eval();
        if (!entry.path.length) await refreshCommitted();
        // Positional siblings cannot keep a lifetime that would now name another record.
        for (const sibling of [...entries.values()])
          if (
            sibling.path.length >= targetPath.length &&
            samePath(parentPath(targetPath), sibling.path.slice(0, targetPath.length - 1)) &&
            sibling.path[targetPath.length - 1].repeatableKey === part.repeatableKey &&
            sibling.path[targetPath.length - 1].identity === 'position'
          )
            sibling.handle.retire();
        const membership = await controller.dispatch({
          type: 'change',
          fieldKey: info.field.data_name,
          scopeId: entry.scopeId,
          instancePath: entry.path,
          metadata: { action: 'remove', affectedInstancePath: targetPath },
        });
        return response(
          membership.issues.length
            ? { status: 'completed', issues: [], notificationIssues: membership.issues }
            : membership
        );
      }
      if (request.action === 'dispatch')
        return response(
          await controller.dispatch({
            type: request.type,
            fieldKey: request.fieldKey,
            scopeId: entry.scopeId,
            instancePath: entry.path,
            metadata: request.metadata,
          })
        );
      return response(failed('invalid_request', 'Unknown preview action.'));
    },
  };
}

/** Bounded request-owned sessions; schema replacement and expiry are forced retirement. */
export function createPreviewSessionManager({
  getSchema,
  serializeRecord,
  evaluateRepeatable,
  maxSessions = 32,
  ttlMs = 30 * 60 * 1000,
  createEngine,
  submissionOptions,
  onResolveHiddenValue,
  storageAdapter,
  evaluationOptions,
}) {
  const sessions = new Map();
  function dispose(id) {
    const session = sessions.get(id);
    for (const controller of session?.cancellations?.values() || []) controller.abort();
    session?.editor.dispose();
    sessions.delete(id);
  }
  function prune() {
    for (const [id, entry] of sessions) if (Date.now() - entry.touched > ttlMs) dispose(id);
  }
  return {
    async create(request) {
      prune();
      const schema = getSchema();
      if (!schema) throw new Error('No schema loaded.');
      const id = randomUUID();
      const identity =
        request.recordIdentity ??
        request.recordOptions?.mainRecordId ??
        (storageAdapter ? uuidv7() : undefined);
      const stored =
        storageAdapter && identity != null ? await storageAdapter.load(identity) : null;
      const editor = createPreviewEditor({
        schema,
        initialState: stored?.record ? restorePreviewRecord(schema, stored.record) : request.state,
        initialFreshness: stored?.freshness,
        submissionOptions,
        onResolveHiddenValue,
        evaluationOptions,
        configuration: request.configuration,
        recordOptions: {
          ...request.recordOptions,
          ...(storageAdapter ? { mainRecordId: stored?.record?.id ?? identity } : {}),
        },
        serializeRecord: (state, options) => serializeRecord(schema, state, options),
        evaluateRepeatable,
        createEngine,
      });
      if (sessions.size >= maxSessions) dispose(sessions.keys().next().value);
      const session = {
        editor,
        identity: identity ?? id,
        fingerprint: fingerprint(schema),
        touched: Date.now(),
        sequence: 0,
        tail: Promise.resolve(),
        cache: new Map(),
        cacheSizes: new Map(),
        cacheBytes: 0,
        saving: new Set(),
        cancellations: new Map(),
        cancelled: new Set(),
      };
      sessions.set(id, session);
      const initial = await editor.ready;
      return {
        sessionId: id,
        sequence: 0,
        ...(storageAdapter ? { recordIdentity: identity } : {}),
        ...(await editor.command({ action: 'inspect', instancePath: [] })),
        ...initial,
      };
    },
    cancel(request) {
      const session = sessions.get(request.sessionId);
      if (!session || typeof request.requestId !== 'string' || request.requestId.length > 128)
        return failed('stale_preparation', 'No current cancellable preparation.');
      const controller = session.cancellations.get(request.requestId);
      if (controller) controller.abort();
      else {
        session.cancelled.add(request.requestId);
        while (session.cancelled.size > 32)
          session.cancelled.delete(session.cancelled.values().next().value);
      }
      return { status: 'cancelled', eligible: false, payload: null, issues: [] };
    },
    async persist(request) {
      const session = sessions.get(request.sessionId);
      if (!storageAdapter || !session || session.fingerprint !== fingerprint(getSchema()))
        return failed(
          'invalid_persistence',
          'This preview has no current persistence adapter session.'
        );
      if (session.persisting)
        return failed('save_in_progress', 'Persistence is already in progress.');
      session.persisting = true;
      const work = session.tail.then(() =>
        session.editor.persist(request.preparationId, (record, freshness) =>
          storageAdapter.save(session.identity, { record, freshness })
        )
      );
      session.tail = work.catch(() => {});
      try {
        return await work;
      } finally {
        session.persisting = false;
      }
    },
    command(request) {
      prune();
      const session = sessions.get(request.sessionId);
      if (!session)
        return Promise.resolve(failed('stale_generation', 'Preview session has ended.'));
      const schema = getSchema();
      if (!schema || session.fingerprint !== fingerprint(schema)) {
        dispose(request.sessionId);
        return Promise.resolve(failed('stale_generation', 'The active schema has changed.'));
      }
      session.touched = Date.now();
      const sequence = request.sequence;
      if (!Number.isSafeInteger(sequence) || sequence < 1)
        return Promise.resolve(
          failed('invalid_request', 'A positive request sequence is required.')
        );
      if (session.cache.has(sequence)) return session.cache.get(sequence).then(copyEventData);
      if (sequence !== session.sequence + 1)
        return Promise.resolve(failed('out_of_order', 'Preview requests must arrive in order.'));
      session.sequence = sequence;
      const saving = request.action === 'prepare' || request.action === 'accept-row';
      const abort = saving && request.requestId ? new AbortController() : null;
      if (abort) {
        if (typeof request.requestId !== 'string' || request.requestId.length > 128)
          return Promise.resolve(failed('invalid_request', 'requestId must be a bounded string.'));
        session.cancellations.set(request.requestId, abort);
        if (session.cancelled.delete(request.requestId)) abort.abort();
      }
      const target = request.scopeId || 'root';
      const busy = saving && session.saving.has(target);
      if (saving) session.saving.add(target);
      const work = session.tail
        .then(() =>
          sessions.get(request.sessionId) === session
            ? busy
              ? failed('save_in_progress', 'Save preparation is already in progress.')
              : storageAdapter && request.action === 'acknowledge'
                ? failed(
                    'persistence_required',
                    'The server adapter acknowledges successful persistence.'
                  )
                : session.editor.command({ ...request, signal: abort?.signal })
            : failed('stale_generation', 'Preview session has ended.')
        )
        .then((result) => {
          const response = { sessionId: request.sessionId, sequence, ...result };
          if (session.cache.has(sequence)) {
            const bytes = Buffer.byteLength(JSON.stringify(response));
            session.cacheSizes.set(sequence, bytes);
            session.cacheBytes += bytes;
            // Keep the latest replay, bounding older response retention by bytes as well as count.
            while (session.cache.size > 1 && session.cacheBytes > 8 * 1024 * 1024) {
              const oldest = session.cache.keys().next().value;
              session.cache.delete(oldest);
              session.cacheBytes -= session.cacheSizes.get(oldest) || 0;
              session.cacheSizes.delete(oldest);
            }
          }
          return response;
        })
        .finally(() => {
          if (saving && !busy) session.saving.delete(target);
          if (abort) session.cancellations.delete(request.requestId);
        });
      session.tail = work.catch(() => {});
      session.cache.set(sequence, work);
      while (session.cache.size > 32) {
        const oldest = session.cache.keys().next().value;
        session.cache.delete(oldest);
        session.cacheBytes -= session.cacheSizes.get(oldest) || 0;
        session.cacheSizes.delete(oldest);
      }
      return work.then(copyEventData);
    },
    dispose,
    disposeAll() {
      for (const id of sessions.keys()) dispose(id);
    },
  };
}
