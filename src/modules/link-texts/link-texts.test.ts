import type {
  CachedMetadata,
  Reference
} from 'obsidian';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import {
  describe,
  expect,
  it
} from 'vitest';

import {
  getWrittenLinkText,
  readLinkTexts
} from './link-texts.ts';

describe('getWrittenLinkText', () => {
  it.each([
    ['[[bravo|alpha]]', 'alpha'],
    ['[alpha](bravo.md)', 'alpha'],
    [String.raw`[\*alpha\*](bravo.md)`, '*alpha*'],
    ['[[bravo#Heading| alpha ]]', 'alpha'],
    ['![[IMG_2231.jpg|boarding pass]]', 'boarding pass'],
    ['![[IMG_2231.jpg|boarding pass|300]]', 'boarding pass'],
    ['![boarding pass|300x200](IMG_2231.jpg)', 'boarding pass'],
    ['[[bravo|2026]]', '2026']
  ])('should read %s as %s', (original, expected) => {
    expect(getWrittenLinkText(toReference(original))).toBe(expected);
  });

  it.each([
    '[[bravo]]',
    '[](bravo.md)',
    '![[IMG_2231.jpg|300]]',
    '![[IMG_2231.jpg|300x200]]',
    '[alpha](https://example.com)',
    'not a link'
  ])('should find no written text in %s', (original) => {
    expect(getWrittenLinkText(toReference(original))).toBeNull();
  });
});

describe('readLinkTexts', () => {
  it('should keep written texts that are not the target\'s own name, from links, embeds and frontmatter', () => {
    const cache = castTo<CachedMetadata>({
      embeds: [toReference('![[IMG_2231.jpg|boarding pass]]', 'IMG_2231.jpg')],
      frontmatterLinks: [{ displayText: '', key: 'related', link: 'bravo', original: '[[bravo|from frontmatter]]' }],
      links: [
        toReference('[alpha](bravo.md)', 'bravo.md'),
        toReference('[[bravo]]'),
        toReference('[Bravo](bravo.md)', 'bravo.md'),
        toReference('[[Notes/bravo|notes/BRAVO]]', 'Notes/bravo'),
        toReference('[[bravo|bravo.md]]'),
        toReference('[[missing|charlie]]', 'missing')
      ]
    });

    expect(readLinkTexts({
      cache,
      resolveTargetPath: (reference) => {
        if (reference.link === 'missing') {
          return null;
        }
        return reference.link === 'IMG_2231.jpg' ? 'IMG_2231.jpg' : 'Notes/bravo.md';
      }
    })).toEqual([
      { targetPath: 'IMG_2231.jpg', text: 'boarding pass' },
      { targetPath: 'Notes/bravo.md', text: 'alpha' },
      { targetPath: 'Notes/bravo.md', text: 'from frontmatter' }
    ]);
  });

  it('should compare a target without an extension by its whole name', () => {
    const cache = castTo<CachedMetadata>({ links: [toReference('[[Makefile|Makefile]]', 'Makefile'), toReference('[[Makefile|build]]', 'Makefile')] });

    expect(readLinkTexts({ cache, resolveTargetPath: () => 'Makefile' })).toEqual([{ targetPath: 'Makefile', text: 'build' }]);
  });
});

let nextLine = 0;

// Each at an offset of its own: `getReferences` keeps one reference per start offset.
function toReference(original: string, link = 'bravo'): Reference {
  const line = nextLine++;
  return castTo<Reference>({ displayText: '', link, original, position: { end: { col: original.length, line, offset: line * 100 + original.length }, start: { col: 0, line, offset: line * 100 } } });
}
