const DEFAULT_AUTH_BASE_URL =
  process.env.FORM0_REFORM_AUTH_BASE_URL ??
  process.env.PRIVATE_AUTH_BASE_URL ??
  'http://localhost:3001';

const DEFAULT_API_BASE_URL =
  process.env.FORM0_REFORM_API_BASE_URL ??
  process.env.PRIVATE_API_BASE_URL ??
  'http://localhost:3001/v1';

export const DEFAULT_REFORM_DEVICE_CLIENT_ID =
  process.env.FORM0_CLI_DEVICE_CLIENT_ID ?? 'form0-cli';

function normalizeBaseUrl(value) {
  return value.replace(/\/$/, '');
}

function normalizeAuthBaseUrl(value) {
  const baseUrl = normalizeBaseUrl(value);
  if (baseUrl.endsWith('/api/auth')) {
    return baseUrl;
  }
  return `${baseUrl}/api/auth`;
}

function normalizeApiBaseUrl(value) {
  const baseUrl = normalizeBaseUrl(value);
  if (baseUrl.endsWith('/v1')) {
    return baseUrl;
  }
  return `${baseUrl}/v1`;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function parseErrorResponse(response) {
  try {
    const payload = await response.json();
    const errorCode =
      payload && typeof payload === 'object' && typeof payload.error === 'string'
        ? payload.error
        : null;
    if (
      payload &&
      typeof payload === 'object' &&
      typeof payload.error_description === 'string'
    ) {
      return {
        message: payload.error_description,
        errorCode,
      };
    }
    if (
      payload &&
      typeof payload === 'object' &&
      payload.error &&
      typeof payload.error === 'object' &&
      typeof payload.error.message === 'string'
    ) {
      return {
        message: payload.error.message,
        errorCode: null,
      };
    }
    if (
      payload &&
      typeof payload === 'object' &&
      typeof payload.message === 'string'
    ) {
      return {
        message: payload.message,
        errorCode,
      };
    }
  } catch {
    // Fall back to response status text.
  }

  return {
    message: response.statusText || 'Request failed.',
    errorCode: null,
  };
}

async function reformFetch(url, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (options.accessToken) {
    headers.set('Authorization', `Bearer ${options.accessToken}`);
  }

  let body = options.body;
  if (body && typeof body === 'object' && !(body instanceof Buffer)) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(body);
  }

  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers,
    body,
    cache: 'no-store',
  });

  if (!response.ok) {
    const parsedError = await parseErrorResponse(response);
    const error = new Error(parsedError.message);
    error.status = response.status;
    error.errorCode = parsedError.errorCode;
    throw error;
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function buildScopedFormsQuery(scope, state = 'all') {
  const params = new URLSearchParams();
  if (scope?.main_org_id) {
    params.set('main_org_id', scope.main_org_id);
  }
  if (scope?.sub_org_id) {
    params.set('sub_org_id', scope.sub_org_id);
  }
  params.set('state', state);
  return params.toString();
}

export function resolveReformBaseUrls(settings = {}) {
  return {
    authBaseUrl: normalizeAuthBaseUrl(
      settings.authBaseUrl || DEFAULT_AUTH_BASE_URL,
    ),
    apiBaseUrl: normalizeApiBaseUrl(settings.apiBaseUrl || DEFAULT_API_BASE_URL),
  };
}

export function getReformAuthRouteUrl(authBaseUrl, routePath) {
  const normalizedBaseUrl = normalizeAuthBaseUrl(authBaseUrl);
  const normalizedPath = routePath.startsWith('/') ? routePath : `/${routePath}`;
  return `${normalizedBaseUrl}${normalizedPath}`;
}

export async function requestDeviceCode({
  authBaseUrl,
  clientId = DEFAULT_REFORM_DEVICE_CLIENT_ID,
}) {
  return reformFetch(getReformAuthRouteUrl(authBaseUrl, '/device/code'), {
    method: 'POST',
    body: {
      client_id: clientId,
    },
  });
}

async function exchangeDeviceCode({
  authBaseUrl,
  deviceCode,
  clientId = DEFAULT_REFORM_DEVICE_CLIENT_ID,
}) {
  return reformFetch(getReformAuthRouteUrl(authBaseUrl, '/device/token'), {
    method: 'POST',
    body: {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
      client_id: clientId,
    },
  });
}

export async function pollDeviceToken({
  authBaseUrl,
  deviceCode,
  intervalSeconds,
  expiresInSeconds,
  clientId = DEFAULT_REFORM_DEVICE_CLIENT_ID,
}) {
  const startedAt = Date.now();
  let pollingIntervalMs = Math.max(1, intervalSeconds) * 1000;
  const timeoutMs = Math.max(1, expiresInSeconds) * 1000;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await exchangeDeviceCode({
        authBaseUrl,
        deviceCode,
        clientId,
      });
    } catch (error) {
      const status = error?.status ?? null;
      const errorCode = error?.errorCode ?? null;
      if (
        status === 400 &&
        errorCode === 'authorization_pending'
      ) {
        await sleep(pollingIntervalMs);
        continue;
      }
      if (
        status === 400 &&
        errorCode === 'slow_down'
      ) {
        pollingIntervalMs += 5000;
        await sleep(pollingIntervalMs);
        continue;
      }
      throw error;
    }
  }

  throw new Error('Device authorization timed out before it was approved.');
}

export async function fetchReformSession({ authBaseUrl, accessToken }) {
  return reformFetch(getReformAuthRouteUrl(authBaseUrl, '/get-session'), {
    method: 'GET',
    accessToken,
  });
}

export async function signOutReformSession({ authBaseUrl, accessToken }) {
  return reformFetch(getReformAuthRouteUrl(authBaseUrl, '/sign-out'), {
    method: 'POST',
    accessToken,
  });
}

export async function listTopLevelOrganizations({ apiBaseUrl, accessToken }) {
  const params = new URLSearchParams({
    kind: 'top-level',
    state: 'active',
    limit: '100',
  });
  const response = await reformFetch(`${normalizeApiBaseUrl(apiBaseUrl)}/orgs?${params.toString()}`, {
    method: 'GET',
    accessToken,
  });
  return response?.data?.orgs ?? [];
}

export async function listSubOrganizations({
  apiBaseUrl,
  accessToken,
  mainOrgId,
}) {
  const params = new URLSearchParams({
    kind: 'sub',
    parent_org_id: mainOrgId,
    state: 'active',
    limit: '100',
  });
  const response = await reformFetch(`${normalizeApiBaseUrl(apiBaseUrl)}/orgs?${params.toString()}`, {
    method: 'GET',
    accessToken,
  });
  return response?.data?.orgs ?? [];
}

export async function listReformForms({
  apiBaseUrl,
  accessToken,
  scope,
  state = 'all',
}) {
  const query = buildScopedFormsQuery(scope, state);
  const response = await reformFetch(
    `${normalizeApiBaseUrl(apiBaseUrl)}/forms?${query}`,
    {
      method: 'GET',
      accessToken,
    },
  );
  return response?.data?.forms ?? [];
}

export async function getReformFormSchema({
  apiBaseUrl,
  accessToken,
  formId,
  scope,
}) {
  const query = buildScopedFormsQuery(scope, 'all');
  const response = await reformFetch(
    `${normalizeApiBaseUrl(apiBaseUrl)}/forms/${encodeURIComponent(formId)}/schema?${query}`,
    {
      method: 'GET',
      accessToken,
    },
  );

  if (!response?.data?.form_schema) {
    throw new Error(`Form ${formId} did not return a schema payload.`);
  }

  return response.data.form_schema;
}
