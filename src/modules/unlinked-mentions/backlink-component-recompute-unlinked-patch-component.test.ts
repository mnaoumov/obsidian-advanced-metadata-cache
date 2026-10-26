import type { BacklinkComponent } from '@obsidian-typings/obsidian-public-latest/implementations';
import type { CachedMetadata } from 'obsidian';
import type { Mock } from 'vitest';

import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { waitForAllAsyncOperations } from '@mnaoumov/typescript-test-toolkit/async-operation-tracking';
import { TFile } from 'obsidian';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

import type {
  UnlinkedMentionMatch,
  UnlinkedMentionsComponent
} from './unlinked-mentions-component.ts';

import { BacklinkComponentRecomputeUnlinkedPatchComponent } from './backlink-component-recompute-unlinked-patch-component.ts';

interface FakeResultDomItem {
  separateMatches: boolean;
}

const originalRecomputeUnlinked = vi.fn();
const originalOnFileChanged = vi.fn().mockReturnValue('original result');

class FakeBacklinkComponent {
  public addLinkFunction = vi.fn();
  public app = {
    metadataCache: {
      getFileCache: vi.fn((): CachedMetadata | null => null)
    }
  };

  public passSearchFilter = vi.fn((_file: TFile, content: string) => !content.includes('filtered'));
  public stopUnlinkedSearch = vi.fn();
  public unlinkedAliases = '';
  public unlinkedCollapsed = false;
  public unlinkedCountEl = { hide: vi.fn(), setText: vi.fn(), show: vi.fn() };
  public unlinkedDom = {
    addResult: vi.fn((_file: TFile, _result: unknown, _content: string): FakeResultDomItem => ({ separateMatches: false })),
    changed: vi.fn(),
    emptyResults: vi.fn(),
    getMatchCount: vi.fn(() => 7),
    removeResult: vi.fn(),
    sortOrder: 'alphabetical',
    startLoader: vi.fn(),
    stopLoader: vi.fn()
  };

  public unlinkedFile: null | TFile = null;

  public onFileChanged(file: unknown): unknown {
    return originalOnFileChanged(file) as unknown;
  }

  public recomputeUnlinked(file: unknown): unknown {
    return originalRecomputeUnlinked(file) as unknown;
  }
}

describe('BacklinkComponentRecomputeUnlinkedPatchComponent', () => {
  let backlinkComponent: FakeBacklinkComponent;
  let component: BacklinkComponentRecomputeUnlinkedPatchComponent;
  let getUnlinkedMentionIn: Mock<(file: TFile, mentioningFile: TFile) => Promise<null | UnlinkedMentionMatch>>;
  let getUnlinkedMentions: Mock<(file: TFile) => Promise<UnlinkedMentionMatch[]>>;
  let isBuilt: boolean;
  let target: TFile;

  beforeEach(async () => {
    vi.clearAllMocks();
    isBuilt = true;
    target = createFile('Target.md');
    getUnlinkedMentions = vi.fn<(file: TFile) => Promise<UnlinkedMentionMatch[]>>().mockResolvedValue([]);
    getUnlinkedMentionIn = vi.fn<(file: TFile, mentioningFile: TFile) => Promise<null | UnlinkedMentionMatch>>().mockResolvedValue(null);
    backlinkComponent = new FakeBacklinkComponent();
    component = new BacklinkComponentRecomputeUnlinkedPatchComponent({
      backlinkComponent: asBacklinkComponent(backlinkComponent),
      unlinkedMentionsComponent: castTo<UnlinkedMentionsComponent>({
        getUnlinkedMentionIn,
        getUnlinkedMentions,
        get isBuilt(): boolean {
          return isBuilt;
        }
      })
    });
    await component.loadWithPromises();
  });

  // The patch sits on the shared prototype, so a component left loaded would wrap the next test's patch.
  afterEach(() => {
    component.unload();
  });

  it('should fall through to Obsidian until the index is built', () => {
    isBuilt = false;

    backlinkComponent.recomputeUnlinked(target);

    expect(originalRecomputeUnlinked).toHaveBeenCalledWith(target);
    expect(getUnlinkedMentions).not.toHaveBeenCalled();
  });

  it('should fill the section from the index, sorted, filtered, with link buttons', async () => {
    const beta = createFile('Beta.md');
    const alpha = createFile('Alpha.md');
    const hidden = createFile('Hidden.md');
    getUnlinkedMentions.mockResolvedValue([
      match(beta, 'beta target', [[5, 11]]),
      match(hidden, 'filtered target', [[9, 15]]),
      match(alpha, 'alpha target', [[6, 12]])
    ]);
    backlinkComponent.app.metadataCache.getFileCache.mockReturnValue(castTo<CachedMetadata>({ frontmatter: { aliases: ['T'] } }));

    backlinkComponent.recomputeUnlinked(target);
    await waitForAllAsyncOperations();

    expect(originalRecomputeUnlinked).not.toHaveBeenCalled();
    expect(backlinkComponent.stopUnlinkedSearch).toHaveBeenCalled();
    expect(backlinkComponent.unlinkedFile).toBe(target);
    expect(backlinkComponent.unlinkedAliases).toBe('["T"]');
    expect(backlinkComponent.unlinkedDom.addResult.mock.calls.map(([file]) => castTo<TFile>(file).path)).toEqual(['Alpha.md', 'Beta.md']);
    expect(backlinkComponent.unlinkedDom.addResult).toHaveBeenCalledWith(alpha, { content: [[6, 12]] }, 'alpha target');
    expect(backlinkComponent.addLinkFunction).toHaveBeenCalledWith({ separateMatches: true }, target, alpha);
    expect(backlinkComponent.unlinkedDom.stopLoader).toHaveBeenCalled();
    expect(backlinkComponent.unlinkedCountEl.setText).toHaveBeenLastCalledWith('7');
    expect(backlinkComponent.unlinkedDom.changed).toHaveBeenCalled();
  });

  it('should hide the count of a collapsed section and not re-check changed files for it', async () => {
    backlinkComponent.unlinkedCollapsed = true;

    backlinkComponent.recomputeUnlinked(target);
    await waitForAllAsyncOperations();
    backlinkComponent.onFileChanged(createFile('One.md'));
    await waitForAllAsyncOperations();

    expect(backlinkComponent.unlinkedCountEl.hide).toHaveBeenCalled();
    expect(getUnlinkedMentions).not.toHaveBeenCalled();
    expect(getUnlinkedMentionIn).not.toHaveBeenCalled();
  });

  it('should empty the section when no note is shown', async () => {
    backlinkComponent.recomputeUnlinked(null);
    await waitForAllAsyncOperations();

    expect(backlinkComponent.unlinkedDom.emptyResults).toHaveBeenCalled();
    expect(getUnlinkedMentions).not.toHaveBeenCalled();
  });

  it('should drop an answer that arrives after a newer recompute began', async () => {
    let resolveFirst: ((matches: UnlinkedMentionMatch[]) => void) | undefined;
    getUnlinkedMentions.mockReturnValueOnce(
      new Promise<UnlinkedMentionMatch[]>((resolve) => {
        resolveFirst = resolve;
      })
    );

    backlinkComponent.recomputeUnlinked(target);
    backlinkComponent.recomputeUnlinked(target);
    resolveFirst?.([match(createFile('Late.md'), 'target', [[0, 6]])]);
    await waitForAllAsyncOperations();

    expect(backlinkComponent.unlinkedDom.addResult).not.toHaveBeenCalled();
  });

  it('should re-check a changed note against the shown note, adding or removing its result', async () => {
    backlinkComponent.recomputeUnlinked(target);
    await waitForAllAsyncOperations();
    const one = createFile('One.md');

    getUnlinkedMentionIn.mockResolvedValueOnce(match(one, 'target', [[0, 6]]));
    expect(backlinkComponent.onFileChanged(one)).toBe('original result');
    await waitForAllAsyncOperations();
    expect(getUnlinkedMentionIn).toHaveBeenCalledWith(target, one);
    expect(backlinkComponent.unlinkedDom.addResult).toHaveBeenCalledWith(one, { content: [[0, 6]] }, 'target');

    getUnlinkedMentionIn.mockResolvedValueOnce(null);
    backlinkComponent.onFileChanged(one);
    await waitForAllAsyncOperations();
    expect(backlinkComponent.unlinkedDom.removeResult).toHaveBeenCalledWith(one);

    getUnlinkedMentionIn.mockResolvedValueOnce(match(one, 'filtered', [[0, 6]]));
    backlinkComponent.onFileChanged(one);
    await waitForAllAsyncOperations();
    expect(backlinkComponent.unlinkedDom.removeResult).toHaveBeenCalledTimes(2);
  });

  it('should not re-check the shown note itself, a folder, or after the shown note changed', async () => {
    backlinkComponent.recomputeUnlinked(target);
    await waitForAllAsyncOperations();

    backlinkComponent.onFileChanged(target);
    backlinkComponent.onFileChanged({ path: 'Folder' });
    await waitForAllAsyncOperations();
    expect(getUnlinkedMentionIn).not.toHaveBeenCalled();

    const one = createFile('One.md');
    getUnlinkedMentionIn.mockImplementationOnce(() => {
      backlinkComponent.unlinkedFile = createFile('Other.md');
      return Promise.resolve(match(one, 'target', [[0, 6]]));
    });
    backlinkComponent.onFileChanged(one);
    await waitForAllAsyncOperations();
    expect(backlinkComponent.unlinkedDom.addResult).not.toHaveBeenCalled();
  });

  it('should not re-check anything for a section Obsidian filled, or when none is shown', async () => {
    backlinkComponent.onFileChanged(createFile('One.md'));
    isBuilt = false;
    backlinkComponent.recomputeUnlinked(target);
    backlinkComponent.onFileChanged(createFile('One.md'));
    await waitForAllAsyncOperations();

    isBuilt = true;
    backlinkComponent.recomputeUnlinked(null);
    await waitForAllAsyncOperations();
    backlinkComponent.onFileChanged(createFile('One.md'));
    await waitForAllAsyncOperations();

    expect(getUnlinkedMentionIn).not.toHaveBeenCalled();
  });

  it('should restore the original methods when unloaded', () => {
    component.unload();

    backlinkComponent.recomputeUnlinked(target);

    expect(originalRecomputeUnlinked).toHaveBeenCalledWith(target);
  });
});

function asBacklinkComponent(fake: FakeBacklinkComponent): BacklinkComponent {
  return castTo<BacklinkComponent>(fake);
}

function createFile(path: string): TFile {
  return castTo<TFile>(App.createConfigured__().vault.createSync__(path, ''));
}

function match(file: TFile, content: string, ranges: [number, number][]): UnlinkedMentionMatch {
  return { content, file, ranges };
}
