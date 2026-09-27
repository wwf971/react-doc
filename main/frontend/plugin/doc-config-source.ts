import { parse as parseYaml } from 'yaml';
import { configDeclaredIs } from '../src/lib/doc-config-define.js';

// Source and document levels of the config system, read at build time.
// Design: doc_page_impl_config.md
//
// source level, in rule order:
//   - action: addFolder              "config" applies to every file this rule collects
//     path: ./guide
//     config: { TagsDisplayAtLinkIsOn: true }
//   - action: setConfigByPath        files already collected whose internal path
//     pattern: "/guide/**"             matches the glob
//     config: { TagsDisplayAtMainPanelIsOn: false }
//   - action: setConfigByName        same, matching the file name
//     pattern: "*.py"
//     config: { ... }
// a later rule replaces the same key; a removed file loses its config with itself.
//
// document level: the "config" mapping in md/mdx frontmatter.
//
// both are emitted in the manifest (entry.configSource, entry.configFrontmatter).
// keys and values are validated in the browser, where the key definitions
// (including application-defined ones) are known.

type ConfigEntry = {
  internalPath: string;
  name: string;
  configSource?: Record<string, any>;
};

export const configSourceActionList = ['setConfigByPath', 'setConfigByName'];

export function configSourceRuleIs(rule: any): boolean {
  return configSourceActionList.includes(rule?.action);
}

// "config" declared directly on addFolder/addFile, for one newly collected entry
export function configSourceAddRuleApply(entry: ConfigEntry, rule: any, ruleIndex: number): void {
  if (rule.config === undefined) return;
  if (!configDeclaredIs(rule.config)) {
    console.warn(`[doc-source] source rule ${ruleIndex}: "config" must be a mapping`);
    return;
  }
  entry.configSource = { ...(entry.configSource ?? {}), ...rule.config };
}

// setConfigByPath / setConfigByName against the files collected so far
export function configSourceRuleApply(
  entries: ConfigEntry[],
  rule: any,
  ruleIndex: number,
  globToRegex: (pattern: string) => RegExp,
): void {
  if (!configDeclaredIs(rule.config) || typeof rule.pattern !== 'string') {
    console.warn(`[doc-source] source rule ${ruleIndex} (${rule.action}) needs "pattern" and a "config" mapping`);
    return;
  }
  const isByPath = rule.action === 'setConfigByPath';
  const pattern = isByPath && !rule.pattern.startsWith('/') ? `/${rule.pattern}` : rule.pattern;
  const regex = globToRegex(pattern);
  for (const entry of entries) {
    if (!regex.test(isByPath ? entry.internalPath : entry.name)) continue;
    entry.configSource = { ...(entry.configSource ?? {}), ...rule.config };
  }
}

// one file collected by several rules: its declarations accumulate in rule order
export function configSourceEntryMerge(entryKept: ConfigEntry, entryNext: ConfigEntry): Record<string, any> | undefined {
  if (!entryKept.configSource && !entryNext.configSource) return undefined;
  return { ...(entryKept.configSource ?? {}), ...(entryNext.configSource ?? {}) };
}

export function configFrontmatterRead(text: string, filePath: string): Record<string, any> | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!match) return undefined;
  let frontmatter: any;
  try {
    frontmatter = parseYaml(match[1]);
  } catch {
    // malformed frontmatter is reported when the document is compiled
    return undefined;
  }
  const config = frontmatter?.config;
  if (config === undefined) return undefined;
  if (!configDeclaredIs(config)) {
    console.warn(`[doc-source] frontmatter "config" must be a mapping: ${filePath}`);
    return undefined;
  }
  return config;
}
