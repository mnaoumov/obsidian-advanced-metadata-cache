import type { MarkdownlintCli2ConfigurationSchema } from '@mnaoumov/typescript-dev-toolkit/linters/markdownlint-types/@types/markdownlint-cli2-config-schema';

import { obsidianMarkdownlintCli2Config } from '@mnaoumov/obsidian-dev-toolkit/linters/markdownlint-cli2-config';

export const config: MarkdownlintCli2ConfigurationSchema = obsidianMarkdownlintCli2Config;
