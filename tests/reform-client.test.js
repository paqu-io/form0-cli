import assert from 'node:assert/strict';
import { resolveReformBaseUrls } from '../src/utils/reform-client.js';

async function run() {
  const originalEnv = {
    FORM0_REFORM_AUTH_BASE_URL: process.env.FORM0_REFORM_AUTH_BASE_URL,
    FORM0_REFORM_API_BASE_URL: process.env.FORM0_REFORM_API_BASE_URL,
    PRIVATE_AUTH_BASE_URL: process.env.PRIVATE_AUTH_BASE_URL,
    PRIVATE_API_BASE_URL: process.env.PRIVATE_API_BASE_URL,
  };

  try {
    delete process.env.FORM0_REFORM_AUTH_BASE_URL;
    delete process.env.FORM0_REFORM_API_BASE_URL;
    delete process.env.PRIVATE_AUTH_BASE_URL;
    delete process.env.PRIVATE_API_BASE_URL;

    assert.deepEqual(resolveReformBaseUrls(), {
      authBaseUrl: 'https://private-api.reformapp.io/api/auth',
      apiBaseUrl: 'https://private-api.reformapp.io/v1',
    });

    process.env.FORM0_REFORM_AUTH_BASE_URL = 'https://env-auth.example';
    process.env.FORM0_REFORM_API_BASE_URL = 'https://env-api.example';

    assert.deepEqual(
      resolveReformBaseUrls({
        savedAuthBaseUrl: 'https://saved-auth.example',
        savedApiBaseUrl: 'https://saved-api.example',
      }),
      {
        authBaseUrl: 'https://env-auth.example/api/auth',
        apiBaseUrl: 'https://env-api.example/v1',
      }
    );

    assert.deepEqual(
      resolveReformBaseUrls({
        overrideAuthBaseUrl: 'https://override-auth.example',
        overrideApiBaseUrl: 'https://override-api.example',
        savedAuthBaseUrl: 'https://saved-auth.example',
        savedApiBaseUrl: 'https://saved-api.example',
      }),
      {
        authBaseUrl: 'https://override-auth.example/api/auth',
        apiBaseUrl: 'https://override-api.example/v1',
      }
    );

    delete process.env.FORM0_REFORM_AUTH_BASE_URL;
    delete process.env.FORM0_REFORM_API_BASE_URL;
    process.env.PRIVATE_AUTH_BASE_URL = 'https://legacy-auth.example';
    process.env.PRIVATE_API_BASE_URL = 'https://legacy-api.example';

    assert.deepEqual(resolveReformBaseUrls(), {
      authBaseUrl: 'https://legacy-auth.example/api/auth',
      apiBaseUrl: 'https://legacy-api.example/v1',
    });

    console.log('Reform client tests passed.');
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
