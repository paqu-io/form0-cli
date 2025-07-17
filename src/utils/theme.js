import chalk from 'chalk';

// Theme definitions
export const THEMES = {
  dark: {
    name: 'dark',
    colors: {
      // Brand and primary colors
      brand: '#DB3700',
      primary: '#4A9EFF',

      // Status colors
      success: '#13A10E',
      error: '#EF4444',
      warning: '#C19C00',
      info: '#2563EB',

      // Text colors
      text: '#FFFFFF',
      textSecondary: '#9CA3AF',
      textMuted: '#6B7280',

      // Accent colors for different elements
      accent1: '#06B6D4', // cyan
      accent2: '#8B5CF6', // purple/magenta
      accent3: '#10B981', // green
      accent4: '#F59E0B', // yellow
      accent5: '#EF4444', // red
      accent6: '#3B82F6', // blue
      accent7: '#F97316', // orange
      accent8: '#EC4899', // pink
    },
  },

  light: {
    name: 'light',
    colors: {
      // Brand and primary colors (slightly darker for contrast)
      brand: '#DB3700', // Let's use the same brand color for both dark and light themes
      primary: '#2563EB',

      // Status colors (darker variants)
      success: '#13A10E',
      error: '#EF4444',
      warning: '#C19C00',
      info: '#2563EB',

      // Text colors (dark on light)
      text: '#111827',
      textSecondary: '#4B5563',
      textMuted: '#6B7280',

      // Accent colors (darker for better contrast on light backgrounds)
      accent1: '#0891B2', // cyan
      accent2: '#7C3AED', // purple/magenta
      accent3: '#059669', // green
      accent4: '#D97706', // yellow
      accent5: '#DC2626', // red
      accent6: '#2563EB', // blue
      accent7: '#EA580C', // orange
      accent8: '#DB2777', // pink
    },
  },
};

// Current theme (will be loaded from config)
let currentTheme = THEMES.dark;

/**
 * Set the current theme
 */
export function setTheme(themeName) {
  if (THEMES[themeName]) {
    currentTheme = THEMES[themeName];
    return true;
  }
  return false;
}

/**
 * Get the current theme
 */
export function getCurrentTheme() {
  return currentTheme;
}

/**
 * Get available theme names
 */
export function getAvailableThemes() {
  return Object.keys(THEMES);
}

/**
 * Theme-aware color functions
 */
export const colors = {
  // Brand colors
  brand: (text) => chalk.hex(currentTheme.colors.brand)(text),
  brandBold: (text) => chalk.hex(currentTheme.colors.brand).bold(text),

  // Status colors
  success: (text) => chalk.hex(currentTheme.colors.success)(text),
  error: (text) => chalk.hex(currentTheme.colors.error)(text),
  warning: (text) => chalk.hex(currentTheme.colors.warning)(text),
  info: (text) => chalk.hex(currentTheme.colors.info)(text),

  // Text colors
  text: (text) => chalk.hex(currentTheme.colors.text)(text),
  textSecondary: (text) => chalk.hex(currentTheme.colors.textSecondary)(text),
  textMuted: (text) => chalk.hex(currentTheme.colors.textMuted)(text),

  // Accent colors for different UI elements
  accent1: (text) => chalk.hex(currentTheme.colors.accent1)(text),
  accent2: (text) => chalk.hex(currentTheme.colors.accent2)(text),
  accent3: (text) => chalk.hex(currentTheme.colors.accent3)(text),
  accent4: (text) => chalk.hex(currentTheme.colors.accent4)(text),
  accent5: (text) => chalk.hex(currentTheme.colors.accent5)(text),
  accent6: (text) => chalk.hex(currentTheme.colors.accent6)(text),
  accent7: (text) => chalk.hex(currentTheme.colors.accent7)(text),
  accent8: (text) => chalk.hex(currentTheme.colors.accent8)(text),

  // Styled combinations
  header: (text) => chalk.hex(currentTheme.colors.info).bold(text),
  label: (text) => chalk.hex(currentTheme.colors.text).bold(text),
  value: (text) => chalk.hex(currentTheme.colors.accent1)(text),

  // Field type colors (for form preview)
  fieldSection: (text) => chalk.hex(currentTheme.colors.accent2)(text),
  fieldText: (text) => chalk.hex(currentTheme.colors.accent3)(text),
  fieldNumeric: (text) => chalk.hex(currentTheme.colors.accent6)(text),
  fieldCalculated: (text) => chalk.hex(currentTheme.colors.accent4)(text),
  fieldChoice: (text) => chalk.hex(currentTheme.colors.accent5)(text),
  fieldDate: (text) => chalk.hex(currentTheme.colors.accent1)(text),
  fieldTime: (text) => chalk.hex(currentTheme.colors.accent1)(text),
  fieldLabel: (text) => chalk.hex(currentTheme.colors.accent6)(text),
  fieldSignature: (text) => chalk.hex(currentTheme.colors.accent7)(text),
  fieldMedia: (text) => chalk.hex(currentTheme.colors.accent8)(text),
  fieldDefault: (text) => chalk.hex(currentTheme.colors.accent1)(text),
};
