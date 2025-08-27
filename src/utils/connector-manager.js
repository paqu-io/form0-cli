import fs from 'fs-extra';
import path from 'path';
import { getConfig } from './config.js';

export class ConnectorManager {
  constructor() {
    this.connectors = new Map();
    this.config = null;
  }

  /**
   * Load connector configuration from the global config
   */
  async loadConnectorConfig() {
    const globalConfig = getConfig();
    this.config = globalConfig.connectors || {};
    return this.config;
  }

  /**
   * Enhanced connector path resolution for development scenarios
   */
  async resolveConnectorModule(connectorName) {
    // 1. First try as a standard node module
    try {
      const connectorModule = await import(connectorName);
      return {
        module: connectorModule,
        path: connectorName,
        type: 'npm'
      };
    } catch (importError) {
      // Continue to other resolution strategies
    }

    // 2. Check if it's an npm-linked package in node_modules
    const nodeModulesPath = path.join(process.cwd(), 'node_modules', connectorName);
    if (await fs.pathExists(nodeModulesPath)) {
      try {
        const stats = await fs.lstat(nodeModulesPath);
        if (stats.isSymbolicLink()) {
          const realPath = await fs.realpath(nodeModulesPath);
          const indexPath = await this.findConnectorEntryPoint(realPath);
          if (indexPath) {
            const connectorModule = await import(indexPath);
            return {
              module: connectorModule,
              path: realPath,
              type: 'linked',
              symlinkPath: nodeModulesPath
            };
          }
        } else {
          // Regular npm-installed package
          const indexPath = await this.findConnectorEntryPoint(nodeModulesPath);
          if (indexPath) {
            const connectorModule = await import(indexPath);
            return {
              module: connectorModule,
              path: nodeModulesPath,
              type: 'installed'
            };
          }
        }
      } catch (linkError) {
        // Continue to other paths
      }
    }

    // 3. Try various relative and absolute path combinations
    const possiblePaths = [
      // Relative paths from current working directory
      path.join(process.cwd(), '..', connectorName),
      path.join(process.cwd(), connectorName),
      
      // If connectorName is already a path, use it directly
      path.isAbsolute(connectorName) ? connectorName : null,
      
      // Common development directory structures
      path.join(process.cwd(), '..', 'packages', connectorName),
      path.join(process.cwd(), 'packages', connectorName),
    ].filter(Boolean);

    for (const possiblePath of possiblePaths) {
      try {
        if (await fs.pathExists(path.join(possiblePath, 'package.json'))) {
          const indexPath = await this.findConnectorEntryPoint(possiblePath);
          if (indexPath) {
            const connectorModule = await import(indexPath);
            return {
              module: connectorModule,
              path: possiblePath,
              type: 'local'
            };
          }
        }
      } catch (pathError) {
        // Continue trying other paths
      }
    }

    throw new Error(`Connector '${connectorName}' not found. Tried resolution paths: ${possiblePaths.join(', ')}`);
  }

  /**
   * Find the entry point for a connector package
   */
  async findConnectorEntryPoint(packagePath) {
    // Try package.json main field first
    try {
      const packageJsonPath = path.join(packagePath, 'package.json');
      const packageJson = await fs.readJson(packageJsonPath);
      if (packageJson.main) {
        const mainPath = path.resolve(packagePath, packageJson.main);
        if (await fs.pathExists(mainPath)) {
          return mainPath;
        }
      }
      if (packageJson.module) {
        const modulePath = path.resolve(packagePath, packageJson.module);
        if (await fs.pathExists(modulePath)) {
          return modulePath;
        }
      }
    } catch (error) {
      // Continue to static entry points
    }
    
    // Common entry points
    const possibleEntryPoints = [
      path.join(packagePath, 'src', 'index.js'),
      path.join(packagePath, 'lib', 'index.js'),
      path.join(packagePath, 'dist', 'index.js'),
      path.join(packagePath, 'index.js'),
      path.join(packagePath, 'src', 'connector.js'),
      path.join(packagePath, 'lib', 'connector.js'),
    ];

    return await this.findStaticEntryPoint(possibleEntryPoints);
  }

  /**
   * Find entry point from static paths
   */
  async findStaticEntryPoint(entryPoints) {
    for (const entryPoint of entryPoints) {
      if (await fs.pathExists(entryPoint)) {
        return entryPoint;
      }
    }
    return null;
  }

  /**
   * Extract connector class from module with better error handling
   */
  extractConnectorClass(connectorModule, connectorName) {
    // Try various export patterns
    const possibleExports = [
      connectorModule.default,
      connectorModule.Form0PostgreSQLConnector,
      connectorModule.Form0MySQLConnector,
      connectorModule.Form0MongoDBConnector,
      connectorModule.Form0WebhookConnector,
      connectorModule.Form0EmailConnector,
      connectorModule.Form0Connector,
      connectorModule.Connector,
      connectorModule[connectorName],
      connectorModule
    ];

    for (const possibleExport of possibleExports) {
      if (possibleExport && typeof possibleExport === 'function') {
        // Check if it looks like a constructor
        if (possibleExport.prototype && typeof possibleExport.prototype.constructor === 'function') {
          return possibleExport;
        }
      }
    }

    // If we get here, we couldn't find a suitable connector class
    throw new Error(`Could not find a valid connector class in module. Available exports: ${Object.keys(connectorModule).join(', ')}`);
  }

  /**
   * Dynamically load and initialize a connector with enhanced development support
   * @param {string} connectorName - Name of the connector (e.g., 'form0-connector-pg')
   * @param {Object} options - Additional options for initialization
   */
  async loadConnector(connectorName, options = {}) {
    try {
      // Check if connector is already loaded
      if (this.connectors.has(connectorName)) {
        const connectorData = this.connectors.get(connectorName);
        return connectorData.instance;
      }

      // Enhanced module resolution
      const resolution = await this.resolveConnectorModule(connectorName);
      
      // Extract the connector class
      const ConnectorClass = this.extractConnectorClass(resolution.module, connectorName);

      // Instantiate the connector
      const connector = new ConnectorClass();

      // Get connector-specific configuration
      const connectorConfig = this.config[connectorName] || {};

      // Initialize the connector with configuration
      await connector.initialize(connectorConfig, options.envVars);

      // Store the connector instance with metadata
      this.connectors.set(connectorName, {
        instance: connector,
        metadata: {
          path: resolution.path,
          type: resolution.type,
          symlinkPath: resolution.symlinkPath,
          loadedAt: new Date().toISOString()
        }
      });

      console.log(`🔌 Loaded connector '${connectorName}' from ${resolution.type} source: ${resolution.path}`);

      return connector;
    } catch (error) {
      const errorMessage = `Failed to load connector '${connectorName}': ${error.message}`;
      
      // Provide helpful troubleshooting information
      console.error(`❌ ${errorMessage}`);
      
      if (error.message.includes('not found')) {
        console.log(`💡 Troubleshooting tips:`);
        console.log(`   • Ensure the connector is installed: npm install ${connectorName}`);
        console.log(`   • For local development: form0 connector install ../path/to/connector`);
        console.log(`   • For npm-linked packages: npm link ${connectorName}`);
        console.log(`   • Check the connector name spelling`);
      }
      
      throw new Error(errorMessage);
    }
  }

  /**
   * Get an already loaded connector
   * @param {string} connectorName - Name of the connector
   */
  getConnector(connectorName) {
    const connectorData = this.connectors.get(connectorName);
    return connectorData ? connectorData.instance : null;
  }

  /**
   * Check if a connector is loaded and initialized
   * @param {string} connectorName - Name of the connector
   */
  isConnectorLoaded(connectorName) {
    return this.connectors.has(connectorName);
  }

  /**
   * Get all loaded connectors
   */
  getLoadedConnectors() {
    return Array.from(this.connectors.keys());
  }

  /**
   * Health check for a specific connector
   * @param {string} connectorName - Name of the connector
   */
  async healthCheck(connectorName) {
    try {
      const connectorData = this.connectors.get(connectorName);
      
      if (!connectorData) {
        return {
          healthy: false,
          message: `Connector '${connectorName}' is not loaded`
        };
      }

      const connector = connectorData.instance;

      if (typeof connector.healthCheck !== 'function') {
        return {
          healthy: false,
          message: `Connector '${connectorName}' does not implement healthCheck method`
        };
      }

      return await connector.healthCheck();
    } catch (error) {
      return {
        healthy: false,
        message: `Health check failed: ${error.message}`
      };
    }
  }

  /**
   * Health check for all loaded connectors
   */
  async healthCheckAll() {
    const results = {};
    
    for (const connectorName of this.connectors.keys()) {
      results[connectorName] = await this.healthCheck(connectorName);
    }
    
    return results;
  }

  /**
   * Submit data to all available connectors
   * @param {Object} structuredRecord - The structured record to submit
   */
  async submitToConnectors(structuredRecord) {
    const results = [];
    
    for (const [connectorName, connectorData] of this.connectors) {
      const connector = connectorData.instance;
      
      try {
        if (typeof connector.onFormSubmit !== 'function') {
          results.push({
            connector: connectorName,
            success: false,
            message: 'Connector does not implement onFormSubmit method'
          });
          continue;
        }

        const result = await connector.onFormSubmit(structuredRecord);
        results.push({
          connector: connectorName,
          ...result
        });
      } catch (error) {
        results.push({
          connector: connectorName,
          success: false,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    }
    
    return results;
  }

  /**
   * Get metadata for a specific connector with enhanced information
   * @param {string} connectorName - Name of the connector
   */
  getConnectorMetadata(connectorName) {
    const connectorData = this.connectors.get(connectorName);
    
    if (!connectorData) {
      return null;
    }

    const connector = connectorData.instance;
    const loadMetadata = connectorData.metadata;

    // Get connector-specific metadata if available
    let connectorSpecificMetadata = {};
    if (typeof connector.getMetadata === 'function') {
      connectorSpecificMetadata = connector.getMetadata();
    }

    // Combine all metadata
    return {
      name: connectorName,
      initialized: true,
      loadedFrom: loadMetadata.path,
      sourceType: loadMetadata.type,
      symlinkPath: loadMetadata.symlinkPath,
      loadedAt: loadMetadata.loadedAt,
      ...connectorSpecificMetadata
    };
  }

  /**
   * Get metadata for all loaded connectors
   */
  getAllConnectorMetadata() {
    const metadata = {};
    
    for (const connectorName of this.connectors.keys()) {
      metadata[connectorName] = this.getConnectorMetadata(connectorName);
    }
    
    return metadata;
  }

  /**
   * Unload a specific connector and clean up its resources
   * @param {string} connectorName - Name of the connector to unload
   */
  async unloadConnector(connectorName) {
    const connectorData = this.connectors.get(connectorName);
    
    if (!connectorData) {
      return false;
    }

    const connector = connectorData.instance;

    try {
      // Call cleanup method if available
      if (typeof connector.destroy === 'function') {
        await connector.destroy();
      }

      // Remove from our cache
      this.connectors.delete(connectorName);
      console.log(`🔌 Unloaded connector '${connectorName}'`);
      return true;
    } catch (error) {
      console.error(`Failed to cleanly unload connector '${connectorName}':`, error.message);
      // Still remove it from cache even if cleanup failed
      this.connectors.delete(connectorName);
      return false;
    }
  }

  /**
   * Unload all connectors and clean up resources
   */
  async unloadAllConnectors() {
    const promises = [];
    
    for (const connectorName of this.connectors.keys()) {
      promises.push(this.unloadConnector(connectorName));
    }
    
    await Promise.allSettled(promises);
    this.connectors.clear();
  }

  /**
   * Test connection to a connector package without fully loading it
   * @param {string} connectorName - Name of the connector package
   * @param {Object} config - Configuration to test
   */
  async testConnector(connectorName, config = {}) {
    try {
      // Try to temporarily load the connector
      await this.loadConnector(connectorName, { envVars: config });
      
      // Test the connection
      const healthResult = await this.healthCheck(connectorName);
      
      // Clean up the temporary connector
      await this.unloadConnector(connectorName);
      
      return healthResult;
    } catch (error) {
      return {
        healthy: false,
        message: `Test connection failed: ${error.message}`
      };
    }
  }

  /**
   * Reload a connector (useful during development)
   * @param {string} connectorName - Name of the connector to reload
   */
  async reloadConnector(connectorName) {
    try {
      // Unload if currently loaded
      if (this.isConnectorLoaded(connectorName)) {
        await this.unloadConnector(connectorName);
      }

      // Clear the module cache for this connector
      // Note: This is a bit tricky with ES modules, but we can try
      console.log(`🔄 Reloading connector '${connectorName}'...`);

      // Load the connector again
      await this.loadConnector(connectorName);
      
      console.log(`✅ Successfully reloaded connector '${connectorName}'`);
      return true;
    } catch (error) {
      console.error(`❌ Failed to reload connector '${connectorName}': ${error.message}`);
      return false;
    }
  }
}

// Export a singleton instance
export const connectorManager = new ConnectorManager();
export default connectorManager;