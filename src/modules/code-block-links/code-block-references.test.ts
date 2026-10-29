import type {
  CachedMetadata,
  LinkCache,
  SectionCache
} from 'obsidian';

import {
  describe,
  expect,
  it
} from 'vitest';

import { isMatchingNamePatterns } from '../../name-patterns.ts';
import {
  findCodeBlockReferences,
  hasCodeSection,
  hasIncludedCodeBlock
} from './code-block-references.ts';

/**
 * A reference as the tests compare it.
 */
interface FoundReference {
  readonly language: string;
  readonly link: string;
  readonly offset: number;
  readonly original: string;
}

/**
 * A fence the stand-in parser has opened and not yet closed.
 */
interface OpenFence {
  readonly fence: string;
  readonly line: number;
  readonly offset: number;
}

const LINK_REG_EXP = /(?<Embed>!?)\[\[(?<Link>[^\]|]+)(?:\|[^\]]*)?\]\]/gu;
const FENCE_REG_EXP = /^ {0,3}(?<Fence>`{3,}|~{3,})/u;

function createSection(startLine: number, startOffset: number, endLine: number, endOffset: number): SectionCache {
  return {
    position: {
      end: { col: 0, line: endLine, offset: endOffset },
      start: { col: 0, line: startLine, offset: startOffset }
    },
    type: 'code'
  };
}

async function find(text: string, languages: readonly string[]): Promise<FoundReference[]> {
  const references = await findCodeBlockReferences({
    cache: parseMarkdown(text),
    isLanguageIncluded: (language) => isMatchingNamePatterns(languages, language),
    parseMarkdown: (markdown) => Promise.resolve(parseMarkdown(markdown)),
    text
  });

  return references.map(({ language, reference }) => {
    // The mapped position must point at the reference's own text in the note.
    expect(text.slice(reference.position.start.offset, reference.position.end.offset)).toBe(reference.original);
    const lineStart = text.split('\n').slice(0, reference.position.start.line).join('\n').length + (reference.position.start.line > 0 ? 1 : 0);
    expect(lineStart + reference.position.start.col).toBe(reference.position.start.offset);
    return { language, link: reference.link, offset: reference.position.start.offset, original: reference.original };
  });
}

/**
 * A stand-in for Obsidian's worker, good enough to exercise the mapping: wikilinks outside fences become links or
 * embeds, and every fence becomes a `code` section with nothing found inside it.
 *
 * @param markdown - The markdown.
 * @returns Its cache.
 */
function parseMarkdown(markdown: string): CachedMetadata {
  const lines = markdown.split('\n');
  const links: LinkCache[] = [];
  const embeds: LinkCache[] = [];
  const sections: SectionCache[] = [];
  let offset = 0;
  let openFence: null | OpenFence = null;

  for (const [line, lineText] of lines.entries()) {
    const fence = FENCE_REG_EXP.exec(lineText)?.groups?.['Fence'];

    if (openFence) {
      if (fence && fence.startsWith(openFence.fence.charAt(0)) && fence.length >= openFence.fence.length && lineText.trim() === fence) {
        sections.push(createSection(openFence.line, openFence.offset, line, offset + lineText.length));
        openFence = null;
      }
    } else if (fence) {
      openFence = { fence, line, offset };
    } else {
      for (const match of lineText.matchAll(LINK_REG_EXP)) {
        const col = match.index;
        const reference: LinkCache = {
          link: match.groups?.['Link'] ?? '',
          original: match[0],
          position: {
            end: { col: col + match[0].length, line, offset: offset + col + match[0].length },
            start: { col, line, offset: offset + col }
          }
        };
        (match.groups?.['Embed'] ? embeds : links).push(reference);
      }
    }

    offset += lineText.length + 1;
  }

  if (openFence) {
    sections.push(createSection(openFence.line, openFence.offset, lines.length - 1, markdown.length));
  }

  return { embeds, links, sections };
}

describe('findCodeBlockReferences', () => {
  it('should find the links inside a whitelisted block, at their place in the note', async () => {
    const text = '# Title\n\n```ad-note\nSee [[Alpha]] and ![[Image.png]].\n```\n';

    expect(await find(text, ['ad-note'])).toEqual([
      { language: 'ad-note', link: 'Alpha', offset: text.indexOf('[[Alpha]]'), original: '[[Alpha]]' },
      { language: 'ad-note', link: 'Image.png', offset: text.indexOf('![[Image.png]]'), original: '![[Image.png]]' }
    ]);
  });

  it('should tell an embed from a link', async () => {
    const references = await findCodeBlockReferences({
      cache: parseMarkdown('```md\n![[Image.png]] [[Alpha]]\n```'),
      isLanguageIncluded: () => true,
      parseMarkdown: (markdown) => Promise.resolve(parseMarkdown(markdown)),
      text: '```md\n![[Image.png]] [[Alpha]]\n```'
    });

    expect(references.map(({ isEmbed, reference }) => [reference.link, isEmbed])).toEqual([['Image.png', true], ['Alpha', false]]);
  });

  it('should ignore a block whose language is not listed', async () => {
    expect(await find('```js\n// [[Alpha]]\n```\n', ['ad-note'])).toEqual([]);
  });

  it('should match a prefix pattern', async () => {
    const text = '```ad-warning\n[[Alpha]]\n```\n```ad-tip\n[[Bravo]]\n```\n```admonition\n[[Charlie]]\n```';

    const found = await find(text, ['ad-*']);
    expect(found.map(({ language, link }) => [language, link])).toEqual([['ad-warning', 'Alpha'], ['ad-tip', 'Bravo']]);
  });

  it('should take the first word of the info string as the language', async () => {
    const found = await find('```ad-note Some title\n[[Alpha]]\n```', ['ad-note']);
    expect(found.map(({ link }) => link)).toEqual(['Alpha']);
  });

  it('should ignore a fence with no language and an indented code block', async () => {
    expect(await find('```\n[[Alpha]]\n```\n\n    [[Bravo]]\n', ['*'])).toEqual([]);
  });

  it('should keep positions right after a multi-line block, and for a tilde fence', async () => {
    const text = 'Intro [[Outside]]\n~~~~tabs\nline one\n\nline [[Alpha]] three\n~~~~\n\n```tabs\n\n\n[[Bravo]]\n```';

    const found = await find(text, ['tabs']);
    expect(found.map(({ link, offset }) => [link, offset])).toEqual([
      ['Alpha', text.indexOf('[[Alpha]]')],
      ['Bravo', text.indexOf('[[Bravo]]')]
    ]);
  });

  it('should strip the fence indentation from the content and map the columns back', async () => {
    const text = '  ```ad-note\n  [[Alpha]]\n     [[Bravo]]\n  ```';

    const found = await find(text, ['ad-note']);
    expect(found.map(({ link, offset }) => [link, offset])).toEqual([
      ['Alpha', text.indexOf('[[Alpha]]')],
      ['Bravo', text.indexOf('[[Bravo]]')]
    ]);
  });

  it('should skip an indented code block, which Obsidian lists as a code section with no fence', async () => {
    const text = 'Intro\n\n    [[Alpha]]';
    const references = await findCodeBlockReferences({
      cache: { sections: [createSection(2, 7, 2, text.length)] },
      isLanguageIncluded: () => true,
      parseMarkdown: (markdown) => Promise.resolve(parseMarkdown(markdown)),
      text
    });

    expect(references).toEqual([]);
  });

  it('should find nothing in a block that is only its opening fence', async () => {
    expect(await find('Intro\n```ad-note', ['ad-note'])).toEqual([]);
  });

  it('should not take a shorter fence, or one of the other character, for the closing one', async () => {
    // Either way the block runs to the end of the note, so its last line is content, not a closing fence.
    const shorter = await find('````ad-note\n[[Alpha]]\n```', ['ad-note']);
    const otherCharacter = await find('~~~ad-note\n[[Alpha]]\n```', ['ad-note']);

    expect(shorter.map(({ link }) => link)).toEqual(['Alpha']);
    expect(otherCharacter.map(({ link }) => link)).toEqual(['Alpha']);
  });

  it('should read an unclosed block to the end of the note', async () => {
    const text = '```ad-note\n[[Alpha]]\n[[Bravo]]';

    const found = await find(text, ['ad-note']);
    expect(found.map(({ link }) => link)).toEqual(['Alpha', 'Bravo']);
  });

  it('should follow a whitelisted block nested inside a whitelisted one, and skip a nested other one', async () => {
    const text = '````ad-note\n[[Outer]]\n```ad-tip\n[[Inner]]\n```\n```js\n[[Code]]\n```\n````';

    expect(await find(text, ['ad-*'])).toEqual([
      { language: 'ad-note', link: 'Outer', offset: text.indexOf('[[Outer]]'), original: '[[Outer]]' },
      { language: 'ad-tip', link: 'Inner', offset: text.indexOf('[[Inner]]'), original: '[[Inner]]' }
    ]);
  });

  it('should never let the inner text be read as frontmatter', async () => {
    const parsedTexts: string[] = [];
    await findCodeBlockReferences({
      cache: parseMarkdown('```md\n---\n[[Alpha]]\n---\n```'),
      isLanguageIncluded: () => true,
      parseMarkdown: (markdown) => {
        parsedTexts.push(markdown);
        return Promise.resolve(parseMarkdown(markdown));
      },
      text: '```md\n---\n[[Alpha]]\n---\n```'
    });

    expect(parsedTexts).toEqual(['\n---\n[[Alpha]]\n---']);
  });

  it('should skip a block the parser fails on', async () => {
    expect(
      await findCodeBlockReferences({
        cache: parseMarkdown('```md\n[[Alpha]]\n```'),
        isLanguageIncluded: () => true,
        parseMarkdown: () => Promise.resolve(null),
        text: '```md\n[[Alpha]]\n```'
      })
    ).toEqual([]);
  });
});

describe('hasIncludedCodeBlock', () => {
  it('should say whether any block is of a listed language, without a parse', () => {
    const text = 'x\n```js\ncode\n```\n```ad-note\n[[Alpha]]\n```';
    const cache = parseMarkdown(text);

    expect(hasCodeSection(cache)).toBe(true);
    expect(hasIncludedCodeBlock({ cache, isLanguageIncluded: (language) => language === 'ad-note', text })).toBe(true);
    expect(hasIncludedCodeBlock({ cache, isLanguageIncluded: (language) => language === 'tabs', text })).toBe(false);
    expect(hasIncludedCodeBlock({ cache: {}, isLanguageIncluded: () => true, text })).toBe(false);
  });
});
