/** Private portable editor dispatcher. Engines execute; adapters own presentation and payloads. */
export function copyEventData(value, seen = new Set()) {
  if (value == null || ['string', 'number', 'boolean', 'undefined'].includes(typeof value))
    return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof File === 'function' && value instanceof File)
    return new File([value], value.name, { type: value.type, lastModified: value.lastModified });
  if (typeof Blob === 'function' && value instanceof Blob)
    return Blob.prototype.slice.call(value, 0, value.size, value.type);
  if (typeof value !== 'object' || seen.has(value))
    throw new Error('Event data must be portable and must not contain cycles.');
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
    throw new Error('Event data must contain only portable data or native media handles.');
  seen.add(value);
  const result = Array.isArray(value) ? [] : {};
  for (const [key, entry] of Object.entries(value))
    Object.defineProperty(result, key, {
      value: copyEventData(entry, seen),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  seen.delete(value);
  return result;
}

/** File/Blob metadata survives worker state reads without loading binary data. */
export function eventDataSignature(value) {
  return JSON.stringify(value, (_key, entry) => {
    if (typeof File === 'function' && entry instanceof File)
      return {
        mediaKind: 'File',
        name: entry.name,
        size: entry.size,
        type: entry.type,
        lastModified: entry.lastModified,
      };
    if (typeof Blob === 'function' && entry instanceof Blob)
      return { mediaKind: 'Blob', size: entry.size, type: entry.type };
    return entry;
  });
}

export function normalizeEventOptions(events = {}) {
  const lifecycle = events.lifecycle === true;
  if (lifecycle && !['new', 'existing'].includes(events.recordKind))
    throw new Error(
      'form0: events.recordKind must be "new" or "existing" when lifecycle is enabled.'
    );
  const interactions = events.fieldInteractions ?? [];
  if (
    !Array.isArray(interactions) ||
    interactions.some((type) => !['focus', 'blur', 'click'].includes(type))
  )
    throw new Error('form0: events.fieldInteractions must select focus, blur or click.');
  return {
    lifecycle,
    recordKind: events.recordKind,
    fieldInteractions: [...new Set(interactions)],
  };
}

export function mergeCustomValidation(summary, findings = []) {
  const customIssues = findings.map((finding) => ({
    kind: 'custom',
    message: finding.message,
    instancePath: copyEventData(finding.instancePath || []),
  }));
  return {
    ...summary,
    hasErrors: Boolean(summary?.hasErrors || customIssues.length),
    requiredFieldErrors: [...(summary?.requiredFieldErrors || [])],
    generalErrors: [...(summary?.generalErrors || []), ...customIssues],
    orderedIssues: [...(summary?.orderedIssues || []), ...customIssues],
  };
}

function captureRequest(request) {
  const captured = copyEventData(request);
  if (
    !captured ||
    typeof captured !== 'object' ||
    Array.isArray(captured) ||
    captured instanceof Date
  )
    throw new Error('An event request object is required.');
  if (
    captured.scopeId !== undefined &&
    (typeof captured.scopeId !== 'string' || !captured.scopeId.trim())
  )
    throw new Error('scopeId must be a nonempty string.');
  if (captured.instancePath !== undefined && !Array.isArray(captured.instancePath))
    throw new Error('instancePath must be an array.');
  if (
    captured.metadata !== undefined &&
    (!captured.metadata ||
      typeof captured.metadata !== 'object' ||
      Array.isArray(captured.metadata) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(captured.metadata)))
  )
    throw new Error('Event metadata must be a plain object.');
  return captured;
}

const samePath = (left, right) =>
  Array.isArray(left) &&
  Array.isArray(right) &&
  left.length === right.length &&
  left.every((part, index) => {
    const other = right[index];
    return (
      part?.repeatableKey === other?.repeatableKey &&
      part?.identity === other?.identity &&
      (part?.identity === 'id' ? part.instanceId === other.instanceId : part.index === other.index)
    );
  });

const failure = (code, message, scope) => ({
  status: 'failed',
  eligible: false,
  payload: null,
  operations: [],
  validationIssues: [],
  issues: [{ code, message, instancePath: copyEventData(scope?.instancePath || []) }],
});

/** Await delegation and all defaults, rejecting fallback calls after their dispatch lifetime. */
export async function completeEventOperations(
  operations,
  meta,
  { delegate, applyDefault, isCurrent }
) {
  let open = true;
  const pending = [];
  const fallback = (selected = operations) => {
    if (!open || !isCurrent()) {
      const rejected = Promise.reject(new Error('Event operation dispatch has ended.'));
      rejected.catch(() => {});
      return rejected;
    }
    const work = Promise.resolve().then(() => {
      if (!isCurrent()) throw new Error('Event operation target has ended.');
      return applyDefault(selected, meta);
    });
    work.catch(() => {});
    pending.push(work);
    return work;
  };
  try {
    if (!isCurrent()) throw new Error('Event operation target has ended.');
    await (delegate
      ? delegate(copyEventData(operations), copyEventData(meta), fallback)
      : fallback());
    // Delegates may call fallback without returning its promise.
    for (let index = 0; index < pending.length; index++) await pending[index];
    if (!isCurrent()) throw new Error('Event operation target has ended.');
  } finally {
    open = false;
  }
}

export function createEventSession(configuration = {}) {
  const config = normalizeEventOptions(configuration);
  const scopes = new Map();
  let generation = 0;
  let active = false;
  let publicController = null;
  let rootScopeId = null;
  let tail = Promise.resolve();
  const saves = new Set();
  const current = (scope) =>
    active && scopes.get(scope.scopeId) === scope && scope.adapter.isCurrent();

  function resolve(request) {
    const path =
      request.instancePath ??
      (request.scopeId ? scopes.get(request.scopeId)?.instancePath : []) ??
      [];
    if (!Array.isArray(path)) return null;
    const scope = request.scopeId
      ? scopes.get(request.scopeId)
      : [...scopes.values()].find((entry) => samePath(entry.instancePath, path));
    if (!scope || !samePath(scope.instancePath, path) || !current(scope)) return null;
    if (path.some((part) => part?.identity === 'position') && request.scopeId !== scope.scopeId)
      return null;
    return scope;
  }
  function enqueue(epoch, work) {
    const next = tail.then(() =>
      active && epoch === generation
        ? work()
        : failure('stale_generation', 'This event controller has ended.')
    );
    tail = next.catch(() => {});
    return next;
  }
  async function execute(scope, type, fieldKey, metadata = {}) {
    if (!current(scope)) return failure('scope_closed', 'The target editor has ended.', scope);
    try {
      await scope.adapter.settle();
      if (!current(scope)) return failure('scope_closed', 'The target editor has ended.', scope);
      if (scope.instancePath.length) {
        const reads = {};
        const ancestors = [...scopes.values()]
          .filter(
            (entry) =>
              entry.instancePath.length < scope.instancePath.length &&
              samePath(entry.instancePath, scope.instancePath.slice(0, entry.instancePath.length))
          )
          .sort((a, b) => a.instancePath.length - b.instancePath.length);
        for (const ancestor of ancestors) {
          await ancestor.adapter.settle();
          if (!current(scope) || !current(ancestor))
            return failure('scope_closed', 'The target editor has ended.', scope);
          Object.assign(reads, ancestor.adapter.readableValues?.() || {});
        }
        await scope.adapter.refreshReads?.(reads);
      }
      const validating =
        type === (scope.instancePath.length ? 'validate-repeatable' : 'validate-record');
      if (validating || type === (scope.instancePath.length ? 'save-repeatable' : 'save-record')) {
        const state = await scope.adapter.read();
        metadata = {
          ...metadata,
          isDraft: metadata?.isDraft === true,
          isValid: !scope.adapter.validate(state).hasErrors,
        };
      }
      const detail = await scope.adapter.trigger(type, fieldKey, metadata);
      if (!current(scope)) return failure('scope_closed', 'The target editor has ended.', scope);
      if (type === (scope.instancePath.length ? 'validate-repeatable' : 'validate-record')) {
        scope.findings = copyEventData(detail.validationIssues || []);
        scope.dataSignature = scope.adapter.dataSignature();
        scope.adapter.onValidation(scope.findings);
      }
      if (detail.issues?.length) return { ...copyEventData(detail), status: 'failed' };
      if (detail.operations?.length)
        await scope.adapter.process(
          detail.operations,
          {
            eventType: type,
            fieldKey,
            metadata,
            scopeId: scope.scopeId,
            instancePath: scope.instancePath,
          },
          () => current(scope)
        );
      if (!current(scope)) return failure('scope_closed', 'The target editor has ended.', scope);
      if (typeof type === 'string' && type.startsWith('unload-')) {
        scope.adapter.endScope?.();
        retire(scope);
        if (!scope.instancePath.length) {
          active = false;
          generation++;
        }
      }
      return { ...copyEventData(detail), status: 'completed' };
    } catch (error) {
      if (type === (scope.instancePath.length ? 'validate-repeatable' : 'validate-record')) {
        scope.findings = [];
        scope.adapter.onValidation([]);
      }
      return failure('event_execution_failed', error?.message || 'Event execution failed.', scope);
    }
  }
  function retire(scope) {
    if (scopes.get(scope.scopeId) !== scope) return;
    if (scope.adapter.isCurrent()) scope.adapter.endScope?.();
    scopes.delete(scope.scopeId);
    scope.findings = [];
    scope.adapter.onValidation([]);
    for (const child of [...scopes.values()])
      if (
        child.instancePath.length > scope.instancePath.length &&
        samePath(scope.instancePath, child.instancePath.slice(0, scope.instancePath.length))
      )
        retire(child);
  }
  async function validate(scope, isDraft) {
    const state = await scope.adapter.read();
    const scoped = scope.adapter.recordCoordinator
      ? await scope.adapter.recordCoordinator.evaluate(scope.instancePath)
      : null;
    if (scoped && scoped.status !== 'evaluated')
      return {
        detail: failure(
          'record_evaluation_failed',
          scoped.issues?.[0]?.message || 'Scope evaluation failed.',
          scope
        ),
        summary: scope.adapter.validate(state),
        state,
        signature: scope.adapter.dataSignature(),
      };
    const intrinsic = scoped?.validationSummary || scope.adapter.validate(state);
    const detail = config.lifecycle
      ? await execute(
          scope,
          scope.instancePath.length ? 'validate-repeatable' : 'validate-record',
          scope.fieldKey,
          {
            isDraft,
            isValid: !intrinsic.hasErrors,
          }
        )
      : { status: 'completed', operations: [], validationIssues: [], issues: [] };
    return {
      detail,
      summary: mergeCustomValidation(intrinsic, detail.validationIssues),
      state,
      signature: scope.adapter.dataSignature(),
    };
  }
  async function prepare(scope, intent, request = {}) {
    try {
      await scope.adapter.settle();
      if (!current(scope)) return failure('scope_closed', 'The target editor has ended.', scope);
      if (!scope.adapter.canEdit())
        return failure('readonly_scope', 'The target editor is read-only.', scope);
      const draft = intent === 'draft';
      if (!scope.instancePath.length && scope.adapter.recordCoordinator) {
        const result = await scope.adapter.recordCoordinator.prepare(
          { ...request, intent },
          {
            managedEvents: config.lifecycle,
            saveHook: (summary) =>
              execute(scope, 'save-record', scope.fieldKey, {
                isDraft: draft,
                isValid: !summary.hasErrors,
              }),
            serialize: (snapshot, selectedIntent, summary) =>
              scope.adapter.serialize(snapshot, selectedIntent, summary),
          }
        );
        if (!current(scope)) return failure('scope_closed', 'The target editor has ended.', scope);
        scope.adapter.onPreparation?.(result);
        return result;
      }
      let validation = await validate(scope, draft);
      if (validation.detail.issues.length || (!draft && validation.summary.hasErrors))
        return {
          ...validation.detail,
          eligible: false,
          payload: null,
          validationSummary: validation.summary,
        };
      const signature = scope.adapter.dataSignature();
      const save = config.lifecycle
        ? await execute(
            scope,
            scope.instancePath.length ? 'save-repeatable' : 'save-record',
            scope.fieldKey,
            {
              isDraft: draft,
              isValid: !scope.adapter.validate(validation.state).hasErrors,
            }
          )
        : { status: 'completed', operations: [], validationIssues: [], issues: [] };
      if (save.issues.length)
        return { ...save, eligible: false, payload: null, validationSummary: validation.summary };
      if (signature !== scope.adapter.dataSignature()) validation = await validate(scope, draft);
      if (validation.detail.issues.length || (!draft && validation.summary.hasErrors))
        return {
          ...validation.detail,
          eligible: false,
          payload: null,
          validationSummary: validation.summary,
        };
      if (!current(scope)) return failure('scope_closed', 'The target editor has ended.', scope);
      if (!scope.adapter.canEdit())
        return failure('readonly_scope', 'The target editor is read-only.', scope);
      // Read after every accepted operation; payload and summary use this exact snapshot.
      const state = await scope.adapter.read();
      if (
        eventDataSignature(state.values) !== eventDataSignature(validation.state.values) ||
        scope.adapter.dataSignature() !== validation.signature
      )
        return failure(
          'values_changed',
          'Editable data changed during preparation; retry with the current values.',
          scope
        );
      const { payload, meta } = await scope.adapter.serialize(state, intent, validation.summary);
      if (!current(scope)) return failure('scope_closed', 'The target editor has ended.', scope);
      return {
        status: 'completed',
        eligible: true,
        payload: copyEventData(payload),
        meta: copyEventData(meta),
        validationSummary: copyEventData(validation.summary),
        issues: [],
      };
    } catch (error) {
      scope.adapter.recordCoordinator?.cancelPreparation();
      return failure(
        'save_preparation_failed',
        error?.message || 'Save preparation failed.',
        scope
      );
    }
  }
  function controller(epoch) {
    return Object.freeze({
      dispatch(request = {}) {
        let captured;
        try {
          captured = captureRequest(request);
        } catch (error) {
          return Promise.resolve(failure('invalid_request', error.message));
        }
        return enqueue(epoch, () => {
          const scope = resolve(captured);
          return scope
            ? execute(scope, captured.type, captured.fieldKey, captured.metadata)
            : failure('invalid_target', 'No active editor matches this event target.');
        });
      },
      prepareSave(request = {}) {
        let captured;
        try {
          if (!request || typeof request !== 'object' || Array.isArray(request))
            throw new Error('A request object is required.');
          const { signal, ...portable } = request;
          captured = captureRequest(portable);
          if (signal) {
            if (
              typeof signal.aborted !== 'boolean' ||
              typeof signal.addEventListener !== 'function'
            )
              throw new Error('signal must be an AbortSignal.');
            captured.signal = signal;
          }
        } catch (error) {
          return Promise.resolve(failure('invalid_request', error.message));
        }
        if (!['submit', 'draft'].includes(captured.intent))
          return Promise.resolve(failure('invalid_intent', 'Save intent must be submit or draft.'));
        const scope = resolve(captured);
        if (!scope)
          return Promise.resolve(
            failure('invalid_target', 'No active editor matches this save target.')
          );
        if (scope.instancePath.length && captured.intent === 'draft')
          return Promise.resolve(
            failure('unsupported_intent', 'Row drafts are not supported.', scope)
          );
        if (saves.has(scope))
          return Promise.resolve(
            failure('save_in_progress', 'Save preparation is already in progress.', scope)
          );
        saves.add(scope);
        return enqueue(epoch, () => prepare(scope, captured.intent, captured)).finally(() =>
          saves.delete(scope)
        );
      },
      async getSaveChanges(request = {}) {
        const scope = rootScopeId && scopes.get(rootScopeId);
        return active && epoch === generation && scope?.adapter.recordCoordinator
          ? scope.adapter.recordCoordinator.getSaveChanges(request)
          : failure('stale_generation', 'This event controller has ended.');
      },
      acknowledgeSave(request = {}) {
        const scope = rootScopeId && scopes.get(rootScopeId);
        return active && epoch === generation && scope?.adapter.recordCoordinator
          ? scope.adapter.recordCoordinator.acknowledgeSave(request)
          : failure('stale_generation', 'This event controller has ended.');
      },
    });
  }
  return {
    config,
    start() {
      active = true;
      generation++;
      tail = Promise.resolve();
      publicController = controller(generation);
      return publicController;
    },
    getController: () => publicController,
    end() {
      active = false;
      generation++;
      for (const scope of [...scopes.values()]) retire(scope);
    },
    register({ scopeId, instancePath = [], fieldKey, adapter }) {
      if (!instancePath.length && rootScopeId && rootScopeId !== scopeId) {
        generation++;
        tail = Promise.resolve();
        for (const entry of [...scopes.values()]) retire(entry);
        publicController = controller(generation);
      }
      if (!instancePath.length) rootScopeId = scopeId;
      const scope = {
        scopeId,
        instancePath: copyEventData(instancePath),
        fieldKey,
        adapter,
        findings: [],
        dataSignature: adapter.dataSignature(),
      };
      scopes.set(scopeId, scope);
      return {
        retire: () => retire(scope),
        dataChanged() {
          const signature = adapter.dataSignature();
          if (scope.dataSignature !== signature) {
            scope.dataSignature = signature;
            scope.findings = [];
            adapter.onValidation([]);
          }
        },
        change: (type, targetField, metadata, update) =>
          enqueue(generation, async () => {
            if (!current(scope))
              return failure('scope_closed', 'The target editor has ended.', scope);
            try {
              await update();
            } catch (error) {
              return failure(
                'value_update_failed',
                error?.message || 'Value update failed.',
                scope
              );
            }
            return execute(scope, type, targetField, metadata);
          }),
        dispatch: (type, metadata = {}, targetField = fieldKey) =>
          enqueue(generation, () => execute(scope, type, targetField, metadata)),
        prepare: (intent) => controller(generation).prepareSave({ intent, scopeId, instancePath }),
      };
    },
  };
}

/** Attribution reuses observed row identity; this helper never creates record IDs. */
export function repeatableChangeMetadata(
  controller,
  repeatableKey,
  instanceId,
  parentPath = [],
  action = 'edit',
  index = 0
) {
  const parents = parentPath.map((part) => ({
    repeatableKey: part.key,
    instanceId: part.id ?? null,
    identity: part.id == null ? 'position' : 'id',
    index: Number.isInteger(part.index) ? part.index : 0,
  }));
  const prefix = controller.diagnosticInstancePath || [];
  const includesPrefix =
    prefix.length &&
    prefix.every(
      (part, i) =>
        part.repeatableKey === parents[i]?.repeatableKey &&
        part.instanceId === parents[i]?.instanceId
    );
  return {
    action,
    affectedInstancePath: [
      ...(includesPrefix ? parents : [...prefix, ...parents]),
      {
        repeatableKey,
        instanceId: instanceId ?? null,
        identity: instanceId == null ? 'position' : 'id',
        index: Number.isInteger(index) && index >= 0 ? index : 0,
      },
    ],
  };
}
