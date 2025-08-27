/**
 * Version utilities for form0-cli
 * CLI-specific helpers that extend form0-core utilities
 */

import { recordVersion, formVersion } from 'form0-core';

// Re-export core utilities for convenience
export { recordVersion, formVersion };

/**
 * Generate development version string for CLI usage
 * @param {string} baseVersion - e.g., "1" or "1.1.1"
 * @returns {string} - e.g., "1-dev1704123456"
 */
export function generateDevVersion(baseVersion = '1') {
  return formVersion.createDev(baseVersion);
}

/**
 * Validate form version (alias for core function)
 * @param {*} version
 * @returns {boolean}
 */
export function isValidFormVersion(version) {
  return formVersion.isValid(version);
}

/**
 * Validate record version (alias for core function)
 * @param {*} version
 * @returns {boolean}
 */
export function isValidRecordVersion(version) {
  return recordVersion.isValid(version);
}

/**
 * Parse version information for display (extends core with CLI-specific data)
 * @param {string} version
 * @returns {Object} - Display information about the version
 */
export function parseVersionInfo(version) {
  const coreInfo = formVersion.parse(version);

  if (!coreInfo) {
    return {
      valid: false,
      display: String(version),
      type: 'unknown',
    };
  }

  return {
    valid: true,
    display: version,
    base: coreInfo.base,
    environment: coreInfo.environment,
    type: coreInfo.isProduction ? 'production' : 'development',
    isProduction: coreInfo.isProduction,
    isDevelopment: !coreInfo.isProduction,
  };
}

/**
 * Format version for CLI display with colors
 * @param {string} version
 * @param {Object} chalk - Chalk instance for coloring
 * @returns {string} - Formatted version string
 */
export function formatVersionDisplay(version, chalk) {
  const info = parseVersionInfo(version);

  if (!info.valid) {
    return chalk.red(`❌ ${info.display}`);
  }

  if (info.isProduction) {
    return chalk.green(`📦 ${info.display}`);
  } else {
    return chalk.yellow(`🚧 ${info.display}`);
  }
}
