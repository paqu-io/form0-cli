let activeReview = null;
export const cancelSubmissionReview = () => activeReview?.();
/** Bounded review presentation. Record calculation and selection remain server-owned. */
export function reviewSubmission(controller, review, schema, translate) {
  cancelSubmissionReview();
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    const title = document.createElement('h2');
    title.textContent = translate('freshness.review');
    const description = document.createElement('p');
    description.textContent =
      translate('freshness.description') + ' (' + review.childChangeCount + ')';
    const list = document.createElement('ol');
    list.style.maxHeight = '50vh';
    list.style.overflow = 'auto';
    const controls = document.createElement('div');
    const labels = new Map();
    const visit = (fields) => {
      for (const field of fields || []) {
        labels.set(field.data_name, field.label || field.data_name);
        visit(field.elements);
      }
    };
    visit(schema.form?.elements);
    let offset = 0,
      version = 0;
    const previousFocus = document.activeElement;
    const finish = (action) => {
      version++;
      activeReview = null;
      dialog.close();
      dialog.remove();
      previousFocus?.focus();
      resolve(action);
    };
    const button = (label, run) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.textContent = label;
      element.onclick = run;
      controls.append(element);
      return element;
    };
    const previous = button(translate('freshness.previous'), () => {
      offset = Math.max(0, offset - 50);
      void page();
    });
    const next = button(translate('freshness.next'), () => {
      offset += 50;
      void page();
    });
    async function page() {
      const current = ++version;
      const result = await controller.getSaveChanges({
        preparationId: review.preparationId,
        offset,
        limit: 50,
      });
      if (current !== version) return;
      if (result.issues?.length) {
        finish('cancel');
        return;
      }
      list.replaceChildren();
      for (const change of result.changes) {
        const item = document.createElement('li');
        const path = change.instancePath
          .map((part) => part.repeatableKey + '[' + (part.instanceId ?? part.index + 1) + ']')
          .join(' / ');
        item.textContent =
          (change.label ||
            [path, labels.get(change.fieldName) || change.fieldName].filter(Boolean).join(' / ')) +
          ': ' +
          JSON.stringify(change.before) +
          ' → ' +
          JSON.stringify(change.after);
        list.append(item);
      }
      previous.disabled = offset === 0;
      next.disabled = offset + result.changes.length >= result.total;
    }
    button(translate('freshness.refresh'), () => finish('refresh'));
    if (review.choices.includes('retain'))
      button(translate('freshness.retain'), () => finish('retain'));
    button(translate('freshness.cancel'), () => finish('cancel'));
    activeReview = () => finish('cancel');
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish('cancel');
    });
    dialog.append(title, description, list, controls);
    document.body.append(dialog);
    dialog.showModal();
    void page();
  });
}

export function clearValidationFindings() {
  document.getElementById('preview-validation-findings')?.remove();
}

/** Keep complete findings; render only one bounded page. */
export function renderValidationFindings(summary, { translate, onSelect }) {
  clearValidationFindings();
  const findings = summary?.orderedIssues || [
    ...(summary?.requiredFieldErrors || []),
    ...(summary?.generalErrors || []),
    ...(summary?.scopeIssues || []),
  ];
  if (!findings.length) return;
  const panel = document.createElement('section');
  panel.id = 'preview-validation-findings';
  const title = document.createElement('h3');
  title.textContent = translate('freshness.validationCount', { count: findings.length });
  const list = document.createElement('ol');
  const controls = document.createElement('div');
  let offset = 0;
  const button = (text, action) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = text;
    node.onclick = action;
    controls.append(node);
    return node;
  };
  const previous = button(translate('freshness.previous'), () => {
    offset = Math.max(0, offset - 50);
    page();
  });
  const next = button(translate('freshness.next'), () => {
    offset += 50;
    page();
  });
  function page() {
    list.replaceChildren();
    for (const issue of findings.slice(offset, offset + 50)) {
      const item = document.createElement('li');
      const path = (issue.instancePath || [])
        .map((part) => part.repeatableKey + '[' + (part.instanceId ?? part.index + 1) + ']')
        .join(' / ');
      const action = document.createElement('button');
      action.type = 'button';
      action.textContent = [
        path,
        issue.field?.label || issue.fieldName || translate('freshness.record'),
        issue.message || issue.errorMessage,
      ]
        .filter(Boolean)
        .join(': ');
      action.onclick = () => {
        void onSelect(issue);
      };
      item.append(action);
      list.append(item);
    }
    previous.disabled = !offset;
    next.disabled = offset + 50 >= findings.length;
  }
  panel.append(title, list, controls);
  document.getElementById('submit-container')?.after(panel);
  page();
}
