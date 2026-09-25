/**
 * @file
 *
 * Produces the desktop screenshots the community-store listing needs,
 * driving a real Obsidian and writing
 * `images/screenshots/screenshot-desktop-N.png`.
 *
 * This plugin's payoff is SPEED, which a still frame cannot show by itself — and
 * a small vault has no payoff at all, as the plugin's own README says. So the
 * capture builds the condition the plugin is for: a vault of several thousand
 * notes, generated here rather than staged, with one note everything points at.
 *
 * The numbers in frame are measured in that vault, in the same run, on the same
 * note: the patched lookup, then Obsidian's own implementation reached through
 * `getBacklinksForFile.originalFn`. Nothing is quoted from a benchmark elsewhere,
 * and the assertion requires the patched path to actually be faster before the
 * frame claiming so is written.
 */

import {
  mkdirSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { sleep as sleepInNode } from 'obsidian-dev-utils/async';
import {
  captureObsidianScreenshot,
  evalInObsidian,
  labelScreenshot,
  readPngDimensions
} from 'obsidian-integration-testing';
import { getTemporaryVault } from 'obsidian-integration-testing/vitest-global-setup-plugin';
import {
  beforeAll,
  describe,
  expect,
  it
} from 'vitest';

/**
 * The dictionary either implementation answers with, reduced to its keys.
 */
interface BacklinkDictionary {
  keys: (this: void) => string[];
}

/**
 * `App`, reduced to the inline-title toggle that `obsidian-typings` does not
 * declare. Setting the config alone changes nothing on screen.
 */
interface InlineTitleApp {
  updateInlineTitleDisplay: (this: void) => void;
}

/**
 * The backlink lookup as this plugin leaves it: callable as before, plus the
 * `originalFn` handle onto Obsidian's own implementation, which is what makes a
 * fair side-by-side measurement possible at all.
 */
interface PatchedGetBacklinksForFile {
  (this: void, file: unknown): BacklinkDictionary;
  // eslint-disable-next-line unicorn/name-replacements -- `originalFn` is the plugin's own public property name, not ours to rename.
  originalFn: (this: void, file: unknown) => BacklinkDictionary;
}

const WIDTH_IN_PIXELS = 1200;
const HEIGHT_IN_PIXELS = 800;

/**
 * The note everything points at, and the folder the pointing notes live in.
 */
const HUB_NOTE_PATH = 'Projects/Website redesign.md';
const LINKING_FOLDER = 'Journal';

/**
 * How many notes link to the hub. Enough that the Backlinks pane is worth looking
 * at, and enough that Obsidian's own scan has something to do.
 */
const LINKING_NOTE_COUNT = 120;

/**
 * How many other notes the vault holds. This is the only reason any of this is
 * worth measuring: the plugin answers from an index, so its cost does not move
 * with this number, while Obsidian's own implementation walks all of it.
 */
const FILLER_NOTE_COUNT = 4000;

/**
 * How much faster the cached lookup has to be before a frame may say so.
 */
const REQUIRED_SPEEDUP = 2;

/**
 * Where the measured numbers are written so they can be photographed. A `Notice`
 * would be the obvious place and is out of reach: a serialized closure has no
 * imports, so it cannot construct one.
 */
const RESULT_NOTE_PATH = 'Measurements.md';

/**
 * The plugin's own id, which is also the id of its settings tab.
 */
const PLUGIN_ID = 'advanced-metadata-cache';

/**
 * How many notes are WRITTEN into the vault: the hub, the notes linking to it, and the filler.
 *
 * Obsidian routinely settles BELOW it, and that is not a bug in the staging. The notes are written
 * into a vault that is already open, so Obsidian learns about them through the platform's
 * directory-change watcher — which has a bounded buffer and silently drops events when thousands of
 * files land at once. Measured here 2026-09-23: 4121 written, 2546 and 2638 seen on two runs.
 *
 * So this is the ceiling the wait below stops AT, never the figure it holds out for. What it waits
 * for is the count to stop moving, because the backlink count is no use as a settle signal: it
 * reaches its own total while the filler is still arriving, which is how the first frame came out
 * reporting a vault a third smaller than the one the caption describes.
 */
const STAGED_NOTE_COUNT = 1 + LINKING_NOTE_COUNT + FILLER_NOTE_COUNT;

/**
 * How many consecutive unchanged polls mean the vault has stopped growing rather than merely paused.
 */
const SETTLED_POLL_COUNT = 3;

/**
 * The module rows the settings tab leads with, in the order it renders them.
 *
 * Asserted rather than merely photographed: the frame's caption says every index is a module of its
 * own, and this is what stops that caption outliving the settings tab it describes.
 */
const EXPECTED_MODULE_SETTING_NAMES = ['Backlinks module', 'Names module', 'Titles module'];

/**
 * What every module row's name ends with, and so how a module row is told from the rows that
 * configure one.
 */
const MODULE_SETTING_NAME_SUFFIX = ' module';

const IMAGES_DIRECTORY = join(process.cwd(), 'images', 'screenshots');

/**
 * The measurement, taken once and reused by the frames that report it.
 */
let measurement: BacklinkMeasurement | null = null;

beforeAll(async () => {
  const vault = getTemporaryVault();

  vault.populate(buildVault());
  await vault.syncToDevice();

  await evalInObsidian({
    async callback({ app, hubNotePath, lib: { waitUntil }, linkingNoteCount }) {
      /*
       * Under the transport's ~30s per-closure cap, not at it.
       * Read and deliberately left as it is. The ceiling below is the whole budget bar a 1_500 settle,
       * and unlike most ceilings in these suites it is not generous over sub-second work: what it waits
       * for is a vault of thousands of notes becoming readable, which is the slow step these shots exist
       * to photograph.
       * Tightening it would trade a failure that names the wait for one that photographs a half-indexed
       * vault, and there is no margin to buy: the settle is the only other cost.
       */
      const INDEX_TIMEOUT_IN_MILLISECONDS = 25_000;
      const SETTLE_DELAY_IN_MILLISECONDS = 1500;

      app.changeTheme('obsidian');

      await waitUntil({
        message: 'the staged vault to appear',
        predicate: () => Boolean(app.vault.getFileByPath(hubNotePath)),
        timeoutInMilliseconds: INDEX_TIMEOUT_IN_MILLISECONDS
      });

      app.vault.setConfig('showInlineTitle', false);
      const inlineTitleApp: unknown = app;
      (inlineTitleApp as InlineTitleApp).updateInlineTitleDisplay();

      await sleep(SETTLE_DELAY_IN_MILLISECONDS);

      return { linkingNoteCount };
    },
    input: { hubNotePath: HUB_NOTE_PATH, linkingNoteCount: LINKING_NOTE_COUNT },
    vaultPath: vaultPath()
  });

  // Indexing thousands of notes takes Obsidian a while, and every frame below is
  // meaningless until it has finished — a Backlinks pane that is still filling in
  // photographs as a plugin that found nothing.
  await waitForIndex();
});

describe('desktop store screenshots', () => {
  it('1 - the backlinks of a note in a big vault', async () => {
    const backlinkCount = await openBacklinksPane();
    expect(backlinkCount).toBe(LINKING_NOTE_COUNT);
    await shoot(1, 'The Backlinks module: all 120 backlinks in a big vault');
  });

  it('2 - how long each way takes', async () => {
    measurement = await measureBacklinkLookups();
    // The frame reports numbers; this is what stops it reporting a lie.
    expect(measurement.cachedInMilliseconds).toBeLessThan(measurement.originalInMilliseconds / REQUIRED_SPEEDUP);
    await shoot(2, 'Answered from an index, not a scan of every note');
  });

  it('3 - the same answer, either way', async () => {
    const counts = await compareBacklinkCounts();
    // Faster is only worth anything if it is also right.
    expect(counts.cached).toBe(counts.original);
    expect(counts.cached).toBe(LINKING_NOTE_COUNT);
    await shoot(3, 'The same answer as Obsidian, arrived at faster');
  });

  it('4 - every index is a module of its own', async () => {
    const moduleSettingNames = await openSettingsTab();

    // The whole point of the frame: three modules, and the backlink one leading. A set of frames
    // showing only backlinks would photograph the plugin this was ported FROM.
    expect(moduleSettingNames).toStrictEqual(EXPECTED_MODULE_SETTING_NAMES);
    await shoot(4, 'Every index is a module, switched on by itself');
  });
});

/**
 * Builds the vault the shots are taken in.
 *
 * Named like a vault someone actually keeps: the frames show the file explorer,
 * and `big/dir-3/file-17.md` would photograph as a benchmark rather than as the
 * situation the reader is in.
 *
 * @returns A map of vault-relative paths to content.
 */
function buildVault(): Record<string, string> {
  const files: Record<string, string> = {
    [HUB_NOTE_PATH]: '# Website redesign\n\nThe project everything else refers back to.\n'
  };

  const topics = ['Standup', 'Review', 'Retro', 'Planning', 'Handover'];

  for (let index = 0; index < LINKING_NOTE_COUNT; index++) {
    const topic = topics[index % topics.length] ?? 'Standup';
    const day = (index % 28) + 1;
    const month = (index % 12) + 1;
    const paddedMonth = String(month).padStart(2, '0');
    const paddedDay = String(day).padStart(2, '0');
    files[`${LINKING_FOLDER}/2026-${paddedMonth}/2026-${paddedMonth}-${paddedDay} ${topic}.md`] = `# ${topic}\n\nPicked up again on [[Website redesign]].\n`;
  }

  // The filler notes LINK to each other. An empty note costs Obsidian's own
  // implementation nothing to walk, so a vault of empty notes would have measured
  // A difference that no reader's vault would reproduce — real vaults are full of
  // links, and links are what that implementation re-reads on every question.
  for (let index = 0; index < FILLER_NOTE_COUNT; index++) {
    const folder = `Archive/${String(2010 + (index % 15))}`;
    const firstNeighbor = (index + 1) % FILLER_NOTE_COUNT;
    const secondNeighbor = (index + 7) % FILLER_NOTE_COUNT;
    files[`${folder}/Note ${String(index)}.md`] = [
      `# Note ${String(index)}`,
      '',
      `Older material. See also [[Note ${String(firstNeighbor)}]] and [[Note ${String(secondNeighbor)}]].`,
      ''
    ].join('\n');
  }

  return files;
}

/**
 * Asks for the backlink count both ways.
 *
 * @returns What each implementation answered.
 */
async function compareBacklinkCounts(): Promise<BacklinkCounts> {
  return await evalInObsidian({
    async callback({ app, hubNotePath, resultNotePath }) {
      const SETTLE_DELAY_IN_MILLISECONDS = 1500;
      const RESIZE_SETTLE_DELAY_IN_MILLISECONDS = 2000;

      await sleep(RESIZE_SETTLE_DELAY_IN_MILLISECONDS);

      // Shot 1 left a Backlinks tab and an expanded right dock behind. They would
      // sit in this frame reporting "No backlinks found" for the results note,
      // which is true and completely beside the point.
      for (const backlinkLeaf of app.workspace.getLeavesOfType('backlink')) {
        backlinkLeaf.detach();
      }

      app.workspace.rightSplit.collapse();
      app.workspace.leftSplit.collapse();

      /**
       * Writes the measured numbers into a note and opens it, which is what the
       * shot photographs. Defined here rather than at module scope because a
       * serialized closure carries no outer functions with it.
       *
       * @param lines - The note's Markdown, line by line.
       */
      async function writeResultNote(lines: string[]): Promise<void> {
        const content = lines.join('\n');
        const existing = app.vault.getFileByPath(resultNotePath);
        const resultFile = existing ?? await app.vault.create(resultNotePath, content);
        if (existing) {
          await app.vault.modify(existing, content);
        }

        await app.workspace.getLeaf(false).openFile(resultFile);
        await app.workspace.getLeaf(false).setViewState({
          state: { file: resultNotePath, mode: 'preview', source: false },
          type: 'markdown'
        });
      }

      const file = app.vault.getFileByPath(hubNotePath);
      if (!file) {
        throw new Error(`Note is missing from the vault: ${hubNotePath}`);
      }

      const lookup: unknown = app.metadataCache.getBacklinksForFile;
      const getBacklinksForFile = lookup as PatchedGetBacklinksForFile;
      const cached = getBacklinksForFile(file).keys().length;
      const original = getBacklinksForFile.originalFn(file).keys().length;

      await writeResultNote([
        '# Backlinks for Website redesign',
        '',
        '| Asked | Answer |',
        '| --- | --- |',
        `| From the cache | ${String(cached)} backlinks |`,
        `| Obsidian's own | ${String(original)} backlinks |`
      ]);

      await sleep(SETTLE_DELAY_IN_MILLISECONDS);

      return { cached, original };
    },
    input: { hubNotePath: HUB_NOTE_PATH, resultNotePath: RESULT_NOTE_PATH },
    vaultPath: vaultPath()
  });
}

/**
 * Times both implementations over the same note.
 *
 * @returns The two timings, in milliseconds.
 */
async function measureBacklinkLookups(): Promise<BacklinkMeasurement> {
  return await evalInObsidian({
    async callback({ app, hubNotePath, iterations, resultNotePath }) {
      const SETTLE_DELAY_IN_MILLISECONDS = 1500;
      const RESIZE_SETTLE_DELAY_IN_MILLISECONDS = 2000;

      await sleep(RESIZE_SETTLE_DELAY_IN_MILLISECONDS);

      // Shot 1 left a Backlinks tab and an expanded right dock behind. They would
      // sit in this frame reporting "No backlinks found" for the results note,
      // which is true and completely beside the point.
      for (const backlinkLeaf of app.workspace.getLeavesOfType('backlink')) {
        backlinkLeaf.detach();
      }

      app.workspace.rightSplit.collapse();
      app.workspace.leftSplit.collapse();

      /**
       * Writes the measured numbers into a note and opens it, which is what the
       * shot photographs. Defined here rather than at module scope because a
       * serialized closure carries no outer functions with it.
       *
       * @param lines - The note's Markdown, line by line.
       */
      async function writeResultNote(lines: string[]): Promise<void> {
        const content = lines.join('\n');
        const existing = app.vault.getFileByPath(resultNotePath);
        const resultFile = existing ?? await app.vault.create(resultNotePath, content);
        if (existing) {
          await app.vault.modify(existing, content);
        }

        await app.workspace.getLeaf(false).openFile(resultFile);
        await app.workspace.getLeaf(false).setViewState({
          state: { file: resultNotePath, mode: 'preview', source: false },
          type: 'markdown'
        });
      }

      const file = app.vault.getFileByPath(hubNotePath);
      if (!file) {
        throw new Error(`Note is missing from the vault: ${hubNotePath}`);
      }

      const lookup: unknown = app.metadataCache.getBacklinksForFile;
      const getBacklinksForFile = lookup as PatchedGetBacklinksForFile;

      function measure(run: () => void): number {
        const start = performance.now();
        for (let iteration = 0; iteration < iterations; iteration++) {
          run();
        }

        return (performance.now() - start) / iterations;
      }

      const cachedInMilliseconds = measure(() => {
        getBacklinksForFile(file);
      });
      const originalInMilliseconds = measure(() => {
        getBacklinksForFile.originalFn(file);
      });

      await writeResultNote([
        `# Backlinks for ${file.basename}`,
        '',
        `Averaged over ${String(iterations)} calls, in a vault of ${String(app.vault.getMarkdownFiles().length)} notes.`,
        '',
        '| Asked | Time |',
        '| --- | --- |',
        `| From the cache | ${cachedInMilliseconds.toFixed(3)} ms |`,
        `| Obsidian's own | ${originalInMilliseconds.toFixed(3)} ms |`
      ]);

      await sleep(SETTLE_DELAY_IN_MILLISECONDS);

      return { cachedInMilliseconds, originalInMilliseconds };
    },
    input: { hubNotePath: HUB_NOTE_PATH, iterations: MEASUREMENT_ITERATIONS, resultNotePath: RESULT_NOTE_PATH },
    vaultPath: vaultPath()
  });
}

/**
 * Opens the hub note with the Backlinks pane beside it.
 *
 * @returns How many backlinks the pane is showing.
 */
async function openBacklinksPane(): Promise<number> {
  return await evalInObsidian({
    async callback({ app, hubNotePath, lib: { waitUntil } }) {
      /*
       * Under the transport's ~30s per-closure cap, not at it.
       * Read and deliberately left as it is, for the same reason as the staging closure above: the
       * ceiling waits for the Backlinks pane to fill from a vault of thousands of notes, which is the
       * slow step rather than a generous margin over a quick one.
       * A pane still filling in is what this frame must never show, so the budget stays and the 2_000
       * settle after it is the only other cost.
       */
      const RENDER_TIMEOUT_IN_MILLISECONDS = 25_000;
      const SETTLE_DELAY_IN_MILLISECONDS = 2000;

      const file = app.vault.getFileByPath(hubNotePath);
      if (!file) {
        throw new Error(`Note is missing from the vault: ${hubNotePath}`);
      }

      await app.workspace.getLeaf(false).openFile(file);

      // ONE pane, in the right dock where Obsidian normally keeps it. The
      // `backlink:open-backlinks` command opens a second one as a tab in the main
      // area, and a frame showing the same list twice reads as a mistake.
      for (const staleLeaf of app.workspace.getLeavesOfType('backlink')) {
        staleLeaf.detach();
      }

      app.workspace.rightSplit.expand();
      const backlinkLeaf = app.workspace.getRightLeaf(false);
      if (!backlinkLeaf) {
        throw new Error('Obsidian offered no right-dock leaf for the backlinks pane.');
      }

      await backlinkLeaf.setViewState({ active: true, type: 'backlink' });
      await app.workspace.revealLeaf(backlinkLeaf);

      // The file explorer would otherwise take a third of the frame for folders
      // nobody is reading.
      app.workspace.leftSplit.collapse();

      await waitUntil({
        message: 'the backlinks pane to fill',
        predicate: () => document.querySelectorAll('.backlink-pane .search-result-file-title').length > 0,
        timeoutInMilliseconds: RENDER_TIMEOUT_IN_MILLISECONDS
      });

      await sleep(SETTLE_DELAY_IN_MILLISECONDS);

      return app.metadataCache.getBacklinksForFile(file).keys().length;
    },
    input: { hubNotePath: HUB_NOTE_PATH },
    vaultPath: vaultPath()
  });
}

/**
 * Opens the plugin's own settings tab, which is where the modules are switched on and off.
 *
 * Left in its default state deliberately — Backlinks on, Names and Titles off — because that IS the
 * shape a reader meets: one module doing the work it was installed for, and two more they can switch
 * on. Toggling one here would photograph a vault nobody has.
 *
 * @returns The names of the rendered module rows, in render order.
 */
async function openSettingsTab(): Promise<string[]> {
  return await evalInObsidian({
    async callback({ app, lib: { waitUntil }, moduleSettingNameSuffix, pluginId }) {
      const RENDER_TIMEOUT_IN_MILLISECONDS = 20_000;
      const OPEN_DELAY_IN_MILLISECONDS = 500;
      const SETTLE_DELAY_IN_MILLISECONDS = 1500;

      // The earlier frames left a results note, a Backlinks tab and an expanded dock behind. The
      // settings modal covers all of it, but a notice would sit on TOP of the modal.
      for (const noticeEl of document.querySelectorAll('.notice')) {
        noticeEl.detach();
      }

      app.setting.open();
      await sleep(OPEN_DELAY_IN_MILLISECONDS);
      app.setting.openTabById(pluginId);

      await waitUntil({
        message: 'the settings tab to render its module rows',
        predicate: () =>
          [...document.querySelectorAll('.setting-item-name')]
            .some((settingNameEl) => settingNameEl.textContent.endsWith(moduleSettingNameSuffix)),
        timeoutInMilliseconds: RENDER_TIMEOUT_IN_MILLISECONDS
      });

      await sleep(SETTLE_DELAY_IN_MILLISECONDS);

      return [...document.querySelectorAll('.setting-item-name')]
        .map((settingNameEl) => settingNameEl.textContent)
        .filter((settingName) => settingName.endsWith(moduleSettingNameSuffix));
    },
    input: { moduleSettingNameSuffix: MODULE_SETTING_NAME_SUFFIX, pluginId: PLUGIN_ID },
    vaultPath: vaultPath()
  });
}

/**
 * Captures the window, captions it, and writes it as
 * `images/screenshots/screenshot-desktop-<index>.png`.
 *
 * @param index - The 1-based listing position.
 * @param caption - The caption drawn across the bottom of the frame.
 */
async function shoot(index: number, caption: string): Promise<void> {
  const bytes = await captureObsidianScreenshot({
    heightInPixels: HEIGHT_IN_PIXELS,
    vaultPath: vaultPath(),
    widthInPixels: WIDTH_IN_PIXELS
  });

  const labeled = await labelScreenshot(bytes, { text: caption });

  expect(readPngDimensions(labeled)).toStrictEqual({
    heightInPixels: HEIGHT_IN_PIXELS,
    widthInPixels: WIDTH_IN_PIXELS
  });

  mkdirSync(IMAGES_DIRECTORY, { recursive: true });
  writeFileSync(join(IMAGES_DIRECTORY, `screenshot-desktop-${String(index)}.png`), labeled);
}

function vaultPath(): string {
  return getTemporaryVault().path;
}

/**
 * Waits for Obsidian to have read the whole staged vault, and for the plugin's index to hold every
 * linking note.
 *
 * Both halves, because they finish at different times: a frame taken before the pane settles shows a
 * half-built list, and one taken before the vault settles reports a smaller vault than the caption
 * claims.
 */
async function waitForIndex(): Promise<void> {
  const ATTEMPTS = 60;
  const INTERVAL_IN_MILLISECONDS = 3000;

  let progress: StagingProgress = { backlinkCount: 0, markdownFileCount: 0 };
  let lastMarkdownFileCount = -1;
  let settledPollCount = 0;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    progress = await readStagingProgress();

    settledPollCount = progress.markdownFileCount === lastMarkdownFileCount ? settledPollCount + 1 : 0;
    lastMarkdownFileCount = progress.markdownFileCount;

    // Everything arrived, which is the happy ending and the only one that needs no settling.
    if (progress.markdownFileCount >= STAGED_NOTE_COUNT && progress.backlinkCount >= LINKING_NOTE_COUNT) {
      return;
    }

    // Or it stopped arriving, which is the ordinary ending: whatever the watcher dropped is dropped,
    // and the vault Obsidian has is the vault the frames will report.
    if (settledPollCount >= SETTLED_POLL_COUNT && progress.backlinkCount >= LINKING_NOTE_COUNT) {
      return;
    }

    await sleepInNode({ milliseconds: INTERVAL_IN_MILLISECONDS });
  }

  throw new Error(
    `The vault never finished indexing. Last seen: ${String(progress.markdownFileCount)} of ${String(STAGED_NOTE_COUNT)} notes, ${String(progress.backlinkCount)} of ${String(LINKING_NOTE_COUNT)} backlinks.`
  );
}

/**
 * How many times each implementation is called before its average is taken.
 */
const MEASUREMENT_ITERATIONS = 20;

/**
 * What each implementation answered.
 */
interface BacklinkCounts {
  readonly cached: number;
  readonly original: number;
}

/**
 * How long each implementation took, in milliseconds.
 */
interface BacklinkMeasurement {
  readonly cachedInMilliseconds: number;
  readonly originalInMilliseconds: number;
}

/**
 * How far Obsidian has got through the staged vault.
 */
interface StagingProgress {
  readonly backlinkCount: number;
  readonly markdownFileCount: number;
}

/**
 * Asks how far the staging has got.
 *
 * Polled from the Node side: staging thousands of notes outlasts the transport's per-call cap, so the
 * wait cannot live inside one closure.
 *
 * @returns How much of the vault Obsidian has read, and how much of the hub's backlinks it has found.
 */
async function readStagingProgress(): Promise<StagingProgress> {
  return await evalInObsidian({
    callback({ app, hubNotePath }) {
      const file = app.vault.getFileByPath(hubNotePath);
      return {
        backlinkCount: file ? app.metadataCache.getBacklinksForFile(file).keys().length : 0,
        markdownFileCount: app.vault.getMarkdownFiles().length
      };
    },
    input: { hubNotePath: HUB_NOTE_PATH },
    vaultPath: vaultPath()
  });
}
