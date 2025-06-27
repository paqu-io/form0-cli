#!/usr/bin/env node

// Simple test script to verify theme system
import { loadConfig, updateConfig } from './src/utils/config.js';
import { colors, getCurrentTheme } from './src/utils/theme.js';

console.log('🧪 Testing form0 theme system...\n');

// Load config
await loadConfig();

console.log('📋 Current theme:', getCurrentTheme().name);
console.log();

// Test dark theme colors
console.log('🌙 Dark theme preview:');
console.log('  Brand:', colors.brand('form0 CLI'));
console.log('  Success:', colors.success('✅ Operation completed'));
console.log('  Error:', colors.error('❌ Something went wrong'));
console.log('  Warning:', colors.warning('⚠️  Please check this'));
console.log('  Info:', colors.info('ℹ️  Information message'));
console.log();

// Switch to light theme
console.log('🔄 Switching to light theme...');
await updateConfig({ theme: 'light' });
console.log();

console.log('☀️  Light theme preview:');
console.log('  Brand:', colors.brand('form0 CLI'));
console.log('  Success:', colors.success('✅ Operation completed'));
console.log('  Error:', colors.error('❌ Something went wrong'));
console.log('  Warning:', colors.warning('⚠️  Please check this'));
console.log('  Info:', colors.info('ℹ️  Information message'));
console.log();

// Switch back to dark theme
console.log('🔄 Switching back to dark theme...');
await updateConfig({ theme: 'dark' });
console.log();

console.log('✅ Theme system test completed!');
console.log('📁 Config saved to: ~/.form0-cli/config.json'); 