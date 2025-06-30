import fs from 'fs-extra';
import path from 'path';
import express from 'express';
import { WebSocketServer } from 'ws';
import chokidar from 'chokidar';
import { createServer } from 'http';
import { colors } from '../utils/theme.js';
import { createFormEngine, validateSchema } from 'form0-core';
import { t } from '../utils/i18n.js';

class Form0Server {
  constructor(schemaPath, options = {}) {
    this.schemaPath = schemaPath;
    this.options = options;
    this.currentSchema = null;
    this.app = null;
    this.server = null;
    this.wss = null;
    this.watcher = null;
    this.port = parseInt(options.port) || 3030;
    this.host = options.host || 'localhost';
  }

  async start() {
    try {
      // Load initial schema
      await this.loadSchema();
      console.log(colors.success(t('commands.serve.schemaLoaded', { path: this.schemaPath })));

      // Setup Express app
      this.setupApp();

      // Find available port
      this.port = await this.findAvailablePort(this.port);

      // Start HTTP server
      this.server = createServer(this.app);
      
      // Setup WebSocket server
      this.setupWebSocket();

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

  async loadSchema() {
    const data = await fs.readJson(this.schemaPath);
    validateSchema(data.form);
    this.currentSchema = data;
  }

  setupApp() {
    this.app = express();
    
    // Serve static files
    this.app.use(express.static(path.join(process.cwd(), 'src/server/static')));
    
    // API endpoint to get current schema
    this.app.get('/api/schema', (req, res) => {
      res.json(this.currentSchema);
    });

    // API endpoint to run engine with values
    this.app.post('/api/engine', express.json(), (req, res) => {
      try {
        const { values = {} } = req.body;
        
        // Create engine with proper helpers (including builtins)
        const engine = createFormEngine({
          schema: this.currentSchema,
          initialValues: values,
          helpers: {} // builtins are included by default in createFormEngine
        });
        
        engine.eval();
        const state = engine.getState();
        
        // Debug logging (can be removed in production)
        // console.log('Engine state for values:', values);
        // console.log('Calculated values:', state.values);
        
        res.json(state);
      } catch (err) {
        console.error('Engine evaluation error:', err);
        res.status(400).json({ error: err.message });
      }
    });

    // Serve main page
    this.app.get('/', (req, res) => {
      const html = this.generateHTML();
      res.send(html);
    });
  }

  setupWebSocket() {
    this.wss = new WebSocketServer({ server: this.server });
    
    this.wss.on('connection', (ws) => {
      console.log(colors.textSecondary(t('commands.serve.clientConnected')));
      
      // Send current schema immediately
      ws.send(JSON.stringify({
        type: 'schema-update',
        schema: this.currentSchema
      }));

      ws.on('close', () => {
        console.log(colors.textSecondary(t('commands.serve.clientDisconnected')));
      });
    });
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
    const timestamp = new Date().toLocaleTimeString();
    console.log(colors.info(t('commands.serve.schemaChanged', { timestamp })));
    
    try {
      const oldSchema = this.currentSchema;
      await this.loadSchema();
      
      console.log(colors.success(t('commands.serve.schemaReloaded')));
      
      // Show what changed for debugging
      console.log(colors.textSecondary('Broadcasting schema update to clients...'));
      
      // Broadcast to all connected clients
      const message = JSON.stringify({
        type: 'schema-update',
        schema: this.currentSchema
      });

      let clientCount = 0;
      this.wss.clients.forEach((client) => {
        if (client.readyState === client.OPEN) {
          client.send(message);
          clientCount++;
        }
      });
      
      console.log(colors.textSecondary(`📡 Sent update to ${clientCount} connected client(s)`));
      
    } catch (err) {
      console.error(colors.error(t('commands.serve.failedToReload', { message: err.message })));
    }
  }

  generateHTML() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>form0 Development Server</title>
    <style>
        body { font-family: system-ui, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .header { border-bottom: 1px solid #eee; padding-bottom: 15px; margin-bottom: 20px; }
        .form-container { margin-bottom: 20px; }
        .field { margin-bottom: 15px; }
        .field label { display: block; margin-bottom: 5px; font-weight: 500; }
        .field input, .field select, .field textarea { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; box-sizing: border-box; }
        .field.error input { border-color: #e74c3c; }
        .error-message { color: #e74c3c; font-size: 14px; margin-top: 5px; }
        .section { border: 1px solid #eee; padding: 15px; margin: 10px 0; border-radius: 4px; }
        .section-title { font-weight: bold; margin-bottom: 10px; }
        .calculated { background: #cce7ff; border: 1px solid #66b3ff; }
        .calculated input { background: #cce7ff; color: #0056b3; font-weight: 500; cursor: not-allowed; box-sizing: border-box; }
        .readonly { background: #f8f9fa; }
        .readonly input { background: #f8f9fa; color: #6c757d; cursor: not-allowed; box-sizing: border-box; }
        .hidden { display: none; }
        .status { padding: 10px; margin: 10px 0; border-radius: 4px; background: #d4edda; border: 1px solid #c3e6cb; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🦙 form0 Development Server</h1>
            <p>Schema: <code>${this.schemaPath}</code></p>
            <div class="status" id="status">Loading schema...</div>
        </div>
        <div class="form-container" id="form-container">
            <!-- Form will be rendered here -->
        </div>
    </div>

    <script>
        // WebSocket connection for live reload
        const wsHost = window.location.hostname;
        const wsPort = window.location.port;
        const ws = new WebSocket(\`ws://\${wsHost}:\${wsPort}\`);
        let currentSchema = null;
        let formEngine = null;

        ws.onopen = () => {
            console.log('🔗 WebSocket connected');
            document.getElementById('status').textContent = '✅ Connected - watching for changes';
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'schema-update') {
                console.log('📡 Received schema update from server');
                currentSchema = data.schema;
                renderForm();
                document.getElementById('status').textContent = '✅ Schema updated - ' + new Date().toLocaleTimeString();
            }
        };

        ws.onclose = () => {
            console.log('🔌 WebSocket disconnected');
            document.getElementById('status').textContent = '❌ Disconnected from server';
        };
        
        ws.onerror = (error) => {
            console.error('❌ WebSocket error:', error);
            document.getElementById('status').textContent = '❌ WebSocket connection error';
        };

        function renderForm() {
            if (!currentSchema) return;
            
            console.log('🔄 Rendering form:', currentSchema.form.name);
            
            const container = document.getElementById('form-container');
            container.innerHTML = '';
            
            const formTitle = document.createElement('h2');
            formTitle.textContent = currentSchema.form.name || 'Untitled Form';
            container.appendChild(formTitle);
            
            const form = document.createElement('form');
            form.id = 'main-form';
            
            renderElements(currentSchema.form.elements || [], form);
            container.appendChild(form);
            
            // Initial engine evaluation
            updateFormState();
        }

        function renderElements(elements, container) {
            elements.forEach(element => {
                if (element.type === 'Section') {
                    renderSection(element, container);
                } else {
                    renderField(element, container);
                }
            });
        }

        function renderSection(section, container) {
            const sectionDiv = document.createElement('div');
            sectionDiv.className = 'section';
            sectionDiv.setAttribute('data-key', section.key);
            
            // Show section title using label field (use data_name as fallback)
            const title = document.createElement('div');
            title.className = 'section-title';
            title.textContent = section.label || section.data_name || 'Section';
            sectionDiv.appendChild(title);
            
            // Render drilldown sections as inline sections
            const elements = section.elements || section.drilldown_elements || [];
            renderElements(elements, sectionDiv);
            
            container.appendChild(sectionDiv);
        }

        function renderField(field, container) {
            const fieldDiv = document.createElement('div');
            fieldDiv.className = 'field';
            fieldDiv.setAttribute('data-key', field.key);
            fieldDiv.setAttribute('data-name', field.data_name);
            
            const label = document.createElement('label');
            label.textContent = field.label || field.data_name;
            if (field.required) label.textContent += ' *';
            fieldDiv.appendChild(label);
            
            let input;
            
            switch (field.type) {
                case 'TextField':
                    input = document.createElement('input');
                    input.type = 'text';
                    if (field.pattern) input.pattern = field.pattern;
                    break;
                    
                case 'NumericField':
                    input = document.createElement('input');
                    input.type = 'number';
                    if (field.min !== undefined) input.min = field.min;
                    if (field.max !== undefined) input.max = field.max;
                    if (field.format === 'integer') input.step = '1';
                    break;
                    
                case 'ChoiceField':
                    input = document.createElement('select');
                    (field.choices || []).forEach(choice => {
                        const option = document.createElement('option');
                        option.value = choice.value;
                        option.textContent = choice.label || choice.value;
                        input.appendChild(option);
                    });
                    break;
                    
                case 'CalculatedField':
                    input = document.createElement('input');
                    input.type = 'text';
                    input.readOnly = true;
                    fieldDiv.classList.add('calculated');
                    // Mark as read-only immediately
                    fieldDiv.classList.add('readonly');
                    break;
                    
                default:
                    input = document.createElement('input');
                    input.type = 'text';
            }
            
            input.name = field.data_name;
            
            // Set read-only state based on schema
            if (field.read_only === true || field.type === 'CalculatedField') {
                input.readOnly = true;
                fieldDiv.classList.add('readonly');
            }
            
            input.addEventListener('input', updateFormState);
            input.addEventListener('change', updateFormState);
            
            fieldDiv.appendChild(input);
            container.appendChild(fieldDiv);
        }

        async function updateFormState() {
            if (!currentSchema) return;
            
            const formData = new FormData(document.getElementById('main-form'));
            const values = {};
            
            // Convert form values to appropriate types based on field definitions
            for (const [key, value] of formData.entries()) {
                const field = findFieldByDataName(key);
                if (field) {
                    if (field.type === 'NumericField') {
                        // Convert to number, handle empty strings
                        values[key] = value === '' ? null : Number(value);
                    } else {
                        values[key] = value === '' ? null : value;
                    }
                } else {
                    values[key] = value === '' ? null : value;
                }
            }
            
            try {
                const response = await fetch('/api/engine', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ values })
                });
                
                const state = await response.json();
                applyFormState(state);
                
            } catch (err) {
                console.error('Failed to update form state:', err);
            }
        }
        
        function findFieldByDataName(dataName) {
            function searchElements(elements) {
                for (const element of elements) {
                    if (element.data_name === dataName) {
                        return element;
                    }
                    if (element.type === 'Section') {
                        const found = searchElements(element.elements || element.drilldown_elements || []);
                        if (found) return found;
                    }
                }
                return null;
            }
            
            return currentSchema ? searchElements(currentSchema.form.elements || []) : null;
        }

        function applyFormState(state) {
            // console.log('Applying form state:', state);
            
            // Apply visibility
            Object.entries(state.visible || {}).forEach(([fieldName, isVisible]) => {
                const element = document.querySelector(\`[data-name="\${fieldName}"]\`);
                if (element) {
                    element.classList.toggle('hidden', !isVisible);
                }
            });
            
            // Apply readonly
            Object.entries(state.read_only || {}).forEach(([fieldName, isReadOnly]) => {
                const input = document.querySelector(\`input[name="\${fieldName}"], select[name="\${fieldName}"]\`);
                if (input) {
                    input.readOnly = isReadOnly;
                    
                    // Only add readonly class if it's not already a calculated field
                    if (!input.parentElement.classList.contains('calculated')) {
                        input.parentElement.classList.toggle('readonly', isReadOnly);
                    }
                    // console.log(\`Set \${fieldName} readonly: \${isReadOnly}\`);
                }
            });
            
            // Apply calculated values (and other computed values)
            Object.entries(state.values || {}).forEach(([fieldName, value]) => {
                const input = document.querySelector(\`input[name="\${fieldName}"]\`);
                if (input) {
                    // Convert boolean values to string for display
                    const displayValue = value === null || value === undefined ? '' : String(value);
                    
                    // Only update if it's a calculated field (readonly) or if the current value is different
                    if (input.readOnly || input.value !== displayValue) {
                        input.value = displayValue;
                        // console.log(\`Updated \${fieldName} value: \${value} -> \${displayValue}\`);
                    }
                }
            });
            
            // Apply errors
            document.querySelectorAll('.error-message').forEach(el => el.remove());
            document.querySelectorAll('.field.error').forEach(el => el.classList.remove('error'));
            
            Object.entries(state.errors || {}).forEach(([fieldName, errorMessage]) => {
                const fieldDiv = document.querySelector(\`[data-name="\${fieldName}"]\`);
                if (fieldDiv && errorMessage) {
                    fieldDiv.classList.add('error');
                    const errorDiv = document.createElement('div');
                    errorDiv.className = 'error-message';
                    errorDiv.textContent = errorMessage;
                    fieldDiv.appendChild(errorDiv);
                }
            });
            
            // Handle required field validation
            Object.entries(state.required || {}).forEach(([fieldName, isRequired]) => {
                const fieldDiv = document.querySelector(\`[data-name="\${fieldName}"]\`);
                const input = document.querySelector(\`input[name="\${fieldName}"], select[name="\${fieldName}"]\`);
                if (fieldDiv && input && isRequired) {
                    const value = input.value;
                    if (!value || value.trim() === '') {
                        // Only show required error if field is not already showing another error
                        if (!fieldDiv.classList.contains('error')) {
                            fieldDiv.classList.add('error');
                            const errorDiv = document.createElement('div');
                            errorDiv.className = 'error-message';
                            errorDiv.textContent = 'This field is required';
                            fieldDiv.appendChild(errorDiv);
                        }
                    }
                }
            });
        }
    </script>
</body>
</html>`;
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
      
      if (this.wss) {
        this.wss.close();
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
    if (this.wss) this.wss.close();
    if (this.server) this.server.close();
  }
}

export async function serveCommand(schemaPath = 'form.schema.json', options) {
  const server = new Form0Server(schemaPath, options);
  await server.start();
} 