import { createRecordEvaluator } from 'form0-core';
import { copyEventData, eventDataSignature } from './session-dispatcher.js';

const collectionSchemas = new WeakMap();
export const hasRecordCollections = (schema) => {
  if (!schema || typeof schema !== 'object') return false;
  if (collectionSchemas.has(schema)) return collectionSchemas.get(schema);
  const visit = (fields) =>
    (fields || []).some(
      (field) =>
        /\bREPEATABLE(?:VALUES|SUM)\s*\(/.test(field.calculate || '') || visit(field.elements)
    );
  const result = visit(schema?.form?.elements);
  collectionSchemas.set(schema, result);
  return result;
};
const samePath = (a, b) =>
  a.length === b.length &&
  a.every((part, index) => {
    const other = b[index];
    return (
      part.repeatableKey === other.repeatableKey &&
      part.identity === other.identity &&
      (part.identity === 'id' ? part.instanceId === other.instanceId : part.index === other.index)
    );
  });
const fail = (code, message) => ({
  status: 'failed',
  eligible: false,
  payload: null,
  issues: [{ code, message, instancePath: [] }],
});

/** Drop disposable closed-row maps from transport, retaining every record value and metadata. */
export function compactRecordTree(record, root = true) {
  if (!record) return record;
  if (!root) for (const name of ['errors', 'visible', 'required', 'read_only']) delete record[name];
  for (const rows of Object.values(record.repeatable || {}))
    for (const row of rows) compactRecordTree(row, false);
  return record;
}

// Schedule a fresh browser task without nested timer delays or prioritizing continuations
// ahead of queued cancellation messages. Other hosts keep core's timer fallback.
const hostScheduling = () =>
  typeof globalThis.scheduler?.postTask === 'function'
    ? { yieldToHost: () => globalThis.scheduler.postTask(() => {}, { priority: 'user-visible' }) }
    : {};

// Bound host work around selection, hooks and serialization as well as engine tasks.
function preparationCheckpoint(options) {
  const clock = () => globalThis.performance?.now?.() ?? Date.now();
  const yieldToHost =
    hostScheduling(options).yieldToHost || (() => new Promise((resolve) => setTimeout(resolve, 0)));
  let started = clock();
  return async () => {
    if (clock() - started < 8) return;
    await yieldToHost();
    started = clock();
  };
}

/** One backend per schema/configuration lifetime; reports and reviews never enter renderer state. */
export function createRecordBackend(config) {
  let evaluator;
  let generation = 0;
  let changes = [];
  let pendingSource = null;
  const get = () => {
    evaluator ||= createRecordEvaluator({ ...config, diagnostics: { console: false } });
    if (typeof evaluator.evaluateScope !== 'function')
      throw new Error(
        'This consumer requires the coordinated form0-core release containing evaluateScope(). Upgrade core before using this consumer.'
      );
    return evaluator;
  };
  return {
    evaluateScope: (snapshot, options) =>
      get().evaluateScope(snapshot, { ...hostScheduling(), ...options }),
    async prepare(snapshot, options) {
      const attempt = ++generation;
      const result = await get().prepareSubmission(snapshot, { ...hostScheduling(), ...options });
      if (attempt !== generation)
        return fail('stale_preparation', 'This preparation has been released.');
      changes = result.changes || [];
      pendingSource = result.status === 'requires_decision' ? snapshot : null;
      const { proposal: _proposal, changes: _changes, ...compact } = result;
      if (compact.status === 'requires_decision') delete compact.freshness;
      compact.changeCount = changes.length;
      compact.childChangeCount = changes.filter((entry) => entry.instancePath.length).length;
      if (compact.snapshot) compactRecordTree(compact.snapshot);
      return compact;
    },
    getChanges({ offset = 0, limit = 50 } = {}) {
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100
      )
        return fail('invalid_page', 'Changes require offset >= 0 and limit from 1 to 100.');
      return {
        status: 'completed',
        total: changes.length,
        offset,
        changes: copyEventData(changes.slice(offset, offset + limit)),
        issues: [],
      };
    },
    release() {
      generation++;
      changes = [];
      if (evaluator && pendingSource) {
        const source = pendingSource;
        pendingSource = null;
        const signal = new AbortController();
        signal.abort();
        void evaluator.prepareSubmission(source, { signal: signal.signal });
      }
    },
    dispose() {
      this.release();
      evaluator = null;
    },
  };
}

function overlay(tree, path, data) {
  if (!path.length) return { ...tree, ...data };
  const [part, ...rest] = path;
  const rows = [...(tree.repeatable?.[part.repeatableKey] || [])];
  let index =
    part.identity === 'id'
      ? rows.findIndex((row) => (row.id ?? row.record_id) === part.instanceId)
      : part.index;
  if (index < 0) index = rows.length;
  if (index > rows.length) throw new Error('The positional editor no longer exists.');
  const base = rows[index] || (part.identity === 'id' ? { id: part.instanceId } : {});
  rows[index] = overlay(base, rest, data);
  return { ...tree, repeatable: { ...tree.repeatable, [part.repeatableKey]: rows } };
}

/** Private portable host coordination. Core owns evaluation; host adapters own operations/storage. */
export function createRecordCoordinator({
  schema,
  helpers,
  security,
  getOptions = () => ({}),
  seed = {},
}) {
  let backend = null;
  let configuration = schema;
  const editors = new Map();
  const preparationSession = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  let nextId = 0;
  let attempt = null;
  let applying = false;
  let savedFreshness = copyEventData(getOptions().initialFreshness || null);
  const listeners = new Set();
  const notify = (event) => {
    for (const listener of listeners) {
      try {
        const value = listener(event);
        if (value?.then) value.catch(() => {});
      } catch {
        /* Presentation observers cannot change selection or persistence acknowledgement. */
      }
    }
  };
  const local = () =>
    (backend ||= createRecordBackend({ schema: configuration, helpers, security }));
  const options = () => getOptions().submissionOptions || {};
  const root = () => [...editors.values()].find((entry) => !entry.path.length);
  const capture = (path = []) => {
    let snapshot = root()?.read() || {
      values: seed.raw_values || seed.values || {},
      repeatable: seed.repeatable || {},
    };
    for (const editor of [...editors.values()].sort((a, b) => a.path.length - b.path.length))
      if (
        editor.path.length &&
        editor.path.length <= path.length &&
        samePath(editor.path, path.slice(0, editor.path.length))
      )
        snapshot = overlay(snapshot, editor.path, editor.read());
    return snapshot;
  };
  const signature = () =>
    eventDataSignature({
      snapshot: capture(),
      policy: { mode: options().mode ?? 'automatic', allowRetain: options().allowRetain === true },
    });
  const selection = async (result) => {
    if (result.snapshot && ['ready', 'blocked'].includes(result.status)) {
      if (result.changeCount) notify({ type: 'selection' });
      applying = true;
      try {
        await root()?.apply(result.snapshot);
      } finally {
        applying = false;
      }
    }
  };
  const descriptor = (result) => {
    const { snapshot: _snapshot, ...publicResult } = result;
    return {
      ...publicResult,
      preparationId: attempt.id,
      payload: null,
      status:
        result.status === 'ready' || result.status === 'blocked' ? 'completed' : result.status,
    };
  };
  const finish = (result) => {
    const value = descriptor(result);
    attempt = null;
    backend?.release?.();
    return value;
  };
  return {
    hasCollections: () => hasRecordCollections(configuration),
    setSchema(next) {
      if (next && configuration !== next) {
        attempt = null;
        configuration = next;
        backend?.dispose?.();
        backend = null;
      }
    },
    setBackend(next) {
      attempt = null;
      backend?.dispose?.();
      backend = next;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    freshness: () => copyEventData(savedFreshness),
    capture,
    signature,
    preparedSignature: () => attempt?.signature || null,
    bind(path, adapter) {
      const key = JSON.stringify(path);
      const entry = { path: copyEventData(path), ...adapter };
      editors.set(key, entry);
      return () => {
        if (editors.get(key) === entry) editors.delete(key);
      };
    },
    async evaluate(path = [], evaluationOptions = {}) {
      return local().evaluateScope(capture(path), { ...evaluationOptions, instancePath: path });
    },
    async prepare(request, { saveHook, serialize, managedEvents = false } = {}) {
      if ([...editors.values()].some((entry) => entry.path.length))
        return fail(
          'pending_editor',
          'Accept or cancel the open child editor before preparing the root record.'
        );
      const policy = options();
      const settings = {
        intent: request.intent,
        mode: policy.mode,
        allowRetain: policy.allowRetain === true,
        managedEvents,
        signal: request.signal,
      };
      const current = signature();
      if (request.decision) {
        if (!attempt || attempt.reviewId !== request.decision.reviewId)
          return fail(
            'stale_review',
            'This review no longer matches the current record. Prepare again.'
          );
        if (attempt.signature !== current) {
          attempt = null;
          backend?.release?.();
          return fail(
            'stale_review',
            'This review no longer matches the current record. Prepare again.'
          );
        }
      } else {
        backend?.release?.();
        attempt = {
          id: `form0-preparation-${preparationSession}-${++nextId}`,
          signature: current,
          source: capture(),
          saveRan: false,
        };
      }
      const active = attempt;
      active.phase = 'preparing';
      const checkpoint = preparationCheckpoint({ signal: request.signal });
      const checkCurrent = async () => {
        await checkpoint();
        if (active !== attempt)
          return fail('stale_preparation', 'This save preparation has ended.');
        if (request.signal?.aborted)
          return finish({ status: 'cancelled', eligible: false, issues: [] });
        if (active.signature !== signature())
          return finish(fail('values_changed', 'Values changed during preparation; retry.'));
        return null;
      };
      let result = await local().prepare(active.source, {
        ...settings,
        decision: request.decision,
      });
      const initialFailure = await checkCurrent();
      if (initialFailure) return initialFailure;
      active.result = result;
      active.reviewId = result.reviewId;
      if (result.status === 'requires_decision') {
        active.phase = 'review';
        return descriptor(result);
      }
      if (request.signal?.aborted)
        return finish({ status: 'cancelled', eligible: false, issues: [] });
      await selection(result);
      active.signature = signature();
      if (!result.eligible) return finish(result);
      if (managedEvents && !active.saveRan && saveHook) {
        active.saveRan = true;
        const hookFailure = await checkCurrent();
        if (hookFailure) return hookFailure;
        const before = active.signature;
        const saved = await saveHook(result.validationSummary);
        await checkpoint();
        if (active !== attempt)
          return fail('stale_preparation', 'This save preparation has ended.');
        if (request.signal?.aborted)
          return finish({ status: 'cancelled', eligible: false, issues: [] });
        if (saved?.issues?.length) return finish({ ...saved, eligible: false, payload: null });
        if (before !== signature()) {
          active.source = capture();
          active.signature = signature();
          result = await local().prepare(active.source, settings);
          const refreshFailure = await checkCurrent();
          if (refreshFailure) return refreshFailure;
          active.result = result;
          active.reviewId = result.reviewId;
          if (result.status === 'requires_decision') {
            active.phase = 'review';
            return descriptor(result);
          }
          await selection(result);
          active.signature = signature();
          if (!result.eligible) return finish(result);
        }
      }
      if (request.signal?.aborted)
        return finish({ status: 'cancelled', eligible: false, issues: [] });
      const serializationFailure = await checkCurrent();
      if (serializationFailure) return serializationFailure;
      let serialized;
      try {
        serialized = await serialize(result.snapshot, request.intent, result.validationSummary, {
          signal: request.signal,
          ...hostScheduling({ signal: request.signal }),
        });
      } catch (error) {
        if (active !== attempt)
          return fail('stale_preparation', 'This save preparation has ended.');
        if (request.signal?.aborted || error?.name === 'AbortError' || error?.code === 'cancelled')
          return finish({ status: 'cancelled', eligible: false, issues: [] });
        throw error;
      }
      const { payload, meta } = serialized;
      const deliveryFailure = await checkCurrent();
      if (deliveryFailure) return deliveryFailure;
      if (request.signal?.aborted)
        return finish({ status: 'cancelled', eligible: false, issues: [] });
      active.phase = 'prepared';
      active.source = null;
      active.result = { freshness: result.freshness, eligible: true };
      return {
        status: 'completed',
        eligible: true,
        preparationId: active.id,
        payload,
        meta: { ...meta, preparationId: active.id, freshness: copyEventData(result.freshness) },
        freshness: copyEventData(result.freshness),
        validationSummary: result.validationSummary,
        changeCount: result.changeCount,
        issues: [],
        diagnostics: result.diagnostics,
      };
    },
    getSaveChanges({ preparationId, ...page } = {}) {
      if (attempt?.id !== preparationId || attempt.phase === 'preparing')
        return fail('stale_preparation', 'This change report has ended.');
      if (attempt.signature !== signature()) {
        attempt = null;
        backend?.release?.();
        return fail('stale_preparation', 'This change report has ended.');
      }
      return local().getChanges(page);
    },
    acknowledgeSave({ preparationId } = {}) {
      if (
        !attempt?.result?.eligible ||
        attempt.id !== preparationId ||
        attempt.signature !== signature()
      ) {
        if (attempt?.id === preparationId) {
          attempt = null;
          backend?.release?.();
        }
        return fail(
          'stale_preparation',
          'Only the current persisted preparation can be acknowledged.'
        );
      }
      savedFreshness = copyEventData(attempt.result.freshness);
      root()?.acknowledged?.();
      backend?.release?.();
      attempt = null;
      notify({ type: 'acknowledged' });
      return { status: 'completed', issues: [], freshness: copyEventData(savedFreshness) };
    },
    changed() {
      if (applying || !attempt || attempt.phase === 'preparing') return null;
      const current = signature();
      if (attempt.signature !== current) {
        attempt = null;
        backend?.release?.();
      }
      return current;
    },
    cancelPreparation() {
      attempt = null;
      backend?.release?.();
    },
    dispose() {
      attempt = null;
      backend?.dispose?.();
      backend = null;
      editors.clear();
      listeners.clear();
    },
  };
}

/** Attach an evaluated state without replacing the core engine's captured mutable value objects. */
export function applyRecordState(engine, state) {
  const target = engine.getState();
  for (const name of ['values', 'visible', 'required', 'read_only', 'errors']) {
    for (const key of Object.keys(target[name] || {})) delete target[name][key];
    Object.assign(target[name], state[name] || {});
  }
}
