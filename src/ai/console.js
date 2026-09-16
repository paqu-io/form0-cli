import { colors } from '../utils/theme.js';

function abortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('Prompt cancelled');
  error.name = 'AbortError';
  return error;
}

function styleMessage(message, tone) {
  const style =
    {
      success: colors.success,
      error: colors.error,
      warning: colors.warning,
      muted: colors.textSecondary,
      accent: colors.accent1,
      header: colors.header,
    }[tone] || colors.text;
  return style(String(message));
}

function formatPromptMessage(message) {
  const label = String(message || '').trimEnd();
  return /[:?!](?:\s*\([^)]*\))?$/.test(label) ? `${label} ` : `${label}: `;
}

/** Readline-native interaction adapter for AI authoring. */
export class PlainAIConsole {
  constructor({ readline }) {
    this.readline = readline;
  }

  write(message, { tone } = {}) {
    console.log(styleMessage(message, tone));
  }

  writeLines(lines) {
    for (const line of lines) console.log(line);
  }

  async select({ title, items }) {
    this.write(title, { tone: 'header' });
    for (const [index, item] of items.entries()) {
      this.write(
        `  ${index + 1}. ${item.label}${item.description ? ` — ${item.description}` : ''}`
      );
    }
    const answer = await this.prompt({ message: 'Selection', type: 'text' });
    const index = Number.parseInt(answer, 10) - 1;
    return items[index]?.value ?? null;
  }

  async prompt({ message, type = 'text', options = [], signal }) {
    if (type === 'select') {
      return this.select({
        title: message,
        items: options.map((option) => ({
          value: option.id,
          label: option.label,
          description: option.description,
        })),
      });
    }
    if (
      type === 'secret' &&
      process.stdin.isTTY &&
      typeof process.stdin.setRawMode === 'function'
    ) {
      return this.promptSecret(message, signal);
    }
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(abortError(signal));
      const onAbort = () => {
        this.readline.output?.write('\n');
        reject(abortError(signal));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      const callback = (answer) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(answer);
      };
      const question = formatPromptMessage(message);
      if (signal) this.readline.question(question, { signal }, callback);
      else this.readline.question(question, callback);
    });
  }

  async promptSecret(message, signal) {
    signal?.throwIfAborted();
    this.readline.pause();
    process.stdout.write(formatPromptMessage(message));
    return new Promise((resolve, reject) => {
      let value = '';
      const wasRaw = process.stdin.isRaw;
      process.stdin.setRawMode(true);
      process.stdin.resume();
      const finish = (error) => {
        process.stdin.off('data', onData);
        signal?.removeEventListener('abort', onAbort);
        process.stdin.setRawMode(Boolean(wasRaw));
        this.readline.resume();
        process.stdout.write('\n');
        if (error) reject(error);
        else resolve(value);
      };
      const onAbort = () => finish(abortError(signal));
      const onData = (data) => {
        const input = data.toString('utf8');
        if (input === '\u0003' || input === '\x1b') return finish(new Error('Prompt cancelled'));
        if (input === '\r' || input === '\n') return finish();
        if (input === '\u007f') value = value.slice(0, -1);
        else if (!/[\x00-\x1f\x7f]/.test(input)) value += input;
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      process.stdin.on('data', onData);
    });
  }
}

export { formatPromptMessage };
