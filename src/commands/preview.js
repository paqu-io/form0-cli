import fs from 'fs-extra';
import chalk from 'chalk';

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
      case 'CalculatedField':
        typeColor = chalk.yellow;
        break;
      default:
        typeColor = chalk.cyan;
    }
    
    const label = element.label || element.data_name || 'Unlabeled';
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
    const form = data.form;
    
    console.log(chalk.blue.bold(`📋 Form: ${form?.name || 'Unnamed'}`));
    if (form?.description) {
      console.log(chalk.gray(`   ${form.description}`));
    }
    console.log();
    
    printFields(form?.elements || []);
    console.log();
  } catch (err) {
    console.error(chalk.red('❌ Failed to preview schema:'), err.message);
    process.exit(1);
  }
}
