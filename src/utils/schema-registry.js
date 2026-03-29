import fs from 'fs-extra';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeString(value) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function findMatchingBracket(source, startIndex) {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escape = false;

  for (let i = startIndex; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (inSingle) {
      if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === "'") {
        inSingle = false;
      }
      continue;
    }

    if (inDouble) {
      if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === '"') {
        inDouble = false;
      }
      continue;
    }

    if (inTemplate) {
      if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === '`') {
        inTemplate = false;
      }
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }

    if (char === "'") {
      inSingle = true;
      continue;
    }

    if (char === '"') {
      inDouble = true;
      continue;
    }

    if (char === '`') {
      inTemplate = true;
      continue;
    }

    if (char === '[') {
      if (depth === 0) {
        depth = 1;
      } else {
        depth += 1;
      }
      continue;
    }

    if (char === ']') {
      depth -= 1;
      if (depth === 0) {
        return { start: startIndex, end: i };
      }
    }
  }

  return null;
}

function findFormsArrayRange(source) {
  const match = source.match(/const\s+forms\s*=\s*\[/);
  if (!match) {
    return null;
  }

  const bracketIndex = source.indexOf('[', match.index);
  if (bracketIndex === -1) {
    return null;
  }

  const range = findMatchingBracket(source, bracketIndex);
  if (!range) {
    return null;
  }

  return range;
}

function getIndentation(source, arrayStartIndex) {
  const lineStart = source.lastIndexOf('\n', arrayStartIndex) + 1;
  const baseIndentMatch = source.slice(lineStart, arrayStartIndex).match(/^\s*/);
  const baseIndent = baseIndentMatch ? baseIndentMatch[0] : '';
  const itemIndent = `${baseIndent}  `;
  const propIndent = `${itemIndent}  `;
  return { baseIndent, itemIndent, propIndent };
}

function buildEntryLines(entry, itemIndent, propIndent) {
  const escapedId = escapeString(entry.id);
  const escapedTitle = escapeString(entry.title);
  const escapedDescription = escapeString(entry.description);
  const lines = [
    `${itemIndent}{`,
    `${propIndent}id: '${escapedId}',`,
    `${propIndent}title: '${escapedTitle}',`,
    `${propIndent}description: '${escapedDescription}',`,
  ];

  if (Array.isArray(entry.tags) && entry.tags.length > 0) {
    const tags = entry.tags.map((tag) => `'${escapeString(tag)}'`).join(', ');
    lines.push(`${propIndent}tags: [${tags}],`);
  }

  lines.push(`${propIndent}loadSchema: () => import('./${escapedId}/schema.json'),`);
  lines.push(`${itemIndent}}`);
  return lines;
}

function buildEntryString(entry, itemIndent, propIndent) {
  return buildEntryLines(entry, itemIndent, propIndent).join('\n');
}

function getTopLevelObjectRanges(arrayContent) {
  const ranges = [];
  let depth = 0;
  let start = null;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escape = false;

  for (let i = 0; i < arrayContent.length; i += 1) {
    const char = arrayContent[i];
    const next = arrayContent[i + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (inSingle) {
      if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === "'") {
        inSingle = false;
      }
      continue;
    }

    if (inDouble) {
      if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === '"') {
        inDouble = false;
      }
      continue;
    }

    if (inTemplate) {
      if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === '`') {
        inTemplate = false;
      }
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }

    if (char === "'") {
      inSingle = true;
      continue;
    }

    if (char === '"') {
      inDouble = true;
      continue;
    }

    if (char === '`') {
      inTemplate = true;
      continue;
    }

    if (char === '{') {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0 && start != null) {
        ranges.push({ start, end: i });
        start = null;
      }
    }
  }

  return ranges;
}

function removeObjectRange(arrayContent, range) {
  let removeStart = range.start;
  let removeEnd = range.end;
  let i = removeEnd + 1;

  while (i < arrayContent.length && /\s/.test(arrayContent[i])) {
    i += 1;
  }

  if (arrayContent[i] === ',') {
    removeEnd = i;
    i += 1;
    while (i < arrayContent.length && /[ \t]/.test(arrayContent[i])) {
      i += 1;
    }
    if (arrayContent[i] === '\n') {
      removeEnd = i;
    }
  } else {
    let j = removeStart - 1;
    while (j >= 0 && /\s/.test(arrayContent[j])) {
      j -= 1;
    }
    if (arrayContent[j] === ',') {
      removeStart = j;
    }
  }

  return arrayContent.slice(0, removeStart) + arrayContent.slice(removeEnd + 1);
}

function findEntryRangeById(arrayContent, formId) {
  const ranges = getTopLevelObjectRanges(arrayContent);
  const idRegex = new RegExp(`\\bid\\s*:\\s*['"]${escapeRegExp(formId)}['"]`);

  for (const range of ranges) {
    const segment = arrayContent.slice(range.start, range.end + 1);
    if (idRegex.test(segment)) {
      return range;
    }
  }

  return null;
}

export async function addFormToRegistry(registryPath, entry) {
  const source = await fs.readFile(registryPath, 'utf8');
  const range = findFormsArrayRange(source);
  if (!range) {
    throw new Error('forms array not found in registry');
  }

  const { itemIndent, propIndent } = getIndentation(source, range.start);
  const entryString = buildEntryString(entry, itemIndent, propIndent);

  const inner = source.slice(range.start + 1, range.end);
  const trimmedInner = inner.trimEnd();
  const hasContent = trimmedInner.trim().length > 0;
  const endsWithComma = hasContent && /,\s*$/.test(trimmedInner);
  const newInner = hasContent
    ? `${trimmedInner}${endsWithComma ? '' : ','}\n${entryString}\n`
    : `\n${entryString}\n`;

  const updated = source.slice(0, range.start + 1) + newInner + source.slice(range.end);
  await fs.writeFile(registryPath, updated);
}

export async function updateFormInRegistry(registryPath, entry) {
  const source = await fs.readFile(registryPath, 'utf8');
  const range = findFormsArrayRange(source);
  if (!range) {
    throw new Error('forms array not found in registry');
  }

  const inner = source.slice(range.start + 1, range.end);
  const entryRange = findEntryRangeById(inner, entry.id);
  if (!entryRange) {
    return { updated: false };
  }

  const { itemIndent, propIndent } = getIndentation(source, range.start);
  const entryString = buildEntryString(entry, itemIndent, propIndent);
  const updatedInner =
    inner.slice(0, entryRange.start) + entryString + inner.slice(entryRange.end + 1);
  const updated = source.slice(0, range.start + 1) + updatedInner + source.slice(range.end);
  await fs.writeFile(registryPath, updated);
  return { updated: true };
}

export async function upsertFormInRegistry(registryPath, entry) {
  const result = await updateFormInRegistry(registryPath, entry);
  if (result.updated) {
    return result;
  }

  await addFormToRegistry(registryPath, entry);
  return { updated: false, inserted: true };
}

export async function registryHasForm(registryPath, formId) {
  const source = await fs.readFile(registryPath, 'utf8');
  const range = findFormsArrayRange(source);
  if (!range) {
    return false;
  }
  const inner = source.slice(range.start + 1, range.end);
  return Boolean(findEntryRangeById(inner, formId));
}

export async function removeFormFromRegistry(registryPath, formId) {
  const source = await fs.readFile(registryPath, 'utf8');
  const range = findFormsArrayRange(source);
  if (!range) {
    throw new Error('forms array not found in registry');
  }

  const inner = source.slice(range.start + 1, range.end);
  const entryRange = findEntryRangeById(inner, formId);
  if (!entryRange) {
    return { removed: false };
  }

  const updatedInner = removeObjectRange(inner, entryRange);
  const updated = source.slice(0, range.start + 1) + updatedInner + source.slice(range.end);
  await fs.writeFile(registryPath, updated);
  return { removed: true };
}
