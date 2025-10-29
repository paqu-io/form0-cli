import fs from 'fs-extra';
import path from 'path';
import { colors } from './theme.js';
import { t } from './i18n.js';

/**
 * Validate if a connector is installed in node_modules
 */
export async function isConnectorInstalled(connectorName) {
  try {
    // Check if it exists in node_modules
    const nodeModulesPath = path.join(process.cwd(), 'node_modules', connectorName);
    const exists = await fs.pathExists(nodeModulesPath);
    
    if (!exists) {
      return false;
    }
    
    // Check if it has a valid package.json
    const packageJsonPath = path.join(nodeModulesPath, 'package.json');
    const hasPackageJson = await fs.pathExists(packageJsonPath);
    
    return hasPackageJson;
  } catch (error) {
    return false;
  }
}

/**
 * Get installed connectors from node_modules
 */
export async function getInstalledConnectors() {
  try {
    const nodeModulesPath = path.join(process.cwd(), 'node_modules');
    
    if (!await fs.pathExists(nodeModulesPath)) {
      return [];
    }
    
    const entries = await fs.readdir(nodeModulesPath);
    const connectors = [];
    
    for (const entry of entries) {
      // Look for packages that match connector naming patterns
      if (entry.startsWith('form0-connector-')) {
        const installed = await isConnectorInstalled(entry);
        if (installed) {
          connectors.push(entry);
        }
      }
    }
    
    return connectors;
  } catch (error) {
    console.error('Error scanning for installed connectors:', error.message);
    return [];
  }
}

/**
 * Validate connector installation before configuration
 */
export async function validateConnectorForConfiguration(connectorName) {
  const isInstalled = await isConnectorInstalled(connectorName);
  
  if (!isInstalled) {
    console.log(colors.error(t('connectors.validation.notInstalled', { name: connectorName })));
    console.log(colors.textMuted(t('connectors.validation.installSuggestion', { name: connectorName })));
    console.log(colors.textMuted(`  npm install ${connectorName}`));
    console.log();
    return false;
  }
  
  return true;
}