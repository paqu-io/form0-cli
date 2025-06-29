import { updateConfig, getConfig, getAvailableLocales } from '../utils/config.js';
import { getLocale, getSupportedLocales } from '../utils/i18n.js';
import { colors } from '../utils/theme.js';

/**
 * Handle locale command
 */
export async function localeCommand(localeName) {
  if (!localeName) {
    // Show current locale and available options
    showLocaleStatus();
    return;
  }

  const availableLocales = getAvailableLocales();
  
  if (!availableLocales.includes(localeName)) {
    console.log(colors.error(`❌ Invalid locale: ${localeName}`));
    console.log(colors.textSecondary(`Available locales: ${availableLocales.join(', ')}`));
    return;
  }

  // Update locale
  const success = await updateConfig({ locale: localeName });
  
  if (success) {
    const displayName = localeName === 'auto' ? 'auto-detect' : localeName;
    console.log(colors.success(`✅ Locale set to: ${displayName}`));
    console.log(colors.textSecondary('Locale preference saved to your configuration.'));
    
    if (localeName === 'auto') {
      const detectedLocale = getLocale();
      console.log(colors.textSecondary(`Currently detected: ${detectedLocale}`));
    }
  } else {
    console.log(colors.error('❌ Failed to save locale preference'));
  }
}

/**
 * Show current locale status
 */
function showLocaleStatus() {
  const config = getConfig();
  const currentLocale = getLocale();
  const configLocale = config.locale || 'auto';
  const availableLocales = getAvailableLocales();
  const supportedLocales = getSupportedLocales();

  console.log(colors.header('\n🌍 Locale Settings:\n'));
  console.log(colors.textSecondary('  Configuration:'), colors.value(configLocale));
  console.log(colors.textSecondary('  Current locale:'), colors.value(currentLocale));
  
  if (configLocale === 'auto') {
    console.log(colors.textSecondary('  Detection:'), colors.textMuted('Auto-detected from system'));
  }
  
  console.log(colors.textSecondary('  Available options:'), colors.textMuted(availableLocales.join(', ')));
  console.log(colors.textSecondary('  Supported languages:'), colors.textMuted(supportedLocales.filter(l => l !== 'auto').join(', ')));
  console.log();
  console.log(colors.textSecondary('  Usage:'));
  console.log(colors.textMuted('    locale              Show current locale'));
  console.log(colors.textMuted('    locale <option>     Set locale preference'));
  console.log();
  console.log(colors.textSecondary('  Examples:'));
  console.log(colors.textMuted('    locale auto         Auto-detect from system (default)'));
  console.log(colors.textMuted('    locale en           Force English'));
  console.log(colors.textMuted('    locale es           Force Spanish'));
  console.log(colors.textMuted('    locale fr           Force French'));
  console.log(colors.textMuted('    locale it           Force Italian'));
  console.log();
  
  // Show language examples
  showLanguageExamples();
}

/**
 * Show examples of messages in different languages
 */
function showLanguageExamples() {
  console.log(colors.header('🗣️  Language Examples:\n'));
  
  const examples = {
    en: '✅ Schema is valid.',
    es: '✅ El esquema es válido.',
    fr: '✅ Le schéma est valide.',
    it: '✅ Lo schema è valido.'
  };
  
  console.log(colors.textSecondary('  Sample message in different languages:'));
  Object.entries(examples).forEach(([lang, message]) => {
    const isCurrentLang = lang === getLocale();
    const indicator = isCurrentLang ? colors.success(' ← current') : '';
    console.log(colors.textSecondary(`    ${lang}:`), colors.text(message) + indicator);
  });
  console.log();
} 