/**
 * UI operation handlers for form0-cli
 * Handles UI-related operations like ALERT
 */

import { createAlertDialogContent } from '../dom-utils.js';

// Shared alert dialog background overlay
let alertDialogOverlay = null;

// Alert queue to handle multiple alerts
let alertQueue = [];
let isShowingAlert = false;

/**
 * Create or get the shared alert dialog overlay
 */
function getAlertDialogOverlay() {
  if (!alertDialogOverlay) {
    alertDialogOverlay = document.createElement('div');
    alertDialogOverlay.className = 'alert-dialog-overlay';
    alertDialogOverlay.style.display = 'none';
    document.body.appendChild(alertDialogOverlay);
  }
  return alertDialogOverlay;
}

/**
 * Show the next alert in the queue
 */
function showNextAlert() {
  if (!alertQueue.length) {
    isShowingAlert = false;
    return;
  }
  isShowingAlert = true;
  const item = alertQueue.shift();
  const overlay = getAlertDialogOverlay();
  const previousFocus = document.activeElement;
  overlay.innerHTML = '';
  const content = createAlertDialogContent(item.title, item.message);
  overlay.appendChild(content);
  overlay.style.display = 'flex';
  content.setAttribute('role', 'alertdialog');
  content.setAttribute('aria-modal', 'true');
  const originalButton = content.querySelector('.alert-dialog-ok-btn');
  const footer = originalButton.parentElement;
  const closeButton = content.querySelector('.alert-dialog-close');
  originalButton.remove();
  let input;
  if (item.input) {
    input = document.createElement('input');
    input.type = 'text';
    input.placeholder = item.placeholder || '';
    input.setAttribute('aria-label', item.placeholder || 'Response');
    content.insertBefore(input, footer);
  }
  let closed = false;
  const close = (response = { cancelled: true }) => {
    if (closed) return;
    closed = true;
    overlay.removeEventListener('click', outside);
    document.removeEventListener('keydown', keydown, true);
    overlay.style.display = 'none';
    overlay.innerHTML = '';
    item.resolve?.(response);
    previousFocus?.focus?.();
    showNextAlert();
  };
  const buttons = (item.buttons || [{ id: 'OK', label: 'OK' }]).map((definition) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'alert-dialog-ok-btn';
    button.textContent = definition.label;
    button.addEventListener('click', () =>
      close({ value: definition.id, input: input?.value || '' })
    );
    footer.appendChild(button);
    return button;
  });
  const outside = (event) => {
    if (event.target === overlay) close();
  };
  const keydown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
    if (event.key === 'Tab') {
      const targets = [closeButton, ...(input ? [input] : []), ...buttons];
      const index = targets.indexOf(document.activeElement);
      const next = (index + (event.shiftKey ? -1 : 1) + targets.length) % targets.length;
      event.preventDefault();
      targets[next].focus();
    }
  };
  closeButton.addEventListener('click', () => close());
  overlay.addEventListener('click', outside);
  document.addEventListener('keydown', keydown, true);
  (input || buttons[0]).focus();
}

/**
 * Handler for ALERT operation
 * Displays an alert dialog with title and message
 * @param {Object} params - Operation parameters
 * @param {string} params.title - The title to display
 * @param {string} params.message - The message to display
 * @param {FormStateManager} formStateManager - Form state manager instance
 */
function handleAlert(params, formStateManager) {
  const { title, message } = params;

  console.log(`[ALERT] ${title}: ${message}`);

  // Add to queue
  alertQueue.push({ title, message });

  // Show alert if none is currently showing
  if (!isShowingAlert) {
    showNextAlert();
  }
}

/**
 * Export UI operation handlers
 */
export const uiOperationHandlers = {
  ALERT: handleAlert,
  MESSAGEBOX: (params) =>
    new Promise((resolve) => {
      alertQueue.push({ ...params, resolve });
      if (!isShowingAlert) showNextAlert();
    }),
  // Future handlers will be added here:
  // CONFIRM: handleConfirm,
  // NOTIFY: handleNotify,
  // etc.
};
