# HTML range index

Contract `1.15.0` adds `getHtmlRanges`, `getHtmlRangesSafe`, `getHtmlDiagnostics` and `getHtmlDiagnosticsSafe`. All accept a Markdown note's path or `TFile`. Enable **HTML module** first; it is off by default.

The range methods return detached `HtmlRange[]` values. A range is either an HTML block from Obsidian's existing `CachedMetadata.sections`, or a lexical tag candidate. Blocks contain their tag ranges, so consumers should select the kind they need. `html` is the original source slice, `position` uses end-exclusive UTF-16 offsets, and `tagName` is lowercase for tags and `null` for blocks. Namespace is `html`, `svg` or `mathml`.

`null` means unavailable: the module is off, startup has not finished, the file is outside the index, or an edit is awaiting Obsidian's metadata event. `[]` means a completed scan found nothing. The `Safe` variants wait for startup reconciliation, not a future metadata event. Re-query after that event when an edit answers `null`.

## Cost and persistence

The module reuses Obsidian's block cache, then scans each missing or changed Markdown note through the shared `IncrementalFileIndexComponent`. It does not invoke a Markdown parser. Both consumers read the same projection; lookups read no note. A local IndexedDB checkpoint stores per-note candidates and their observed `mtime` and size. Unchanged records restore without note reads. Empty scans are persisted too. Rename moves records; delete and modify invalidate them. Generated plugin transport notes are excluded.

The checkpoint is device-local and contains source HTML. It is a derived cache and can be rebuilt. A same-size rewrite preserving `mtime` is indistinguishable from an unchanged note, as for the other stat-validated indexes. `HTML_VERSION` controls the schema and store identity and must change when extraction semantics change.

## Validation and uncertainty

Diagnostics validate only indexed opening tags through Obsidian's actual `sanitizeHTMLToDom`. The comparison uses an inert browser template on the input side, so ordinary attribute quoting and browser normalization are not findings. A changed or removed element produces `sanitized`; native HTML represented by `HTMLUnknownElement` produces `unknown`. These are independent categories: an unknown tag may also be removed. Source is never rewritten automatically.

Custom element names containing a hyphen are not called unknown solely because the browser has not registered them. Their sanitizer changes are still reported. SVG and MathML fragments are wrapped in their own namespaces; table cells, rows and select options get parsing context. Foreign vocabulary is judged by the sanitizer rather than an invented blacklist. Each indexed note revision retains its diagnostic result, so repeated queries from several consumers do not revalidate unchanged notes. A second memo shares runtime API version, namespace and exact fragment checks across notes, bounded to 2,048 fragments per module lifetime. A changed record automatically gets a new result; old records can be collected. Diagnostics are recomputed after a reload and are never persisted. Every returned diagnostic and position is detached from both memos.

This is a candidate index, not a replacement for Obsidian's inline Markdown parser. Cached code and YAML sections, lexical backtick spans, top-level fences, escapes, HTML comments and Obsidian comments outside HTML blocks are excluded. Markdown syntax inside an HTML block remains HTML text. Raw script, style, title and textarea bodies are not interpreted as nested tags. Autolinks are not tags.

Inline candidates can still occur in link destinations or other uncommon Markdown constructs; malformed HTML, implicit HTML tree repairs, custom-element registration, complex SVG/MathML integration points and ancestors outside the candidate may affect rendering. Fragment diagnostics describe the supplied namespace and wrapper context, not every possible Reading-view ancestor. Consumers should present reviewable diagnostics and never blindly delete source based on a candidate. The cross-platform oracle suite compares cached block positions and sanitizer decisions in a real Obsidian; the lexical unit suite pins offsets and exclusions.
