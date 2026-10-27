import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

/** Example host adapter: atomically replace a local record-plus-freshness companion envelope. */
export function createFilePreviewStorage(directory) {
  const filename = (identity) => {
    if (
      !['string', 'number'].includes(typeof identity) ||
      identity === '' ||
      (typeof identity === 'number' && !Number.isFinite(identity))
    )
      throw new Error('Storage identity must be a nonempty string or finite number.');
    return path.join(
      directory,
      createHash('sha256').update(JSON.stringify(identity)).digest('hex') + '.json'
    );
  };
  return {
    async load(identity) {
      try {
        return JSON.parse(await readFile(filename(identity), 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },
    async save(identity, { record, freshness }) {
      const target = filename(identity);
      await mkdir(directory, { recursive: true });
      const temporary = target + '.' + randomUUID() + '.tmp';
      try {
        await writeFile(temporary, JSON.stringify({ record, freshness }), {
          flag: 'wx',
          mode: 0o600,
        });
        await rename(temporary, target);
      } finally {
        await unlink(temporary).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
      }
    },
  };
}
