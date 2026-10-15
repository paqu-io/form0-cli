import fs from 'fs';
import { config } from 'dotenv';

// Localazy sync is disabled: src/locales/*.json are edited in the repo and are the source of
// truth. A download would overwrite them with stale remote translations.
if (process.env.FORM0_LOCALAZY_ENABLED !== '1') {
  console.error(
    '❌ Localazy sync is disabled. Locale files in src/locales are the source of truth.\n' +
      '   Set FORM0_LOCALAZY_ENABLED=1 to re-enable it.'
  );
  process.exit(1);
}

// Load environment variables from .env and .env.local
config({ path: '.env.local' });
config({ path: '.env' });

const localazyConfig = {
  writeKey: process.env.LOCALAZY_WRITE_KEY || '',
  readKey: process.env.LOCALAZY_READ_KEY || '',

  upload: {
    type: 'json',
    files: 'src/locales/en.json',
    deprecate: 'file',
  },

  download: {
    files: 'src/locales/${lang}.json',
  },
};

fs.writeFileSync('localazy.json', JSON.stringify(localazyConfig, null, 2));
console.log('✅ Generated localazy.json with environment variables');

// Log status of keys (without revealing actual values)
if (localazyConfig.writeKey) {
  console.log('✅ Write key loaded');
} else {
  console.log('⚠️  Write key not found - set LOCALAZY_WRITE_KEY in .env or .env.local');
}

if (localazyConfig.readKey) {
  console.log('✅ Read key loaded');
} else {
  console.log('⚠️  Read key not found - set LOCALAZY_READ_KEY in .env or .env.local');
}
