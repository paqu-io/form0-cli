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
};

let currentConfig = { ...DEFAULT_CONFIG };

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
      currentConfig = { ...DEFAULT_CONFIG, ...configData };

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

    // Update config
    currentConfig = { ...currentConfig, ...updates };

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
