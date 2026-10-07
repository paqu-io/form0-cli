import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'fs-extra';
import * as form0Core from 'form0-core';

function requireCoreAuthoring() {
  if (!form0Core.applyFormMutationBatch || !form0Core.getFormSchemaRevision) {
    throw new Error('This AI preview requires a form0-core release with authoring APIs');
  }
  return form0Core;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createJsonDiff(before, after, currentPath = '$') {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (
    before === null ||
    after === null ||
    typeof before !== 'object' ||
    typeof after !== 'object' ||
    Array.isArray(before) !== Array.isArray(after)
  ) {
    return [{ path: currentPath, before, after }];
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].flatMap((key) =>
    createJsonDiff(before[key], after[key], `${currentPath}.${key}`)
  );
}

export function createEmptyFormSchema() {
  return { form: { name: 'New form', description: null, events: null, elements: [] } };
}

export function schemaSessionKey(schemaPath) {
  const identity = schemaPath ? path.resolve(schemaPath) : `unsaved:${crypto.randomUUID()}`;
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24);
}

export class AISchemaWorkspace {
  constructor({ schema, schemaPath = null, onPreview = null, onCommit = null }) {
    this.schemaPath = schemaPath ? path.resolve(schemaPath) : null;
    this.baseline = clone(schema || createEmptyFormSchema());
    this.committed = clone(this.baseline);
    this.committedRevision = requireCoreAuthoring().getFormSchemaRevision(this.committed);
    this.pending = null;
    this.undoSnapshot = null;
    this.onPreview = onPreview;
    this.onCommit = onCommit;
  }

  getCurrentSchema() {
    return clone(this.pending?.schema || this.committed);
  }

  getCommittedSchema() {
    return clone(this.committed);
  }

  getBaselineSchema() {
    return clone(this.baseline);
  }

  getCumulativeDiff() {
    return createJsonDiff(this.baseline, this.getCurrentSchema());
  }

  getPendingDiff() {
    return this.pending ? createJsonDiff(this.committed, this.pending.schema) : [];
  }

  getRevision() {
    return this.pending?.revision || this.committedRevision;
  }

  getPendingProposal() {
    return this.pending ? clone(this.pending) : null;
  }

  validateCurrent() {
    const core = requireCoreAuthoring();
    if (!core.validateFormAuthoringSchema) {
      throw new Error('This AI validation requires a newer form0-core authoring contract');
    }
    return core.validateFormAuthoringSchema({ schema: this.getCurrentSchema() });
  }

  async publishCurrent() {
    const schema = this.getCurrentSchema();
    await this.onPreview?.(schema, {
      state: this.pending ? 'draft' : 'committed',
      revision: this.getRevision(),
      summary: this.pending?.summary || '',
    });
    return schema;
  }

  stage({ baseRevision, operations, summary = '' }) {
    const base = this.pending?.schema || this.committed;
    const result = requireCoreAuthoring().applyFormMutationBatch({
      schema: base,
      baseRevision,
      operations,
    });
    if (result.valid) {
      const jsonDiff = createJsonDiff(base, result.schema);
      if (jsonDiff.length === 0) {
        return {
          ...result,
          valid: false,
          staged: false,
          schema: null,
          semanticDiff: [],
          diagnostics: [
            ...result.diagnostics,
            {
              code: 'no_schema_changes',
              severity: 'error',
              message:
                'The proposal does not change the schema. Provide actual changes using the core mutation operation formats; any existing draft is unchanged.',
            },
          ],
        };
      }
      if (createJsonDiff(this.committed, result.schema).length === 0) {
        this.pending = null;
        return {
          ...result,
          staged: false,
          message: 'The draft now matches the saved schema; there is nothing to apply.',
        };
      }
      this.pending = {
        schema: result.schema,
        revision: result.revision,
        baseCommittedRevision: this.committedRevision,
        semanticDiff: result.semanticDiff,
        jsonDiff,
        diagnostics: result.diagnostics,
        operations: clone(operations),
        summary,
      };
      return { ...result, staged: true };
    }
    return result;
  }

  async preview() {
    if (!this.pending) throw new Error('There is no pending AI proposal');
    await this.publishCurrent();
    return this.getPendingProposal();
  }

  async discard() {
    this.pending = null;
    await this.onPreview?.(this.committed, {
      state: 'committed',
      revision: this.committedRevision,
    });
  }

  async readDiskRevision() {
    if (!this.schemaPath || !(await fs.pathExists(this.schemaPath))) return this.committedRevision;
    return requireCoreAuthoring().getFormSchemaRevision(await fs.readJson(this.schemaPath));
  }

  async apply({ schemaPath = this.schemaPath } = {}) {
    if (!this.pending) throw new Error('There is no pending AI proposal');
    if (this.getPendingDiff().length === 0) {
      throw new Error('The proposal does not change the saved schema; there is nothing to apply');
    }
    if (!schemaPath) throw new Error('A schema path is required before applying a new form');
    const resolvedPath = path.resolve(schemaPath);
    if (this.schemaPath && (await this.readDiskRevision()) !== this.pending.baseCommittedRevision) {
      throw new Error(
        'The schema file changed after this proposal was created; discard or revise it'
      );
    }
    await fs.ensureDir(path.dirname(resolvedPath));
    const temporaryPath = `${resolvedPath}.form0-ai-${process.pid}-${crypto.randomUUID()}.tmp`;
    const existingMode = (await fs.pathExists(resolvedPath))
      ? (await fs.stat(resolvedPath)).mode & 0o777
      : 0o644;
    await fs.writeJson(temporaryPath, this.pending.schema, { spaces: 2, mode: existingMode });
    try {
      await fs.rename(temporaryPath, resolvedPath);
    } catch (error) {
      await fs.remove(temporaryPath);
      throw error;
    }
    this.undoSnapshot = { schema: this.committed, revision: this.committedRevision };
    this.committed = this.pending.schema;
    this.committedRevision = this.pending.revision;
    this.pending = null;
    this.schemaPath = resolvedPath;
    await this.onCommit?.(this.committed, resolvedPath);
    return this.getCommittedSchema();
  }

  async undo() {
    if (!this.undoSnapshot) throw new Error('There is no applied AI batch to undo');
    const restored = this.undoSnapshot;
    this.pending = {
      schema: clone(restored.schema),
      revision: restored.revision,
      baseCommittedRevision: this.committedRevision,
      semanticDiff: [
        { op: 'undo', summary: 'Restore the schema before the last applied AI batch' },
      ],
      jsonDiff: createJsonDiff(this.committed, restored.schema),
      diagnostics: [],
      operations: [],
      summary: 'Undo last applied AI batch',
    };
    return this.getPendingProposal();
  }
}
