import type { Loc } from 'obsidian';

import {
  describe,
  expect,
  it
} from 'vitest';

import { findHtmlRanges } from './html-ranges.ts';

describe('HTML candidates', () => {
  it('preserves quoted brackets, closing tags and exact UTF-16 locations', () => {
    const content = '😀\r\nText <span title=">">alpha</span>';
    const ranges = findHtmlRanges({ content });
    expect(ranges.map((range) => range.html)).toEqual(['<span title=">">', '</span>']);
    expect(ranges[0]?.position.start).toEqual({ col: 5, line: 1, offset: 9 });
    for (const range of ranges) {
      expect(content.slice(range.position.start.offset, range.position.end.offset)).toBe(range.html);
    }
  });

  it('excludes frontmatter, code, escaped tags, comments and autolinks', () => {
    const content = '---\nvalue: <alpha>\n---\n`<bravo>` \\<charlie> <!-- <delta> --> %% <echo> %%\n```html\n<foxtrot>\n```\n<https://example.com> <alpha@example.com> <span>yes</span>';
    expect(findHtmlRanges({ content }).map((range) => range.html)).toEqual(['<span>', '</span>']);
  });

  it('uses cached blocks and excludes cached indented code without parsing Markdown', () => {
    const content = '    <alpha>\n\n<div>\n`<span>`\n</div>';
    function locate(offset: number): Loc {
      return { col: 0, line: 0, offset };
    }
    const ranges = findHtmlRanges({
      content,
      sections: [
        { id: undefined, position: { end: locate(11), start: locate(0) }, type: 'code' },
        { id: undefined, position: { end: locate(content.length), start: locate(13) }, type: 'html' }
      ]
    });
    expect(ranges.filter((range) => range.kind === 'block').map((range) => range.html)).toEqual(['<div>\n`<span>`\n</div>']);
    expect(ranges.filter((range) => range.kind === 'tag').map((range) => range.tagName)).toEqual(['div', 'span', 'div']);
  });

  it('tracks SVG and MathML namespaces and HTML integration points', () => {
    const content = '<svg><circle/><foreignObject><span>x</span></foreignObject></svg><math><mi>x</mi></math>';
    expect(findHtmlRanges({ content }).filter((range) => !range.isClosing).map((range) => [range.tagName, range.namespace])).toEqual([
      ['svg', 'svg'],
      ['circle', 'svg'],
      ['foreignobject', 'svg'],
      ['span', 'html'],
      ['math', 'mathml'],
      ['mi', 'mathml']
    ]);
  });

  it('does not interpret raw HTML text as nested tags or eat an unmatched code delimiter', () => {
    expect(findHtmlRanges({ content: '` unmatched <span>x</span> <script>"<alpha>"</script>' }).map((range) => range.tagName)).toEqual(['span', 'span', 'script', 'script']);
  });

  it('handles incomplete fences, comments and raw tags without returning literal examples', () => {
    for (const content of ['```\n<span>', '~~~\n<span>', '<!-- <span>', '%% <span>', '---\nvalue: <span>']) {
      expect(findHtmlRanges({ content })).toEqual([]);
    }
    expect(findHtmlRanges({ content: 'İ<script>"<alpha>"</SCRIPT><br>' }).map((range) => range.html)).toEqual(['<script>', '</SCRIPT>', '<br>']);
    expect(findHtmlRanges({ content: '<script>unclosed <alpha>' }).map((range) => range.html)).toEqual(['<script>']);
    expect(findHtmlRanges({ content: '</span> <br/> <invalid' }).map((range) => range.html)).toEqual(['</span>', '<br/>']);
  });

  it('keeps different fence markers and lengths literal and scans after cached blocks', () => {
    const content = '<div>\n```\n<span>\n```\n</div>\nText <b>x</b>\n~~~\n```\n~~\n~~~\n<i>after</i>';
    const start = { col: 0, line: 0, offset: 0 };
    const end = { col: 6, line: 4, offset: content.indexOf('\nText') };
    const ranges = findHtmlRanges({ content, sections: [{ id: undefined, position: { end, start }, type: 'html' }] });
    expect(ranges.filter((range) => range.kind === 'tag').map((range) => range.tagName)).toEqual(['div', 'span', 'div', 'b', 'b', 'i', 'i']);
  });
});
