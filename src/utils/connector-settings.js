const CONNECTOR_ENV_KEYS = {
  'form0-connector-pg': [
    'FORM0_CONNECTOR_PG_HOST',
    'FORM0_CONNECTOR_PG_PORT',
    'FORM0_CONNECTOR_PG_DATABASE',
    'FORM0_CONNECTOR_PG_USERNAME',
    'FORM0_CONNECTOR_PG_PASSWORD',
    'FORM0_CONNECTOR_PG_SSL',
    'FORM0_CONNECTOR_PG_SSL_REJECT_UNAUTHORIZED',
    'FORM0_CONNECTOR_PG_MAX_CONNECTIONS',
    'FORM0_CONNECTOR_PG_IDLE_TIMEOUT',
    'FORM0_CONNECTOR_PG_CONNECTION_TIMEOUT',
    'FORM0_CONNECTOR_PG_TABLE_NAME',
    'FORM0_CONNECTOR_PG_CHILD_TABLE_NAME',
    'FORM0_CONNECTOR_PG_SCHEMA',
    'FORM0_CONNECTOR_PG_DEBUG',
  ],
  'form0-connector-sqlite': [
    'FORM0_CONNECTOR_SQLITE_PATH',
    'FORM0_CONNECTOR_SQLITE_TABLE_NAME',
    'FORM0_CONNECTOR_SQLITE_CHILD_TABLE_NAME',
    'FORM0_CONNECTOR_SQLITE_DEBUG',
  ],
};

export function getConnectorEnvKeys(connectorName) {
  return CONNECTOR_ENV_KEYS[connectorName] || [];
}

export function getPostgreSQLStorageDefaults(currentConfig = {}, currentEnv = {}) {
  return {
    tableName:
      currentConfig.tableName || currentEnv.FORM0_CONNECTOR_PG_TABLE_NAME || 'form0_submissions',
    childTableName:
      currentConfig.childTableName ||
      currentEnv.FORM0_CONNECTOR_PG_CHILD_TABLE_NAME ||
      'form0_submissions_children',
    schema: currentConfig.schema || currentEnv.FORM0_CONNECTOR_PG_SCHEMA || 'public',
  };
}
