import path from 'path';
import fs from 'fs-extra';
import readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import { v7 as uuidv7 } from 'uuid';
import { colors } from '../utils/theme.js';
import { t } from '../utils/i18n.js';
import { importSchemaFromCsvFile, exportSchemaToCsvFile } from '../utils/schema-csv.js';
import { defaultFormTemplate } from '../form0-forms/form-schema-template.js';
import { ensureKeysForSchema } from '../utils/ensure-keys.js';
import { COMMON_SCHEMA_PATHS } from '../utils/constants.js';
import { detectSchemaProject, discoverSchemas, formatSchemaCandidate } from '../utils/schema-utils.js';
import { addFormToRegistry, registryHasForm, removeFormFromRegistry } from '../utils/schema-registry.js';

export async function confirmOverwrite(targetPath, { force = false, readlineInterface } = {}) {
  if (force) return true;

  const resolvedPath = path.resolve(targetPath);
  const targetExists = await fs.pathExists(targetPath);

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

  const promptKey = targetExists ? 'overwritePrompt' : 'writePrompt';
  const promptMessage = colors.warning(
    t(`commands.schema.${promptKey}`, {
      file: path.basename(targetPath),
      path: resolvedPath,
    })
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

export function resolveDefaultSchemaPath(csvPath) {
  const parsed = path.parse(csvPath);
  const baseDir = parsed.dir || '.';
  const baseName = parsed.name || 'form.schema';
  return path.join(baseDir, `${baseName}.json`);
}

function canPrompt(readlineInterface) {
  return Boolean(readlineInterface || (input.isTTY && output.isTTY));
}

function createReadline(readlineInterface) {
  if (readlineInterface) {
    return { rl: readlineInterface, shouldClose: false };
  }
  return { rl: readline.createInterface({ input, output }), shouldClose: true };
}

async function askQuestion(readlineInterface, prompt) {
  const { rl, shouldClose } = createReadline(readlineInterface);
  const answer = await new Promise((resolve) => {
    rl.question(prompt, (response) => {
      resolve(response.trim());
    });
  });
  if (shouldClose) {
    rl.close();
  }
  return answer;
}

async function promptSelect({ title, options, promptKey, defaultIndex = null, readlineInterface }) {
  if (!canPrompt(readlineInterface)) {
    return null;
  }

  console.log(colors.accent1(title));
  options.forEach((option, index) => {
    console.log(colors.textSecondary(`  ${index + 1}) ${option.label}`));
  });

  while (true) {
    const promptMessage = colors.text(
      t(promptKey, {
        count: options.length,
        default: defaultIndex != null ? defaultIndex + 1 : undefined,
      })
    );
    const answer = await askQuestion(readlineInterface, promptMessage);

    if (!answer) {
      if (defaultIndex != null) {
        return options[defaultIndex].value;
      }
      return null;
    }

    if (/^q$/i.test(answer)) {
      return null;
    }

    const selectedIndex = Number.parseInt(answer, 10);
    if (
      Number.isInteger(selectedIndex) &&
      selectedIndex >= 1 &&
      selectedIndex <= options.length
    ) {
      return options[selectedIndex - 1].value;
    }

    console.log(colors.warning(t('commands.schema.invalidSelection', { count: options.length })));
  }
}

async function promptForValue({
  promptKey,
  defaultValue = '',
  required = false,
  validate,
  readlineInterface,
  formatParams = {},
}) {
  if (!canPrompt(readlineInterface)) {
    return null;
  }

  while (true) {
    const promptMessage = colors.text(
      t(promptKey, {
        ...formatParams,
        default: defaultValue,
      })
    );
    const answer = await askQuestion(readlineInterface, promptMessage);
    const value = answer || defaultValue;
    const trimmed = typeof value === 'string' ? value.trim() : value;

    if (required && !trimmed) {
      console.log(colors.warning(t('commands.schema.missingRequiredValue')));
      continue;
    }

    if (validate) {
      const validation = validate(trimmed);
      if (validation !== true) {
        console.log(colors.warning(validation));
        continue;
      }
    }

    return trimmed;
  }
}

async function confirmDelete(promptKey, formatParams, { readlineInterface } = {}) {
  if (!canPrompt(readlineInterface)) {
    console.log(colors.error(t('commands.schema.deleteRefused')));
    return false;
  }

  const promptMessage = colors.warning(t(promptKey, formatParams));
  const answer = await askQuestion(readlineInterface, promptMessage);
  const accepted = /^y(es)?$/i.test(answer.trim());

  if (!accepted) {
    console.log(colors.warning(t('commands.schema.deleteCancelled')));
  }

  return accepted;
}

function slugify(value) {
  if (!value) return '';
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isValidFormId(value) {
  return /^[a-z0-9_-]+$/.test(value);
}

function normalizeSchemaFilename(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'form.schema.json';
  }
  if (trimmed.toLowerCase().endsWith('.json')) {
    return trimmed;
  }
  return `${trimmed}.json`;
}

function isPathInput(inputValue) {
  if (!inputValue) return false;
  if (path.isAbsolute(inputValue)) return true;
  if (inputValue.startsWith('./') || inputValue.startsWith('../')) return true;
  if (inputValue.includes('/') || inputValue.includes('\\')) return true;
  const lower = inputValue.toLowerCase();
  if (lower.endsWith('.json') || lower.endsWith('.yml') || lower.endsWith('.yaml')) {
    return true;
  }
  return false;
}

function dedent(text) {
  if (typeof text !== 'string') return text;
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  if (nonEmptyLines.length === 0) return text;
  const minIndent = Math.min(...nonEmptyLines.map((line) => line.match(/^\s*/)[0].length));
  return lines
    .map((line) => line.slice(minIndent))
    .join('\n')
    .trim();
}

function dedentCodeInSchema(obj) {
  if (typeof obj === 'string') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => dedentCodeInSchema(item));
  }

  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === 'code' && typeof value === 'string') {
        result[key] = dedent(value);
      } else if (key === 'calculate' && typeof value === 'string') {
        result[key] = dedent(value);
      } else {
        result[key] = dedentCodeInSchema(value);
      }
    }
    return result;
  }

  return obj;
}

function buildBlankSchema({ name, description, id }) {
  return {
    form: {
      name,
      description,
      id,
      record_count: 0,
      record_last_change_at: null,
      form_created_at: null,
      form_updated_at: null,
      form_created_by: null,
      form_updated_by: null,
      status: 'active',
      version: '1',
      main_org_id: 'personal',
      main_org_metadata: null,
      sub_org_id: null,
      sub_org_metadata: null,
      project_id: null,
      project_metadata: null,
      status_field: {
        type: 'StatusField',
        key: '@status',
        data_name: 'status',
        label: 'Status',
        display: 'default',
        enabled: true,
        visible: true,
        visible_conditions: null,
        read_only: false,
        read_only_conditions: null,
        default_value: 'pending',
        choices: [
          { label: 'Enrolled', value: 'enrolled', color: '#87D30F' },
          { label: 'Not Enrolled', value: 'not_enrolled', color: '#FF0000' },
          { label: 'Pending', value: 'pending', color: '#FFA500' },
        ],
      },
      title_field: {
        type: 'TitleField',
        key: '@title',
        data_name: 'title',
        label: 'Title',
        display: 'default',
        enabled: true,
        visible: true,
        visible_conditions: null,
        read_only: true,
        read_only_conditions: null,
        elements: ['text_1'],
      },
      bounding_box: [0, 0, 0, 0],
      location_enabled: false,
      location_required: false,
      image: null,
      image_thumbnail: null,
      image_small: null,
      image_large: null,
      events: {
        code: '',
      },
      elements: [
        {
          type: 'TextField',
          data_name: 'text_1',
          label: 'Text 1',
          display: 'default',
          description: null,
          description_mode: null,
          required: false,
          required_conditions: null,
          visible: true,
          visible_conditions: null,
          read_only: false,
          read_only_conditions: null,
          default_value: null,
          pattern: null,
          pattern_description: null,
          supporting_image: false,
          supporting_image_path: null,
          supporting_image_display: null,
        },
      ],
    },
  };
}

function applyFormMetadata(schema, { name, description, id }) {
  if (!schema.form || typeof schema.form !== 'object') {
    schema.form = {};
  }
  schema.form.name = name;
  schema.form.description = description;
  schema.form.id = id;
  schema.form.version = '1';
  return schema;
}

async function selectSchemaSource(readlineInterface) {
  const options = [
    { label: t('commands.schema.newSourceBlank'), value: 'blank' },
    { label: t('commands.schema.newSourceCopy'), value: 'copy' },
    { label: t('commands.schema.newSourceDefault'), value: 'default' },
  ];

  return promptSelect({
    title: t('commands.schema.newSourceTitle'),
    options,
    promptKey: 'commands.schema.selectPromptWithDefault',
    defaultIndex: 0,
    readlineInterface,
  });
}

async function selectExistingSchema(readlineInterface, startDir) {
  const { candidates } = await discoverSchemas(startDir);
  if (candidates.length === 0) {
    console.log(colors.error(t('commands.schema.newNoSchemasToCopy')));
    return null;
  }

  const options = candidates.map((candidate) => ({
    label: formatSchemaCandidate(candidate),
    value: candidate,
  }));

  return promptSelect({
    title: t('commands.schema.newSelectSchemaTitle'),
    options,
    promptKey: 'commands.schema.selectPrompt',
    defaultIndex: null,
    readlineInterface,
  });
}

async function promptForStandardMetadata(readlineInterface) {
  const formName = await promptForValue({
    promptKey: 'commands.schema.newFormNamePrompt',
    required: true,
    readlineInterface,
  });

  const description = await promptForValue({
    promptKey: 'commands.schema.newFormDescriptionPrompt',
    defaultValue: '',
    required: false,
    readlineInterface,
  });

  const fileNameInput = await promptForValue({
    promptKey: 'commands.schema.newFilePrompt',
    defaultValue: COMMON_SCHEMA_PATHS[0],
    required: true,
    readlineInterface,
  });

  return {
    formName,
    description,
    fileName: normalizeSchemaFilename(fileNameInput || COMMON_SCHEMA_PATHS[0]),
  };
}

async function promptForAppMetadata(readlineInterface) {
  const title = await promptForValue({
    promptKey: 'commands.schema.newFormNamePrompt',
    required: true,
    readlineInterface,
  });

  const description = await promptForValue({
    promptKey: 'commands.schema.newFormDescriptionPrompt',
    defaultValue: '',
    required: false,
    readlineInterface,
  });

  const slug = slugify(title) || 'form-schema';
  const formId = await promptForValue({
    promptKey: 'commands.schema.newFormIdPrompt',
    defaultValue: slug,
    required: true,
    validate: (value) => {
      if (!isValidFormId(value)) {
        return t('commands.schema.newInvalidFormId');
      }
      return true;
    },
    readlineInterface,
    formatParams: { default: slug },
  });

  const tagsInput = await promptForValue({
    promptKey: 'commands.schema.newTagsPrompt',
    defaultValue: '',
    required: false,
    readlineInterface,
  });

  const tags = tagsInput
    ? tagsInput
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];

  return {
    title,
    description,
    formId,
    tags,
  };
}

export async function schemaImportCommand(csvPath, options = {}) {
  const { output: outputPath, force = false } = options;
  const targetPath = outputPath || resolveDefaultSchemaPath(csvPath);

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
    const resolvedSource = path.resolve(sourcePath);
    const resolvedTarget = path.resolve(csvPath);
    console.log(colors.info(t('commands.schema.exportPreview', { json: resolvedSource, csv: resolvedTarget })));

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

function resolveDisplayPath(targetPath, baseDir = process.cwd()) {
  const relative = path.relative(baseDir, targetPath);
  return relative && !relative.startsWith('..') ? relative : targetPath;
}

async function resolveSchemaCandidate(inputValue, startDir) {
  const { candidates } = await discoverSchemas(startDir);
  if (!inputValue) {
    return null;
  }

  const trimmed = inputValue.trim();
  if (isPathInput(trimmed)) {
    const resolvedInput = path.resolve(trimmed);
    const match = candidates.find((candidate) => {
      const full = path.resolve(candidate.fullPath || candidate.path);
      return full === resolvedInput;
    });
    if (match) {
      return match;
    }
    if (await fs.pathExists(resolvedInput)) {
      return {
        path: trimmed,
        fullPath: resolvedInput,
        displayPath: trimmed,
      };
    }
    return null;
  }

  const byFormName = candidates.find((candidate) => candidate.formName === trimmed);
  if (byFormName) {
    return byFormName;
  }

  const byFilename = candidates.find(
    (candidate) => path.basename(candidate.path) === trimmed
  );
  if (byFilename) {
    return byFilename;
  }

  return null;
}

export async function schemaNewCommand(options = {}) {
  const { readlineInterface, startDir = process.cwd() } = options;

  try {
    if (!canPrompt(readlineInterface)) {
      console.log(colors.error(t('commands.schema.promptRequired')));
      return { cancelled: true };
    }

    const project = await detectSchemaProject(startDir);
    const sourceChoice = await selectSchemaSource(readlineInterface);
    if (!sourceChoice) {
      console.log(colors.warning(t('commands.schema.newCancelled')));
      return { cancelled: true };
    }

    let baseSchema = null;
    if (sourceChoice === 'copy') {
      const selected = await selectExistingSchema(readlineInterface, startDir);
      if (!selected) {
        console.log(colors.warning(t('commands.schema.newCancelled')));
        return { cancelled: true };
      }
      baseSchema = await fs.readJson(selected.fullPath || selected.path);
    } else if (sourceChoice === 'default') {
      baseSchema = structuredClone(defaultFormTemplate);
      baseSchema = dedentCodeInSchema(baseSchema);
    }

    const isAppProject = project.type === 'web' || project.type === 'mobile';
    const schemaId = uuidv7();
    let schema;
    let schemaPath;
    let formDir = null;
    let registryPath = project.registryPath;
    let metadata;

    if (isAppProject) {
      metadata = await promptForAppMetadata(readlineInterface);
      if (!metadata) {
        console.log(colors.warning(t('commands.schema.newCancelled')));
        return { cancelled: true };
      }
    } else {
      metadata = await promptForStandardMetadata(readlineInterface);
      if (!metadata) {
        console.log(colors.warning(t('commands.schema.newCancelled')));
        return { cancelled: true };
      }
    }

    if (sourceChoice === 'blank') {
      schema = buildBlankSchema({
        name: isAppProject ? metadata.title : metadata.formName,
        description: metadata.description || '',
        id: schemaId,
      });
    } else {
      schema = structuredClone(baseSchema);
      applyFormMetadata(schema, {
        name: isAppProject ? metadata.title : metadata.formName,
        description: metadata.description || '',
        id: schemaId,
      });
    }

    if (schema.form?.elements) {
      ensureKeysForSchema(schema.form.elements);
    }

    if (isAppProject) {
      if (!registryPath || !(await fs.pathExists(registryPath))) {
        console.log(
          colors.error(t('commands.schema.registryMissing', { path: registryPath || '' }))
        );
        return { cancelled: true };
      }

      const formsDir = project.formsDir;
      formDir = path.join(formsDir, metadata.formId);
      schemaPath = path.join(formDir, 'schema.json');

      if (await fs.pathExists(formDir)) {
        console.log(colors.error(t('commands.schema.formDirExists', { path: formDir })));
        return { cancelled: true };
      }

      if (await registryHasForm(registryPath, metadata.formId)) {
        console.log(colors.error(t('commands.schema.formIdExists', { id: metadata.formId })));
        return { cancelled: true };
      }

      const confirmed = await confirmOverwrite(schemaPath, { readlineInterface });
      if (!confirmed) {
        return { cancelled: true };
      }

      await fs.ensureDir(formDir);
      await fs.writeJson(schemaPath, schema, { spaces: 2 });
      await addFormToRegistry(registryPath, {
        id: metadata.formId,
        title: metadata.title,
        description: metadata.description || '',
        tags: metadata.tags,
      });
    } else {
      const targetPath = path.resolve(startDir, metadata.fileName);
      const confirmed = await confirmOverwrite(targetPath, { readlineInterface });
      if (!confirmed) {
        return { cancelled: true };
      }
      schemaPath = targetPath;
      await fs.ensureDir(path.dirname(targetPath));
      await fs.writeJson(targetPath, schema, { spaces: 2 });
    }

    console.log(
      colors.success(
        t('commands.schema.newSuccess', { path: resolveDisplayPath(schemaPath) })
      )
    );

    return {
      cancelled: false,
      schemaPath,
      formDir,
      formId: metadata.formId,
      projectType: project.type,
    };
  } catch (err) {
    console.error(colors.error(t('commands.schema.newFailed', { message: err.message })));
    process.exitCode = 1;
    return { cancelled: true };
  }
}

export async function schemaDeleteCommand(schemaInput, options = {}) {
  const { readlineInterface, startDir = process.cwd() } = options;

  try {
    if (!canPrompt(readlineInterface)) {
      console.log(colors.error(t('commands.schema.promptRequired')));
      return { cancelled: true };
    }

    const project = await detectSchemaProject(startDir);
    const { candidates } = await discoverSchemas(startDir);

    let target = null;
    if (schemaInput) {
      target = await resolveSchemaCandidate(schemaInput, startDir);
      if (!target) {
        console.log(colors.error(t('commands.schema.deleteNotFound', { input: schemaInput })));
        return { cancelled: true };
      }
    } else {
      if (candidates.length === 0) {
        console.log(colors.error(t('commands.schema.deleteNoSchemas')));
        return { cancelled: true };
      }

      const options = candidates.map((candidate) => ({
        label: formatSchemaCandidate(candidate),
        value: candidate,
      }));

      target = await promptSelect({
        title: t('commands.schema.deleteSelectTitle'),
        options,
        promptKey: 'commands.schema.selectPrompt',
        defaultIndex: null,
        readlineInterface,
      });

      if (!target) {
        console.log(colors.warning(t('commands.schema.deleteCancelled')));
        return { cancelled: true };
      }
    }

    const resolvedPath = path.resolve(target.fullPath || target.path);
    const formsDir = project.formsDir ? path.resolve(project.formsDir) : null;
    const isAppProject = project.type === 'web' || project.type === 'mobile';
    const isInFormsDir = Boolean(formsDir) && resolvedPath.startsWith(formsDir + path.sep);
    const formId =
      target.formName || (isInFormsDir ? path.basename(path.dirname(resolvedPath)) : null);
    const formDir = formId && formsDir ? path.join(formsDir, formId) : null;

    if (isAppProject && formId && formDir && isInFormsDir) {
      if (!project.registryPath || !(await fs.pathExists(project.registryPath))) {
        console.log(
          colors.error(t('commands.schema.registryMissing', { path: project.registryPath || '' }))
        );
        return { cancelled: true };
      }

      const confirmed = await confirmDelete(
        'commands.schema.deleteConfirmFolder',
        { folder: formId },
        { readlineInterface }
      );
      if (!confirmed) {
        return { cancelled: true };
      }

      await fs.remove(formDir);
      await removeFormFromRegistry(project.registryPath, formId);

      console.log(colors.success(t('commands.schema.deleteSuccessFolder', { folder: formId })));
      return {
        cancelled: false,
        deleted: true,
        schemaPath: path.join(formDir, 'schema.json'),
        formDir,
        formId,
        projectType: project.type,
      };
    }

    if (!(await fs.pathExists(resolvedPath))) {
      console.log(
        colors.error(
          t('commands.schema.deleteNotFound', { input: schemaInput || resolvedPath })
        )
      );
      return { cancelled: true };
    }

    const confirmed = await confirmDelete(
      'commands.schema.deleteConfirmFile',
      { file: path.basename(resolvedPath) },
      { readlineInterface }
    );
    if (!confirmed) {
      return { cancelled: true };
    }

    await fs.remove(resolvedPath);
    console.log(
      colors.success(
        t('commands.schema.deleteSuccessFile', { path: resolveDisplayPath(resolvedPath) })
      )
    );

    return {
      cancelled: false,
      deleted: true,
      schemaPath: resolvedPath,
      formDir: null,
      formId: null,
      projectType: project.type,
    };
  } catch (err) {
    console.error(colors.error(t('commands.schema.deleteFailed', { message: err.message })));
    process.exitCode = 1;
    return { cancelled: true };
  }
}
