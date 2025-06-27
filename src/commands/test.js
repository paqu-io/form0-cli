import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { spawn } from 'child_process';

// Helper function to check if npm is available
async function isNpmAvailable() {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  
  return new Promise((resolve) => {
    const testProcess = spawn(npmCommand, ['--version'], {
      stdio: 'ignore',
      shell: true
    });
    
    testProcess.on('close', (code) => {
      resolve(code === 0);
    });
    
    testProcess.on('error', () => {
      resolve(false);
    });
  });
}

export async function testCommand(dir = '.') {
  const base = path.resolve(process.cwd(), dir);
  const testFilePath = path.join(base, 'test.js');
  const schemaFilePath = path.join(base, 'form.schema.json');
  const packageJsonPath = path.join(base, 'package.json');
  const nodeModulesPath = path.join(base, 'node_modules');

  // Check if test.js exists
  if (!(await fs.pathExists(testFilePath))) {
    console.error(chalk.red('❌ No test.js file found in'), chalk.cyan(base));
    console.log(chalk.yellow('💡 Run'), chalk.cyan('form0 init'), chalk.yellow('to create a test project first'));
    process.exit(1);
  }

  // Check if schema file exists
  if (!(await fs.pathExists(schemaFilePath))) {
    console.error(chalk.red('❌ No form.schema.json file found in'), chalk.cyan(base));
    console.log(chalk.yellow('💡 Make sure you have a valid form schema file'));
    process.exit(1);
  }

  // Check if package.json exists and install dependencies if needed
  if (await fs.pathExists(packageJsonPath) && !(await fs.pathExists(nodeModulesPath))) {
    const npmAvailable = await isNpmAvailable();
    
    if (!npmAvailable) {
      console.log(chalk.yellow('⚠️  npm is not available in your PATH.'));
      console.log(chalk.yellow('💡 Please install Node.js/npm or run'), chalk.cyan('npm install'), chalk.yellow('manually in:'));
      console.log(chalk.cyan('   ' + base));
      console.log();
      console.log(chalk.yellow('🔄 Attempting to run test anyway...'));
    } else {
      console.log(chalk.yellow('📦 Installing dependencies...'));
      
      // Determine the correct npm command for the platform
      const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      
      try {
        await new Promise((resolve, reject) => {
          const installProcess = spawn(npmCommand, ['install'], {
            cwd: base,
            stdio: 'inherit',
            shell: true // This helps with Windows PATH issues
          });
          
          installProcess.on('close', (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`npm install failed with exit code ${code}`));
            }
          });
          
          installProcess.on('error', reject);
        });
        console.log();
      } catch (error) {
        console.log(chalk.yellow('⚠️  Failed to auto-install dependencies.'));
        console.log(chalk.yellow('💡 Please run'), chalk.cyan('npm install'), chalk.yellow('manually before testing.'));
        console.log(chalk.gray('Error:', error.message));
        console.log();
        
        // Continue with the test anyway, but warn the user
        console.log(chalk.yellow('🔄 Attempting to run test anyway...'));
      }
    }
  }

  console.log(chalk.blue('🧪 Running test file:'), chalk.cyan(testFilePath));
  console.log(chalk.gray('─'.repeat(50)));

  return new Promise((resolve, reject) => {
    const child = spawn('node', [testFilePath], {
      cwd: base,
      stdio: 'inherit'
    });

    child.on('close', (code) => {
      console.log(chalk.gray('─'.repeat(50)));
      if (code === 0) {
        console.log(chalk.green('✅ Test completed successfully'));
        resolve();
      } else {
        console.log(chalk.red(`❌ Test failed with exit code ${code}`));
        reject(new Error(`Test failed with exit code ${code}`));
      }
    });

    child.on('error', (err) => {
      console.error(chalk.red('❌ Failed to run test:'), err.message);
      reject(err);
    });
  });
} 