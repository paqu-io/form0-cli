import { updateConfig, getConfig } from '../utils/config.js';
import { getAvailableThemes, getCurrentTheme, colors } from '../utils/theme.js';

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
    console.log(colors.error(`❌ Invalid theme: ${themeName}`));
    console.log(colors.textSecondary(`Available themes: ${availableThemes.join(', ')}`));
    return;
  }

  // Update theme
  const success = await updateConfig({ theme: themeName });
  
  if (success) {
    console.log(colors.success(`✅ Theme switched to: ${themeName}`));
    console.log(colors.textSecondary('Theme preference saved to your configuration.'));
  } else {
    console.log(colors.error('❌ Failed to save theme preference'));
  }
}

/**
 * Show current theme status
 */
function showThemeStatus() {
  const currentTheme = getCurrentTheme();
  const availableThemes = getAvailableThemes();
  const config = getConfig();

  console.log(colors.header('\n🎨 Theme Settings:\n'));
  console.log(colors.textSecondary('  Current theme:'), colors.value(currentTheme.name));
  console.log(colors.textSecondary('  Available themes:'), colors.textMuted(availableThemes.join(', ')));
  console.log();
  console.log(colors.textSecondary('  Usage:'));
  console.log(colors.textMuted('    theme              Show current theme'));
  console.log(colors.textMuted('    theme <name>       Switch to theme'));
  console.log();
  console.log(colors.textSecondary('  Examples:'));
  console.log(colors.textMuted('    theme dark         Switch to dark theme'));
  console.log(colors.textMuted('    theme light        Switch to light theme'));
  console.log();
  
  // Show color preview
  showColorPreview();
}

/**
 * Show a preview of the current theme colors
 */
function showColorPreview() {
  console.log(colors.header('🌈 Current Theme Preview:\n'));
  
  console.log(colors.textSecondary('  Brand:'), colors.brand('form0 CLI'));
  console.log(colors.textSecondary('  Success:'), colors.success('✅ Operation completed'));
  console.log(colors.textSecondary('  Error:'), colors.error('❌ Something went wrong'));
  console.log(colors.textSecondary('  Warning:'), colors.warning('⚠️  Please check this'));
  console.log(colors.textSecondary('  Info:'), colors.info('ℹ️  Information message'));
  console.log();
  
  console.log(colors.textSecondary('  Field Types:'));
  console.log(colors.textSecondary('    Section:'), colors.fieldSection('Section'));
  console.log(colors.textSecondary('    Text Field:'), colors.fieldText('TextField'));
  console.log(colors.textSecondary('    Numeric:'), colors.fieldNumeric('NumericField'));
  console.log(colors.textSecondary('    Calculated:'), colors.fieldCalculated('CalculatedField'));
  console.log();
} 