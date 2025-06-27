import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { setTheme, getAvailableThemes } from './theme.js';

// Configuration file path
const CONFIG_DIR = path.join(os.homedir(), '.form0-cli');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// Default configuration
const DEFAULT_CONFIG = {
  theme: 'dark',
  version: '1.0.0'
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
      
      // Apply theme
      setTheme(currentConfig.theme);
      
      return currentConfig;
    } else {
      // Create default config file
      await saveConfig();
      return currentConfig;
    }
  } catch (error) {
    console.error('Failed to load config:', error.message);
    // Use defaults if loading fails
    setTheme(currentConfig.theme);
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
    
    // Update config
    currentConfig = { ...currentConfig, ...updates };
    
    // Apply theme if changed
    if (updates.theme) {
      setTheme(updates.theme);
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
 * Get config file path (for debugging)
 */
export function getConfigPath() {
  return CONFIG_FILE;
} 