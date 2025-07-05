import fs from 'fs-extra';
import chalk from 'chalk';
import { ensureChoiceValuesForSchema } from '../utils/ensure-choice-values.js';
import { t } from '../utils/i18n.js';

function printFields(elements, indent = '') {
  elements.forEach((element, index) => {
    const isLast = index === elements.length - 1;
    const connector = isLast ? '└─' : '├─';
    const childIndent = indent + (isLast ? '  ' : '│ ');

    let typeColor = chalk.white;
    switch (element.type) {
      case 'Section':
        typeColor = chalk.magenta;
        break;
      case 'TextField':
        typeColor = chalk.green;
        break;
      case 'NumericField':
        typeColor = chalk.blue;
        break;
      case 'ChoiceField':
        typeColor = chalk.cyan;
        break;
      case 'CalculatedField':
        typeColor = chalk.yellow;
        break;
      default:
        typeColor = chalk.cyan;
    }

    const label = element.label || element.data_name || t('commands.preview.unlabeled');
    const dataNameDisplay = element.data_name ? chalk.gray(` [${element.data_name}]`) : '';
    const keyDisplay = element.key ? chalk.gray(` (key: ${element.key})`) : '';

    console.log(
      `${indent}${connector} ${typeColor(element.type)} ${chalk.bold(label)}${dataNameDisplay}${keyDisplay}`
    );

    if (element.type === 'Section' && element.elements) {
      printFields(element.elements, childIndent);
    }
  });
}

export async function previewCommand(file) {
  try {
    const data = await fs.readJson(file);
    
    // Process ChoiceField choices before preview
    ensureChoiceValuesForSchema(data.form.elements || []);
    
    const form = data.form;

    console.log(
      chalk.blue.bold(t('commands.preview.formTitle', { name: form?.name || t('preview.unnamed') }))
    );
    if (form?.description) {
      console.log(chalk.gray(`   ${form.description}`));
    }
    console.log();

    printFields(form?.elements || []);
    console.log();
  } catch (err) {
    console.error(chalk.red(t('commands.preview.failedToPreview', { message: err.message })));
    process.exit(1);
  }
}
