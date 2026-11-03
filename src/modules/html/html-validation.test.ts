import {
  describe,
  expect,
  it,
  vi
} from 'vitest';

import { findHtmlRanges } from './html-ranges.ts';
import { HtmlValidation } from './html-validation.ts';

const CACHE_TEST_TIMEOUT_IN_MILLISECONDS = 30_000;

describe('HTML fragment validation', () => {
  it('separates unknown names from sanitizer changes and ignores normal browser normalization', () => {
    const validation = new HtmlValidation();
    const ranges = findHtmlRanges({ content: '<span title=alpha>text</span><nonExistingTag>x</nonExistingTag><alpha-widget/><script></script><span onclick="alert(1)"><a href="https://example.com">' });
    const diagnostics = validation.diagnose(ranges);
    expect(diagnostics.map((diagnostic) => [diagnostic.kind, diagnostic.range.tagName])).toContainEqual(['unknown', 'nonexistingtag']);
    expect(diagnostics.map((diagnostic) => [diagnostic.kind, diagnostic.range.tagName])).toContainEqual(['sanitized', 'script']);
    expect(diagnostics.filter((diagnostic) => diagnostic.kind === 'sanitized').map((diagnostic) => diagnostic.range.html)).toContain('<span onclick="alert(1)">');
    expect(diagnostics.filter((diagnostic) => diagnostic.kind === 'unknown').map((diagnostic) => diagnostic.range.tagName)).toEqual(['nonexistingtag']);
    expect(diagnostics.some((diagnostic) => diagnostic.range.html === '<span title=alpha>')).toBe(false);
    expect(diagnostics.some((diagnostic) => diagnostic.range.tagName === 'a')).toBe(false);
    expect(validation.diagnose(ranges)).toEqual(diagnostics);
  });

  it('keeps table, SVG and MathML parsing contexts separate and preserves source positions', () => {
    const validation = new HtmlValidation();
    const ranges = findHtmlRanges({ content: '<table><tbody><tr><td>x</td></tr></tbody></table><svg><circle/><foreignObject><span>x</span></foreignObject></svg><math><mi>x</mi></math>' });
    expect(validation.diagnose(ranges).filter((diagnostic) => diagnostic.kind === 'unknown')).toEqual([]);
    const block = { ...ranges[0], html: '<span>', isClosing: false, kind: 'block' as const, namespace: 'html' as const, position: { end: { col: 6, line: 0, offset: 6 }, start: { col: 0, line: 0, offset: 0 } }, tagName: null };
    expect(validation.diagnose([block])).toEqual([]);
  });

  it('detects removed attributes on SVG names whose DOM spelling uses camel case', () => {
    const ranges = findHtmlRanges({ content: '<svg><linearGradient onclick="alert(1)"></linearGradient><foreignObject onclick="alert(1)"></foreignObject></svg>' });
    expect(new HtmlValidation().diagnose(ranges).map((diagnostic) => [diagnostic.kind, diagnostic.range.tagName])).toEqual([
      ['sanitized', 'lineargradient'],
      ['sanitized', 'foreignobject']
    ]);
  });

  it('does not report document wrappers that the browser already omits from a fragment', () => {
    expect(new HtmlValidation().diagnose(findHtmlRanges({ content: '<html><head><body>' }))).toEqual([]);
  });

  it('bounds the fragment memo while retaining deterministic answers', () => {
    const validation = new HtmlValidation();
    const first = findHtmlRanges({ content: '<script>' });
    const sanitize = vi.spyOn(Range.prototype, 'createContextualFragment');
    const original = validation.diagnose(first);
    expect(validation.diagnose([...first])).toEqual(original);
    const changed = validation.diagnose(first);
    Object.assign(changed[0]?.range.position.start ?? {}, { offset: 999 });
    changed.length = 0;
    expect(validation.diagnose(first)[0]?.range.position.start.offset).toBe(0);
    const count = 2050;
    for (let index = 0; index < count; index++) {
      expect(validation.diagnose(findHtmlRanges({ content: `<span title="${String(index)}">` }))).toEqual([]);
    }
    const calls = sanitize.mock.calls.length;
    expect(validation.diagnose(first)).toEqual(original);
    expect(sanitize).toHaveBeenCalledTimes(calls);
    expect(validation.diagnose(findHtmlRanges({ content: '<script>' })).map((diagnostic) => diagnostic.kind)).toEqual(['sanitized']);
    sanitize.mockRestore();
  }, CACHE_TEST_TIMEOUT_IN_MILLISECONDS);
});
