import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/server/express-server.js';

const schema = {
  form: {
    name: 'Media Reference Shape',
    version: '1',
    title_field: null,
    status_field: null,
    elements: [
      {
        type: 'PhotoField',
        key: 'photo_key',
        data_name: 'photos',
        label: 'Photos',
      },
      {
        type: 'VideoField',
        key: 'video_key',
        data_name: 'videos',
        label: 'Videos',
      },
      {
        type: 'SignatureField',
        key: 'signature_key',
        data_name: 'signature',
        label: 'Signature',
      },
      {
        type: 'RepeatableSection',
        key: 'children_key',
        data_name: 'children',
        label: 'Children',
        elements: [
          {
            type: 'PhotoField',
            key: 'child_photo_key',
            data_name: 'child_photo',
            label: 'Child Photo',
          },
        ],
      },
    ],
  },
};

const listen = (server) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });

const close = (server) =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

async function run() {
  const app = createApp(
    () => schema,
    () => ({ source: 'test' }),
    process.cwd()
  );
  const server = http.createServer(app);

  try {
    const address = await listen(server);
    const response = await fetch(`http://127.0.0.1:${address.port}/api/create-record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: {
          values: {
            photos: [
              {
                filename: 'field-photo.jpg',
                original_filename: 'field-photo.jpg',
                mime_type: 'image/jpeg',
                size_bytes: 1234,
                attached_at_client: '2026-04-12T10:00:00.000Z',
                captured_at_client: '2026-04-12T09:59:00.000Z',
                caption: 'front',
              },
            ],
            videos: [
              {
                filename: 'clip.mp4',
                original_filename: 'clip.mp4',
                mime_type: 'video/mp4',
                size_bytes: 5678,
                duration: 12,
                attached_at_client: '2026-04-12T11:00:00.000Z',
              },
            ],
            signature: {
              data: 'abcd',
              mime_type: 'image/png',
              size_bytes: 3,
              attached_at_client: '2026-04-12T12:00:00.000Z',
              signed_at_client: '2026-04-12T12:00:00.000Z',
            },
          },
          repeatable: {
            children_key: [
              {
                values: {
                  child_photo: [
                    {
                      filename: 'child.jpg',
                      original_filename: 'child.jpg',
                      mime_type: 'image/jpeg',
                      size_bytes: 999,
                      attached_at_client: '2026-04-12T13:00:00.000Z',
                    },
                  ],
                },
                repeatable: {},
              },
            ],
          },
        },
        options: {
          fieldKeyMode: 'data-name',
        },
      }),
    });

    if (!response.ok) {
      assert.fail(await response.text());
    }
    const payload = await response.json();
    const values = payload.record.form_values;

    assert.equal(values.photos[0].filename, 'field-photo.jpg');
    assert.equal(values.photos[0].original_filename, 'field-photo.jpg');
    assert.equal(values.photos[0].mime_type, 'image/jpeg');
    assert.equal(values.photos[0].size_bytes, 1234);
    assert.equal(values.photos[0].attached_at_client, '2026-04-12T10:00:00.000Z');
    assert.equal(values.photos[0].captured_at_client, '2026-04-12T09:59:00.000Z');
    assert.ok(values.photos[0].photo_id);
    assert.equal(values.photos[0].media_id, values.photos[0].photo_id);

    assert.equal(values.videos[0].original_filename, 'clip.mp4');
    assert.equal(values.videos[0].mime_type, 'video/mp4');
    assert.equal(values.videos[0].size_bytes, 5678);
    assert.ok(values.videos[0].video_id);
    assert.equal(values.videos[0].media_id, values.videos[0].video_id);

    assert.equal(values.signature.mime_type, 'image/png');
    assert.equal(values.signature.size_bytes, 3);
    assert.equal(values.signature.signed_at_client, '2026-04-12T12:00:00.000Z');
    assert.ok(values.signature.signature_id);
    assert.equal(values.signature.media_id, values.signature.signature_id);

    const childPhoto = values.children[0].form_values.child_photo[0];
    assert.equal(childPhoto.original_filename, 'child.jpg');
    assert.equal(childPhoto.mime_type, 'image/jpeg');
    assert.equal(childPhoto.size_bytes, 999);
    assert.ok(childPhoto.photo_id);
    assert.equal(childPhoto.media_id, childPhoto.photo_id);

    console.log('Media reference shape tests passed.');
  } finally {
    await close(server);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
