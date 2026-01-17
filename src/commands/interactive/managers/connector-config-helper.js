import {
  getProjectConnectorConfig,
  resolveProjectConfig,
  updateProjectConnectorConfig,
} from '../../../utils/project-config.js';
import { resolveProjectEnv, upsertProjectEnv } from '../../../utils/project-env.js';
import path from 'path';
import { connectorManager } from '../../../utils/connector-manager.js';
import { colors } from '../../../utils/theme.js';
import { validateConnectorForConfiguration } from '../../../utils/connector-validation.js';

/**
 * Prompt user for input using provided readline interface
 * Simplified version that doesn't interfere with CLI command processing
 */
function askQuestion(rl, question) {
  return new Promise((resolve, reject) => {
    rl.question(question, (answer) => {
      const trimmedAnswer = answer.trim();
      
      // Check for exit commands
      if (trimmedAnswer.toLowerCase() === 'exit' || trimmedAnswer.toLowerCase() === 'cancel') {
        reject(new Error('EXIT_REQUESTED'));
        return;
      }
      
      resolve(trimmedAnswer);
    });
  });
}

/**
 * Convert user input to boolean value
 * @param {string} input - User input string
 * @param {boolean} defaultValue - Default value if input is empty
 * @returns {boolean}
 */
function convertInputToBoolean(input, defaultValue = false) {
  if (!input || input.trim() === '') {
    return defaultValue;
  }
  
  const lowerInput = input.toLowerCase().trim();
  return ['y', 'yes', 'true', '1', 'on'].includes(lowerInput);
}

/**
 * Interactive configuration for PostgreSQL connector
 */
async function configurePostgreSQLConnector(rl, connectorName) {
  console.log('\n🔧 PostgreSQL Connector Configuration');
  console.log('====================================');
  console.log(colors.textMuted('Type "exit" or "cancel" to abort configuration'));
  console.log();
  
  const currentConfig = await getProjectConnectorConfig(connectorName);
  const { env } = await resolveProjectEnv();
  const currentEnv = { ...process.env, ...env };
  
  try {
    // Get database connection details
    const host = await askQuestion(rl, 
      `Database host (current: ${currentEnv.FORM0_CONNECTOR_PG_HOST || 'localhost'}): `
    ) || currentEnv.FORM0_CONNECTOR_PG_HOST || 'localhost';
    
    const port = await askQuestion(rl, 
      `Database port (current: ${currentEnv.FORM0_CONNECTOR_PG_PORT || '5432'}): `
    ) || currentEnv.FORM0_CONNECTOR_PG_PORT || '5432';
    
    const database = await askQuestion(rl, 
      `Database name (current: ${currentEnv.FORM0_CONNECTOR_PG_DATABASE || 'none'}): `
    ) || currentEnv.FORM0_CONNECTOR_PG_DATABASE;
    
    const username = await askQuestion(rl, 
      `Database username (current: ${currentEnv.FORM0_CONNECTOR_PG_USERNAME || 'none'}): `
    ) || currentEnv.FORM0_CONNECTOR_PG_USERNAME;
    
    const password = await askQuestion(rl, 
      `Database password (current: ${currentEnv.FORM0_CONNECTOR_PG_PASSWORD ? '***' : 'none'}): `
    ) || currentEnv.FORM0_CONNECTOR_PG_PASSWORD;
    
    const sslInput = await askQuestion(rl, 
      `Enable SSL? (y/n, current: ${currentEnv.FORM0_CONNECTOR_PG_SSL === 'true' ? 'y' : 'n'}): `
    );
    const ssl = convertInputToBoolean(sslInput, currentEnv.FORM0_CONNECTOR_PG_SSL === 'true');
    
    const currentTableName =
      currentConfig.tableName || currentEnv.FORM0_CONNECTOR_PG_TABLE_NAME || 'form0_submissions';
    const tableName = await askQuestion(rl, 
      `Table name (current: ${currentTableName}): `
    ) || currentTableName;
    
    const currentSchema = currentConfig.schema || currentEnv.FORM0_CONNECTOR_PG_SCHEMA || 'public';
    const schema = await askQuestion(rl, 
      `Database schema (current: ${currentSchema}): `
    ) || currentSchema;
    
    const enabledInput = await askQuestion(rl, 
      `Enable connector? (y/n, current: ${currentConfig.enabled ? 'y' : 'n'}): `
    );
    const enabled = convertInputToBoolean(enabledInput, currentConfig.enabled);
    
    const autoLoadInput = await askQuestion(rl, 
      `Auto-load on server start? (y/n, current: ${currentConfig.autoLoad ? 'y' : 'n'}): `
    );
    const autoLoad = convertInputToBoolean(autoLoadInput, currentConfig.autoLoad);

    return {
      connectorConfig: {
        tableName,
        schema,
        enabled,
        autoLoad,
      },
      envUpdates: {
        FORM0_CONNECTOR_PG_HOST: host,
        FORM0_CONNECTOR_PG_PORT: port,
        FORM0_CONNECTOR_PG_DATABASE: database,
        FORM0_CONNECTOR_PG_USERNAME: username,
        FORM0_CONNECTOR_PG_PASSWORD: password,
        FORM0_CONNECTOR_PG_SSL: ssl,
      },
    };
  } catch (error) {
    if (error.message === 'EXIT_REQUESTED') {
      throw new Error('Configuration cancelled by user');
    }
    throw error;
  }
}

/**
 * Interactive configuration for SQLite connector
 */
async function configureSQLiteConnector(rl, connectorName) {
  console.log('\n🔧 SQLite Connector Configuration');
  console.log('================================');
  console.log(colors.textMuted('Type "exit" or "cancel" to abort configuration'));
  console.log();

  const currentConfig = await getProjectConnectorConfig(connectorName);
  const { env } = await resolveProjectEnv();
  const currentEnv = { ...process.env, ...env };

  try {
    const defaultPath = currentEnv.FORM0_CONNECTOR_SQLITE_PATH || './form0.db';
    const databasePath =
      (await askQuestion(rl, `Database file path (current: ${defaultPath}): `)) || defaultPath;

    const currentTableName =
      currentConfig.tableName || currentEnv.FORM0_CONNECTOR_SQLITE_TABLE_NAME || 'form0_submissions';
    const tableName =
      (await askQuestion(rl, `Main table name (current: ${currentTableName}): `)) ||
      currentTableName;

    const currentChildTableName =
      currentConfig.childTableName ||
      currentEnv.FORM0_CONNECTOR_SQLITE_CHILD_TABLE_NAME ||
      'form0_submissions_children';
    const childTableName =
      (await askQuestion(rl, `Child table name (current: ${currentChildTableName}): `)) ||
      currentChildTableName;

    const enabledInput = await askQuestion(
      rl,
      `Enable connector? (y/n, current: ${currentConfig.enabled ? 'y' : 'n'}): `
    );
    const enabled = convertInputToBoolean(enabledInput, currentConfig.enabled);

    const autoLoadInput = await askQuestion(
      rl,
      `Auto-load on server start? (y/n, current: ${currentConfig.autoLoad ? 'y' : 'n'}): `
    );
    const autoLoad = convertInputToBoolean(autoLoadInput, currentConfig.autoLoad);

    return {
      connectorConfig: {
        tableName,
        childTableName,
        enabled,
        autoLoad,
      },
      envUpdates: {
        FORM0_CONNECTOR_SQLITE_PATH: databasePath,
      },
    };
  } catch (error) {
    if (error.message === 'EXIT_REQUESTED') {
      throw new Error('Configuration cancelled by user');
    }
    throw error;
  }
}

/**
 * Generic connector configuration
 */
async function configureGenericConnector(rl, connectorName) {
  console.log(`\n🔧 ${connectorName} Configuration`);
  console.log('================================');
  console.log(colors.textMuted('Type "exit" or "cancel" to abort configuration'));
  console.log();
  
  const currentConfig = await getProjectConnectorConfig(connectorName);
  
  try {
    const enabledInput = await askQuestion(rl, 
      `Enable connector? (y/n, current: ${currentConfig.enabled ? 'y' : 'n'}): `
    );
    const enabled = convertInputToBoolean(enabledInput, currentConfig.enabled);
    
    const autoLoadInput = await askQuestion(rl, 
      `Auto-load on server start? (y/n, current: ${currentConfig.autoLoad ? 'y' : 'n'}): `
    );
    const autoLoad = convertInputToBoolean(autoLoadInput, currentConfig.autoLoad);

    console.log('\n💡 Note: This connector may require additional configuration.');
    console.log('   Please refer to its documentation for environment variables');
    console.log('   or configuration files that may be needed.');

    return {
      connectorConfig: {
        enabled,
        autoLoad,
      },
      envUpdates: null,
    };
  } catch (error) {
    if (error.message === 'EXIT_REQUESTED') {
      throw new Error('Configuration cancelled by user');
    }
    throw error;
  }
}

/**
 * Test connector connection
 */
async function testConnectorConnection(connectorName) {
  try {
    console.log(`\n🔄 Testing connection to ${connectorName}...`);
    
    const { projectRoot } = await resolveProjectConfig();
    await connectorManager.loadConnectorConfig({ projectDir: projectRoot });
    const testResult = await connectorManager.testConnector(connectorName);
    
    if (testResult.healthy) {
      console.log(`✅ Connection successful: ${testResult.message}`);
      if (testResult.database) {
        console.log(`   Database: ${testResult.database}`);
      }
      if (testResult.host && testResult.port) {
        console.log(`   Host: ${testResult.host}:${testResult.port}`);
      }
    } else {
      console.log(`❌ Connection failed: ${testResult.message}`);
    }
    
  } catch (error) {
    console.log(`❌ Test failed: ${error.message}`);
  }
}

/**
 * Configure a connector interactively using the provided readline interface
 * This function no longer creates its own readline interface
 */
export async function configureConnectorWithShellContext(connectorName, rl) {
  if (!rl) {
    throw new Error('Readline interface is required for connector configuration');
  }

  // First validate that the connector is installed
  const isValid = await validateConnectorForConfiguration(connectorName);
  if (!isValid) {
    return;
  }

  try {
    let result;
    
    // Provide specialized configuration for known connectors
    if (connectorName === 'form0-connector-pg') {
      result = await configurePostgreSQLConnector(rl, connectorName);
    } else if (connectorName === 'form0-connector-sqlite') {
      result = await configureSQLiteConnector(rl, connectorName);
    } else {
      result = await configureGenericConnector(rl, connectorName);
    }
    
    const { connectorConfig, envUpdates } = result;

    // Save configuration
    const { configPath, projectRoot } = await updateProjectConnectorConfig(
      connectorName,
      connectorConfig
    );

    if (envUpdates) {
      await upsertProjectEnv(envUpdates, projectRoot);
    }
    
    if (configPath) {
      console.log(`\n✅ Configuration saved for ${connectorName}`);
      console.log(`   Config: ${configPath}`);
      if (envUpdates) {
        console.log(`   Env: ${path.join(projectRoot, '.env.local')}`);
      }
      
      // Offer to test the connection
      try {
        const testInput = await askQuestion(rl, 
          '\nTest connection now? (y/n): '
        );
        
        if (convertInputToBoolean(testInput, false)) {
          await testConnectorConnection(connectorName);
        }
      } catch (error) {
        if (error.message === 'EXIT_REQUESTED') {
          console.log(colors.textMuted('\nSkipping connection test.'));
        } else {
          throw error;
        }
      }
    } else {
      console.log(`\n❌ Failed to save configuration for ${connectorName}`);
    }
    
  } catch (error) {
    if (error.message === 'Configuration cancelled by user') {
      console.log(colors.warning('\n⚠️ Configuration cancelled by user'));
      return;
    }
    console.error(`❌ Error configuring connector: ${error.message}`);
    throw error; // Re-throw to be handled by the caller
  }
}
