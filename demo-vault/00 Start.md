# Start here

Welcome to the [Advanced Metadata Cache](https://github.com/mnaoumov/obsidian-advanced-metadata-cache/) demo vault. `Advanced Metadata Cache` maintains the vault indexes Obsidian rebuilds on every call, and answers the built-in lookup from the index instead. Each index is a **module** you switch on or off on its own. The modules are demonstrated here: **Backlinks**, which keeps an always-up-to-date index of every note's backlinks, so `app.metadataCache.getBacklinksForFile()` - the undocumented function that powers Obsidian's core **Backlinks** pane and many community plugins - answers from the index instead of rescanning the whole vault on every call; **Names**, which does the same for what every note is called, behind the `[[` autocomplete; **Titles**, which lets a frontmatter property count as a note's name too; **Headings**, which records when each heading of a note was created, modified and seen; **Properties**, which lets other plugins find notes by a frontmatter property value; **Unlinked mentions**, which fills the Backlinks pane's **Unlinked mentions** section without reading every note; **Link texts**, which remembers the texts links show for a note or an attachment, so other plugins can find a file by them; **Code block links**, which counts the links written inside code blocks that plugins render as notes, such as admonitions; **Tags**, which lists the notes carrying each tag, so other plugins can find them without reading every note; **External links**, which lists the notes linking to each website and page, so other plugins can show a site's backlinks, suggest URLs and spot typos; and **Non-Markdown**, which supplies core metadata for configured file extensions and plugin file types; **HTML**, which shares source ranges and sanitizer checks with other plugins; and **Block metadata**, which reads properties written for one heading or block of a note.

**Honest note:** in a tiny vault like this one you will *not* feel a speed difference - the built-in lookup is already fast enough here. The plugin earns its keep in **large** vaults (thousands of notes and links), where the built-in scan gets slow. What this vault shows is *what* the plugin does: it serves the same backlinks through a cached, extended API you can call yourself.

**How to see it:** open [01 Backlink cache](<./01 Backlink cache.md>) and click its **Run** button - it asks the cache for the backlinks of [Central topic](<./Topics/Central topic.md>) and lists the notes that link to it.

## Feature

- [01 Backlink cache](<./01 Backlink cache.md>)
- [02 Fast, safe, and original backlinks](<./02 Fast, safe, and original backlinks.md>)
- [03 Canvas backlinks](<./03 Canvas backlinks.md>)
- [04 Settings](<./04 Settings.md>)
- [05 Name index](<./05 Name index.md>)
- [06 Titles](<./06 Titles.md>)
- [07 Heading times](<./07 Heading times.md>)
- [08 Property index](<./08 Property index.md>)
- [09 Unlinked mentions](<./09 Unlinked mentions.md>)
- [10 Link texts](<./10 Link texts.md>)
- [11 Code block links](<./11 Code block links.md>)
- [12 Tags](<./12 Tags.md>)
- [13 External links](<./13 External links.md>)
- [14 Non-Markdown](<./14 Non-Markdown.md>)
- [15 HTML](<./15 HTML.md>)
- [16 Block metadata](<./16 Block metadata.md>)
