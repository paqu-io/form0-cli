import fs from 'fs-extra';
import path from 'path';
import { resolveProjectConfig } from './project-config.js';

function hasDependency(dependencies, name) {
  return dependencies && Object.prototype.hasOwnProperty.call(dependencies, name);
}

export async function isReactNativeProject(startDir = process.cwd()) {
  try {
    const { projectRoot } = await resolveProjectConfig(startDir);
    const packageJsonPath = path.join(projectRoot, 'package.json');

    if (!(await fs.pathExists(packageJsonPath))) {
      return false;
    }

    const pkg = await fs.readJson(packageJsonPath);
    const dependencies = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };

    if (hasDependency(dependencies, 'react-native')) {
      return true;
    }

    if (hasDependency(dependencies, 'expo')) {
      return true;
    }

    return false;
  } catch (error) {
    return false;
  }
}
