import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getConnectorEnvKeys,
  getPostgreSQLStorageDefaults,
} from '../src/utils/connector-settings.js';

test('PostgreSQL connector environment keys include child table configuration', () => {
  assert.ok(
    getConnectorEnvKeys('form0-connector-pg').includes('FORM0_CONNECTOR_PG_CHILD_TABLE_NAME')
  );
});

test('PostgreSQL storage defaults include the child table', () => {
  assert.deepEqual(getPostgreSQLStorageDefaults(), {
    tableName: 'form0_submissions',
    childTableName: 'form0_submissions_children',
    schema: 'public',
  });
});

test('project configuration takes precedence over PostgreSQL environment values', () => {
  assert.deepEqual(
    getPostgreSQLStorageDefaults(
      {
        tableName: 'configured_records',
        childTableName: 'configured_children',
        schema: 'configured_schema',
      },
      {
        FORM0_CONNECTOR_PG_TABLE_NAME: 'environment_records',
        FORM0_CONNECTOR_PG_CHILD_TABLE_NAME: 'environment_children',
        FORM0_CONNECTOR_PG_SCHEMA: 'environment_schema',
      }
    ),
    {
      tableName: 'configured_records',
      childTableName: 'configured_children',
      schema: 'configured_schema',
    }
  );
});

test('PostgreSQL storage configuration falls back to environment values', () => {
  assert.deepEqual(
    getPostgreSQLStorageDefaults(
      {},
      {
        FORM0_CONNECTOR_PG_TABLE_NAME: 'environment_records',
        FORM0_CONNECTOR_PG_CHILD_TABLE_NAME: 'environment_children',
        FORM0_CONNECTOR_PG_SCHEMA: 'environment_schema',
      }
    ),
    {
      tableName: 'environment_records',
      childTableName: 'environment_children',
      schema: 'environment_schema',
    }
  );
});
