# The `Advanced Metadata Cache` API

This is the reference for plugin developers. The README's [For plugin developers](../README.md#for-plugin-developers) section says how to get the API handle; this note says what each member answers.

Everything this plugin offers another plugin is declared in one hand-written file, [api.d.ts](../api.d.ts) at the repository root. It imports from `obsidian` and nothing else, so you can copy it into your own code or reference it where it sits, with no build-time dependency on this repository.

Beside it, [api-contract.ts](../api-contract.ts) holds the published API's contract, `ADVANCED_METADATA_CACHE_API_CONTRACT`: for every method, a schema over its arguments and a schema over what it returns. It is the constant this plugin publishes with the API, so copy it next to `api.d.ts` and pass it as the `contract`, and both sides check the same definition. Its [Standard Schema](https://standardschema.dev) builders, contract types and guard builders come from [`@mnaoumov/typescript-lib`](https://github.com/mnaoumov/typescript-lib#api-contracts), and its file guards from [`@mnaoumov/obsidian-lib`](https://www.npmjs.com/package/@mnaoumov/obsidian-lib), so copying it means adding both packages to your dependencies (`npm install @mnaoumov/typescript-lib @mnaoumov/obsidian-lib`, typescript-lib `1.3.0` or later); `api.d.ts` alone needs nothing but `obsidian`. (It is not named `api.ts`: TypeScript would read `api.d.ts` as that file's own declarations.)

The contract version moves independently of the plugin's own, so ask for a range, and ask for the lowest version that has every member you call. Each section below says which version it arrived in.

## Backlinks

Added in contract `1.3.0`:

```ts
const fast = api.getBacklinksForFile(pathOrFile);
const safe = await api.getBacklinksForFileSafe(pathOrFile);
const original = api.getBacklinksForFileOriginal(file);
```

`getBacklinksForFile` reads straight from the cache and accepts a vault path as well as a `TFile`; it may be a moment behind a change Obsidian has not finished processing. `getBacklinksForFileSafe` waits for those changes first. Both answer **`null` while the Backlinks module is off** — call the core method then. `getBacklinksForFileOriginal` is Obsidian's own implementation, bypassing the cache, and always answers. [02 Fast, safe, and original backlinks](<../demo-vault/02 Fast, safe, and original backlinks.md>) runs all three side by side.

## Names

Added in contract `1.3.0`:

```ts
const fast = api.getLinkSuggestions();
const safe = await api.getLinkSuggestionsSafe();
const original = api.getLinkSuggestionsOriginal();

const paths = api.getPathsByName('Some Alias');
const safePaths = await api.getPathsByNameSafe('Some Alias');
```

`getPathsByName` answers "which notes are called this?" — matching a note's own name, any of its `aliases` or any of its [titles](<../demo-vault/06 Titles.md>), case-insensitively and with runs of whitespace collapsed, exactly as Obsidian resolves a wikilink. The answer is a **list** and is deliberately unranked: several notes may declare the same alias, and which one the user meant is a question about your context, not about the vault.

**The array `getLinkSuggestions()` answers with is Obsidian's own, entry for entry** — `getLinkSuggestionsOriginal()` is there so you can check. The single exception is the **Offer titles in the `[[` autocomplete** setting described in [06 Titles](<../demo-vault/06 Titles.md>): with it on, the title entries are *appended*, so Obsidian's array stays a strict prefix of what you get and the difference is exactly a suffix. It is off by default, so a consumer that has not been told otherwise can treat the two as identical.

**Use the `Safe` variants when you may be asked early.** The index is built once the metadata cache can answer; until then `getLinkSuggestions()` falls through to Obsidian's implementation and `getPathsByName` answers with nothing. `getLinkSuggestionsSafe()` / `getPathsByNameSafe()` wait for the build. All four answer **`null` while the Names module is off**; `getLinkSuggestionsOriginal` always answers. [05 Name index](<../demo-vault/05 Name index.md>) runs them.

## Removed in 2.0.0: the members on the core methods

Before `1.3.0` these calls were reached through members this plugin added to the patched core methods. `1.3.0` deprecated them and **2.0.0 removed them**, because nothing of this plugin's own belongs on an Obsidian function: the patched methods now keep Obsidian's own signature and carry nothing else. Each has a replacement on the API:

| Removed                                                     | Use instead                                  |
|-------------------------------------------------------------|----------------------------------------------|
| `app.metadataCache.getBacklinksForFile(path)`, with a path  | `api.getBacklinksForFile(path)`              |
| `app.metadataCache.getBacklinksForFile.safe(pathOrFile)`    | `api.getBacklinksForFileSafe(pathOrFile)`    |
| `app.metadataCache.getBacklinksForFile.originalFn(file)`    | `api.getBacklinksForFileOriginal(file)`      |
| `app.metadataCache.getLinkSuggestions.safe()`               | `api.getLinkSuggestionsSafe()`               |
| `app.metadataCache.getLinkSuggestions.originalFn()`         | `api.getLinkSuggestionsOriginal()`           |
| `app.metadataCache.getLinkSuggestions.getPathsByName(n)`    | `api.getPathsByName(n)`                      |
| `app.metadataCache.getLinkSuggestions.getPathsByNameSafe(n)`| `api.getPathsByNameSafe(n)`                  |

## Titles

`getTitlePropertyNames` and `getTitles` arrived in contract `1.0.0`:

```ts
console.log(api.getTitlePropertyNames()); // ['title']
console.log(api.getTitles('Notes/Some note.md')); // ['The Real Name']
```

Both answer **empty while the Titles module is off**, which is the same answer as "no property is configured" and is meant to be.

`getTitles` is synchronous and lazily memoized per note, so it is safe on a per-keystroke path. Read `getTitlePropertyNames()` and show that list rather than offering a property setting of your own — one place to type `title` is the point of the setting living here. [06 Titles](<../demo-vault/06 Titles.md>) shows what the module does for a user.

## Handing over a title property of your own

A plugin that used to own a title property setting hands its value over with `migrateSettings`, added in contract `1.1.0`. It is the envelope of `@mnaoumov/obsidian-lib`'s `SettingsMigrationApi`, so `SettingsMigrationComponent` drives it for you. Watch this plugin's API with the contract `{ migrateSettings: {} }` and the range `^1`, then propose `{ titlePropertyNames: ['subtitle'] }`. Against a `1.0.0` provider, the offer waits instead of failing.

This plugin owns the list, so it owns the dialog. The dialog names your plugin, shows the proposed names beside the current list, and suggests the proposed names ADDED to that list (a name already on it in any casing is not added twice), which the user can approve, edit or decline. While the Titles module is off, it also offers to switch it on. The call resolves `{ isApplied: false }` on a cancel, so retire your pending value only on `true`. When there is nothing to change, it resolves `true` without showing anything.

## Heading times

`getHeadingTimes(pathOrFile)`, added in contract `1.2.0`, answers a note's headings in document order, each with its text, level, line and three times, Unix epoch milliseconds:

```ts
for (const { created, heading, level, modified, seen } of api.getHeadingTimes('Notes/Changelog.md')) {
  console.log(level, heading, created, modified, seen);
}
```

A time is `null` when the plugin did not see the event happen, so sort `null` as the oldest and keep document order among equals. It is synchronous and current as of the last parse Obsidian announced: if you have just edited the note, await `getCacheSafe` from `@mnaoumov/obsidian-lib` first. It answers empty while the **Headings** module is off, and a note that is not tracked yet answers its current headings with every time `null`. Ask for the range `^1.2`. [07 Heading times](<../demo-vault/07 Heading times.md>) says how a heading is recognized from one version of a note to the next.

## Notes by property value

Added in contract `1.4.0`. Register the property once on load, then ask:

```ts
api.registerPropertyName('keys');

const paths = api.getPathsByPropertyValue('keys', 'abc123');
const withKeys = api.getPathsWithProperty('keys');

const safePaths = await api.getPathsByPropertyValueSafe('keys', 'abc123');
const safeWithKeys = await api.getPathsWithPropertySafe('keys');
```

`getPathsByPropertyValue` finds the notes whose property holds the value — the property itself when it is a scalar, or one of its members when it is a list. Names and values are matched exactly. A number or a boolean is matched by its string form, so `'7'` finds `keys: 7`, and `null` or an object is never matched. `getPathsWithProperty` finds every note carrying the property at all, `null` and an empty list included. Both answer unordered paths.

**A registration is durable**: it is saved with the index, so at the next startup the property is answered from disk before your plugin has even loaded. There is no unregister; registering again is harmless.

**Use the `Safe` variants when the answer must be current.** At startup the index answers with what the previous session saved, at once, but it does not know yet what changed while Obsidian was closed — a note synced or edited outside Obsidian. Once the metadata cache is ready the index is rebuilt from it, and the `Safe` variants wait for that. All four answer **`null` for a property nobody registered and while the Properties module is off** — scan the vault yourself then. Ask for the range `^1.4`.

## Notes by date

Added in contract `1.5.0`. Every **date property** is indexed with no registration, in each casing a note spells it, and its values are kept in order. A date property is one whose type is `Date` or `Date & time`, or, since contract `1.6.0`, one whose name matches the **Date properties** setting: exact names, or patterns where `*` stands for anything, matched case-sensitively. The default is `date` and `*Date`, so `birthDate` and `startDate` are date properties whatever their type. A vault that names its dates differently lists its own, e.g. `date_*`, `*DateTime`, `ctime`, `mtime`.

```ts
// Every dated value in the vault, oldest first.
const all = api.getDatedValues({});

// Every note dated in the first half of 2026, by one property.
const due = api.getDatedValues({ from: '2026', propertyNames: ['due'], to: '2026-06' });

// Every birthday from today to a month from now, whatever the year; `from` after `to` wraps the year end.
const upcoming = api.getDatedValues({ from: '10-26', isRecurring: true, propertyNames: ['birthday'], to: '11-25' });

const safeAll = await api.getDatedValuesSafe({});

// The values of the date properties that are not dates, which every answer above leaves out.
const skipped = await api.getNonDateValuesSafe();
```

Each entry is `{ path, propertyName, value }`, and a list property gives one entry per date it lists. A value counts as a date when it is shaped `YYYY-MM-DD`, optionally followed by `THH:mm`, `THH:mm:ss` or `THH:mm:ss.sss`: what Obsidian's own date pickers write. A registered property of any type contributes the values of that shape too. A date property also counts a year or a month alone, since contract `1.6.0`.

What a value may carry beyond that, since contract `1.6.0`:

| Value | Example | Handled as |
| --- | --- | --- |
| A date, or a datetime with no zone | `2026-10-26`, `2026-10-26T09:30` | A date. |
| A datetime with an ISO 8601 offset | `2026-10-26T00:21:46-06:00`, `2026-10-26T09:30Z` | A date, **ordered and matched by the date and time as written**, the offset dropped. |
| A datetime with an RFC 9557 time zone, after or instead of the offset | `2026-10-26T09:30+02:00[Europe/Kyiv]` | The same as an offset. |
| A year, or a year and a month, in a date property | `2019`, `2019-05` | A date of **reduced precision**, standing for its whole year or month. See below. |
| Anything else: a time alone, a space instead of the `T`, a zone name without brackets, free text | `14:30`, `2026-10-26 09:30`, `next week` | Not a date: left out, never guessed. |

**A zoned value sorts by its wall-clock time, not by its instant**, so `2026-10-26T23:00-06:00` is found on the 26th, the day the note says, although it is the 27th in UTC. Mixed with values without a zone, which have no instant at all, that is the only order every value has. Two values with the same wall-clock time are ordered by their text, and the bounds of a query never carry a zone. Each entry still reports the value as written, zone included, so a consumer that wants the instant parses it itself.

**A partly known date is written with reduced precision, as ISO 8601 has it**: `closedDate: 2019` when only the year is known, `closedDate: 2019-05` when the month is known too. Such a value means *some time in 2019*, not *the 1st of January 2019*, and the index never treats it as one day:

- It is reported as written, `2019` or `2019-05`, never padded, so its precision is the length of its `value`. An unquoted `2019` is a YAML number, and it is reported as `'2019'` all the same.
- It sorts at the start of its period: `2019` before `2019-01-01`, `2019-05` before `2019-05-01`.
- A range matches it whenever the two **overlap**: `{ from: '2019-05-10', to: '2019-05-20' }` lists both `2019` and `2019-05`, because either may have been in those days. Drop the short values when you want only the dates certainly in the range.
- With `isRecurring` on, a year alone has no month and day and is skipped, and `2019-05` matches any range that touches May.
- It counts only in a **date property**, by type or by name. A registered `pages` property holding `1500` is not a year.

Obsidian's own `Date` property type shows such a value as the first day of its period: `2019` reads as `2019-01-01` in the date picker, and picking a date there writes a full date in its place. Showing it writes nothing back, and the value in the note stays valid ISO 8601. To keep reduced precision visible while editing, leave such a property as `Text` and make it a date property by name instead, which the default `*Date` pattern already does for `closedDate`.

`getNonDateValues` lists the values of the date properties that are not dates, ordered by path, then property name, then value, so a typo in a `birthDate` can be found rather than silently missing from every range.

Both bounds are **inclusive and compared as prefixes**, so `to: '2026-06'` includes the whole of June and `to: '2026-06-30'` includes `2026-06-30T23:59`; leave a bound out for no bound. With `isRecurring` on, the bounds are a month and day (`'10-26'`) or a month (`'10'`), and the answer is ordered by month and day, then by year. Otherwise it is ordered by value. Ties are broken by property name, then by path.

A property is registered the first time a note carries it as a date property, when the type is assigned to it, or when a name added to the setting matches it, and like any registration that lasts: changing its type back, or taking the name off the setting, keeps it indexed. The answer is `null` when `propertyNames` names a property that is not indexed, and while the Properties module is off. Ask for the range `^1.5`, or `^1.6` for `getNonDateValues`. [08 Property index](<../demo-vault/08 Property index.md>) runs these queries on a few notes.

## Unlinked mentions

Added in contract `1.7.0`:

```ts
for (const { path, ranges } of await api.getUnlinkedMentions('Notes/Some note.md') ?? []) {
  console.log(path, ranges.map(({ end, start }) => `${String(start)}-${String(end)}`));
}
```

`getUnlinkedMentions(pathOrFile)` answers the notes the Backlinks pane's **Unlinked mentions** section lists for a note, ordered by path, each with the spans of its text that mention the note, as UTF-16 offsets from the start of the file, ordered by position. It is always asynchronous, because each candidate note is read to confirm its matches, and it waits for the index to be built first. It answers **`null` while the Unlinked mentions module is off** — read the vault yourself then. Ask for the range `^1.7`. [09 Unlinked mentions](<../demo-vault/09 Unlinked mentions.md>) says what counts as a mention.
