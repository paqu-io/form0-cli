const clone = (value) =>
  JSON.parse(
    JSON.stringify(value, (_key, entry) => {
      if (
        ['function', 'symbol', 'bigint'].includes(typeof entry) ||
        (entry &&
          typeof entry === 'object' &&
          !Array.isArray(entry) &&
          ![Object.prototype, null].includes(Object.getPrototypeOf(entry)))
      )
        throw new Error(
          'Preview requests must contain JSON data; native files and executable configuration are unsupported.'
        );
      return entry;
    })
  );
const failure = (code, message) => ({
  status: 'failed',
  eligible: false,
  payload: null,
  operations: [],
  validationIssues: [],
  issues: [{ code, message, instancePath: [] }],
});
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

/** Transport only: core executes on the server; presentation and request lifetime stay here. */
export function createPreviewEventClient({
  fetch: requestFetch = globalThis.fetch,
  accept = () => {},
  present = async () => {},
  getRecordOptions = () => undefined,
} = {}) {
  let generation = 0,
    current = null,
    tail = Promise.resolve();
  const saves = new Set();
  let lastCommittedState = null;
  const scopes = () => current?.scopes || [];
  const target = (request) =>
    scopes().find(
      (scope) =>
        (!request.scopeId || request.scopeId === scope.scopeId) &&
        samePath(
          scope.instancePath,
          request.instancePath ??
            (request.scopeId
              ? scopes().find((item) => item.scopeId === request.scopeId)?.instancePath
              : []) ??
            []
        )
    );
  async function send(path, body) {
    const response = await requestFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Preview request failed.');
    return data;
  }
  function enqueue(epoch, request) {
    let captured;
    try {
      captured = clone(request);
      if (!captured || typeof captured !== 'object' || Array.isArray(captured))
        throw new Error('A request object is required.');
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
          Array.isArray(captured.metadata))
      )
        throw new Error('Metadata must be an object.');
    } catch (error) {
      return Promise.resolve(failure('invalid_request', error.message));
    }
    const next = tail.then(async () => {
      if (epoch !== generation || !current)
        return failure('stale_generation', 'This preview controller has ended.');
      const session = current;
      let chosen = target(captured);
      if (captured.action !== 'open-row' && !chosen)
        return failure('invalid_target', 'No active editor matches this target.');
      if (
        chosen?.instancePath.some((part) => part.identity === 'position') &&
        captured.scopeId !== chosen.scopeId
      )
        return failure('invalid_target', 'Positional targets require the observed scopeId.');
      const sequence = ++session.sequence;
      try {
        const result = await send('/api/preview-events', {
          ...captured,
          sessionId: session.sessionId,
          sequence,
          scopeId: chosen?.scopeId,
          instancePath: captured.instancePath ?? chosen?.instancePath ?? [],
        });
        if (
          epoch === generation &&
          current === session &&
          result.issues?.some((issue) => issue.code === 'stale_generation')
        ) {
          const retiredScopes = clone(session.scopes);
          lastCommittedState = clone(session.committedState);
          session.scopes = [];
          current = null;
          generation++;
          await accept(
            {
              ...result,
              state: session.state,
              scopes: [],
              retiredScopes,
              diagnostics: [],
              customValidation: [],
            },
            captured
          );
          return clone(result);
        }
        if (
          epoch !== generation ||
          current !== session ||
          result.sessionId !== session.sessionId ||
          result.sequence !== sequence
        )
          return failure('stale_generation', 'Obsolete preview response.');
        session.scopes = result.scopes || session.scopes;
        if (result.state) session.state = clone(result.state);
        if (result.committedState) session.committedState = clone(result.committedState);
        await accept(clone(result), captured);
        if (epoch !== generation || current !== session)
          return failure('stale_generation', 'Preview state target has ended.');
        await present(result.presentations || []);
        if (epoch !== generation || current !== session)
          return failure('stale_generation', 'Preview presentation has ended.');
        return clone(result);
      } catch (error) {
        return failure('preview_request_failed', error.message);
      }
    });
    tail = next.catch(() => {});
    return next;
  }
  function controller(epoch) {
    return Object.freeze({
      dispatch(request = {}) {
        if (!request || typeof request !== 'object' || Array.isArray(request))
          return Promise.resolve(failure('invalid_request', 'A request object is required.'));
        return enqueue(epoch, { ...request, action: 'dispatch' });
      },
      prepareSave(request = {}) {
        if (!request || typeof request !== 'object' || Array.isArray(request))
          return Promise.resolve(failure('invalid_request', 'A request object is required.'));
        const chosen = target(request);
        const key = chosen?.scopeId || 'root';
        if (saves.has(key))
          return Promise.resolve(
            failure('save_in_progress', 'Save preparation is already in progress.')
          );
        saves.add(key);
        let recordOptions;
        try {
          recordOptions = getRecordOptions();
        } catch (error) {
          saves.delete(key);
          return Promise.resolve(failure('invalid_request', error.message));
        }
        return enqueue(epoch, {
          ...request,
          recordOptions: recordOptions ?? request.recordOptions,
          action: 'prepare',
        }).finally(() => saves.delete(key));
      },
    });
  }
  return {
    async start(configuration, state, recordOptions = {}) {
      const captured = clone({ configuration, state, recordOptions });
      this.dispose();
      const epoch = generation;
      const result = await send('/api/preview-session', captured);
      if (epoch !== generation) {
        send('/api/preview-dispose', { sessionId: result.sessionId }).catch(() => {});
        return failure('stale_generation', 'Obsolete preview initialization.');
      }
      current = {
        sessionId: result.sessionId,
        sequence: 0,
        scopes: result.scopes || [],
        state: clone(result.state),
        committedState: clone(result.committedState || result.state),
        configuration: clone(configuration),
      };
      await accept(clone(result));
      if (epoch !== generation)
        return failure('stale_generation', 'Obsolete preview initialization.');
      await present(result.presentations || []);
      if (epoch !== generation)
        return failure('stale_generation', 'Obsolete preview initialization.');
      return { result, controller: controller(epoch) };
    },
    dispose() {
      const previous = current;
      if (previous) lastCommittedState = clone(previous.committedState);
      current = null;
      generation++;
      tail = Promise.resolve();
      saves.clear();
      if (previous) send('/api/preview-dispose', { sessionId: previous.sessionId }).catch(() => {});
    },
    request(request) {
      return enqueue(generation, request);
    },
    bindRequest(request) {
      const epoch = generation;
      const captured = typeof request === 'function' ? request : clone(request);
      return () => {
        if (epoch !== generation || !current)
          return Promise.resolve(failure('stale_generation', 'This preview control has ended.'));
        try {
          return enqueue(epoch, typeof captured === 'function' ? captured() : captured);
        } catch (error) {
          return Promise.resolve(failure('invalid_request', error.message));
        }
      };
    },
    getState: () => (current ? clone(current.state) : null),
    getCommittedState: () =>
      current
        ? clone(current.committedState)
        : lastCommittedState
          ? clone(lastCommittedState)
          : null,
    getScopes: () => clone(scopes()),
    isActive: () => Boolean(current),
    resolvePath(contextPath = []) {
      let node = current?.state;
      return contextPath.map((part) => {
        const row = node?.repeatable?.[part.key]?.[part.index];
        const id = row?.id ?? row?.record_id ?? null;
        node = row;
        return {
          repeatableKey: part.key,
          instanceId: id,
          index: part.index,
          identity: id == null ? 'position' : 'id',
        };
      });
    },
  };
}
