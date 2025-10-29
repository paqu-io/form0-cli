import { 
  getConnectorConfig, 
  updateConnectorConfig
} from '../../../utils/config.js';
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
  
  const currentConfig = getConnectorConfig(connectorName);
  
  try {
    // Get database connection details
    const host = await askQuestion(rl, 
      `Database host (current: ${currentConfig.host || 'localhost'}): `
    ) || currentConfig.host || 'localhost';
    
    const port = await askQuestion(rl, 
      `Database port (current: ${currentConfig.port || '5432'}): `
    ) || currentConfig.port || '5432';
    
    const database = await askQuestion(rl, 
      `Database name (current: ${currentConfig.database || 'none'}): `
    ) || currentConfig.database;
    
    const username = await askQuestion(rl, 
      `Database username (current: ${currentConfig.username || 'none'}): `
    ) || currentConfig.username;
    
    const password = await askQuestion(rl, 
      `Database password (current: ${currentConfig.password ? '***' : 'none'}): `
    ) || currentConfig.password;
    
    const sslInput = await askQuestion(rl, 
      `Enable SSL? (y/n, current: ${currentConfig.ssl ? 'y' : 'n'}): `
    );
    const ssl = convertInputToBoolean(sslInput, currentConfig.ssl);
    
    const tableName = await askQuestion(rl, 
      `Table name (current: ${currentConfig.tableName || 'form0_submissions'}): `
    ) || currentConfig.tableName || 'form0_submissions';
    
    const schema = await askQuestion(rl, 
      `Database schema (current: ${currentConfig.schema || 'public'}): `
    ) || currentConfig.schema || 'public';
    
    const enabledInput = await askQuestion(rl, 
      `Enable connector? (y/n, current: ${currentConfig.enabled ? 'y' : 'n'}): `
    );
    const enabled = convertInputToBoolean(enabledInput, currentConfig.enabled);
    
    const autoLoadInput = await askQuestion(rl, 
      `Auto-load on server start? (y/n, current: ${currentConfig.autoLoad ? 'y' : 'n'}): `
    );
    const autoLoad = convertInputToBoolean(autoLoadInput, currentConfig.autoLoad);

    return {
      host,
      port: parseInt(port),
      database,
      username,
      password,
      ssl,
      tableName,
      schema,
      enabled,
      autoLoad
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
  
  const currentConfig = getConnectorConfig(connectorName);
  
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
      enabled,
      autoLoad
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
    
    await connectorManager.loadConnectorConfig();
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
    let config;
    
    // Provide specialized configuration for known connectors
    if (connectorName === 'form0-connector-pg') {
      config = await configurePostgreSQLConnector(rl, connectorName);
    } else {
      config = await configureGenericConnector(rl, connectorName);
    }
    
    // Save configuration
    const success = await updateConnectorConfig(connectorName, config);
    
    if (success) {
      console.log(`\n✅ Configuration saved for ${connectorName}`);
      
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