import path from 'path';
import fs from 'fs-extra';
import readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import { colors } from '../utils/theme.js';
import { t } from '../utils/i18n.js';
import { importSchemaFromCsvFile, exportSchemaToCsvFile } from '../utils/schema-csv.js';

export async function confirmOverwrite(targetPath, { force = false, readlineInterface } = {}) {
  if (force) return true;
  if (!(await fs.pathExists(targetPath))) return true;

  if (!readlineInterface && (!input.isTTY || !output.isTTY)) {
    console.log(
      colors.error(
        t('commands.schema.overwriteRefused', {
          file: path.basename(targetPath),
        })
      )
    );
    return false;
  }

  const promptMessage = colors.warning(
    t('commands.schema.overwritePrompt', { file: path.basename(targetPath) })
  );

  const accepted = await new Promise((resolve) => {
    if (readlineInterface) {
      readlineInterface.question(promptMessage, (answer) => {
        resolve(/^y(es)?$/i.test(answer.trim()));
      });
    } else {
      const rl = readline.createInterface({ input, output });
      rl.question(promptMessage, (answer) => {
        rl.close();
        resolve(/^y(es)?$/i.test(answer.trim()));
      });
    }
  });

  if (!accepted) {
    console.log(colors.warning(t('commands.schema.overwriteCancelled')));
  }

  return accepted;
}

export async function schemaImportCommand(csvPath, options = {}) {
  const { output: outputPath, force = false } = options;
  const targetPath = outputPath || 'form.schema.json';

  try {
    if (!(await confirmOverwrite(targetPath, { force }))) {
      return { cancelled: true };
    }

    const { schemaPath } = await importSchemaFromCsvFile(csvPath, { outputPath: targetPath });
    console.log(
      colors.success(
        t('commands.schema.importSuccess', {
          csv: path.basename(csvPath),
          json: path.basename(schemaPath),
        })
      )
    );
  } catch (err) {
    console.error(colors.error(t('commands.schema.importFailed', { message: err.message })));
    process.exitCode = 1;
  }
}

export async function schemaExportCommand(csvPath = 'form.schema.csv', options = {}) {
  const { input: schemaPath, force = false } = options;
  const sourcePath = schemaPath || 'form.schema.json';

  try {
    if (!(await confirmOverwrite(csvPath, { force }))) {
      return { cancelled: true };
    }

    const { csvPath: outputPath } = await exportSchemaToCsvFile(sourcePath, { outputPath: csvPath });
    console.log(
      colors.success(
        t('commands.schema.exportSuccess', {
          csv: path.basename(outputPath),
          json: path.basename(sourcePath),
        })
      )
    );
  } catch (err) {
    console.error(colors.error(t('commands.schema.exportFailed', { message: err.message })));
    process.exitCode = 1;
  }
}
