import fs from 'fs-extra';
import chalk from 'chalk';

function printFields(elements, indent = '') {
    elements.forEach((field, index) => {
      const isLast = index === elements.length - 1;
      const prefix = indent + (isLast ? '└─ ' : '├─ ');
  
      if (field.type === 'Section') {
        const label = field.label || '(no label)';
        const display = field.display || 'inline';
        const isDrilldown = display === 'drilldown';
        const line =
          chalk.magenta(`${prefix}Section`.padEnd(20)) +
          chalk.white(label) +
          chalk.gray(` [${field.data_name}] (key: ${field.key})`) +
          (isDrilldown ? chalk.yellow(' 🔎 drilldown') : '');
  
        console.log(line);
  
        // ✅ Always recurse into child elements
        printFields(field.elements || [], indent + (isLast ? '   ' : '│  '));
      } else {
        const label = field.label || '(no label)';
        console.log(
          chalk.green(`${prefix}${field.type.padEnd(20)}`) +
          chalk.white(label) +
          chalk.gray(` [${field.data_name}] (key: ${field.key})`)
        );
      }
    });
  }

export async function previewCommand(file) {
  try {
    const data = await fs.readJson(file);
    const elements = data.form?.elements || [];

    console.log(chalk.cyan(`📋 Previewing form: ${data.form?.name || 'Unnamed Form'}\n`));
    printFields(elements);
  } catch (err) {
    console.error('❌ Failed to preview schema:', err.message);
    process.exit(1);
  }
}