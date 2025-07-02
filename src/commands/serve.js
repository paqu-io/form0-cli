import fs from 'fs-extra';
import chokidar from 'chokidar';
import { createServer } from 'http';
import path from 'path';
import { colors } from '../utils/theme.js';
import { validateSchema } from 'form0-core';
import { t } from '../utils/i18n.js';
import { createApp } from '../server/app.js';
import { createWebSocketServer } from '../server/websocket.js';

class Form0Server {
  constructor(schemaPath, options = {}) {
    this.schemaPath = schemaPath;
    this.options = options;
    this.currentSchema = null;
    this.app = null;
    this.server = null;
    this.wsServer = null;
    this.watcher = null;
    this.port = parseInt(options.port) || 3030;
    this.host = options.host || 'localhost';
    this.actualSchemaPath = null; // For interactive mode to track the real schema file
  }

  async start() {
    try {
      // Load initial schema
      await this.loadSchema();
      console.log(colors.success(t('commands.serve.schemaLoaded', { path: this.schemaPath })));

      // Setup Express app with schema provider and schema source
      this.app = createApp(() => this.currentSchema, () => this.getSchemaSource());

      // Find available port
      this.port = await this.findAvailablePort(this.port);

      // Start HTTP server
      this.server = createServer(this.app);
      
      // Setup WebSocket server with schema source
      this.wsServer = createWebSocketServer(this.server, () => this.currentSchema, () => this.getSchemaSource());

      // Start server
      await new Promise((resolve, reject) => {
        this.server.listen(this.port, this.host, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Setup file watching
      this.startWatching();

      // Show server info
      await this.showServerInfo();

      // Setup exit handlers
      this.setupExitHandlers();

    } catch (err) {
      console.error(colors.error(t('commands.serve.failedToStart', { message: err.message })));
      process.exit(1);
    }
  }

  getSchemaSource() {
    if (this.schemaPath === 'interactive-schema' && this.actualSchemaPath) {
      return `Interactive Mode (${path.basename(this.actualSchemaPath)})`;
    } else if (this.schemaPath === 'interactive-schema') {
      return 'Interactive Mode';
    }
    return path.basename(this.schemaPath);
  }

  // Method to get the actual schema file path for interactive mode
  getActualSchemaPath() {
    return this.actualSchemaPath || this.schemaPath;
  }

  // Method to set the actual schema path (used by interactive mode)
  setActualSchemaPath(actualPath) {
    this.actualSchemaPath = actualPath;
  }

  async loadSchema() {
    const data = await fs.readJson(this.schemaPath);
    validateSchema(data.form);
    this.currentSchema = data;
  }

  startWatching() {
    console.log(colors.textSecondary(`👀 Watching file: ${this.schemaPath}`));
    
    this.watcher = chokidar.watch(this.schemaPath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
      }
    });

    this.watcher.on('change', async (filePath) => {
      console.log(colors.info(`📝 File changed: ${filePath}`));
      await this.handleSchemaChange();
    });

    this.watcher.on('error', (error) => {
      console.error(colors.error(t('commands.serve.watcherError', { message: error.message })));
    });
    
    this.watcher.on('ready', () => {
      console.log(colors.textSecondary('👀 File watcher ready'));
    });
  }

  async handleSchemaChange() {
    // Format timestamp as yyyy-mm-dd hh:mm:ss
    const now = new Date();
    const timestamp = now.getFullYear() + '-' + 
                     String(now.getMonth() + 1).padStart(2, '0') + '-' + 
                     String(now.getDate()).padStart(2, '0') + ' ' +
                     String(now.getHours()).padStart(2, '0') + ':' + 
                     String(now.getMinutes()).padStart(2, '0') + ':' + 
                     String(now.getSeconds()).padStart(2, '0');

    console.log(colors.info(t('commands.serve.schemaChanged', { timestamp })));
    
    try {
      await this.loadSchema();
      console.log(colors.success(t('commands.serve.schemaReloaded')));
      
      // Broadcast schema update to all connected clients with source
      this.wsServer.broadcastSchemaUpdate(this.currentSchema, this.getSchemaSource());
      
    } catch (err) {
      console.error(colors.error(t('commands.serve.failedToReload', { message: err.message })));
    }
  }

  async findAvailablePort(startPort) {
    const net = await import('net');
    
    return new Promise((resolve) => {
      const server = net.createServer();
      
      server.listen(startPort, (err) => {
        if (err) {
          server.close();
          // Try next port
          this.findAvailablePort(startPort + 1).then(resolve);
        } else {
          const port = server.address().port;
          server.close();
          resolve(port);
        }
      });
    });
  }

  async showServerInfo() {
    console.log(colors.header('\n🚀 ' + t('commands.serve.serverStarted')));
    console.log(colors.info('📋 ' + t('commands.serve.schemaFile', { path: this.schemaPath })));
    console.log(colors.success('🌐 ' + t('commands.serve.localUrl', { url: `http://${this.host}:${this.port}` })));
    
    // Try to get network IP
    try {
      const os = await import('os');
      const interfaces = os.networkInterfaces();
      const networkIp = Object.values(interfaces)
        .flat()
        .find(iface => iface.family === 'IPv4' && !iface.internal)?.address;
        
      if (networkIp) {
        console.log(colors.success('🌐 ' + t('commands.serve.networkUrl', { url: `http://${networkIp}:${this.port}` })));
      }
    } catch (err) {
      // Ignore network IP detection errors
    }
    
    console.log(colors.textSecondary('\n✅ ' + t('commands.serve.serverRunning')));
    console.log(colors.textSecondary('   ' + t('commands.serve.pressCtrlC')));
  }

  setupExitHandlers() {
    const cleanup = () => {
      console.log(colors.info('\n' + t('commands.serve.shuttingDown')));
      
      if (this.watcher) {
        this.watcher.close();
      }
      
      if (this.wsServer?.wss) {
        this.wsServer.wss.close();
      }
      
      if (this.server) {
        this.server.close();
      }
      
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }

  stop() {
    if (this.watcher) this.watcher.close();
    if (this.wsServer?.wss) this.wsServer.wss.close();
    if (this.server) this.server.close();
  }

  // Method for interactive integration
  updateSchema(newSchema) {
    console.log(colors.textSecondary('🔄 Updating server schema...'));
    this.currentSchema = newSchema;
    if (this.wsServer) {
      this.wsServer.broadcastSchemaUpdate(this.currentSchema, this.getSchemaSource());
      console.log(colors.textSecondary('📡 Schema update broadcasted to clients'));
    } else {
      console.log(colors.warning('⚠️  No WebSocket server available for broadcasting'));
    }
  }

  // Method to get current server status
  getStatus() {
    return {
      running: !!this.server,
      port: this.port,
      host: this.host,
      schemaPath: this.schemaPath,
      hasSchema: !!this.currentSchema,
      watching: !!this.watcher
    };
  }
}

export async function serveCommand(schemaPath = 'form.schema.json', options) {
  const server = new Form0Server(schemaPath, options);
  await server.start();
}

// Export the server class for interactive use
export { Form0Server }; 