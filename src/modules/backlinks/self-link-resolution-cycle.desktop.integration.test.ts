import {
  evalInObsidian,
  pollInObsidian
} from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  describe,
  expect,
  it
} from 'vitest';

/*
 * Issue #17: saving a note carrying many self-links stalled the editor for 20-30 seconds.
 *
 * The plugin REPLACES `metadataCache.updateRelatedLinks` (it does not call through). Indexing a
 * self-link in `resolvedBasenameMap` made that replacement queue the note for re-resolution in response
 * to the note's OWN change, which fires `changed`, which refreshes its backlinks, which queues it
 * again. Each pass is linear in the self-link count, so the stall is the number of passes.
 *
 * This drives the patched `updateRelatedLinks` in a real Obsidian and asserts the note is not queued
 * for its own change, while its self-backlinks are still recorded — the two halves of the fix. It
 * asserts the CAUSE rather than a wall-clock duration, which would be flaky and would not say why.
 */

const NOTE_PATH = 'self-linker.md';
const NOTE_BASENAME = 'self-linker';
const SELF_LINK_COUNT = 72;
const CACHE_WAIT_IN_MS = 60_000;
const CACHE_POLL_IN_MS = 500;
const SCENARIO_TIMEOUT_IN_MS = 120_000;

describe('self-linking note does not trigger a re-resolution cycle (issue #17)', () => {
  it('should not queue the note for its own change, yet still record its self-backlinks', async () => {
    const vaultPath = getTemporaryVault().path;

    // Wait, in Node and one short eval per poll, for the plugin's index to see every self-link.
    const { selfBacklinkCount } = await pollInObsidian({
      input: {
        NOTE_PATH,
        SELF_LINK_COUNT
      },
      intervalInMilliseconds: CACHE_POLL_IN_MS,
      poll({ app, NOTE_PATH: notePath }) {
        const noteFile = app.vault.getFileByPath(notePath);
        return { selfBacklinkCount: noteFile ? app.metadataCache.getBacklinksForFile(noteFile).get(notePath)?.length ?? 0 : 0 };
      },
      async start({ app, NOTE_PATH: notePath, SELF_LINK_COUNT: selfLinkCount }) {
        // The reporter's exact link shape: an angle-bracket-wrapped same-file heading link whose
        // display text is itself markdown. Each one gets a real heading so it resolves.
        const lines: string[] = [];
        for (let index = 0; index < selfLinkCount; index++) {
          lines.push(`## Section ${String(index)}`, `[**Jump ${String(index)}**](<#Section ${String(index)}>)`, '');
        }
        // Idempotent, so a re-run against a reused vault behaves the same as a fresh one.
        const content = lines.join('\n');
        const existing = app.vault.getFileByPath(notePath);
        if (existing) {
          await app.vault.modify(existing, content);
        } else {
          await app.vault.create(notePath, content);
        }
      },
      timeoutInMilliseconds: CACHE_WAIT_IN_MS,
      timeoutMessage: `the index never recorded all ${String(SELF_LINK_COUNT)} self-links of ${NOTE_PATH}`,
      until: (status) => status.selfBacklinkCount >= SELF_LINK_COUNT,
      vaultPath
    });

    const result = await evalInObsidian({
      callback({ app, NOTE_BASENAME: noteBasename, NOTE_PATH: notePath }) {
        // Record what the PATCHED updateRelatedLinks queues for the note's own name.
        const queuedPaths: string[] = [];
        const originalQueue = app.metadataCache.queueFileForLinkResolution.bind(app.metadataCache);
        app.metadataCache.queueFileForLinkResolution = (file): void => {
          if (file) {
            queuedPaths.push(file.path);
          }
          originalQueue(file);
        };

        try {
          app.metadataCache.updateRelatedLinks([`${noteBasename}.md`]);
        } finally {
          app.metadataCache.queueFileForLinkResolution = originalQueue;
        }

        return { queuedSelf: queuedPaths.includes(notePath) };
      },
      input: {
        NOTE_BASENAME,
        NOTE_PATH
      },
      vaultPath
    });

    // Every self-link is still a backlink — the fix must not cost the panel anything.
    expect(selfBacklinkCount).toBe(SELF_LINK_COUNT);
    // The note is NOT queued to re-resolve itself. This is the cycle's closing edge; before the fix it
    // was queued, and each pass cost one full refresh plus a recompute of every open backlink panel.
    expect(result.queuedSelf).toBe(false);
  }, SCENARIO_TIMEOUT_IN_MS);
});
