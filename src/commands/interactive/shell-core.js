import readline from 'readline';
import { READLINE_CONFIG } from '../../utils/constants.js';
import { showWelcomeBanner, showHelp, showStatus } from '../../utils/display-utils.js';
import { completer } from '../../utils/completion-utils.js';
import { testCommand } from '../test.js';
import { themeCommand } from '../theme.js';
import { localeCommand } from '../locale.js';
import { Form0Server } from '../serve.js';
import { loadConfig } from '../../utils/config.js';
import { colors } from '../../utils/theme.js';
import { t } from '../../utils/i18n.js';

/**
 * Manages the interactive shell core functionality
 */
export class ShellCore {
  constructor(schemaManager, engineRunner, fileWatcher) {
    this.schemaManager = schemaManager;
    this.engineRunner = engineRunner;
    this.fileWatcher = fileWatcher;
    this.rl = null;
    this.devServer = null; // For serve command
    this.serverRunningMode = false; // Flag to track if server is running in blocking mode
    this.originalSigintHandlers = null; // Store original handlers
  }

  /**
   * Initialize the readline interface
   */
  initializeReadline() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: colors.brand('form0> '),
      completer: completer, // Enable tab completion
      history: [], // Enable command history (↑/↓ arrows)
      historySize: READLINE_CONFIG.historySize
    });

    // Set up initial SIGINT handler for readline
    this.rl.on('SIGINT', () => {
      if (this.serverRunningMode) {
        // This should not happen since we override it in server mode
        return;
      }
      this.cleanup();
      console.log(colors.brandBold('\n' + t('interactive.goodbye')));
      process.exit(0);
    });
  }

  /**
   * Start the interactive shell
   */
  async start() {
    // Load configuration first
    await loadConfig();
    
    this.initializeReadline();
    
    showWelcomeBanner();
    console.log(colors.brandBold(t('interactive.welcome')));
    console.log(colors.textSecondary(t('interactive.typeHelp') + '\n'));
    
    // Smart initialization: Auto-load schema or offer to initialize
    await this.schemaManager.smartInit();
    
    this.rl.prompt();
    
    this.rl.on('line', async (input) => {
      const trimmed = input.trim();
      if (trimmed) {
        await this.handleCommand(trimmed);
      }
      // Always show appropriate prompt
      this.rl.prompt();
    });

    this.rl.on('close', () => {
      this.cleanup();
      console.log(colors.brandBold('\n' + t('interactive.goodbye')));
      process.exit(0);
    });
  }

  /**
   * Check if server is running in blocking mode
   */
  isServerRunning() {
    return this.serverRunningMode;
  }

  /**
   * Handle incoming commands
   */
  async handleCommand(input) {
    const [command, ...args] = input.split(' ');
    
    try {
      // In server running mode, allow specific commands and show helpful message for blocked ones
      if (this.serverRunningMode) {
        const allowedCommands = ['serve', 'status', 's', 'preview', 'p', 'validate', 'v', 'help', 'h'];
        if (!allowedCommands.includes(command.toLowerCase())) {
          console.log(colors.warning(`⚠️  Command "${command}" is not available while development server is running.`));
          console.log(colors.textSecondary('   Available commands:'));
          console.log(colors.textSecondary('   • serve stop       - Stop the development server'));
          console.log(colors.textSecondary('   • serve status     - Show server status'));
          console.log(colors.textSecondary('   • status           - Show session status'));
          console.log(colors.textSecondary('   • preview          - Preview current schema'));
          console.log(colors.textSecondary('   • validate         - Validate current schema'));
          console.log(colors.textSecondary('   • help             - Show help'));
          return;
        }
        
        // For serve command, only allow stop and status
        if (command.toLowerCase() === 'serve') {
          const [action] = args;
          if (!['stop', 'status'].includes(action)) {
            console.log(colors.warning(`⚠️  "serve ${action}" is not available while server is running.`));
            console.log(colors.textSecondary('   Use "serve stop" to stop the server or "serve status" to check status.'));
            return;
          }
        }
      }
      
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
            console.log(colors.error(t('interactive.usageLoad')));
            return;
          }
          await this.schemaManager.loadSchema(args[0]);
          // Reset engine when schema changes
          this.engineRunner.resetEngine();
          // Update development server if running
          this.updateDevServerSchema();
          console.log(colors.success(t('interactive.loadedSchema', { filename: args[0] })));
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
            console.log(colors.error(t('interactive.testFailed', { message: err.message })));
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
            // Update development server if running
            this.updateDevServerSchema();
            console.log(colors.success(t('interactive.reloadedSchema', { filename: this.schemaManager.getCurrentSchemaPath() })));
          } catch (err) {
            console.log(colors.error(`❌ ${err.message}`));
          }
          break;
          
        case 'watch':
        case 'w':
          await this.fileWatcher.handleWatchCommand(args);
          break;
          
        case 'serve':
          await this.handleServeCommand(args);
          break;
          
        case 'clear':
        case 'cls':
          if (args[0] === 'values') {
            this.engineRunner.clearValues();
          } else {
            console.clear();
          }
          break;
          
        case 'theme':
          await themeCommand(args[0]);
          break;
          
        case 'locale':
          await localeCommand(args[0]);
          break;
          
        case 'exit':
        case 'quit':
        case 'q':
          this.rl.close();
          break;
          
        default:
          console.log(colors.error(t('interactive.unknownCommand', { command })));
          console.log(colors.textSecondary(t('interactive.typeHelp')));
      }
    } catch (err) {
      console.log(colors.error(t('interactive.error', { message: err.message })));
    }
  }

  /**
   * Handle serve command
   */
  async handleServeCommand(args) {
    const [action, ...rest] = args;
    
    switch (action) {
      case 'start':
        await this.startDevServer(rest);
        break;
        
      case 'stop':
        this.stopDevServer();
        break;
        
      case 'status':
        this.showServeStatus();
        break;
        
      case 'update':
        this.updateDevServerSchema();
        break;
        
      default:
        // Default action: start server
        await this.startDevServer(args);
        break;
    }
  }

  /**
   * Start the development server
   */
  async startDevServer(args) {
    if (!this.schemaManager.getCurrentSchema()) {
      console.log(colors.error('❌ No schema loaded. Use "load <path>" to load a schema first.'));
      return;
    }

    if (this.devServer && this.devServer.getStatus().running) {
      console.log(colors.warning('⚠️  Development server is already running. Use "serve stop" to stop it first.'));
      return;
    }

    try {
      // Parse options
      const options = {};
      for (let i = 0; i < args.length; i += 2) {
        if (args[i] === '--port' || args[i] === '-p') {
          options.port = args[i + 1];
        } else if (args[i] === '--host') {
          options.host = args[i + 1];
        }
      }

      // Create server with current schema
      this.devServer = new Form0Server('interactive-schema', options);
      
      // Set the actual schema path for better display
      const actualSchemaPath = this.schemaManager.getCurrentSchemaPath();
      if (actualSchemaPath) {
        this.devServer.setActualSchemaPath(actualSchemaPath);
      }
      
      // Override schema loading to use interactive schema
      this.devServer.loadSchema = async () => {
        this.devServer.currentSchema = this.schemaManager.getCurrentSchema();
      };
      
      // Override file watching with cleaner messaging and start actual file watching
      this.devServer.startWatching = () => {
        // Start the interactive file watcher silently (no extra messages)
        if (!this.fileWatcher.isCurrentlyWatching()) {
          // Start watching silently for server mode
          this.startSilentFileWatching();
        }
      };

      // Completely override server info display for interactive mode to control messaging
      this.devServer.showServerInfo = async () => {
        console.log(colors.header('\n🚀 ' + t('commands.serve.serverStarted')));
        console.log(colors.info('📋 ' + t('commands.serve.schemaFile', { path: this.devServer.schemaPath })));
        console.log(colors.success('🌐 ' + t('commands.serve.localUrl', { url: `http://${this.devServer.host}:${this.devServer.port}` })));
        
        // Try to get network IP
        try {
          const os = await import('os');
          const interfaces = os.networkInterfaces();
          const networkIp = Object.values(interfaces)
            .flat()
            .find(iface => iface.family === 'IPv4' && !iface.internal)?.address;
            
          if (networkIp) {
            console.log(colors.success('🌐 ' + t('commands.serve.networkUrl', { url: `http://${networkIp}:${this.devServer.port}` })));
          }
        } catch (err) {
          // Ignore network IP detection errors
        }
        
        console.log(colors.textSecondary('\n👀 Interactive mode: Schema changes sync automatically'));
        console.log(colors.textSecondary('   Use "serve stop" to stop server and return to interactive mode'));
      };

      await this.devServer.start();
      
      // Enter server running mode
      this.serverRunningMode = true;
      this.setupServerModeSignalHandlers();
      
      // Show server mode prompt
      this.rl.setPrompt(colors.brand('form0') + colors.textSecondary('(server)') + colors.brand('> '));
      this.rl.prompt();
      
    } catch (err) {
      console.log(colors.error(`❌ Failed to start development server: ${err.message}`));
    }
  }

  /**
   * Start file watching silently for server mode (without showing Ctrl+C messages)
   */
  startSilentFileWatching() {
    const currentSchemaPath = this.schemaManager.getCurrentSchemaPath();
    if (!currentSchemaPath) {
      return;
    }

    // Start file watcher with custom silent mode
    this.fileWatcher.startWatchingInServerMode(currentSchemaPath);
  }

  /**
   * Setup signal handlers for server running mode
   */
  setupServerModeSignalHandlers() {
    // Store all existing SIGINT handlers
    this.originalSigintHandlers = process.listeners('SIGINT').slice();
    
    // Remove existing handlers
    process.removeAllListeners('SIGINT');
    
    // Add a no-op handler for server mode (ignore Ctrl+C completely)
    process.on('SIGINT', () => {
      // Ignore Ctrl+C in server mode - only allow "serve stop"
      console.log(colors.warning('\n⚠️  Use "serve stop" to stop the development server'));
      if (this.rl) {
        this.rl.prompt();
      }
    });

    // Disable the readline interface's built-in SIGINT handling
    if (this.rl) {
      this.rl.removeAllListeners('SIGINT');
    }
  }

  /**
   * Restore original signal handlers
   */
  restoreOriginalSignalHandlers() {
    // Remove server mode handlers
    process.removeAllListeners('SIGINT');
    
    // Restore original handlers if they existed
    if (this.originalSigintHandlers && this.originalSigintHandlers.length > 0) {
      this.originalSigintHandlers.forEach(handler => {
        process.on('SIGINT', handler);
      });
    }

    // Re-enable readline's SIGINT handling
    if (this.rl) {
      this.rl.on('SIGINT', () => {
        this.cleanup();
        console.log(colors.brandBold('\n' + t('interactive.goodbye')));
        process.exit(0);
      });
    }
  }

  /**
   * Stop the development server
   */
  stopDevServer() {
    if (!this.devServer || !this.devServer.getStatus().running) {
      console.log(colors.warning('⚠️  No development server running.'));
      return;
    }

    try {
      this.devServer.stop();
      this.devServer = null;
      
      // Exit server running mode
      this.serverRunningMode = false;
      this.restoreOriginalSignalHandlers();
      
      // Stop file watching if it was started by the server
      if (this.fileWatcher.isCurrentlyWatching()) {
        this.fileWatcher.stopWatching();
      }
      
      console.log(colors.success('✅ Development server stopped'));
      console.log(colors.textSecondary('   Returning to interactive mode...\n'));
      
      // Restore normal prompt
      this.rl.setPrompt(colors.brand('form0> '));
      this.rl.prompt();
      
    } catch (err) {
      console.log(colors.error(`❌ Failed to stop development server: ${err.message}`));
    }
  }

  /**
   * Show development server status
   */
  showServeStatus() {
    if (!this.devServer) {
      console.log(colors.textSecondary('📊 Development server: Not started'));
      return;
    }

    const status = this.devServer.getStatus();
    console.log(colors.header('📊 Development Server Status:'));
    console.log(colors.textSecondary(`  Running: ${status.running ? '✅ Yes' : '❌ No'}`));
    if (status.running) {
      console.log(colors.textSecondary(`  Port: ${status.port}`));
      console.log(colors.textSecondary(`  Host: ${status.host}`));
      console.log(colors.success(`  URL: http://${status.host}:${status.port}`));
      console.log(colors.textSecondary(`  Schema: ${status.hasSchema ? '✅ Loaded' : '❌ None'}`));
    }
  }

  /**
   * Update development server with current schema
   */
  updateDevServerSchema() {
    if (!this.devServer || !this.devServer.getStatus().running) {
      // Don't show warning if server isn't running - this is expected behavior
      return;
    }

    const schema = this.schemaManager.getCurrentSchema();
    if (!schema) {
      console.log(colors.error('❌ No schema loaded to update server with.'));
      return;
    }

    // Update the actual schema path for better display
    const actualSchemaPath = this.schemaManager.getCurrentSchemaPath();
    if (actualSchemaPath) {
      this.devServer.setActualSchemaPath(actualSchemaPath);
    }

    // Update the server's current schema
    this.devServer.updateSchema(schema);
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
      lastValues: this.engineRunner.getLastValues(),
      devServer: this.devServer ? this.devServer.getStatus() : null
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
    // Stop development server if running
    if (this.devServer) {
      try {
        this.devServer.stop();
      } catch (err) {
        // Ignore cleanup errors
      }
    }
    
    // Restore signal handlers if in server mode
    if (this.serverRunningMode) {
      this.serverRunningMode = false;
      this.restoreOriginalSignalHandlers();
    }
    
    this.fileWatcher.cleanup();
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }
} 