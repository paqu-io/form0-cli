import { WebSocketServer } from 'ws';
import { colors } from '../utils/theme.js';
import { t, tn } from '../utils/i18n.js';
import { expandBuildingPlanSchema } from 'form0-core';

export function createWebSocketServer(server, getCurrentSchema, getSchemaSource) {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    // Check if we're in interactive mode by looking at schema source
    const source = getSchemaSource ? getSchemaSource() : '';
    const isInteractiveMode = source.includes('Interactive Mode');

    if (isInteractiveMode) {
      console.log('\n' + colors.textSecondary(t('websocket.browserConnected')));
    } else {
      console.log(colors.textSecondary(t('commands.serve.clientConnected')));
    }

    // Send current schema immediately
    const schema = getCurrentSchema();
    if (schema) {
      const source = getSchemaSource ? getSchemaSource() : 'Current Schema';
      const { schema: preparedSchema, buildingPlanMeta } = expandBuildingPlanSchema(schema);
      ws.send(
        JSON.stringify({
          type: 'schema-update',
          schema: preparedSchema,
          source: source,
          buildingPlanMeta,
        })
      );
    }

    ws.on('close', () => {
      if (isInteractiveMode) {
        console.log('\n' + colors.textSecondary(t('websocket.browserDisconnected')));
      } else {
        console.log(colors.textSecondary(t('commands.serve.clientDisconnected')));
      }
    });
  });

  // Function to broadcast schema updates to all connected clients
  function broadcastSchemaUpdate(schema, schemaSource) {
    console.log(colors.textSecondary(t('websocket.broadcastingUpdate')));

    const source = schemaSource || 'Current Schema';
    const { schema: preparedSchema, buildingPlanMeta } = expandBuildingPlanSchema(schema);
    const message = JSON.stringify({
      type: 'schema-update',
      schema: preparedSchema,
      source: source,
      buildingPlanMeta,
    });

    let clientCount = 0;
    wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        client.send(message);
        clientCount++;
      }
    });

    console.log(
      colors.textSecondary(tn('websocket.updateSent', clientCount, { count: clientCount }))
    );
  }

  return {
    wss,
    broadcastSchemaUpdate,
  };
}
