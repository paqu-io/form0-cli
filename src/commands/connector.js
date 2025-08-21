import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'child_process';
import { connectorManager } from '../utils/connector-manager.js';
import { 
  getConfig, 
  updateConnectorConfig, 
  getConnectorConfig, 
  removeConnectorConfig 
} from '../utils/config.js';
import { t } from '../utils/i18n.js';
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
        installSuccess = true; // Already linked
        break;

      case 'installed':
        console.log(`📦 Connector already installed: ${resolution.packageJson.name}`);
        connectorName = resolution.packageJson.name;
        installSuccess = true; // Already installed
        break;

      case 'npm':
        connectorName = resolution.name;
        
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
  
  const currentConfig = getConnectorConfig(connectorName);
  
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
}

/**
 * Generic connector configuration
 */
async function configureGenericConnector(rl, connectorName) {
  console.log(`\n🔧 ${connectorName} Configuration`);
  console.log('================================');
  
  const currentConfig = getConnectorConfig(connectorName);
  
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
}

/**
 * Configure a connector interactively
 */
async function configureConnector(connectorName) {
  const rl = createReadlineInterface();
  
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
      const testInput = await askQuestion(rl, 
        '\nTest connection now? (y/n): '
      );
      
      if (convertInputToBoolean(testInput, false)) {
        await testConnectorConnection(connectorName);
      }
    } else {
      console.log(`\n❌ Failed to save configuration for ${connectorName}`);
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
 * Reload a connector (useful during development)
 */
async function reloadConnector(connectorName) {
  try {
    console.log(`\n🔄 Reloading connector: ${connectorName}...`);
    
    await connectorManager.loadConnectorConfig();
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
    await connectorManager.loadConnectorConfig();
    const config = getConfig();
    
    if (connectorName) {
      // Show status for specific connector
      const connectorConfig = getConnectorConfig(connectorName);
      
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
      
      const connectorConfigs = config.connectors || {};
      
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
    const currentConfig = getConnectorConfig(connectorName);
    
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
      const success = await removeConnectorConfig(connectorName);
      
      if (success) {
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