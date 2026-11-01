import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { validateSchema, createFormEngine } from 'form0-core';
import { registryHasForm } from '../src/utils/schema-registry.js';

// The web template owns the app schemas; mobile receives byte-identical copies.
// This maintainer command needs both checkouts, not a shared npm package.
const workspace = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({
  options: {
    check: { type: 'boolean', default: false },
    'web-root': { type: 'string', default: path.join(workspace, 'form0-web-tmpl-react-vite') },
    'mobile-root': {
      type: 'string',
      default: path.join(workspace, 'form0-mobile-tmpl-react-native-expo'),
    },
  },
});
const formIds = ['nature-observation', 'equipment-checkout', 'building-condition-survey'];
const files = [
  ['src/forms/catalog.js', 'src/forms/catalog.js'],
  ['tests/starter-schemas.test.mjs', 'tests/starter-schemas.test.mjs'],
  ['docs/starter-schema-review.md', 'docs/starter-schema-review.md'],
  ...formIds.map((id) => [`src/forms/${id}/schema.json`, `src/forms/${id}/schema.json`]),
  [
    'public/supporting-images/evidence-photo-guide.png',
    'assets/supporting-images/evidence-photo-guide.png',
  ],
];

for (const id of formIds) {
  for (const root of [values['web-root'], values['mobile-root']]) {
    if (!(await registryHasForm(path.join(root, 'src/forms/registry.js'), id))) {
      throw new Error(`${id} is missing from the CLI-editable registry in ${root}.`);
    }
  }
  const schema = JSON.parse(
    await readFile(path.join(values['web-root'], `src/forms/${id}/schema.json`), 'utf8')
  );
  validateSchema(schema.form);
  const engine = createFormEngine({ schema });
  engine.eval();
  if (engine.getDiagnostics().length) throw new Error(`${id} has calculation diagnostics.`);
}

const different = [];
for (const [source, destination] of files) {
  const expected = await readFile(path.join(values['web-root'], source));
  const target = path.join(values['mobile-root'], destination);
  const actual = await readFile(target).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (actual?.equals(expected)) continue;
  if (values.check) {
    different.push(destination);
  } else {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, expected);
  }
}

if (different.length) {
  throw new Error(
    `Mobile starter files differ; run this script without --check:\n${different.join('\n')}`
  );
}
const generated = spawnSync(
  process.execPath,
  [
    path.join(values['mobile-root'], 'scripts/generate-image-registry.js'),
    ...(values.check ? ['--check'] : []),
  ],
  { stdio: 'inherit' }
);
if (generated.error) throw generated.error;
if (generated.status !== 0) process.exitCode = generated.status ?? 1;
else
  console.log(`Starter schemas, metadata, and images ${values.check ? 'match' : 'synchronized'}.`);
