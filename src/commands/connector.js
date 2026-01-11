import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'child_process';
import { connectorManager } from '../utils/connector-manager.js';
import { isReactNativeProject } from '../utils/project-detection.js';
import {
  getProjectConnectorConfig,
  getProjectConnectorsConfig,
  removeProjectConnectorConfig,
  resolveProjectConfig,
  updateProjectConnectorConfig,
} from '../utils/project-config.js';
import { resolveProjectEnv, upsertProjectEnv } from '../utils/project-env.js';
import readline from 'readline';

/**
 * Create readline interface for interactive prompts
 */
function createReadlineInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

/**
 * Prompt user for input
 */
function askQuestion(rl, question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
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
 * Check if a given path is a file path (relative or absolute)
 */
function isFilePath(input) {
  // Check for absolute paths
  if (path.isAbsolute(input)) {
    return true;
  }
  
  // Check for relative paths starting with ./ or ../
  if (input.startsWith('./') || input.startsWith('../')) {
    return true;
  }
  
  // Check for local paths without prefix (e.g., "form0-connector-pg" that exists as folder)
  if (input.includes('/') || input.includes('\\')) {
    return true;
  }
  
  return false;
}

/**
 * Resolve connector path for local development
 */
async function resolveConnectorPath(connectorInput) {
  // If it looks like a file path, validate and resolve it
  if (isFilePath(connectorInput)) {
    const resolvedPath = path.resolve(process.cwd(), connectorInput);
    
    // Check if the path exists and has a package.json
    const packageJsonPath = path.join(resolvedPath, 'package.json');
    if (await fs.pathExists(packageJsonPath)) {
      return {
        type: 'local',
        path: resolvedPath,
        packageJson: await fs.readJson(packageJsonPath)
      };
    } else {
      throw new Error(`Local path '${resolvedPath}' does not exist or does not contain a package.json`);
    }
  }
  
  // Check if it's an npm-linked package
  const nodeModulesPath = path.join(process.cwd(), 'node_modules', connectorInput);
  if (await fs.pathExists(nodeModulesPath)) {
    const stats = await fs.lstat(nodeModulesPath);
    if (stats.isSymbolicLink()) {
      const realPath = await fs.realpath(nodeModulesPath);
      const packageJsonPath = path.join(realPath, 'package.json');
      if (await fs.pathExists(packageJsonPath)) {
        return {
          type: 'linked',
          path: realPath,
          symlinkPath: nodeModulesPath,
          packageJson: await fs.readJson(packageJsonPath)
        };
      }
    }
  }
  
  // Check if it's already installed as a regular package
  const regularPackagePath = path.join(process.cwd(), 'node_modules', connectorInput);
  const regularPackageJsonPath = path.join(regularPackagePath, 'package.json');
  if (await fs.pathExists(regularPackageJsonPath)) {
    return {
      type: 'installed',
      path: regularPackagePath,
      packageJson: await fs.readJson(regularPackageJsonPath)
    };
  }
  
  // Default to npm package installation
  return {
    type: 'npm',
    name: connectorInput
  };
}

/**
 * Install a connector package with enhanced local development support
 */
async function installConnector(connectorInput) {
  try {
    console.log(`Installing connector: ${connectorInput}...`);
    
    // Check if package.json exists in current directory
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    if (!(await fs.pathExists(packageJsonPath))) {
      console.error('❌ No package.json found in current directory.');
      console.log('Please run this command from a form0 project directory.');
      return false;
    }

    // Resolve the connector type and path
    let resolution;
    try {
      resolution = await resolveConnectorPath(connectorInput);
    } catch (error) {
      console.error(`❌ ${error.message}`);
      return false;
    }

    let connectorName;
    let installSuccess = false;

    switch (resolution.type) {
      case 'local':
        console.log(`📁 Installing local connector from: ${resolution.path}`);
        connectorName = resolution.packageJson.name || path.basename(resolution.path);

        if (await isReactNativeProject()) {
          if (connectorName === 'form0-connector-pg' || connectorName === 'form0-connector-sqlite') {
            console.error(`❌ Connector '${connectorName}' is not supported in React Native projects.`);
            console.log('💡 Tip: Use local on-device storage in form0-react-native instead.');
            return false;
          }
        }
        
        try {
          // Use npm install with file: protocol for local packages
          execSync(`npm install file:${resolution.path}`, { 
            stdio: 'inherit',
            cwd: process.cwd()
          });
          console.log(`✅ Successfully installed local connector: ${connectorName}`);
          installSuccess = true;
        } catch (error) {
          console.error(`❌ Failed to install local connector: ${error.message}`);
          return false;
        }
        break;

      case 'linked':
        console.log(`🔗 Found npm-linked connector: ${resolution.packageJson.name}`);
        console.log(`   Linked to: ${resolution.path}`);
        connectorName = resolution.packageJson.name;
        if (await isReactNativeProject()) {
          if (connectorName === 'form0-connector-pg' || connectorName === 'form0-connector-sqlite') {
            console.error(`❌ Connector '${connectorName}' is not supported in React Native projects.`);
            console.log('💡 Tip: Use local on-device storage in form0-react-native instead.');
            return false;
          }
        }
        installSuccess = true; // Already linked
        break;

      case 'installed':
        console.log(`📦 Connector already installed: ${resolution.packageJson.name}`);
        connectorName = resolution.packageJson.name;
        if (await isReactNativeProject()) {
          if (connectorName === 'form0-connector-pg' || connectorName === 'form0-connector-sqlite') {
            console.error(`❌ Connector '${connectorName}' is not supported in React Native projects.`);
            console.log('💡 Tip: Use local on-device storage in form0-react-native instead.');
            return false;
          }
        }
        installSuccess = true; // Already installed
        break;

      case 'npm':
        connectorName = resolution.name;

        if (await isReactNativeProject()) {
          if (connectorName === 'form0-connector-pg' || connectorName === 'form0-connector-sqlite') {
            console.error(`❌ Connector '${connectorName}' is not supported in React Native projects.`);
            console.log('💡 Tip: Use local on-device storage in form0-react-native instead.');
            return false;
          }
        }
        
        try {
          // First try regular npm install
          execSync(`npm install ${connectorName}`, { 
            stdio: 'inherit',
            cwd: process.cwd()
          });
          console.log(`✅ Successfully installed npm package: ${connectorName}`);
          installSuccess = true;
        } catch (error) {
          // If npm install fails, check if it's available locally as a fallback
          const fallbackPaths = [
            path.join(process.cwd(), '..', connectorName),
            path.join(process.cwd(), connectorName)
          ];
          
          let fallbackFound = false;
          for (const fallbackPath of fallbackPaths) {
            if (await fs.pathExists(path.join(fallbackPath, 'package.json'))) {
              console.log(`📁 NPM install failed, but found local connector at: ${fallbackPath}`);
              try {
                execSync(`npm install file:${fallbackPath}`, { 
                  stdio: 'inherit',
                  cwd: process.cwd()
                });
                console.log(`✅ Successfully installed local connector as fallback: ${connectorName}`);
                installSuccess = true;
                fallbackFound = true;
                break;
              } catch (localError) {
                console.error(`❌ Fallback local install also failed: ${localError.message}`);
              }
            }
          }
          
          if (!fallbackFound) {
            console.error(`❌ Failed to install connector: ${error.message}`);
            console.log(`💡 Suggestions:`);
            console.log(`   • Check if the package name is correct`);
            console.log(`   • Verify the package is published to npm`);
            console.log(`   • For local development, use a file path: form0 connector install ../path/to/connector`);
            console.log(`   • For linked packages, use: npm link connector-name`);
            return false;
          }
        }
        break;

      default:
        console.error(`❌ Unknown resolution type: ${resolution.type}`);
        return false;
    }

    if (installSuccess) {
      // Provide additional guidance for development workflow
      if (resolution.type === 'local' || resolution.type === 'linked') {
        console.log(`\n💡 Development Tips:`);
        console.log(`   • Changes to the connector source will be reflected immediately`);
        console.log(`   • Use 'form0 connector test ${connectorName}' to verify functionality`);
        console.log(`   • Run 'form0 connector configure ${connectorName}' to set up configuration`);
        console.log(`   • Use 'form0 connector reload ${connectorName}' to reload after code changes`);
      }
      
      return true;
    }

    return false;
  } catch (error) {
    console.error(`❌ Error installing connector: ${error.message}`);
    return false;
  }
}

/**
 * Interactive configuration for PostgreSQL connector
 */
async function configurePostgreSQLConnector(rl, connectorName) {
  console.log('\n🔧 PostgreSQL Connector Configuration');
  console.log('====================================');
  
  const currentConfig = await getProjectConnectorConfig(connectorName);
  const { env } = await resolveProjectEnv();
  const currentEnv = { ...process.env, ...env };
  
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
  
  const currentSchema =
    currentConfig.schema || currentEnv.FORM0_CONNECTOR_PG_SCHEMA || 'public';
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
}

/**
 * Interactive configuration for SQLite connector
 */
async function configureSQLiteConnector(rl, connectorName) {
  console.log('\n🔧 SQLite Connector Configuration');
  console.log('================================');

  const currentConfig = await getProjectConnectorConfig(connectorName);
  const { env } = await resolveProjectEnv();
  const currentEnv = { ...process.env, ...env };

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
}

/**
 * Generic connector configuration
 */
async function configureGenericConnector(rl, connectorName) {
  console.log(`\n🔧 ${connectorName} Configuration`);
  console.log('================================');
  
  const currentConfig = await getProjectConnectorConfig(connectorName);
  
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
}

/**
 * Configure a connector interactively
 */
async function configureConnector(connectorName) {
  const rl = createReadlineInterface();
  
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

    // Save configuration to project config
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
      const testInput = await askQuestion(rl, 
        '\nTest connection now? (y/n): '
      );
      
      if (convertInputToBoolean(testInput, false)) {
        await testConnectorConnection(connectorName);
      }
    }
    
  } catch (error) {
    console.error(`❌ Error configuring connector: ${error.message}`);
  } finally {
    rl.close();
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
 * Reload a connector (useful during development)
 */
async function reloadConnector(connectorName) {
  try {
    console.log(`\n🔄 Reloading connector: ${connectorName}...`);
    
    const { projectRoot } = await resolveProjectConfig();
    await connectorManager.loadConnectorConfig({ projectDir: projectRoot });
    const success = await connectorManager.reloadConnector(connectorName);
    
    if (success) {
      console.log(`✅ Successfully reloaded ${connectorName}`);
      
      // Optionally test the connection after reload
      const metadata = connectorManager.getConnectorMetadata(connectorName);
      if (metadata) {
        console.log(`   Source: ${metadata.sourceType} (${metadata.loadedFrom})`);
        if (metadata.symlinkPath) {
          console.log(`   Symlink: ${metadata.symlinkPath}`);
        }
      }
    } else {
      console.log(`❌ Failed to reload ${connectorName}`);
    }
    
  } catch (error) {
    console.error(`❌ Error reloading connector: ${error.message}`);
  }
}

/**
 * Show connector status
 */
async function showConnectorStatus(connectorName = null) {
  try {
    const { projectRoot } = await resolveProjectConfig();
    await connectorManager.loadConnectorConfig({ projectDir: projectRoot });
    const connectorConfigs = await getProjectConnectorsConfig(projectRoot);
    
    if (connectorName) {
      // Show status for specific connector
      const connectorConfig = connectorConfigs[connectorName] || {};
      
      console.log(`\n📊 Status for ${connectorName}`);
      console.log('='.repeat(20 + connectorName.length));
      
      if (Object.keys(connectorConfig).length === 0) {
        console.log('❌ Not configured');
        return;
      }
      
      console.log(`Enabled: ${connectorConfig.enabled ? '✅' : '❌'}`);
      console.log(`Auto-load: ${connectorConfig.autoLoad ? '✅' : '❌'}`);
      
      if (connectorManager.isConnectorLoaded(connectorName)) {
        console.log('Status: 🟢 Loaded');
        
        const healthResult = await connectorManager.healthCheck(connectorName);
        console.log(`Health: ${healthResult.healthy ? '✅ Healthy' : '❌ Unhealthy'}`);
        
        if (!healthResult.healthy) {
          console.log(`Reason: ${healthResult.message}`);
        }
        
        const metadata = connectorManager.getConnectorMetadata(connectorName);
        if (metadata) {
          console.log(`Version: ${metadata.version || 'Unknown'}`);
          console.log(`Type: ${metadata.type || 'Unknown'}`);
          console.log(`Source: ${metadata.sourceType} (${metadata.loadedFrom})`);
          if (metadata.symlinkPath) {
            console.log(`Symlink: ${metadata.symlinkPath}`);
          }
        }
      } else {
        console.log('Status: ⚫ Not loaded');
      }
      
    } else {
      // Show status for all connectors
      console.log('\n📊 Connector Status Overview');
      console.log('===========================');
      
      if (Object.keys(connectorConfigs).length === 0) {
        console.log('No connectors configured.');
        return;
      }
      
      for (const [name, connectorConfig] of Object.entries(connectorConfigs)) {
        const status = connectorManager.isConnectorLoaded(name) ? '🟢' : '⚫';
        const enabled = connectorConfig.enabled ? '✅' : '❌';
        
        console.log(`${status} ${name} (enabled: ${enabled})`);
        
        if (connectorManager.isConnectorLoaded(name)) {
          const healthResult = await connectorManager.healthCheck(name);
          console.log(`    Health: ${healthResult.healthy ? '✅' : '❌'} ${healthResult.message}`);
          
          const metadata = connectorManager.getConnectorMetadata(name);
          if (metadata && metadata.sourceType !== 'npm') {
            console.log(`    Source: ${metadata.sourceType} (${metadata.loadedFrom})`);
          }
        }
      }
    }
    
  } catch (error) {
    console.error(`❌ Error getting connector status: ${error.message}`);
  }
}

/**
 * Remove connector configuration
 */
async function removeConnector(connectorName) {
  const rl = createReadlineInterface();
  
  try {
    const currentConfig = await getProjectConnectorConfig(connectorName);
    
    if (Object.keys(currentConfig).length === 0) {
      console.log(`❌ Connector '${connectorName}' is not configured.`);
      rl.close();
      return;
    }
    
    console.log(`\n⚠️  This will remove the configuration for '${connectorName}'.`);
    console.log('The package will remain installed but will not be loaded or used.');
    
    const confirmInput = await askQuestion(rl, 
      `Are you sure you want to remove this connector configuration? (y/n): `
    );
    
    if (convertInputToBoolean(confirmInput, false)) {
      // Unload if currently loaded
      if (connectorManager.isConnectorLoaded(connectorName)) {
        await connectorManager.unloadConnector(connectorName);
      }
      
      // Remove configuration
      const { removed } = await removeProjectConnectorConfig(connectorName);
      
      if (removed) {
        console.log(`✅ Configuration removed for ${connectorName}`);
      } else {
        console.log(`❌ Failed to remove configuration for ${connectorName}`);
      }
    } else {
      console.log('Operation cancelled.');
    }
    
  } catch (error) {
    console.error(`❌ Error removing connector: ${error.message}`);
  } finally {
    rl.close();
  }
}

/**
 * List available connectors (both installed and suggested)
 */
async function listConnectors() {
  console.log('\n📦 Available Connectors');
  console.log('======================');
  
  // Check what's installed
  try {
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    if (await fs.pathExists(packageJsonPath)) {
      const packageJson = await fs.readJson(packageJsonPath);
      const dependencies = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies
      };
      
      const installedConnectors = Object.keys(dependencies).filter(name => 
        name.startsWith('form0-connector-')
      );
      
      if (installedConnectors.length > 0) {
        console.log('\n✅ Installed:');
        for (const name of installedConnectors) {
          const connectorPath = path.join(process.cwd(), 'node_modules', name);
          
          // Check if it's a symlink (npm linked)
          if (await fs.pathExists(connectorPath)) {
            const stats = await fs.lstat(connectorPath);
            if (stats.isSymbolicLink()) {
              const realPath = await fs.realpath(connectorPath);
              console.log(`   - ${name} 🔗 (linked to ${realPath})`);
            } else {
              // Check if it's a local file installation
              const version = dependencies[name];
              if (version.startsWith('file:')) {
                console.log(`   - ${name} 📁 (local: ${version})`);
              } else {
                console.log(`   - ${name} 📦 (v${version})`);
              }
            }
          } else {
            console.log(`   - ${name} ⚠️  (not found in node_modules)`);
          }
        }
      }
    }
  } catch (error) {
    console.warn('Could not check installed packages');
  }
  
  // List suggested connectors
  console.log('\n💡 Suggested:');
  console.log('   - form0-connector-pg (PostgreSQL database storage)');
  console.log('   - form0-connector-sqlite (SQLite database storage)');
  console.log('   - form0-connector-mysql (MySQL database storage)');
  console.log('   - form0-connector-mongodb (MongoDB database storage)');
  console.log('   - form0-connector-webhook (HTTP webhook integration)');
  console.log('   - form0-connector-email (Email notifications)');
  
  console.log('\n📖 Installation options:');
  console.log('   npm package:     form0 connector install <connector-name>');
  console.log('   local path:      form0 connector install ../path/to/connector');
  console.log('   absolute path:   form0 connector install /absolute/path/to/connector');
  console.log('   npm link:        npm link <connector-name> && form0 connector install <connector-name>');
  console.log('\n🔧 Configuration:');
  console.log('   form0 connector configure <connector-name>');
}

/**
 * Main connector command handler
 */
export async function connectorCommand(action, connectorName) {
  switch (action) {
    case 'install':
      if (!connectorName) {
        console.error('❌ Connector name is required for install action');
        console.log('Usage: form0 connector install <connector-name-or-path>');
        console.log('Examples:');
        console.log('  form0 connector install form0-connector-pg');
        console.log('  form0 connector install ../form0-connector-pg');
        console.log('  form0 connector install /absolute/path/to/connector');
        return;
      }
      await installConnector(connectorName);
      break;
      
    case 'configure':
      if (!connectorName) {
        console.error('❌ Connector name is required for configure action');
        console.log('Usage: form0 connector configure <connector-name>');
        return;
      }
      await configureConnector(connectorName);
      break;
      
    case 'test':
      if (!connectorName) {
        console.error('❌ Connector name is required for test action');
        console.log('Usage: form0 connector test <connector-name>');
        return;
      }
      await testConnectorConnection(connectorName);
      break;

    case 'reload':
      if (!connectorName) {
        console.error('❌ Connector name is required for reload action');
        console.log('Usage: form0 connector reload <connector-name>');
        return;
      }
      await reloadConnector(connectorName);
      break;
      
    case 'status':
      await showConnectorStatus(connectorName);
      break;
      
    case 'remove':
      if (!connectorName) {
        console.error('❌ Connector name is required for remove action');
        console.log('Usage: form0 connector remove <connector-name>');
        return;
      }
      await removeConnector(connectorName);
      break;
      
    case 'list':
      await listConnectors();
      break;
      
    default:
      console.log('\n🔌 form0 Connector Management');
      console.log('============================');
      console.log('');
      console.log('Available commands:');
      console.log('  install <name>    Install a connector package');
      console.log('  configure <name>  Configure a connector interactively');
      console.log('  test <name>       Test connector connection');
      console.log('  reload <name>     Reload connector (useful during development)');
      console.log('  status [name]     Show connector status (all or specific)');
      console.log('  remove <name>     Remove connector configuration');
      console.log('  list              List available connectors');
      console.log('');
      console.log('Installation examples:');
      console.log('  form0 connector install form0-connector-pg');
      console.log('  form0 connector install ../form0-connector-pg');
      console.log('  form0 connector install /absolute/path/to/connector');
      console.log('');
      console.log('Development workflow:');
      console.log('  npm link connector-package && form0 connector install connector-package');
      console.log('  form0 connector configure connector-package');
      console.log('  form0 connector test connector-package');
      console.log('  form0 connector reload connector-package  # After making changes');
      console.log('');
      break;
  }
}
