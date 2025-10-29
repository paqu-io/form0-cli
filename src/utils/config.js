import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { setTheme, getAvailableThemes } from './theme.js';

// Available locales
const AVAILABLE_LOCALES = ['auto', 'en', 'es', 'fr', 'it'];

// Configuration file path
const CONFIG_DIR = path.join(os.homedir(), '.form0-cli');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// Default configuration
const DEFAULT_CONFIG = {
  theme: 'dark',
  locale: 'auto', // 'auto' means detect from system, or specific locale like 'en', 'es', etc.
  version: '1.0.0',
  connectors: {
    // Connector-specific configuration
    // Example:
    // 'form0-connector-pg': {
    //   enabled: true,
    //   autoLoad: false
    // }
  }
};

let currentConfig = { ...DEFAULT_CONFIG };

/**
 * Convert string boolean-like values to actual booleans
 * @param {any} value - Value to convert
 * @returns {boolean|any} - Boolean if conversion is possible, original value otherwise
 */
function convertToBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  
  if (typeof value === 'string') {
    const lowerValue = value.toLowerCase().trim();
    if (['true', 'yes', 'y', '1', 'on'].includes(lowerValue)) {
      return true;
    }
    if (['false', 'no', 'n', '0', 'off'].includes(lowerValue)) {
      return false;
    }
  }
  
  return value; // Return original value if no conversion possible
}

/**
 * Normalize connector configuration by converting string boolean values
 * @param {Object} connectorConfig - Connector configuration object
 * @returns {Object} - Normalized configuration
 */
function normalizeConnectorConfig(connectorConfig) {
  if (!connectorConfig || typeof connectorConfig !== 'object') {
    return connectorConfig;
  }

  const normalized = {};
  
  for (const [connectorName, config] of Object.entries(connectorConfig)) {
    if (typeof config !== 'object' || config === null) {
      normalized[connectorName] = config;
      continue;
    }

    const normalizedConfig = { ...config };
    
    // Convert boolean-like string values for known boolean fields
    if ('enabled' in normalizedConfig) {
      normalizedConfig.enabled = convertToBoolean(normalizedConfig.enabled);
    }
    
    if ('autoLoad' in normalizedConfig) {
      normalizedConfig.autoLoad = convertToBoolean(normalizedConfig.autoLoad);
    }
    
    normalized[connectorName] = normalizedConfig;
  }
  
  return normalized;
}

/**
 * Ensure config directory exists
 */
async function ensureConfigDir() {
  try {
    await fs.ensureDir(CONFIG_DIR);
    return true;
  } catch (error) {
    console.error('Failed to create config directory:', error.message);
    return false;
  }
}

/**
 * Validate connector configuration
 * @param {Object} connectorConfig - Connector configuration object
 */
function validateConnectorConfig(connectorConfig) {
  if (!connectorConfig || typeof connectorConfig !== 'object') {
    return true; // Empty or null config is valid
  }

  for (const [connectorName, config] of Object.entries(connectorConfig)) {
    if (typeof config !== 'object' || config === null) {
      throw new Error(`Invalid connector configuration for '${connectorName}': must be an object`);
    }

    // Validate boolean fields if present
    if ('enabled' in config && typeof config.enabled !== 'boolean') {
      throw new Error(`Invalid 'enabled' setting for connector '${connectorName}': must be a boolean (true/false). Received: ${typeof config.enabled} "${config.enabled}". Try using 'y'/'n' or 'yes'/'no' values.`);
    }

    if ('autoLoad' in config && typeof config.autoLoad !== 'boolean') {
      throw new Error(`Invalid 'autoLoad' setting for connector '${connectorName}': must be a boolean (true/false). Received: ${typeof config.autoLoad} "${config.autoLoad}". Try using 'y'/'n' or 'yes'/'no' values.`);
    }
  }

  return true;
}

/**
 * Load configuration from file
 */
export async function loadConfig() {
  try {
    // Ensure config directory exists
    await ensureConfigDir();

    // Check if config file exists
    if (await fs.pathExists(CONFIG_FILE)) {
      const configData = await fs.readJson(CONFIG_FILE);

      // Merge with defaults to handle missing keys
      currentConfig = { 
        ...DEFAULT_CONFIG, 
        ...configData,
        // Ensure connectors object exists and merge properly
        connectors: { 
          ...DEFAULT_CONFIG.connectors, 
          ...(configData.connectors || {}) 
        }
      };

      // Normalize connector configuration (convert string booleans)
      currentConfig.connectors = normalizeConnectorConfig(currentConfig.connectors);

      // Validate theme
      const availableThemes = getAvailableThemes();
      if (!availableThemes.includes(currentConfig.theme)) {
        console.warn(`Invalid theme '${currentConfig.theme}' in config, using default 'dark'`);
        currentConfig.theme = 'dark';
      }

      // Validate locale
      if (!AVAILABLE_LOCALES.includes(currentConfig.locale)) {
        console.warn(`Invalid locale '${currentConfig.locale}' in config, using default 'auto'`);
        currentConfig.locale = 'auto';
      }

      // Validate connector configuration
      try {
        validateConnectorConfig(currentConfig.connectors);
      } catch (error) {
        console.warn(`Invalid connector configuration: ${error.message}, using defaults`);
        currentConfig.connectors = { ...DEFAULT_CONFIG.connectors };
      }

      // Apply theme
      setTheme(currentConfig.theme);

      // Initialize i18n after config is loaded
      const { reinitializeLocale } = await import('./i18n.js');
      reinitializeLocale();

      return currentConfig;
    } else {
      // Create default config file
      await saveConfig();

      // Initialize i18n with default config
      const { reinitializeLocale } = await import('./i18n.js');
      reinitializeLocale();

      return currentConfig;
    }
  } catch (error) {
    console.error('Failed to load config:', error.message);
    // Use defaults if loading fails
    setTheme(currentConfig.theme);

    // Initialize i18n with defaults
    const { reinitializeLocale } = await import('./i18n.js');
    reinitializeLocale();

    return currentConfig;
  }
}

/**
 * Save configuration to file
 */
export async function saveConfig() {
  try {
    await ensureConfigDir();
    await fs.writeJson(CONFIG_FILE, currentConfig, { spaces: 2 });
    return true;
  } catch (error) {
    console.error('Failed to save config:', error.message);
    return false;
  }
}

/**
 * Get current configuration
 */
export function getConfig() {
  return { ...currentConfig };
}

/**
 * Update configuration
 */
export async function updateConfig(updates) {
  try {
    // Validate updates
    if (updates.theme && !getAvailableThemes().includes(updates.theme)) {
      throw new Error(`Invalid theme: ${updates.theme}`);
    }

    if (updates.locale && !AVAILABLE_LOCALES.includes(updates.locale)) {
      throw new Error(`Invalid locale: ${updates.locale}`);
    }

    if (updates.connectors) {
      // Normalize connector configuration before validation
      const normalizedConnectors = normalizeConnectorConfig(updates.connectors);
      validateConnectorConfig(normalizedConnectors);
      updates.connectors = normalizedConnectors;
    }

    // Update config with proper merging for nested objects
    currentConfig = { 
      ...currentConfig, 
      ...updates,
      // Properly merge connectors config
      ...(updates.connectors && {
        connectors: { 
          ...currentConfig.connectors, 
          ...updates.connectors 
        }
      })
    };

    // Apply theme if changed
    if (updates.theme) {
      setTheme(updates.theme);
    }

    // Apply locale if changed
    if (updates.locale) {
      // Import here to avoid circular dependency
      const { reinitializeLocale } = await import('./i18n.js');
      reinitializeLocale();
    }

    // Save to file
    await saveConfig();

    return true;
  } catch (error) {
    console.error('Failed to update config:', error.message);
    return false;
  }
}

/**
 * Update connector configuration
 * @param {string} connectorName - Name of the connector
 * @param {Object} connectorConfig - Configuration for the connector
 */
export async function updateConnectorConfig(connectorName, connectorConfig) {
  try {
    if (!connectorName || typeof connectorName !== 'string') {
      throw new Error('Connector name must be a non-empty string');
    }

    // Normalize the single connector config before validation
    const normalizedConfig = normalizeConnectorConfig({ [connectorName]: connectorConfig });
    
    const newConnectors = {
      ...currentConfig.connectors,
      ...normalizedConfig
    };

    validateConnectorConfig(newConnectors);

    return await updateConfig({ connectors: newConnectors });
  } catch (error) {
    console.error(`Failed to update connector config for '${connectorName}':`, error.message);
    return false;
  }
}

/**
 * Get connector configuration
 * @param {string} connectorName - Name of the connector
 */
export function getConnectorConfig(connectorName) {
  return currentConfig.connectors[connectorName] || {};
}

/**
 * Remove connector configuration
 * @param {string} connectorName - Name of the connector
 */
export async function removeConnectorConfig(connectorName) {
  try {
    const newConnectors = { ...currentConfig.connectors };
    delete newConnectors[connectorName];

    return await updateConfig({ connectors: newConnectors });
  } catch (error) {
    console.error(`Failed to remove connector config for '${connectorName}':`, error.message);
    return false;
  }
}

/**
 * Reset configuration to defaults
 */
export async function resetConfig() {
  currentConfig = { ...DEFAULT_CONFIG };
  setTheme(currentConfig.theme);
  return await saveConfig();
}

/**
 * Get available locales
 */
export function getAvailableLocales() {
  return [...AVAILABLE_LOCALES];
}

/**
 * Get config file path (for debugging)
 */
export function getConfigPath() {
  return CONFIG_FILE;
}