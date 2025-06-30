import fs from 'fs-extra';
import path from 'path';
import { spawn } from 'child_process';
import { colors } from '../utils/theme.js';
import { t } from '../utils/i18n.js';

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
    console.error(colors.error(t('commands.test.noTestFile', { base })));
    console.log(colors.warning(t('commands.test.createProjectFirst', { command: colors.value('form0 init') })));
    process.exit(1);
  }

  // Check if schema file exists
  if (!(await fs.pathExists(schemaFilePath))) {
    console.error(colors.error(t('commands.test.noSchemaFile', { base })));
    console.log(colors.warning(t('commands.test.ensureValidSchema')));
    process.exit(1);
  }

  // Check if package.json exists and install dependencies if needed
  if (await fs.pathExists(packageJsonPath) && !(await fs.pathExists(nodeModulesPath))) {
    const npmAvailable = await isNpmAvailable();
    
    if (!npmAvailable) {
      console.log(colors.warning(t('commands.test.npmNotAvailable')));
      console.log(colors.warning(t('commands.test.installManually', { command: colors.value('npm install') })));
      console.log(colors.value('   ' + base));
      console.log();
      console.log(colors.warning(t('commands.test.attemptingRun')));
    } else {
      console.log(colors.warning(t('commands.test.installingDeps')));
      
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
        console.log(colors.warning(t('commands.test.failedAutoInstall')));
        console.log(colors.warning(t('commands.test.runManually', { command: colors.value('npm install') })));
        console.log(colors.textSecondary('Error:', error.message));
        console.log();
        
        // Continue with the test anyway, but warn the user
        console.log(colors.warning(t('commands.test.attemptingRun')));
      }
    }
  }

  console.log(colors.info(t('commands.test.runningTest', { path: colors.value(testFilePath) })));
  console.log(colors.textMuted('─'.repeat(50)));

  return new Promise((resolve, reject) => {
    const child = spawn('node', [testFilePath], {
      cwd: base,
      stdio: 'inherit'
    });

    child.on('close', (code) => {
      console.log(colors.textMuted('─'.repeat(50)));
      if (code === 0) {
        console.log(colors.success(t('commands.test.testCompleted')));
        resolve();
      } else {
        console.log(colors.error(t('commands.test.testFailed', { code })));
        reject(new Error(`Test failed with exit code ${code}`));
      }
    });

    child.on('error', (err) => {
      console.error(colors.error(t('commands.test.failedToRunTest', { message: err.message })));
      reject(err);
    });
  });
} 