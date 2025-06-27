#!/usr/bin/env node

// Basic test to show theme switching works
import { loadConfig, updateConfig, getConfig } from './src/utils/config.js';
import { colors, getCurrentTheme, getAvailableThemes } from './src/utils/theme.js';

console.log('🎨 Basic Theme System Test\n');

// Load config (this will create default config if none exists)
await loadConfig();

console.log('Available themes:', getAvailableThemes().join(', '));
console.log('Current theme:', getCurrentTheme().name);
console.log();

// Show current colors
console.log('Current theme colors:');
console.log('  Brand:', colors.brand('form0 CLI'));
console.log('  Success:', colors.success('✅ Success message'));
console.log('  Error:', colors.error('❌ Error message'));
console.log('  Warning:', colors.warning('⚠️ Warning message'));
console.log('  Header:', colors.header('📋 Header Text'));
console.log();

// Switch to the other theme
const currentTheme = getCurrentTheme().name;
const otherTheme = currentTheme === 'dark' ? 'light' : 'dark';

console.log(`Switching to ${otherTheme} theme...`);
await updateConfig({ theme: otherTheme });
console.log();

console.log(`${otherTheme} theme colors:`);
console.log('  Brand:', colors.brand('form0 CLI'));
console.log('  Success:', colors.success('✅ Success message'));
console.log('  Error:', colors.error('❌ Error message'));
console.log('  Warning:', colors.warning('⚠️ Warning message'));
console.log('  Header:', colors.header('📋 Header Text'));
console.log();

// Switch back
console.log(`Switching back to ${currentTheme} theme...`);
await updateConfig({ theme: currentTheme });
console.log();

console.log('✅ Theme system is working!');
console.log(`📁 Config saved to: ${process.env.HOME || process.env.USERPROFILE}/.form0-cli/config.json`); 