import { colors } from '../utils/theme.js';

function formatValue(value) {
  if (value === undefined) return colors.textMuted('(missing)');
  const serialized = JSON.stringify(value);
  return serialized === undefined ? String(value) : serialized;
}

export function formatSchemaDiffLines(diff, label) {
  if (diff.length === 0) return [colors.textSecondary(`No ${label} changes.`)];
  const lines = [colors.header(`${label} changes (${diff.length})`)];
  for (const change of diff) {
    lines.push(colors.accent1(`  ${change.path}`));
    lines.push(colors.textSecondary(`    - ${formatValue(change.before)}`));
    lines.push(colors.text(`    + ${formatValue(change.after)}`));
  }
  return lines;
}
