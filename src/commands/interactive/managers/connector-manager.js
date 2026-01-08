import { colors } from '../../../utils/theme.js';
import { t } from '../../../utils/i18n.js';
import { connectorManager } from '../../../utils/connector-manager.js';
import { getInstalledConnectors, validateConnectorForConfiguration } from '../../../utils/connector-validation.js';
import { resolveProjectConfig } from '../../../utils/project-config.js';

/**
 * Interactive connector manager for CLI commands
 */
export class ConnectorManager {
  constructor(shell = null) {
    // Use the shared connector manager instance
    this.connectorManager = connectorManager;
    // Store reference to shell for readline coordination
    this.shell = shell;
  }

  async ensureProjectConfigLoaded() {
    const { projectRoot } = await resolveProjectConfig();
    await this.connectorManager.loadConnectorConfig({ projectDir: projectRoot });
    return projectRoot;
  }

  /**
   * Handle connector commands
   */
  async handleCommand(args) {
    const [subcommand, ...subArgs] = args;

    if (!subcommand) {
      this.showConnectorHelp();
      return;
    }

    switch (subcommand.toLowerCase()) {
      case 'help':
      case 'h':
        this.showConnectorHelp();
        break;

      case 'list':
      case 'ls':
        await this.handleListCommand();
        break;

      case 'status':
      case 'st':
        await this.handleStatusCommand(subArgs);
        break;

      case 'load':
      case 'add':
        await this.handleLoadCommand(subArgs);
        break;

      case 'unload':
      case 'remove':
        await this.handleUnloadCommand(subArgs);
        break;

      case 'test':
        await this.handleTestCommand(subArgs);
        break;

      case 'reload':
        await this.handleReloadCommand(subArgs);
        break;

      case 'config':
        await this.handleConfigCommand();
        break;

      case 'configure':
        await this.handleConfigure(subArgs);
        break;

      default:
        console.log(colors.error(t('connectors.unknownSubcommand', { subcommand })));
        this.showConnectorHelp();
    }
  }

  /**
   * Handle configure command by passing the shell's readline interface
   */
  async handleConfigure(args) {
    const connectorName = args[0];
    
    if (!connectorName) {
      console.log(colors.error(t('connectors.configure.nameRequired')));
      return;
    }

    // First validate installation before attempting configuration
    const isValid = await validateConnectorForConfiguration(connectorName);
    if (!isValid) {
      return;
    }

    try {
      // Set up graceful exit handling for SIGINT (Ctrl+C)
      let configurationInProgress = true;
      
      const gracefulExitHandler = () => {
        if (configurationInProgress) {
          console.log('\n');
          console.log(colors.warning('⚠️ Configuration interrupted by user'));
          console.log(colors.textMuted('Returning to interactive shell...'));
          configurationInProgress = false;
          // Don't exit the entire process, just return to shell
          return;
        }
      };

      process.on('SIGINT', gracefulExitHandler);

      try {
        // Import the configuration function and pass the shell's readline interface
        const { configureConnectorWithShellContext } = await import('./connector-config-helper.js');
        
        if (!this.shell || !this.shell.rl) {
          console.log(colors.error('Error: Shell readline interface not available'));
          return;
        }
        
        // Call the configuration logic with the shell's readline interface
        await configureConnectorWithShellContext(connectorName, this.shell.rl);
        
      } finally {
        configurationInProgress = false;
        // Remove our SIGINT handler
        process.removeListener('SIGINT', gracefulExitHandler);
      }
      
    } catch (error) {
      if (error.message === 'Configuration cancelled by user') {
        // This is expected when user cancels, just return to shell
        return;
      }
      console.log(colors.error(t('connectors.configure.failed', { name: connectorName, message: error.message })));
    }
  }

  /**
   * Show connector command help
   */
  showConnectorHelp() {
    console.log(colors.header('\n' + t('connectors.help.title')));
    console.log(colors.textSecondary(t('help.notation')));
    console.log();
    console.log(colors.accent1(t('connectors.help.management')));
    console.log(colors.text(t('connectors.help.listCommand')));
    console.log(colors.text(t('connectors.help.statusCommand')));
    console.log(colors.text(t('connectors.help.loadCommand')));
    console.log(colors.text(t('connectors.help.unloadCommand')));
    console.log();
    console.log(colors.accent1(t('connectors.help.development')));
    console.log(colors.text(t('connectors.help.testCommand')));
    console.log(colors.text(t('connectors.help.reloadCommand')));
    console.log(colors.text(t('connectors.help.configCommand')));
    console.log(colors.text(t('connectors.help.configureCommand')));
    console.log();
    console.log(colors.accent1(t('connectors.help.cliOnly')));
    console.log(colors.text(t('connectors.help.installCommand')));
    console.log();
    console.log(colors.textMuted(t('common.examples')));
    console.log(colors.textMuted(t('connectors.help.exampleList')));
    console.log(colors.textMuted(t('connectors.help.exampleLoad')));
    console.log(colors.textMuted(t('connectors.help.exampleTest')));
    console.log(colors.textMuted(t('connectors.help.exampleConfigure')));
    console.log();
  }

  /**
   * Enhanced list command that shows installation status, configuration, and loading status
   */
  async handleListCommand() {
    try {
      await this.ensureProjectConfigLoaded();
      const loadedConnectors = this.connectorManager.getLoadedConnectors();
      const config = this.connectorManager.config || {};
      const installedConnectors = await getInstalledConnectors();

      console.log(colors.header('\n' + t('connectors.list.title')));

      // Show installed connectors and their status
      if (installedConnectors.length === 0) {
        console.log(colors.textSecondary('No form0 connectors found in node_modules'));
        console.log(colors.textMuted('Install connectors with: npm install form0-connector-<name>'));
        console.log();
        return;
      }

      console.log(colors.accent1('📦 Installed Connectors'));
      for (const connectorName of installedConnectors) {
        const isLoaded = loadedConnectors.includes(connectorName);
        const isConfigured = !!config[connectorName];
        const connectorConfig = config[connectorName] || {};
        const isEnabled = connectorConfig.enabled;

        // Status indicators
        const installStatus = colors.success('✅ Installed');
        const configStatus = isConfigured 
          ? (isEnabled ? colors.success('✅ Configured & Enabled') : colors.warning('⚪ Configured but Disabled'))
          : colors.textSecondary('⚪ Not configured');
        const loadStatus = isLoaded ? colors.success('✅ Loaded') : colors.textSecondary('⚪ Not loaded');
        
        console.log(`  ${colors.text(connectorName)}`);
        console.log(`    ${t('connectors.list.installation')}: ${installStatus}`);
        console.log(`    ${t('connectors.list.config')}: ${configStatus}`);
        console.log(`    ${t('connectors.list.status')}: ${loadStatus}`);
        
        if (connectorConfig.autoLoad) {
          console.log(`    ${colors.textSecondary('🚀 Auto-load enabled')}`);
        }
        
        console.log(); // Empty line between connectors
      }

      // Show configured connectors that are not installed
      const configuredButNotInstalled = Object.keys(config).filter(name => !installedConnectors.includes(name));
      if (configuredButNotInstalled.length > 0) {
        console.log(colors.accent1('⚠️ Configured but Not Installed'));
        configuredButNotInstalled.forEach(name => {
          const connectorConfig = config[name];
          const enabled = connectorConfig.enabled ? colors.warning('Enabled') : colors.textSecondary('Disabled');
          console.log(`  ${colors.text(name)}`);
          console.log(`    ${colors.error('❌ Not installed in node_modules')}`);
          console.log(`    ${t('connectors.list.config')}: ${enabled}`);
          console.log(`    ${colors.textMuted('Run: npm install ' + name)}`);
        });
        console.log();
      }

      // Show loaded connectors that aren't configured
      const unconfiguredLoaded = loadedConnectors.filter(name => !config[name] && installedConnectors.includes(name));
      if (unconfiguredLoaded.length > 0) {
        console.log(colors.accent1('🔄 Loaded but Not Configured'));
        unconfiguredLoaded.forEach(name => {
          console.log(`  ${colors.text(name)} ${colors.warning('⚠️ Temporary load only')}`);
        });
        console.log();
      }

      // Show summary
      console.log(colors.textSecondary('Summary:'));
      console.log(`  ${colors.textSecondary('Installed:')} ${installedConnectors.length}`);
      console.log(`  ${colors.textSecondary('Configured:')} ${Object.keys(config).length}`);
      console.log(`  ${colors.textSecondary('Loaded:')} ${loadedConnectors.length}`);
      console.log();

    } catch (error) {
      console.log(colors.error(t('connectors.list.failed', { message: error.message })));
    }
  }

  /**
   * Handle status command
   */
  async handleStatusCommand(args) {
    try {
      const connectorName = args[0];
      const loadedConnectors = this.connectorManager.getLoadedConnectors();

      if (connectorName) {
        // Show status for specific connector
        if (!loadedConnectors.includes(connectorName)) {
          console.log(colors.error(t('connectors.status.notLoaded', { name: connectorName })));
          return;
        }

        console.log(colors.header(`\n${t('connectors.status.titleSpecific', { name: connectorName })}`));
        
        const metadata = this.connectorManager.getConnectorMetadata(connectorName);
        if (metadata) {
          console.log(colors.textSecondary(t('connectors.status.loadedFrom')), colors.value(metadata.loadedFrom));
          console.log(colors.textSecondary(t('connectors.status.sourceType')), colors.value(metadata.sourceType));
          console.log(colors.textSecondary(t('connectors.status.loadedAt')), colors.value(metadata.loadedAt));
        }

        // Health check
        console.log(colors.textSecondary(t('connectors.status.healthChecking')));
        const healthResult = await this.connectorManager.healthCheck(connectorName);
        
        if (healthResult.healthy) {
          console.log(colors.success(`✅ ${t('connectors.status.healthy')}`));
          if (healthResult.message) {
            console.log(colors.textSecondary(`   ${healthResult.message}`));
          }
        } else {
          console.log(colors.error(`❌ ${t('connectors.status.unhealthy')}`));
          console.log(colors.error(`   ${healthResult.message}`));
        }
      } else {
        // Show status for all connectors
        console.log(colors.header('\n' + t('connectors.status.titleAll')));

        if (loadedConnectors.length === 0) {
          console.log(colors.textSecondary(t('connectors.status.noneLoaded')));
          return;
        }

        const healthChecks = await this.connectorManager.healthCheckAll();
        
        for (const connectorName of loadedConnectors) {
          const health = healthChecks[connectorName];
          const status = health?.healthy ? colors.success('✅ Healthy') : colors.error('❌ Unhealthy');
          
          console.log(`  ${colors.text(connectorName)}: ${status}`);
          if (health?.message) {
            console.log(`    ${colors.textSecondary(health.message)}`);
          }
        }
      }

      console.log();
    } catch (error) {
      console.log(colors.error(t('connectors.status.failed', { message: error.message })));
    }
  }

  /**
   * Handle load command
   */
  async handleLoadCommand(args) {
    const connectorName = args[0];
    
    if (!connectorName) {
      console.log(colors.error(t('connectors.load.nameRequired')));
      return;
    }

    // Validate installation before loading
    const isValid = await validateConnectorForConfiguration(connectorName);
    if (!isValid) {
      return;
    }

    try {
      await this.ensureProjectConfigLoaded();
      console.log(colors.text(t('connectors.load.loading', { name: connectorName })));
      
      await this.connectorManager.loadConnector(connectorName);
      
      console.log(colors.success(t('connectors.load.success', { name: connectorName })));
      
      // Show basic health check
      const healthResult = await this.connectorManager.healthCheck(connectorName);
      if (healthResult.healthy) {
        console.log(colors.success(`✅ ${t('connectors.load.healthCheckPassed')}`));
      } else {
        console.log(colors.warning(`⚠️ ${t('connectors.load.healthCheckFailed')}: ${healthResult.message}`));
      }
    } catch (error) {
      console.log(colors.error(t('connectors.load.failed', { name: connectorName, message: error.message })));
    }
  }

  /**
   * Handle unload command
   */
  async handleUnloadCommand(args) {
    const connectorName = args[0];
    
    if (!connectorName) {
      console.log(colors.error(t('connectors.unload.nameRequired')));
      return;
    }

    try {
      if (!this.connectorManager.isConnectorLoaded(connectorName)) {
        console.log(colors.warning(t('connectors.unload.notLoaded', { name: connectorName })));
        return;
      }

      console.log(colors.text(t('connectors.unload.unloading', { name: connectorName })));
      
      const success = await this.connectorManager.unloadConnector(connectorName);
      
      if (success) {
        console.log(colors.success(t('connectors.unload.success', { name: connectorName })));
      } else {
        console.log(colors.warning(t('connectors.unload.partialSuccess', { name: connectorName })));
      }
    } catch (error) {
      console.log(colors.error(t('connectors.unload.failed', { name: connectorName, message: error.message })));
    }
  }

  /**
   * Handle test command
   */
  async handleTestCommand(args) {
    const connectorName = args[0];
    
    if (!connectorName) {
      console.log(colors.error(t('connectors.test.nameRequired')));
      return;
    }

    try {
      await this.ensureProjectConfigLoaded();
      console.log(colors.text(t('connectors.test.testing', { name: connectorName })));
      
      const testResult = await this.connectorManager.testConnector(connectorName);
      
      if (testResult.healthy) {
        console.log(colors.success(`✅ ${t('connectors.test.success', { name: connectorName })}`));
        if (testResult.message) {
          console.log(colors.textSecondary(`   ${testResult.message}`));
        }
      } else {
        console.log(colors.error(`❌ ${t('connectors.test.failed', { name: connectorName })}`));
        console.log(colors.error(`   ${testResult.message}`));
      }
    } catch (error) {
      console.log(colors.error(t('connectors.test.error', { name: connectorName, message: error.message })));
    }
  }

  /**
   * Handle reload command
   */
  async handleReloadCommand(args) {
    const connectorName = args[0];
    
    if (!connectorName) {
      console.log(colors.error(t('connectors.reload.nameRequired')));
      return;
    }

    try {
      await this.ensureProjectConfigLoaded();
      console.log(colors.text(t('connectors.reload.reloading', { name: connectorName })));
      
      const success = await this.connectorManager.reloadConnector(connectorName);
      
      if (success) {
        console.log(colors.success(t('connectors.reload.success', { name: connectorName })));
        
        // Show basic health check after reload
        const healthResult = await this.connectorManager.healthCheck(connectorName);
        if (healthResult.healthy) {
          console.log(colors.success(`✅ ${t('connectors.reload.healthCheckPassed')}`));
        } else {
          console.log(colors.warning(`⚠️ ${t('connectors.reload.healthCheckFailed')}: ${healthResult.message}`));
        }
      } else {
        console.log(colors.error(t('connectors.reload.failed', { name: connectorName })));
      }
    } catch (error) {
      console.log(colors.error(t('connectors.reload.error', { name: connectorName, message: error.message })));
    }
  }

  /**
   * Handle config command
   */
  async handleConfigCommand() {
    try {
      await this.ensureProjectConfigLoaded();
      const config = this.connectorManager.config || {};
      const configPath = this.connectorManager.configPath || 'form0.config.js';

      console.log(colors.header('\n' + t('connectors.config.title')));

      if (Object.keys(config).length === 0) {
        console.log(colors.textSecondary(t('connectors.config.noConfiguration')));
        console.log();
        console.log(colors.textMuted(t('connectors.config.configLocation', { path: configPath })));
        console.log(colors.textMuted(t('connectors.config.exampleConfig')));
        console.log();
        console.log(colors.code(`export default {
  connectors: {
    'form0-connector-pg': {
      enabled: true,
      autoLoad: true,
    },
  },
};`));
        console.log();
        return;
      }

      // Show current configuration
      console.log(colors.accent1(t('connectors.config.current')));
      console.log(JSON.stringify({ connectors: config }, null, 2));
      console.log();
    } catch (error) {
      console.log(colors.error(t('connectors.config.failed', { message: error.message })));
    }
  }
}
