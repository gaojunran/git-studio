export interface SearchQuery {
  text: string;
  author?: string;
  path?: string;
  since?: string;
  until?: string;
  hash?: string;
  regex?: boolean;
  caseSensitive?: boolean;
  firstParent?: boolean;
  noMerges?: boolean;
  mergesOnly?: boolean;
}

function tokenize(value: string): string[] {
  return value.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
}

function unquote(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

function truthy(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  return !/^(0|false|no|off)$/i.test(value);
}

/**
 * GitHub-style commit search: `author:`, `path:`, `since:`, `until:`, `hash:`,
 * `is:merge`, `is:no-merge`, `first-parent:`, `regex:`, `case:`.
 * Unprefixed words are joined back into a message search.
 */
export function parseSearchQuery(raw: string): SearchQuery {
  const result: SearchQuery = { text: '' };
  const words: string[] = [];

  for (const token of tokenize(raw)) {
    const separator = token.indexOf(':');
    if (separator <= 0) {
      words.push(unquote(token));
      continue;
    }
    const key = token.slice(0, separator).toLowerCase();
    const value = unquote(token.slice(separator + 1));

    switch (key) {
      case 'author':
        result.author = value || undefined;
        break;
      case 'path':
        result.path = value || undefined;
        break;
      case 'since':
      case 'after':
        result.since = value || undefined;
        break;
      case 'until':
      case 'before':
        result.until = value || undefined;
        break;
      case 'hash':
        result.hash = value || undefined;
        break;
      case 'regex':
        result.regex = truthy(value);
        break;
      case 'case':
        result.caseSensitive = truthy(value);
        break;
      case 'first-parent':
        result.firstParent = truthy(value);
        break;
      case 'is':
        if (value === 'merge') {
          result.mergesOnly = true;
          result.noMerges = false;
        } else if (value === 'no-merge' || value === 'no-merges') {
          result.noMerges = true;
          result.mergesOnly = false;
        }
        break;
      default:
        words.push(unquote(token));
    }
  }

  result.text = words.join(' ').trim();
  return result;
}
