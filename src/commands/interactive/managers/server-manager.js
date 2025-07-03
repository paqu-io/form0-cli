import { Form0Server } from '../../serve.js';
import { colors } from '../../../utils/theme.js';
import { t } from '../../../utils/i18n.js';

/**
 * Manages development server operations for interactive mode
 */
export class ServerManager {
  constructor(schemaManager, fileWatcher, readline) {
    this.schemaManager = schemaManager;
    this.fileWatcher = fileWatcher;
    this.readline = readline;
    this.devServer = null;
    this.serverRunningMode = false;
    this.originalSigintHandlers = null;
  }

  /**
   * Check if server is running in blocking mode
   */
  isServerRunning() {
    return this.serverRunningMode;
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
      console.log(colors.error(t('interactive.server.noSchemaLoaded')));
      return;
    }

    if (this.devServer && this.devServer.getStatus().running) {
      console.log(colors.warning(t('interactive.server.alreadyRunning')));
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
        
        console.log(colors.textSecondary('\n' + t('interactive.server.interactiveMode')));
        console.log(colors.textSecondary(t('interactive.server.useServeStop')));
      };

      await this.devServer.start();
      
      // Enter server running mode
      this.serverRunningMode = true;
      this.setupServerModeSignalHandlers();
      
      // Show server mode prompt
      this.readline.setPrompt(colors.brand('form0') + colors.textSecondary('(server)') + colors.brand('> '));
      this.readline.prompt();
      
    } catch (err) {
      console.log(colors.error(t('interactive.server.failedToStart', { message: err.message })));
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
      console.log(colors.warning('\n' + t('interactive.server.ctrlCBlocked')));
      if (this.readline) {
        this.readline.prompt();
      }
    });

    // Disable the readline interface's built-in SIGINT handling
    if (this.readline) {
      this.readline.removeAllListeners('SIGINT');
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
    if (this.readline) {
      this.readline.on('SIGINT', () => {
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
      console.log(colors.warning(t('interactive.server.noServerRunning')));
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
      
      console.log(colors.success(t('interactive.server.serverStopped')));
      console.log(colors.textSecondary(t('interactive.server.returningToInteractive')));
      
      // Restore normal prompt
      this.readline.setPrompt(colors.brand('form0> '));
      this.readline.prompt();
      
    } catch (err) {
      console.log(colors.error(t('interactive.server.failedToStop', { message: err.message })));
    }
  }

  /**
   * Show development server status
   */
  showServeStatus() {
    if (!this.devServer) {
      console.log(colors.textSecondary(t('interactive.server.notStarted')));
      return;
    }

    const status = this.devServer.getStatus();
    console.log(colors.header(t('interactive.server.statusTitle')));
    console.log(colors.textSecondary(t('interactive.server.running', { 
      status: status.running ? t('interactive.server.statusYes') : t('interactive.server.statusNo') 
    })));
    if (status.running) {
      console.log(colors.textSecondary(t('interactive.server.port', { port: status.port })));
      console.log(colors.textSecondary(t('interactive.server.host', { host: status.host })));
      console.log(colors.success(t('interactive.server.url', { url: `http://${status.host}:${status.port}` })));
      console.log(colors.textSecondary(t('interactive.server.schema', { 
        status: status.hasSchema ? t('interactive.server.schemaLoaded') : t('interactive.server.schemaNone')
      })));
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
      console.log(colors.error(t('interactive.server.noSchemaToUpdate')));
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
   * Get server status for display
   */
  getServerStatus() {
    return this.devServer ? this.devServer.getStatus() : null;
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
  }
} 