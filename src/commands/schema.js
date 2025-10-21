import path from 'path';
import { colors } from '../utils/theme.js';
import { t } from '../utils/i18n.js';
import { importSchemaFromCsvFile, exportSchemaToCsvFile } from '../utils/schema-csv.js';

export async function schemaImportCommand(csvPath, options = {}) {
  const { output: outputPath } = options;
  const targetPath = outputPath || 'form.schema.json';

  try {
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
  const { input: schemaPath } = options;
  const sourcePath = schemaPath || 'form.schema.json';

  try {
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
