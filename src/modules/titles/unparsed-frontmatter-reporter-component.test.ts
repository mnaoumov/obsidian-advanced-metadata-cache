import type { App as AppOriginal } from 'obsidian';
import type { MockInstance } from 'vitest';

import { setTimeoutAsync } from '@mnaoumov/typescript-lib/async';
import { castTo } from '@mnaoumov/typescript-lib/object-utils';
import { waitForAllAsyncOperations } from '@mnaoumov/typescript-test-toolkit/async-operation-tracking';
import { App } from 'obsidian-test-mocks/obsidian';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';

vi.mock('@mnaoumov/obsidian-lib/metadata-cache', async (importOriginal) => ({
  ...await importOriginal<typeof import('@mnaoumov/obsidian-lib/metadata-cache')>(),
  ensureMetadataCacheReady: vi.fn(async () => {
    // Ready at once.
  })
}));

/* eslint-disable import-x/first, import-x/imports-first -- vi.mock must precede imports. */
import { UnparsedFrontmatterReporterComponent } from './unparsed-frontmatter-reporter-component.ts';
/* eslint-enable import-x/first, import-x/imports-first -- End of the mocked imports. */

const BROKEN = '---\ntitle: 759/21777/26\nctime: 1\nctime: 2\n---\n# Case\n';
const BROKEN_DIFFERENTLY = '---\ntitle: 759/21777/26\naliases: [a\n---\n# Case\n';
const FIXED = '---\ntitle: 759/21777/26\nctime: 1\n---\n# Case\n';

describe('UnparsedFrontmatterReporterComponent', () => {
  let app: App;
  let component: UnparsedFrontmatterReporterComponent;
  let warn: MockInstance<Console['warn']>;

  beforeEach(() => {
    app = App.createConfigured__();
    component = new UnparsedFrontmatterReporterComponent({ app: castTo<AppOriginal>(app) });
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {
      // Asserted on, not printed.
    });
  });

  afterEach(() => {
    component.unload();
    warn.mockRestore();
  });

  it('should report at startup every note whose frontmatter does not parse, and no other', async () => {
    app.vault.createSync__('Case.md', BROKEN);
    app.vault.createSync__('Fine.md', FIXED);
    app.vault.createSync__('Empty.md', '---\n---\nBody');
    app.vault.createSync__('Plain.md', 'No frontmatter');

    await load();

    expect(getReportedPaths()).toEqual(['Case.md']);
    expect(warn.mock.calls[0]?.[1]).toEqual(expect.any(String));
  });

  it('should report once per error, and again only after the error changed or the note was fixed', async () => {
    const file = app.vault.createSync__('Case.md', BROKEN);
    await load();

    await app.vault.modify(file, `${BROKEN}More\n`);
    await settle();
    expect(getReportedPaths()).toEqual(['Case.md']);

    await app.vault.modify(file, BROKEN_DIFFERENTLY);
    await settle();
    expect(getReportedPaths()).toEqual(['Case.md', 'Case.md']);

    await app.vault.modify(file, FIXED);
    await settle();
    await app.vault.modify(file, BROKEN);
    await settle();
    expect(getReportedPaths()).toEqual(['Case.md', 'Case.md', 'Case.md']);
  });

  it('should report a note that breaks after startup', async () => {
    const file = app.vault.createSync__('Case.md', FIXED);
    await load();
    expect(getReportedPaths()).toEqual([]);

    await app.vault.modify(file, BROKEN);
    await settle();

    expect(getReportedPaths()).toEqual(['Case.md']);
  });

  it('should report nothing once unloaded', async () => {
    const file = app.vault.createSync__('Case.md', FIXED);
    await load();
    component.unload();

    await app.vault.modify(file, BROKEN);
    await settle();

    expect(getReportedPaths()).toEqual([]);
  });

  function getReportedPaths(): string[] {
    return warn.mock.calls.map((call) => /"(?<path>[^"]+)"/.exec(String(call[0]))?.groups?.['path'] ?? '');
  }

  async function load(): Promise<void> {
    await component.loadWithPromises();
    app.workspace.setLayoutReady__();
    await settle();
  }

  async function settle(): Promise<void> {
    await setTimeoutAsync(0);
    await waitForAllAsyncOperations();
  }
});
