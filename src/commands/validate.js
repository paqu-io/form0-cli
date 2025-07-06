import fs from 'fs-extra';
import { validateSchema } from 'form0-core';
import { ensureChoiceValuesForSchema } from '../utils/ensure-choice-values.js';
import { t } from '../utils/i18n.js';

export async function validateCommand(file) {
  try {
    const data = await fs.readJson(file);
    
    // Process SingleChoiceField choices before validation
    ensureChoiceValuesForSchema(data.form.elements || []);
    
    validateSchema(data.form);
    console.log(t('common.schemaIsValid'));
  } catch (err) {
    console.error(t('commands.validate.validationFailed', { message: err.message }));
    process.exit(1);
  }
}
