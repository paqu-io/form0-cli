import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';

function createTextField(key, dataName, label) {
  return {
    type: 'TextField',
    key,
    data_name: dataName,
    label,
    display: 'default',
    description: null,
    description_mode: null,
    required: false,
    required_conditions: null,
    visible: true,
    visible_conditions: null,
    read_only: false,
    read_only_conditions: null,
    default_value: null,
    pattern: null,
    pattern_description: null,
    supporting_image: false,
    supporting_image_path: null,
    supporting_image_display: null,
  };
}

function createRemoteSchema({ id, name, description }) {
  return {
    form: {
      id,
      name,
      description,
      form_created_at: null,
      form_updated_at: null,
      form_created_by: null,
      form_updated_by: null,
      status: 'active',
      version: '1',
      main_org_id: 'main-1',
      main_org_metadata: null,
      sub_org_id: null,
      sub_org_metadata: null,
      project_id: null,
      project_metadata: null,
      status_field: {
        type: 'StatusField',
        key: '@status',
        data_name: 'status',
        label: 'Status',
        display: 'default',
        enabled: true,
        visible: true,
        visible_conditions: null,
        read_only: false,
        read_only_conditions: null,
        default_value: 'pending',
        choices: [
          { label: 'Pending', value: 'pending', color: '#FFA500' },
          { label: 'Done', value: 'done', color: '#13A10E' },
        ],
      },
      title_field: {
        type: 'TitleField',
        key: '@title',
        data_name: 'title',
        label: 'Title',
        display: 'default',
        enabled: true,
        visible: true,
        visible_conditions: null,
        read_only: true,
        read_only_conditions: null,
        elements: ['field_1'],
      },
      bounding_box: [0, 0, 0, 0],
      location_enabled: false,
      location_required: false,
      image: null,
      image_thumbnail: null,
      image_small: null,
      image_large: null,
      events: { code: '' },
      elements: [createTextField('field_1', 'field_1', 'Field 1')],
    },
  };
}

async function startReformServer(state) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');

    if (req.headers.authorization !== 'Bearer test-token') {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'Unauthorized' }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/forms') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          data: {
            forms: state.forms,
          },
        }),
      );
      return;
    }

    const schemaMatch = url.pathname.match(/^\/v1\/forms\/([^/]+)\/schema$/);
    if (req.method === 'GET' && schemaMatch) {
      const formId = decodeURIComponent(schemaMatch[1]);
      const schema = state.schemas[formId];
      if (!schema) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'Not found' }));
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          data: {
            form_schema: schema,
          },
        }),
      );
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'Not found' }));
  });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    server,
    apiBaseUrl: `${baseUrl}/v1`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function run() {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'form0-cli-home-'));
  process.env.HOME = tempHome;
  process.env.FORM0_CLI_DISABLE_KEYCHAIN = 'true';

  const {
    clearStoredReformAuth,
    getStoredReformAuth,
    getReformAuthFilePath,
    saveStoredReformAuth,
  } = await import('../src/utils/reform-storage.js');
  const {
    discoverSchemas,
  } = await import('../src/utils/schema-utils.js');
  const {
    getReformSyncStatus,
    pullReformForms,
    pruneDeletedReformForms,
  } = await import('../src/utils/reform-sync.js');

  const remoteState = {
    forms: [
      {
        id: 'form-1',
        name: 'Contact Form',
        description: 'Primary contact form',
        revision_number: 1,
        updated_at: '2026-03-27T08:00:00.000Z',
        deleted_at: null,
      },
      {
        id: 'form-2',
        name: 'Contact Form',
        description: 'Duplicate title alias test',
        revision_number: 1,
        updated_at: '2026-03-27T08:00:00.000Z',
        deleted_at: null,
      },
    ],
    schemas: {
      'form-1': createRemoteSchema({
        id: 'form-1',
        name: 'Contact Form',
        description: 'Primary contact form',
      }),
      'form-2': createRemoteSchema({
        id: 'form-2',
        name: 'Contact Form',
        description: 'Duplicate title alias test',
      }),
      'form-3': createRemoteSchema({
        id: 'form-3',
        name: 'Inspection Form',
        description: 'Web project sync target',
      }),
    },
  };

  const reformServer = await startReformServer(remoteState);

  try {
    const storageResult = await saveStoredReformAuth({
      accessToken: 'test-token',
      expiresAt: '2099-03-27T08:00:00.000Z',
    });
    assert.equal(storageResult.storage, 'file');
    assert.deepEqual(await getStoredReformAuth(), {
      accessToken: 'test-token',
      expiresAt: '2099-03-27T08:00:00.000Z',
    });
    assert.equal(await fs.pathExists(getReformAuthFilePath()), true);
    await clearStoredReformAuth();
    assert.equal(await getStoredReformAuth(), null);

    const standardProjectDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'form0-cli-standard-'),
    );

    const firstPull = await pullReformForms({
      projectRoot: standardProjectDir,
      apiBaseUrl: reformServer.apiBaseUrl,
      accessToken: 'test-token',
      scope: {
        main_org_id: 'main-1',
      },
    });

    assert.deepEqual(firstPull.summary.created.sort(), [
      'contact-form',
      'contact-form-2',
    ]);
    assert.equal(
      await fs.pathExists(path.join(standardProjectDir, 'contact-form.schema.json')),
      true,
    );
    assert.equal(
      await fs.pathExists(path.join(standardProjectDir, 'contact-form-2.schema.json')),
      true,
    );
    const discoveredStandardSchemas = await discoverSchemas(standardProjectDir);
    assert.deepEqual(
      discoveredStandardSchemas.candidates.map((candidate) => candidate.path).sort(),
      ['contact-form-2.schema.json', 'contact-form.schema.json'],
    );

    await fs.appendFile(
      path.join(standardProjectDir, 'contact-form.schema.json'),
      '\n',
      'utf8',
    );

    remoteState.forms = [
      {
        id: 'form-1',
        name: 'Contact Form',
        description: 'Primary contact form updated remotely',
        revision_number: 2,
        updated_at: '2026-03-27T09:00:00.000Z',
        deleted_at: null,
      },
      {
        id: 'form-2',
        name: 'Contact Form',
        description: 'Duplicate title alias test',
        revision_number: 1,
        updated_at: '2026-03-27T08:00:00.000Z',
        deleted_at: '2026-03-27T09:30:00.000Z',
      },
    ];
    remoteState.schemas['form-1'] = createRemoteSchema({
      id: 'form-1',
      name: 'Contact Form',
      description: 'Primary contact form updated remotely',
    });

    const secondPull = await pullReformForms({
      projectRoot: standardProjectDir,
      apiBaseUrl: reformServer.apiBaseUrl,
      accessToken: 'test-token',
      scope: {
        main_org_id: 'main-1',
      },
    });

    assert.deepEqual(secondPull.summary.conflicts, ['contact-form']);
    assert.deepEqual(secondPull.summary.deleted, ['contact-form-2']);

    const prunePreview = await pruneDeletedReformForms({
      projectRoot: standardProjectDir,
      dryRun: true,
    });
    assert.deepEqual(prunePreview.prunable, ['contact-form-2']);
    assert.equal(
      await fs.pathExists(path.join(standardProjectDir, 'contact-form-2.schema.json')),
      true,
    );

    const pruneResult = await pruneDeletedReformForms({
      projectRoot: standardProjectDir,
      dryRun: false,
    });
    assert.deepEqual(pruneResult.pruned, ['contact-form-2']);
    assert.equal(
      await fs.pathExists(path.join(standardProjectDir, 'contact-form-2.schema.json')),
      false,
    );

    remoteState.forms = [];
    const thirdPull = await pullReformForms({
      projectRoot: standardProjectDir,
      apiBaseUrl: reformServer.apiBaseUrl,
      accessToken: 'test-token',
      scope: {
        main_org_id: 'main-1',
      },
    });
    assert.deepEqual(thirdPull.summary.unreachable, ['contact-form']);

    const standardStatus = await getReformSyncStatus(standardProjectDir);
    const contactEntry = standardStatus.entries.find(
      (entry) => entry.localAlias === 'contact-form',
    );
    assert.equal(contactEntry.remoteState, 'unreachable');
    assert.equal(contactEntry.modifiedLocally, true);

    const webProjectDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'form0-cli-web-'),
    );
    await fs.ensureDir(path.join(webProjectDir, 'src', 'forms'));
    await fs.writeFile(
      path.join(webProjectDir, 'src', 'forms', 'registry.js'),
      "const forms = [\n];\n\nexport { forms };\nexport default forms;\n",
      'utf8',
    );

    remoteState.forms = [
      {
        id: 'form-3',
        name: 'Inspection Form',
        description: 'Web project sync target',
        revision_number: 1,
        updated_at: '2026-03-27T10:00:00.000Z',
        deleted_at: null,
      },
    ];

    const webPull = await pullReformForms({
      projectRoot: webProjectDir,
      apiBaseUrl: reformServer.apiBaseUrl,
      accessToken: 'test-token',
      scope: {
        main_org_id: 'main-1',
      },
    });

    assert.deepEqual(webPull.summary.created, ['inspection-form']);
    assert.equal(
      await fs.pathExists(
        path.join(webProjectDir, 'src', 'forms', 'inspection-form', 'schema.json'),
      ),
      true,
    );

    const registryContents = await fs.readFile(
      path.join(webProjectDir, 'src', 'forms', 'registry.js'),
      'utf8',
    );
    assert.match(registryContents, /id: 'inspection-form'/);
    assert.match(registryContents, /Inspection Form/);

    console.log('Reform sync tests passed.');
  } finally {
    await reformServer.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
