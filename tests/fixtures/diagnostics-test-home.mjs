import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';

// Child-process tests must not load or write the maintainer's CLI configuration.
if (process.env.FORM0_DIAGNOSTICS_TEST_HOME) {
  os.homedir = () => process.env.FORM0_DIAGNOSTICS_TEST_HOME;
  syncBuiltinESMExports();
}
