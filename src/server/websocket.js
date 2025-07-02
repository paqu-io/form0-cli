import { WebSocketServer } from 'ws';
import { colors } from '../utils/theme.js';
import { t } from '../utils/i18n.js';
import path from 'path';

export function createWebSocketServer(server, getCurrentSchema, getSchemaSource) {
  const wss = new WebSocketServer({ server });
  
  wss.on('connection', (ws) => {
    // Check if we're in interactive mode by looking at schema source
    const source = getSchemaSource ? getSchemaSource() : '';
    const isInteractiveMode = source.includes('Interactive Mode');
    
    if (isInteractiveMode) {
      console.log('\n' + colors.textSecondary('🔗 Browser connected to development server'));
    } else {
      console.log(colors.textSecondary(t('commands.serve.clientConnected')));
    }
    
    // Send current schema immediately
    const schema = getCurrentSchema();
    if (schema) {
      const source = getSchemaSource ? getSchemaSource() : 'Current Schema';
      ws.send(JSON.stringify({
        type: 'schema-update',
        schema: schema,
        source: source
      }));
    }

    ws.on('close', () => {
      if (isInteractiveMode) {
        console.log('\n' + colors.textSecondary('🔌 Browser disconnected from development server'));
      } else {
        console.log(colors.textSecondary(t('commands.serve.clientDisconnected')));
      }
    });
  });

  // Function to broadcast schema updates to all connected clients
  function broadcastSchemaUpdate(schema, schemaSource) {
    console.log(colors.textSecondary('Broadcasting schema update to clients...'));
    
    const source = schemaSource || 'Current Schema';
    const message = JSON.stringify({
      type: 'schema-update',
      schema: schema,
      source: source
    });

    let clientCount = 0;
    wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        client.send(message);
        clientCount++;
      }
    });
    
    console.log(colors.textSecondary(`📡 Sent update to ${clientCount} connected client(s)`));
  }

  return {
    wss,
    broadcastSchemaUpdate
  };
} 