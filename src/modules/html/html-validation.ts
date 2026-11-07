import { ensureNonNullable } from '@mnaoumov/typescript-lib/type-guards';
import {
  apiVersion,
  sanitizeHTMLToDom
} from 'obsidian';

import type {
  HtmlDiagnostic,
  HtmlRange
} from '../../plugin-api.ts';

const DEFAULT_MAX_CACHED_FRAGMENTS = 2048;
const WRAPPERS = new Map([
  ['caption', ['table']],
  ['col', ['table', 'colgroup']],
  ['colgroup', ['table']],
  ['optgroup', ['select']],
  ['option', ['select']],
  ['tbody', ['table']],
  ['td', ['table', 'tbody', 'tr']],
  ['tfoot', ['table']],
  ['th', ['table', 'tbody', 'tr']],
  ['thead', ['table']],
  ['tr', ['table', 'tbody']]
]);

/**
Validates candidates once per fragment, namespace and runtime version in this module lifetime.
*/
export class HtmlValidation {
  private readonly cache = new Map<string, readonly HtmlDiagnostic['kind'][]>();
  private readonly records = new WeakMap<readonly HtmlRange[], readonly HtmlDiagnostic[]>();

  /**
   * @param maxCachedFragments - How many fragment answers the memo holds before it starts over.
   */
  public constructor(private readonly maxCachedFragments = DEFAULT_MAX_CACHED_FRAGMENTS) {}

  /**
   * Validates only indexed opening tags. Browser normalization alone is not a sanitizer change.
   * Foreign vocabulary is judged by the sanitizer, never a handwritten tag-name blacklist.
   *
   * @param ranges - Indexed source candidates.
   * @returns Findings with original positions; source is never changed.
   */
  public diagnose(ranges: readonly HtmlRange[]): HtmlDiagnostic[] {
    const previous = this.records.get(ranges);
    if (previous) {
      return copyDiagnostics(previous);
    }
    const diagnostics = ranges.flatMap((range) => {
      if (range.kind !== 'tag' || range.isClosing || range.tagName === null) {
        return [];
      }
      const key = JSON.stringify([apiVersion, range.namespace, range.html]);
      let kinds = this.cache.get(key);
      if (!kinds) {
        kinds = validateTag(range);
        if (this.cache.size >= this.maxCachedFragments) {
          this.cache.clear();
        }
        this.cache.set(key, kinds);
      }
      return kinds.map((kind) => ({ kind, range }));
    });
    this.records.set(ranges, diagnostics);
    return copyDiagnostics(diagnostics);
  }
}

function copyDiagnostics(diagnostics: readonly HtmlDiagnostic[]): HtmlDiagnostic[] {
  return diagnostics.map(({ kind, range }) => ({
    kind,
    range: { ...range, position: { end: { ...range.position.end }, start: { ...range.position.start } } }
  }));
}

function findElement(fragment: DocumentFragment, name: string): Element | null {
  // The HTML parser restores SVG camel case (linearGradient, foreignObject); source keys stay lowercase.
  return [...fragment.querySelectorAll('*')].find((element) => element.localName.toLowerCase() === name) ?? null;
}

function validateTag(range: HtmlRange): HtmlDiagnostic['kind'][] {
  const name = ensureNonNullable(range.tagName);
  const wrappers = range.namespace === 'svg' && name !== 'svg'
    ? ['svg']
    : (range.namespace === 'mathml' && name !== 'math' ? ['math'] : WRAPPERS.get(name) ?? []);
  const html = `${wrappers.map((tag) => `<${tag}>`).join('') + range.html}</${name}>${[...wrappers].reverse().map((tag) => `</${tag}>`).join('')}`;
  // Parse the original in an inert template's document; nothing is attached or executed.
  const sanitized = sanitizeHTMLToDom(html);
  const template = sanitized.ownerDocument.win.createEl('template');
  const parser = template.content.ownerDocument.createRange();
  parser.selectNodeContents(template.content);
  // eslint-disable-next-line no-unsanitized/method -- The original must remain unsanitized for comparison; parsing stays in an inert template document and the result is never attached.
  const original = findElement(parser.createContextualFragment(html), name);
  const kept = findElement(sanitized, name);
  const kinds: HtmlDiagnostic['kind'][] = [];
  if (range.namespace === 'html' && !name.includes('-') && original?.constructor.name === 'HTMLUnknownElement') {
    kinds.push('unknown');
  }
  if (original && (!kept || [...original.attributes].some((attribute) => kept.getAttribute(attribute.name) !== attribute.value))) {
    kinds.push('sanitized');
  }
  return kinds;
}
