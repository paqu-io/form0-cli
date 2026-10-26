import {
  cancelSubmissionReview,
  clearValidationFindings,
  renderValidationFindings,
} from './submission-review.js';
const copy = (value) => JSON.parse(JSON.stringify(value));
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

/** Preview-specific controls; portable validation and event execution remain server-side. */
export function createPreviewEventUI({
  client,
  renderer,
  stateManager,
  translate,
  showError,
  clearError = () => {},
  onReopen = () => {},
  onWarnings = () => {},
  onPrepared = () => {},
  onStatus = () => {},
  diagnostics,
}) {
  let configuration = {
    lifecycle: false,
    recordKind: 'new',
    readonly: false,
    fieldInteractions: [],
  };
  let controller = null,
    intent = 0;
  let sessionGeneration = 0;
  const controls = new Map();
  const preferenceKey = 'form0-preview-events';
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(preferenceKey) || 'null');
    if (
      value &&
      ['new', 'existing'].includes(value.recordKind) &&
      Array.isArray(value.fieldInteractions)
    )
      configuration = {
        ...configuration,
        ...value,
        fieldInteractions: value.fieldInteractions.filter((type) =>
          ['focus', 'blur', 'click'].includes(type)
        ),
      };
  } catch {
    /* A missing preference keeps opt-in disabled. */
  }
  const target = (path) => {
    const instancePath = client.resolvePath(path);
    const scope = client.getScopes().find((item) => samePath(item.instancePath, instancePath));
    return { instancePath, scopeId: scope?.scopeId };
  };
  const report = (result) => {
    if (result?.notificationIssues?.length)
      showError(result.notificationIssues.map((issue) => issue.message).join('\n'));
    if (result?.issues?.length) showError(result.issues.map((issue) => issue.message).join('\n'));
    if (result?.validationSummary?.hasErrors) showError(formatSummary(result.validationSummary));
    return result;
  };
  async function navigateFinding(issue) {
    const path = issue.instancePath || [];
    for (let depth = 1; depth <= path.length; depth++) {
      const targetPath = path.slice(0, depth);
      if (client.getScopes().some((scope) => samePath(scope.instancePath, targetPath))) continue;
      const parentScope = client
        .getScopes()
        .find((scope) => samePath(scope.instancePath, path.slice(0, depth - 1)));
      if (!parentScope) return;
      const result = await client.request({
        action: 'open-row',
        instancePath: targetPath,
        parentScopeId: parentScope.scopeId,
      });
      if (result.issues?.length) {
        report(result);
        return;
      }
    }
    let record = client.getState();
    const context = [];
    for (const part of path) {
      const rows = record?.repeatable?.[part.repeatableKey] || [];
      const index =
        part.identity === 'id'
          ? rows.findIndex((row) => (row.id ?? row.record_id) === part.instanceId)
          : part.index;
      if (index < 0) return;
      context.push({ key: part.repeatableKey, index });
      record = rows[index];
    }
    const target = [...renderer.getFieldInstanceRegistry().values()].find(
      (entry) =>
        (!issue.fieldName || entry.field.data_name === issue.fieldName) &&
        JSON.stringify(entry.contextPath) === JSON.stringify(context)
    );
    let container = issue.fieldName
      ? target?.container
      : !path.length
        ? document.querySelector('#form-container, #form-content, form') ||
          document.getElementById('submit-container')?.parentElement
        : null;
    if (!container && path.length)
      container = [...document.querySelectorAll('[data-repeatable-context]')].find(
        (node) =>
          JSON.stringify(renderer.parseContextKey(node.getAttribute('data-repeatable-context'))) ===
          JSON.stringify(context)
      );
    if (!container) return;
    for (let ancestor = container.parentElement; ancestor; ancestor = ancestor.parentElement)
      if (ancestor.tagName === 'DETAILS') ancestor.open = true;
    container.scrollIntoView?.({ block: 'center' });
    const input = issue.fieldName
      ? container.querySelector('input, textarea, select, button')
      : null;
    if (input) input.focus();
    else {
      container.tabIndex = -1;
      container.focus();
    }
  }
  function formatSummary(summary) {
    if (summary.orderedIssues?.length > 50)
      return translate('freshness.validationCount', { count: summary.orderedIssues.length });
    return (
      summary.orderedIssues || [
        ...(summary.requiredFieldErrors || []),
        ...(summary.generalErrors || []),
      ]
    )
      .map((issue) => {
        const path = (issue.instancePath || [])
          .map(
            (part) => part.repeatableKey + '[' + (part.instanceId ?? 'position ' + part.index) + ']'
          )
          .join(' / ');
        return [path, issue.fieldName, issue.errorMessage || issue.message]
          .filter(Boolean)
          .join(': ');
      })
      .join('\n');
  }
  async function action(request) {
    return report(await client.request(request));
  }
  const hooks = {
    translate,
    edit: (path) =>
      action({
        action: 'open-row',
        ...target(path),
        parentScopeId: target(path.slice(0, -1)).scopeId,
      }),
    save: (path) => action({ action: 'accept-row', intent: 'submit', ...target(path) }),
    async cancel(path) {
      if (globalThis.confirm(translate('previewEvents.confirmCancel')))
        return action({ action: 'cancel', ...target(path) });
    },
    add(section, parentPath) {
      const parent = target(parentPath);
      const data = client.getState();
      let node = data;
      for (const part of parentPath) node = node?.repeatable?.[part.key]?.[part.index];
      const key = renderer.getPreferredKey(section),
        index = node?.repeatable?.[key]?.length || 0;
      const row = renderer.createEmptyRepeatableInstance(section);
      const instancePath = [
        ...parent.instancePath,
        {
          repeatableKey: key,
          instanceId: row.id ?? row.record_id ?? null,
          index,
          identity: row.id == null ? 'position' : 'id',
        },
      ];
      return action({
        action: 'open-row',
        recordKind: 'new',
        instancePath,
        parentScopeId: parent.scopeId,
        row,
      });
    },
    remove(section, parentPath, index) {
      const affectedPath = client.resolvePath([
        ...parentPath,
        { key: renderer.getPreferredKey(section), index },
      ]);
      return action({
        action: 'remove-row',
        ...target(parentPath),
        affectedPath,
        targetScopeId: target([...parentPath, { key: renderer.getPreferredKey(section), index }])
          .scopeId,
      });
    },
  };
  function refreshControls(state) {
    const activeScopes = client.getScopes();
    for (const { field, contextPath, container } of renderer.getFieldInstanceRegistry().values()) {
      const chosen = target(contextPath);
      const opened = activeScopes.some((scope) => scope.scopeId === chosen.scopeId);
      const node = stateManager.getNodeState(state, contextPath);
      stateManager.updateFieldReadOnly(
        field,
        container,
        configuration.readonly ||
          !controller ||
          !opened ||
          node?.read_only?.[field.data_name] === true
      );
    }
    for (const row of document.querySelectorAll('[data-repeatable-context]')) {
      const path = renderer.parseContextKey(row.getAttribute('data-repeatable-context'));
      const scope = target(path);
      const opened = Boolean(scope.scopeId);
      const parent = target(path.slice(0, -1));
      row.dataset.previewScopeId = scope.scopeId || '';
      for (const button of row.querySelectorAll('[data-preview-row-action]')) {
        if (button.closest('[data-repeatable-context]') !== row) continue;
        const type = button.dataset.previewRowAction;
        const command = client.bindRequest(
          type === 'edit'
            ? { action: 'open-row', ...scope, parentScopeId: parent.scopeId }
            : { action: type === 'save' ? 'accept-row' : 'cancel', intent: 'submit', ...scope }
        );
        button.onclick = async () => {
          if (type === 'cancel' && !globalThis.confirm(translate('previewEvents.confirmCancel')))
            return;
          report(await command());
        };
        button.hidden = type === 'edit' ? opened : !opened;
        button.disabled =
          configuration.readonly || !controller || !target(path.slice(0, -1)).scopeId;
      }
      const remove = row.querySelector('.repeatable-instance-remove');
      if (remove) {
        remove.disabled = configuration.readonly || !controller || !parent.scopeId;
        const command = client.bindRequest({
          action: 'remove-row',
          ...parent,
          affectedPath: scope.instancePath,
          targetScopeId: scope.scopeId,
        });
        remove.onclick = async () => report(await command());
      }
    }
    for (const add of document.querySelectorAll('.repeatable-add-button')) {
      const parent = add.closest('[data-repeatable-context]');
      const path = parent
        ? renderer.parseContextKey(parent.getAttribute('data-repeatable-context'))
        : [];
      add.disabled = configuration.readonly || !controller || !target(path).scopeId;
      const parentScope = target(path);
      const section = add._previewSection;
      const command = client.bindRequest(() => {
        if (!client.getScopes().some((scope) => scope.scopeId === parentScope.scopeId))
          throw new Error('The parent editor has ended.');
        let node = client.getState();
        for (const part of parentScope.instancePath) {
          const rows = node?.repeatable?.[part.repeatableKey] || [];
          node =
            part.identity === 'id'
              ? rows.find((row) => (row.id ?? row.record_id) === part.instanceId)
              : rows[part.index];
        }
        const key = renderer.getPreferredKey(section),
          index = node?.repeatable?.[key]?.length || 0,
          row = renderer.createEmptyRepeatableInstance(section);
        return {
          action: 'open-row',
          recordKind: 'new',
          parentScopeId: parentScope.scopeId,
          row,
          instancePath: [
            ...parentScope.instancePath,
            {
              repeatableKey: key,
              instanceId: row.id ?? row.record_id ?? null,
              index,
              identity: row.id == null ? 'position' : 'id',
            },
          ],
        };
      });
      add.onclick = async () => report(await command());
    }
    const status = document.getElementById('record-metadata-status');
    if (status)
      status.disabled =
        configuration.readonly ||
        !controller ||
        !activeScopes.some((scope) => !scope.instancePath.length);
    const reopen = document.getElementById('preview-reopen');
    if (reopen) reopen.hidden = activeScopes.some((scope) => !scope.instancePath.length);
    const submit = document.getElementById('submit-btn');
    if (submit)
      submit.disabled =
        configuration.readonly ||
        !controller ||
        !activeScopes.some((scope) => !scope.instancePath.length);
    for (const name of ['draft', 'cancel', 'close']) {
      const button = document.getElementById('preview-' + name);
      if (button)
        button.disabled =
          !activeScopes.some((scope) => !scope.instancePath.length) ||
          (name === 'draft' && configuration.readonly);
    }
  }
  return {
    get rendererHooks() {
      return hooks;
    },
    get configuration() {
      return copy(configuration);
    },
    get controller() {
      return controller;
    },
    get enabled() {
      return true;
    },
    formatSummary,
    settings() {
      const group = document.createElement('fieldset');
      const legend = document.createElement('legend');
      legend.textContent = translate('previewEvents.settings');
      group.appendChild(legend);
      for (const [key, type, label] of [
        ['lifecycle', 'checkbox', 'enable'],
        ['recordKind', 'select', 'recordKind'],
        ['readonly', 'checkbox', 'readonly'],
        ['focus', 'checkbox', 'focus'],
        ['blur', 'checkbox', 'blur'],
        ['click', 'checkbox', 'click'],
      ]) {
        const wrapper = document.createElement('label');
        wrapper.textContent = translate('previewEvents.' + label) + ' ';
        const input = document.createElement(type === 'select' ? 'select' : 'input');
        input.id = 'settings-preview-' + key;
        if (type === 'select')
          for (const kind of ['new', 'existing']) {
            const option = document.createElement('option');
            option.value = kind;
            option.textContent = translate('previewEvents.' + kind);
            input.appendChild(option);
          }
        else input.type = type;
        wrapper.appendChild(input);
        group.appendChild(wrapper);
        group.appendChild(document.createElement('br'));
        controls.set(key, input);
      }
      this.resetSettings();
      return group;
    },
    resetSettings() {
      for (const [key, input] of controls)
        if (key === 'recordKind') input.value = configuration[key];
        else
          input.checked = ['focus', 'blur', 'click'].includes(key)
            ? configuration.fieldInteractions.includes(key)
            : configuration[key];
    },
    saveSettings() {
      const previous = JSON.stringify(configuration);
      configuration = {
        lifecycle: controls.get('lifecycle').checked,
        recordKind: controls.get('recordKind').value,
        readonly: controls.get('readonly').checked,
        fieldInteractions: ['focus', 'blur', 'click'].filter((key) => controls.get(key).checked),
      };
      try {
        globalThis.localStorage?.setItem(preferenceKey, JSON.stringify(configuration));
      } catch {
        /* Preferences remain usable without storage. */
      }
      return previous !== JSON.stringify(configuration);
    },
    async start(state, recordOptions) {
      cancelSubmissionReview();
      clearValidationFindings();
      const epoch = ++sessionGeneration;
      renderer.setManagedPreview(hooks);
      intent++;
      const started = await client.start(configuration, state, recordOptions);
      if (epoch !== sessionGeneration || !started.controller) return started.result || started;
      controller = started.controller || null;
      globalThis.form0PreviewEvents = controller;
      stateManager.managedUpdate = (snapshot) => this.update(snapshot);
      const container = document.getElementById('submit-container');
      let reopen = document.getElementById('preview-reopen');
      if (!reopen) {
        reopen = document.createElement('button');
        reopen.id = 'preview-reopen';
        reopen.type = 'button';
        container.appendChild(reopen);
      }
      reopen.textContent = translate('previewEvents.reopen');
      reopen.onclick = onReopen;
      reopen.hidden = true;
      const preparedController = controller;
      const cancelRecord = client.bindRequest({ action: 'cancel', ...target([]) });
      const closeRecord = client.bindRequest({
        action: 'dispatch',
        type: 'unload-record',
        ...target([]),
      });
      for (const [name, key, run] of [
        [
          'draft',
          'draft',
          async () => {
            const result = report(await preparedController.prepareSave({ intent: 'draft' }));
            if (result.eligible)
              console.info(
                '[form0] ' +
                  translate('previewEvents.draftPrepared') +
                  '\n' +
                  JSON.stringify(result, null, 2)
              );
          },
        ],
        [
          'cancel',
          'cancelRecord',
          async () => {
            if (globalThis.confirm(translate('previewEvents.confirmCancel')))
              report(await cancelRecord());
          },
        ],
        ['close', 'closeRecord', async () => report(await closeRecord())],
      ]) {
        let button = document.getElementById('preview-' + name);
        if (!button) {
          button = document.createElement('button');
          button.type = 'button';
          button.id = 'preview-' + name;
          container.appendChild(button);
        }
        button.textContent = translate('previewEvents.' + key);
        button.onclick = run;
        button.hidden = false;
      }
      refreshControls(client.getState());
      return report(started.result || started);
    },
    dispose() {
      cancelSubmissionReview();
      clearValidationFindings();
      sessionGeneration++;
      client.dispose();
      controller = null;
      globalThis.form0PreviewEvents = null;
      stateManager.managedUpdate = null;
      stateManager.customValidation = [];
      for (const id of ['draft', 'cancel', 'close', 'reopen']) {
        const button = document.getElementById('preview-' + id);
        if (button) button.hidden = true;
      }
    },
    async update(snapshot, fieldKey = null, contextPath = []) {
      clearValidationFindings();
      stateManager.customValidation = [];
      clearError();
      const uiIntent = ++intent;
      const selected = target(contextPath);
      let node = snapshot;
      for (const part of contextPath) node = node?.repeatable?.[part.key]?.[part.index];
      const instance = renderer
        .getFieldInstanceRegistry()
        .get(`${renderer.formatContextPath(contextPath)}::${fieldKey}`);
      if (instance)
        stateManager.updateFieldPresenceFeedback(
          instance.field,
          instance.container,
          node?.values?.[fieldKey]
        );
      const values = node?.values || {};
      return report(
        await client.request({
          action: 'update',
          ...selected,
          // Other fields may already contain newer results from an earlier queued handler.
          values:
            fieldKey && Object.hasOwn(values, fieldKey) ? { [fieldKey]: values[fieldKey] } : values,
          fieldKey,
          uiIntent,
        })
      );
    },
    interaction(type, fieldKey, contextPath = []) {
      const selected = target(contextPath);
      if (configuration.fieldInteractions.includes(type) && controller && selected.scopeId)
        return action({ action: 'dispatch', type, fieldKey, ...selected });
    },
    async accept(result, request = {}) {
      if (request.uiIntent && request.uiIntent < intent) return;
      if (result.scopes && !result.scopes.some((scope) => !scope.instancePath.length)) {
        controller = null;
        globalThis.form0PreviewEvents = null;
      }
      let pending = document.getElementById('preview-pending-freshness');
      if (!pending) {
        pending = document.createElement('p');
        pending.id = 'preview-pending-freshness';
        pending.setAttribute('role', 'status');
        document.getElementById('submit-container')?.prepend(pending);
      }
      if (Object.hasOwn(result, 'persistedFreshness'))
        pending.textContent =
          result.persistedFreshness?.status === 'pending' ? translate('freshness.pending') : '';
      if (result.validationSummary)
        renderValidationFindings(result.validationSummary, {
          translate,
          onSelect: navigateFinding,
        });
      onWarnings(result.warnings || []);
      if (result.retiredScopes?.length) diagnostics?.retireScopes?.(result.retiredScopes);
      if (result.state) {
        renderer.applyManagedRepeatableState(result.state.repeatable || {});
        stateManager.applyFormState(result.state, { conditionsOnly: true });
        // Synchronize each actual field instance once, before validating its displayed value.
        // An unchanged value must not erase transient UI such as selecting Other before typing.
        for (const { field, contextPath, container } of renderer
          .getFieldInstanceRegistry()
          .values()) {
          const node = stateManager.getNodeState(result.state, contextPath);
          const value = node?.values?.[field.data_name];
          stateManager.updateFieldVisibility(container, node?.visible?.[field.data_name]);
          if (
            Object.hasOwn(node?.values || {}, field.data_name) &&
            JSON.stringify(stateManager.readFieldValue(field, container)) !== JSON.stringify(value)
          )
            stateManager.updateFieldValue(field, container, value, true);
          stateManager.updateFieldValidation(
            field,
            container,
            value,
            node?.required?.[field.data_name],
            node?.errors?.[field.data_name]
          );
        }
        stateManager.customValidation = copy(result.customValidation || []);
        onStatus(result.state.values);
        refreshControls(result.state);
      }
      if (result.eligible && !request.instancePath?.length && result.meta?.timestamps)
        onPrepared(result.meta.timestamps);
      if (result.diagnostics) diagnostics?.accept(diagnostics.beginEvaluation(), result);
      if (result.customValidation?.length)
        showError(formatSummary({ generalErrors: result.customValidation }));
      else if (!result.issues?.length && !result.validationSummary?.hasErrors) clearError();
    },
  };
}
