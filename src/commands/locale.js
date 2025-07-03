import { updateConfig, getConfig, getAvailableLocales } from '../utils/config.js';
import { getLocale, getSupportedLocales, t } from '../utils/i18n.js';
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
    console.log(colors.error(t('locale.invalidLocale', { name: localeName })));
    console.log(
      colors.textSecondary(t('locale.availableLocales', { locales: availableLocales.join(', ') }))
    );
    return;
  }

  // Update locale
  const success = await updateConfig({ locale: localeName });

  if (success) {
    const displayName = localeName === 'auto' ? t('locale.autoDetect') : localeName;
    console.log(colors.success(t('locale.localeSet', { name: displayName })));
    console.log(colors.textSecondary(t('locale.preferenceSaved')));

    if (localeName === 'auto') {
      const detectedLocale = getLocale();
      console.log(colors.textSecondary(t('locale.currentlyDetected', { locale: detectedLocale })));
    }
  } else {
    console.log(colors.error(t('locale.failedToSave')));
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

  console.log(colors.header('\n' + t('locale.localeSettings') + '\n'));
  console.log(colors.textSecondary(t('locale.configuration')), colors.value(configLocale));
  console.log(colors.textSecondary(t('locale.currentLocale')), colors.value(currentLocale));

  if (configLocale === 'auto') {
    console.log(
      colors.textSecondary(t('locale.detection')),
      colors.textMuted(t('locale.autoDetectedFromSystem'))
    );
  }

  console.log(
    colors.textSecondary(t('locale.availableOptions')),
    colors.textMuted(availableLocales.join(', '))
  );
  console.log(
    colors.textSecondary(t('locale.supportedLanguages')),
    colors.textMuted(supportedLocales.filter((l) => l !== 'auto').join(', '))
  );
  console.log();
  console.log(colors.textSecondary(t('common.usage')));
  console.log(colors.textMuted(t('locale.showCurrent')));
  console.log(colors.textMuted(t('locale.setLocale')));
  console.log();
  console.log(colors.textSecondary(t('common.examples')));
  console.log(colors.textMuted(t('locale.exampleAuto')));
  console.log(colors.textMuted(t('locale.exampleEn')));
  console.log(colors.textMuted(t('locale.exampleEs')));
  console.log(colors.textMuted(t('locale.exampleFr')));
  console.log(colors.textMuted(t('locale.exampleIt')));
  console.log();

  // Show language examples
  showLanguageExamples();
}

/**
 * Show examples of messages in different languages
 */
function showLanguageExamples() {
  console.log(colors.header(t('locale.languageExamples') + '\n'));

  const examples = {
    en: '✅ Schema is valid.',
    es: '✅ El esquema es válido.',
    fr: '✅ Le schéma est valide.',
    it: '✅ Lo schema è valido.',
  };

  console.log(colors.textSecondary(t('locale.sampleMessage')));
  Object.entries(examples).forEach(([lang, message]) => {
    const isCurrentLang = lang === getLocale();
    const indicator = isCurrentLang ? colors.success(t('locale.currentIndicator')) : '';
    console.log(colors.textSecondary(`    ${lang}:`), colors.text(message) + indicator);
  });
  console.log();
}
