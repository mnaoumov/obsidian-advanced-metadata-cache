import { obsidianDevUtilsConfig } from 'obsidian-dev-utils/script-utils/linters/markdownlint-cli2-config';

/**
 * The shared configuration, with `MD025` told that a `title` property is not a heading.
 *
 * `MD025` counts a frontmatter `title` as the document's top-level heading, so a note carrying both
 * that property and an `# H1` is reported as having two. In an Obsidian vault that is simply wrong:
 * Obsidian titles a note by its FILENAME and does nothing at all with a `title` property — which is
 * exactly why this plugin has a module that reads it. The demo vault therefore ships a note with
 * both, deliberately, and the shared rule cannot tell that from a mistake.
 *
 * Emptying `front_matter_title` disables only the frontmatter half of the rule. Two `# H1`s in one
 * document are still reported, which is the half worth keeping.
 */
export const config = {
  ...obsidianDevUtilsConfig,
  config: {
    ...obsidianDevUtilsConfig.config,
    MD025: {
      // eslint-disable-next-line camelcase -- That is how the option is spelled in markdownlint's own schema.
      front_matter_title: ''
    }
  }
};
