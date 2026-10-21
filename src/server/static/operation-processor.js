/**
 * Central operation processor for handling form operations
 * Routes operations to appropriate handlers based on type and operation name
 */
export class OperationProcessor {
  constructor(formStateManager) {
    this.formStateManager = formStateManager;
    this.handlers = new Map();
    this.ready = this.registerDefaultHandlers();
  }

  /**
   * Register default operation handlers
   */
  async registerDefaultHandlers() {
    const [field, ui] = await Promise.all([
      import('./operation-handlers/field-operations.js'),
      import('./operation-handlers/ui-operations.js'),
    ]);
    for (const [type, defaults] of [
      ['FIELD_OPERATION', field.fieldOperationHandlers],
      ['UI_OPERATION', ui.uiOperationHandlers],
    ]) {
      for (const [name, handler] of Object.entries(defaults))
        if (!this.handlers.get(type)?.has(name)) this.registerHandler(type, name, handler);
    }
  }

  /**
   * Register handlers for a specific operation type
   * @param {string} type - The operation type (e.g., 'FIELD_OPERATION', 'UI_OPERATION')
   * @param {Object} handlers - Object containing handler functions
   */
  registerHandlers(type, handlers) {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Map());
    }

    const typeHandlers = this.handlers.get(type);
    Object.entries(handlers).forEach(([operation, handler]) => {
      typeHandlers.set(operation, handler);
    });
  }

  /**
   * Process an array of operations
   * @param {Array} operations - Array of operation objects
   * @returns {Promise<void>}
   */
  async processOperations(operations) {
    if (!operations || operations.length === 0) {
      return;
    }
    await this.ready;

    const canBatchEngine =
      this.formStateManager &&
      typeof this.formStateManager.suspendEngineUpdates === 'function' &&
      typeof this.formStateManager.resumeEngineUpdates === 'function';

    if (canBatchEngine) {
      this.formStateManager.suspendEngineUpdates();
    }

    try {
      // Apply all operations with state updates deferred
      for (const operation of operations) {
        await this.processOperation(operation, true); // skipStateUpdate = true
      }

      // Trigger a single engine refresh (will queue if suspended)
      this.formStateManager.updateFormState();
    } finally {
      if (canBatchEngine) {
        this.formStateManager.resumeEngineUpdates();
      }
    }
  }

  /** Managed values are already applied by the scoped server engine. Present each UI op once. */
  async processPresentations(operations = []) {
    await this.ready;
    for (const operation of operations) {
      const handler = this.handlers.get(operation.type)?.get(operation.operation);
      if (!handler || operation.type !== 'UI_OPERATION')
        throw new Error('Unsupported preview presentation: ' + operation.operation);
      await handler(operation.params, this.formStateManager);
    }
  }

  /**
   * Process a single operation
   * @param {Object} operation - Operation object with type, operation, and params
   * @param {boolean} skipStateUpdate - Whether to skip async state updates (default: false)
   * @returns {Promise<void>}
   */
  async processOperation(operation, skipStateUpdate = false) {
    try {
      const { type, operation: operationName, params } = operation;

      // Get handler for this operation type
      const typeHandlers = this.handlers.get(type);
      if (!typeHandlers) {
        console.warn(`No handlers registered for operation type: ${type}`);
        return;
      }

      // Get specific handler for this operation
      const handler = typeHandlers.get(operationName);
      if (!handler) {
        console.warn(`No handler registered for operation: ${type}.${operationName}`);
        return;
      }

      // Execute the handler, pass skipStateUpdate flag for SETVALUE operations
      if (operationName === 'SETVALUE' && skipStateUpdate) {
        await handler(params, this.formStateManager, skipStateUpdate);
      } else {
        await handler(params, this.formStateManager);
      }

      console.log(`🏁 [OPERATION] Processed ${type}.${operationName}`);
    } catch (error) {
      console.error(`🏁 [OPERATION] Error processing operation:`, error);
      console.error(`🏁 [OPERATION] Failed operation:`, operation);
    }
  }

  /**
   * Register a single handler for a specific operation
   * @param {string} type - The operation type
   * @param {string} operation - The operation name
   * @param {Function} handler - The handler function
   */
  registerHandler(type, operation, handler) {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Map());
    }

    this.handlers.get(type).set(operation, handler);
  }
}
