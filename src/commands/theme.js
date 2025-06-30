import { updateConfig, getConfig } from '../utils/config.js';
import { getAvailableThemes, getCurrentTheme, colors } from '../utils/theme.js';
import { t } from '../utils/i18n.js';

/**
 * Handle theme command
 */
export async function themeCommand(themeName) {
  if (!themeName) {
    // Show current theme and available options
    showThemeStatus();
    return;
  }

  const availableThemes = getAvailableThemes();
  
  if (!availableThemes.includes(themeName)) {
    console.log(colors.error(t('theme.invalidTheme', { name: themeName })));
    console.log(colors.textSecondary(t('theme.availableThemes', { themes: availableThemes.join(', ') })));
    return;
  }

  // Update theme
  const success = await updateConfig({ theme: themeName });
  
  if (success) {
    console.log(colors.success(t('theme.themeSwitched', { name: themeName })));
    console.log(colors.textSecondary(t('theme.preferencesSaved')));
  } else {
    console.log(colors.error(t('theme.failedToSave')));
  }
}

/**
 * Show current theme status
 */
function showThemeStatus() {
  const currentTheme = getCurrentTheme();
  const availableThemes = getAvailableThemes();
  const config = getConfig();

  console.log(colors.header('\n' + t('theme.themeSettings') + '\n'));
  console.log(colors.textSecondary(t('theme.currentTheme')), colors.value(currentTheme.name));
  console.log(colors.textSecondary(t('theme.availableThemes')), colors.textMuted(availableThemes.join(', ')));
  console.log();
  console.log(colors.textSecondary(t('common.usage')));
  console.log(colors.textMuted(t('theme.showCurrent')));
  console.log(colors.textMuted(t('theme.switchTheme')));
  console.log();
  console.log(colors.textSecondary(t('common.examples')));
  console.log(colors.textMuted(t('theme.switchToDark')));
  console.log(colors.textMuted(t('theme.switchToLight')));
  console.log();
  
  // Show color preview
  showColorPreview();
}

/**
 * Show a preview of the current theme colors
 */
function showColorPreview() {
  console.log(colors.header(t('theme.currentPreview') + '\n'));
  
  console.log(colors.textSecondary(t('theme.brand')), colors.brand('form0 CLI'));
  console.log(colors.textSecondary(t('theme.success')), colors.success('✅ Operation completed'));
  console.log(colors.textSecondary(t('theme.error')), colors.error('❌ Something went wrong'));
  console.log(colors.textSecondary(t('theme.warning')), colors.warning('⚠️  Please check this'));
  console.log(colors.textSecondary(t('theme.info')), colors.info('ℹ️  Information message'));
  console.log();
  
  console.log(colors.textSecondary(t('theme.fieldTypes')));
  console.log(colors.textSecondary(t('theme.section')), colors.fieldSection('Section'));
  console.log(colors.textSecondary(t('theme.textField')), colors.fieldText('TextField'));
  console.log(colors.textSecondary(t('theme.numeric')), colors.fieldNumeric('NumericField'));
  console.log(colors.textSecondary(t('theme.calculated')), colors.fieldCalculated('CalculatedField'));
  console.log();
} 