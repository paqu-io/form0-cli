/**
 * UI operation handlers for form0-cli
 * Handles UI-related operations like ALERT
 */

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
  if (alertQueue.length === 0) {
    isShowingAlert = false;
    return;
  }

  isShowingAlert = true;
  const { title, message } = alertQueue.shift();

  // Get shared overlay
  const overlay = getAlertDialogOverlay();

  // Clear any existing content
  overlay.innerHTML = '';

  // Create alert dialog content
  const dialogContent = document.createElement('div');
  dialogContent.className = 'alert-dialog-content';
  dialogContent.innerHTML = `
    <span class="alert-dialog-close" tabindex="0">&times;</span>
    <div class="alert-dialog-header">${title}</div>
    <div class="alert-dialog-text">${message}</div>
    <div class="alert-dialog-footer">
      <button class="alert-dialog-ok-btn" tabindex="0">OK</button>
    </div>
  `;

  // Add content to overlay
  overlay.appendChild(dialogContent);
  overlay.style.display = 'flex';

  // Focus management
  const okBtn = dialogContent.querySelector('.alert-dialog-ok-btn');
  const closeBtn = dialogContent.querySelector('.alert-dialog-close');

  // Focus the OK button initially
  okBtn.focus();

  // Event handlers
  function hideDialog() {
    overlay.style.display = 'none';
    overlay.innerHTML = '';
    showNextAlert(); // Show next alert in queue
  }

  // Close button
  closeBtn.addEventListener('click', hideDialog);
  closeBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') hideDialog();
  });

  // OK button
  okBtn.addEventListener('click', hideDialog);
  okBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') hideDialog();
  });

  // Click outside to close
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) hideDialog();
  });

  // Escape key to close
  document.addEventListener('keydown', function escapeHandler(e) {
    if (e.key === 'Escape') {
      hideDialog();
      document.removeEventListener('keydown', escapeHandler);
    }
  });
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
  // Future handlers will be added here:
  // CONFIRM: handleConfirm,
  // NOTIFY: handleNotify,
  // etc.
};
