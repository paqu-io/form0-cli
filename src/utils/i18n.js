import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { getConfig } from './config.js';

// Get the directory of this module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const DEFAULT_LOCALE = 'en';
const SUPPORTED_LOCALES = ['en', 'es', 'fr', 'it'];
const LOCALES_DIR = path.join(__dirname, '..', 'locales');

// State
let currentLocale = DEFAULT_LOCALE;
let translations = {};
let fallbackTranslations = {};

/**
 * Initialize the i18n system
 * This is called automatically when the module is imported
 */
function initialize() {
  // Determine locale from config and system detection
  const locale = determineLocale();
  setLocale(locale);
}

/**
 * Detect the system locale using Node.js Intl API
 */
function detectSystemLocale() {
  try {
    const systemLocale = Intl.DateTimeFormat().resolvedOptions().locale;
    const langCode = systemLocale.split('-')[0].toLowerCase();
    if (SUPPORTED_LOCALES.includes(langCode)) {
      return langCode;
    }
  } catch (err) {
    // Intl API not available or failed
  }
  return DEFAULT_LOCALE;
}

/**
 * Determine the locale to use based on config and system detection
 */
function determineLocale() {
  const config = getConfig();
  const configLocale = config.locale || 'auto';
  
  if (configLocale === 'auto') {
    return detectSystemLocale();
  } else if (SUPPORTED_LOCALES.includes(configLocale)) {
    return configLocale;
  } else {
    return DEFAULT_LOCALE;
  }
}

/**
 * Set the current locale and load translations
 * @param {string} locale - The locale code (e.g., 'en', 'es', 'fr', 'it')
 */
export function setLocale(locale) {
  if (!SUPPORTED_LOCALES.includes(locale)) {
    // Use raw translation for system messages to avoid circular dependency
    const message = getSystemMessage('unsupportedLocale', { locale, defaultLocale: DEFAULT_LOCALE });
    console.warn(message);
    locale = DEFAULT_LOCALE;
  }

  currentLocale = locale;
  loadTranslations(locale);
  
  // Always load fallback translations (English) if not already loaded
  if (locale !== DEFAULT_LOCALE) {
    loadFallbackTranslations();
  }
}

/**
 * Get the current locale
 * @returns {string} Current locale code
 */
export function getLocale() {
  return currentLocale;
}

/**
 * Get list of supported locales
 * @returns {string[]} Array of supported locale codes
 */
export function getSupportedLocales() {
  return [...SUPPORTED_LOCALES];
}

/**
 * Get system message for internal i18n warnings
 * @param {string} key - The system message key
 * @param {object} params - Parameters to replace
 * @returns {string} System message with parameters replaced
 */
function getSystemMessage(key, params = {}) {
  const systemMessages = {
    unsupportedLocale: "Warning: Unsupported locale '{locale}'. Using '{defaultLocale}' instead.",
    translationFileNotFound: "Warning: Translation file not found: {filePath}",
    failedToLoadTranslations: "Warning: Could not load translations for '{locale}': {message}",
    failedToLoadFallback: "Warning: Could not load fallback translations: {message}",
    translationMissing: "Translation missing for key: '{key}' (locale: {locale})"
  };
  
  let message = systemMessages[key] || key;
  // Replace parameters
  Object.keys(params).forEach(param => {
    message = message.replace(`{${param}}`, params[param]);
  });
  return message;
}

/**
 * Load translations for the specified locale
 * @param {string} locale - The locale to load
 */
function loadTranslations(locale) {
  try {
    const localeFile = path.join(LOCALES_DIR, `${locale}.json`);
    
    if (fs.existsSync(localeFile)) {
      translations = fs.readJsonSync(localeFile);
    } else {
      const message = getSystemMessage('translationFileNotFound', { filePath: localeFile });
      console.warn(message);
      translations = {};
    }
  } catch (err) {
    const message = getSystemMessage('failedToLoadTranslations', { locale, message: err.message });
    console.warn(message);
    translations = {};
  }
}

/**
 * Load fallback translations (English)
 */
function loadFallbackTranslations() {
  try {
    const fallbackFile = path.join(LOCALES_DIR, `${DEFAULT_LOCALE}.json`);
    
    if (fs.existsSync(fallbackFile)) {
      fallbackTranslations = fs.readJsonSync(fallbackFile);
    }
  } catch (err) {
    const message = getSystemMessage('failedToLoadFallback', { message: err.message });
    console.warn(message);
    fallbackTranslations = {};
  }
}

/**
 * Get a nested value from an object using dot notation
 * @param {object} obj - The object to search in
 * @param {string} key - The dot-separated key path
 * @returns {*} The value or undefined if not found
 */
function getNestedValue(obj, key) {
  return key.split('.').reduce((current, keyPart) => {
    return current && current[keyPart];
  }, obj);
}

/**
 * Replace parameters in a string with actual values
 * @param {string} template - The template string with {param} placeholders
 * @param {object} params - Object containing parameter values
 * @returns {string} String with parameters replaced
 */
function replaceParameters(template, params = {}) {
  if (typeof template !== 'string') {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (match, paramName) => {
    if (params.hasOwnProperty(paramName)) {
      return String(params[paramName]);
    }
    return match; // Leave unreplaced if parameter not found
  });
}

/**
 * Translate a key to the current locale
 * @param {string} key - The translation key in dot notation (e.g., 'commands.test.success')
 * @param {object} params - Parameters to replace in the translation
 * @returns {string} Translated string with parameters replaced
 */
export function t(key, params = {}) {
  if (!key || typeof key !== 'string') {
    return key || '';
  }

  // Initialize if not already done (safety check)
  if (Object.keys(translations).length === 0 && Object.keys(fallbackTranslations).length === 0) {
    initialize();
  }

  // Try to get translation from current locale
  let translation = getNestedValue(translations, key);
  
  // If not found, try fallback translations
  if (translation === undefined && fallbackTranslations) {
    translation = getNestedValue(fallbackTranslations, key);
  }
  
  // If still not found, return the key itself (for debugging)
  if (translation === undefined) {
    const message = getSystemMessage('translationMissing', { key, locale: currentLocale });
    console.warn(message);
    return key;
  }

  // Replace parameters and return
  return replaceParameters(translation, params);
}

/**
 * Translate a key with plural support
 * @param {string} key - The translation key
 * @param {number} count - The count to determine plural form
 * @param {object} params - Parameters to replace in the translation
 * @returns {string} Translated string with proper plural form
 */
export function tn(key, count, params = {}) {
  // Add count to params
  const extendedParams = { ...params, count };
  
  // For English, simple plural rule: 1 = singular, != 1 = plural
  // For other languages, this could be extended with proper plural rules
  const pluralKey = count === 1 ? `${key}.singular` : `${key}.plural`;
  
  // Try plural key first, fall back to base key
  let translation = getNestedValue(translations, pluralKey);
  if (translation === undefined) {
    translation = getNestedValue(translations, key);
  }
  
  // If still not found, try fallback
  if (translation === undefined && fallbackTranslations) {
    translation = getNestedValue(fallbackTranslations, pluralKey) || 
                  getNestedValue(fallbackTranslations, key);
  }
  
  if (translation === undefined) {
    const message = getSystemMessage('translationMissing', { key, locale: currentLocale });
    console.warn(message);
    return key;
  }

  return replaceParameters(translation, extendedParams);
}

/**
 * Check if a translation exists for the given key
 * @param {string} key - The translation key to check
 * @returns {boolean} True if translation exists
 */
export function hasTranslation(key) {
  return getNestedValue(translations, key) !== undefined ||
         getNestedValue(fallbackTranslations, key) !== undefined;
}

/**
 * Get raw translation object for a key (useful for complex structures)
 * @param {string} key - The translation key
 * @returns {*} The raw translation value (could be string, object, etc.)
 */
export function getRawTranslation(key) {
  return getNestedValue(translations, key) || 
         getNestedValue(fallbackTranslations, key);
}

/**
 * Reload translations (useful for development or dynamic language switching)
 */
export function reloadTranslations() {
  loadTranslations(currentLocale);
  if (currentLocale !== DEFAULT_LOCALE) {
    loadFallbackTranslations();
  }
}

/**
 * Reinitialize locale based on current config (called when config changes)
 */
export function reinitializeLocale() {
  const locale = determineLocale();
  setLocale(locale);
}

// Don't initialize immediately - wait for config to be loaded
// initialize(); 