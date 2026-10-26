/** Preserve the CLI's existing SETVALUE shorthand before evaluating the authoritative snapshot. */
export function normalizeChoiceOperationValue(type, value) {
  if ((type === 'SingleChoiceField' || type === 'BooleanField') && typeof value === 'string') {
    return {
      choice: [{ value, label: value }],
      ...(type === 'SingleChoiceField' ? { other: [] } : {}),
    };
  }
  if (type === 'MultiChoiceField' && Array.isArray(value)) {
    return { choices: value.map((entry) => ({ value: entry, label: entry })), other: [] };
  }
  return value;
}
