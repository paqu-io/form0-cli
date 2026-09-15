const DOCS_ORIGIN = 'https://docs.form0.dev';
const INDEX_URL = `${DOCS_ORIGIN}/llms.txt`;
const DEFAULT_MAX_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

function validateDocsUrl(input) {
  const url = new URL(input, DOCS_ORIGIN);
  if (url.protocol !== 'https:' || url.origin !== DOCS_ORIGIN) {
    throw new Error('Only HTTPS documentation from docs.form0.dev is allowed');
  }
  if (url.username || url.password)
    throw new Error('Documentation URLs cannot contain credentials');
  return url;
}

function markdownLinks(content) {
  const links = [];
  const pattern = /\[[^\]]+\]\((https:\/\/docs\.form0\.dev\/[^)]+\.md)\)/g;
  for (const match of content.matchAll(pattern)) links.push(match[1]);
  return [...new Set(links)];
}

function scoreLink(url, query) {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);
  const haystack = decodeURIComponent(url).toLowerCase();
  return words.reduce((score, word) => score + (haystack.includes(word) ? 1 : 0), 0);
}

export class Form0DocsClient {
  constructor({
    fetchImpl = globalThis.fetch,
    maxBytes = DEFAULT_MAX_BYTES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
    this.fetchImpl = fetchImpl;
    this.maxBytes = maxBytes;
    this.timeoutMs = timeoutMs;
    this.cache = new Map();
  }

  async fetchMarkdown(input) {
    const url = validateDocsUrl(input);
    if (this.cache.has(url.href)) return this.cache.get(url.href);
    const response = await this.fetchImpl(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: { Accept: 'text/markdown, text/plain;q=0.9' },
    });
    if (response.status >= 300 && response.status < 400) {
      throw new Error('Documentation redirects are not followed');
    }
    if (!response.ok) throw new Error(`Documentation request failed with HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!/(text\/markdown|text\/plain|application\/octet-stream)/i.test(contentType)) {
      throw new Error(`Unsupported documentation content type: ${contentType || 'unknown'}`);
    }
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > this.maxBytes) {
      throw new Error('Documentation response exceeds the size limit');
    }
    const content = await response.text();
    if (Buffer.byteLength(content, 'utf8') > this.maxBytes) {
      throw new Error('Documentation response exceeds the size limit');
    }
    this.cache.set(url.href, content);
    return content;
  }

  async search(query, { limit = 3 } = {}) {
    const normalized = typeof query === 'string' ? query.trim() : '';
    if (!normalized) throw new Error('Documentation search query cannot be empty');
    const index = await this.fetchMarkdown(INDEX_URL);
    const links = markdownLinks(index)
      .map((url) => ({ url, score: scoreLink(url, normalized) }))
      .sort((left, right) => right.score - left.score || left.url.localeCompare(right.url))
      .slice(0, Math.max(1, Math.min(limit, 3)));
    const pages = [];
    for (const link of links) {
      try {
        pages.push({ url: link.url, content: await this.fetchMarkdown(link.url) });
      } catch (error) {
        pages.push({ url: link.url, error: error.message });
      }
    }
    return { query: normalized, authority: 'supplementary', pages };
  }
}

export { DOCS_ORIGIN, INDEX_URL, validateDocsUrl };
