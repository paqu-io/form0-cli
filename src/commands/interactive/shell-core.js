import readline from 'readline';
import chalk from 'chalk';
import { BRAND_COLOR, READLINE_CONFIG } from '../../utils/constants.js';
import { showWelcomeBanner, showHelp, showStatus } from '../../utils/display-utils.js';
import { completer } from '../../utils/completion-utils.js';
import { testCommand } from '../test.js';

/**
 * Manages the interactive shell core functionality
 */
export class ShellCore {
  constructor(schemaManager, engineRunner, fileWatcher) {
    this.schemaManager = schemaManager;
    this.engineRunner = engineRunner;
    this.fileWatcher = fileWatcher;
    this.rl = null;
  }

  /**
   * Initialize the readline interface
   */
  initializeReadline() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.hex(BRAND_COLOR)('form0> '),
      completer: completer, // Enable tab completion
      history: [], // Enable command history (↑/↓ arrows)
      historySize: READLINE_CONFIG.historySize
    });
  }

  /**
   * Start the interactive shell
   */
  async start() {
    this.initializeReadline();
    
    showWelcomeBanner();
    console.log(chalk.hex(BRAND_COLOR).bold('🚀 Welcome to form0 interactive environment'));
    console.log(chalk.gray('Type "help" for available commands or "exit" to quit\n'));
    
    // Smart initialization: Auto-load schema or offer to initialize
    await this.schemaManager.smartInit();
    
    this.rl.prompt();
    
    this.rl.on('line', async (input) => {
      const trimmed = input.trim();
      if (trimmed) {
        await this.handleCommand(trimmed);
      }
      this.rl.prompt();
    });

    this.rl.on('close', () => {
      this.cleanup();
      console.log(chalk.hex(BRAND_COLOR).bold('\n🦙 Hasta pronto! 🦙'));
      process.exit(0);
    });
  }

  /**
   * Handle incoming commands
   */
  async handleCommand(input) {
    const [command, ...args] = input.split(' ');
    
    try {
      switch (command.toLowerCase()) {
        case 'help':
        case 'h':
          showHelp();
          break;
        
        case 'init':
          await this.schemaManager.handleInitCommand(args);
          break;
          
        case 'load':
        case 'l':
          if (!args[0]) {
            console.log(chalk.red('❌ Usage: load <schema-file>'));
            return;
          }
          await this.schemaManager.loadSchema(args[0]);
          // Reset engine when schema changes
          this.engineRunner.resetEngine();
          console.log(chalk.green(`✅ Loaded schema: ${args[0]}`));
          break;
          
        case 'preview':
        case 'p':
          this.schemaManager.previewSchema();
          break;
          
        case 'run':
        case 'r':
          await this.engineRunner.runEngine(args);
          break;
          
        case 'validate':
        case 'v':
          this.schemaManager.validateCurrentSchema();
          break;
          
        case 'test':
        case 't':
          try {
            const dir = args[0] || '.';
            await testCommand(dir);
          } catch (err) {
            console.log(chalk.red(`❌ Test failed: ${err.message}`));
          }
          break;
          
        case 'status':
        case 's':
          this.showStatus();
          break;
          
        case 'values':
          this.engineRunner.showValues();
          break;
          
        case 'fields':
        case 'f':
          this.engineRunner.showValidFields();
          break;
          
        case 'reload':
        case 'rld':
          try {
            await this.schemaManager.reloadSchema();
            // Reset engine when schema changes
            this.engineRunner.resetEngine();
            console.log(chalk.green(`✅ Reloaded schema: ${this.schemaManager.getCurrentSchemaPath()}`));
          } catch (err) {
            console.log(chalk.red(`❌ ${err.message}`));
          }
          break;
          
        case 'watch':
        case 'w':
          await this.fileWatcher.handleWatchCommand(args);
          break;
          
        case 'clear':
        case 'cls':
          if (args[0] === 'values') {
            this.engineRunner.clearValues();
          } else {
            console.clear();
          }
          break;
          
        case 'exit':
        case 'quit':
        case 'q':
          this.rl.close();
          break;
          
        default:
          console.log(chalk.red(`❌ Unknown command: ${command}`));
          console.log(chalk.gray('Type "help" for available commands'));
      }
    } catch (err) {
      console.log(chalk.red(`❌ Error: ${err.message}`));
    }
  }

  /**
   * Show comprehensive session status
   */
  showStatus() {
    const sessionInfo = {
      currentSchemaPath: this.schemaManager.getCurrentSchemaPath(),
      currentSchema: this.schemaManager.getCurrentSchema(),
      engine: this.engineRunner.getEngine(),
      isWatching: this.fileWatcher.isCurrentlyWatching(),
      watchOptions: this.fileWatcher.getWatchOptions(),
      lastValues: this.engineRunner.getLastValues()
    };
    showStatus(sessionInfo);
  }

  /**
   * Prompt the user (used by file watcher for re-prompting)
   */
  prompt() {
    if (this.rl) {
      this.rl.prompt();
    }
  }

  /**
   * Cleanup resources on exit
   */
  cleanup() {
    this.fileWatcher.cleanup();
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }
} 