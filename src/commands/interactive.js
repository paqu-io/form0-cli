import { SchemaManager } from './interactive/managers/schema-manager.js';
import { EngineRunner } from './interactive/runners/engine-runner.js';
import { FileWatcher } from './interactive/file-watcher.js';
import { ShellCore } from './interactive/shell-core.js';

/**
 * Main interactive command orchestrator
 * Coordinates all modules for the form0 interactive environment
 */
class Form0Interactive {
  constructor() {
    // Initialize all modules
    this.schemaManager = new SchemaManager();
    this.engineRunner = new EngineRunner(this.schemaManager);
    this.fileWatcher = new FileWatcher(this.schemaManager, this.engineRunner);
    this.shellCore = new ShellCore(this.schemaManager, this.engineRunner, this.fileWatcher);

    // Set up circular dependency for re-prompting
    this.fileWatcher.shellCore = this.shellCore;
  }

  /**
   * Start the interactive environment
   */
  async start() {
    await this.shellCore.start();
  }
}

/**
 * Entry point for the interactive command
 */
export async function interactiveCommand() {
  const interactive = new Form0Interactive();
  await interactive.start();
}
