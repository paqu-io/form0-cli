import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';

/** Expose only the statically reachable portable modules, never an unrestricted source folder. */
export function buildingPlanAssets(coreEntry = import.meta.resolve('form0-core')) {
  const root = path.dirname(fileURLToPath(coreEntry));
  const result = new Map();
  const visit = (relative) => {
    const file = path.resolve(root, relative);
    if (!file.startsWith(`${root}${path.sep}`) || !file.endsWith('.js'))
      throw new TypeError('BuildingPlan browser imports must remain inside core source.');
    const url = `/form0-core/modules/${path.relative(root, file).split(path.sep).join('/')}`;
    if (result.has(url)) return;
    const source = readFileSync(file, 'utf8');
    result.set(url, file);
    const tree = parse(source, { sourceType: 'module', ecmaVersion: 'latest' });
    for (const entry of tree.body) {
      if (!entry.source) continue;
      const name = entry.source.value;
      if (name.startsWith('.')) visit(path.relative(root, path.resolve(path.dirname(file), name)));
      else if (name === 'acorn') {
        result.set('/form0-core/vendor/acorn.mjs', fileURLToPath(import.meta.resolve('acorn')));
      } else throw new TypeError(`Unsupported portable BuildingPlan dependency: ${name}`);
    }
  };
  visit('building-plan/browser.js');
  return result;
}
