import { tagListMerge, tagListNormalize } from '../src/lib/doc-tag-declare.js';

// Source step of the tag system: tags declared by source rules.
// Design: doc_page_impl_tag.md
//
//   - action: addFolder          tags apply to every file this rule collects
//     path: ./guide
//     tags: [guide]
//   - action: addTagByPath       tags apply to files already collected whose
//     pattern: "/guide/**.py"    internal path matches the glob
//     tags: [code]
//   - action: addTagByName       same, matching the file name
//     pattern: "*.sh"
//     tags: [code]
//
// A removed file loses its tags together with itself. The resulting tag list
// of each file is emitted in the manifest as entry.tagList.

type TagEntry = {
  internalPath: string;
  name: string;
  tagList?: any[];
};

export const tagSourceActionList = ['addTagByPath', 'addTagByName'];

export function tagSourceRuleIs(rule: any): boolean {
  return tagSourceActionList.includes(rule?.action);
}

// tags declared directly on addFolder/addFile, for one newly collected entry
export function tagSourceAddRuleApply(entry: TagEntry, rule: any, ruleIndex: number): void {
  const tagList = tagListNormalize(rule.tags);
  if (tagList.length === 0) return;
  entry.tagList = tagListMerge(entry.tagList, tagList, { step: 'source', ruleIndex });
}

// addTagByPath / addTagByName against the files collected so far
export function tagSourceRuleApply(
  entries: TagEntry[],
  rule: any,
  ruleIndex: number,
  globToRegex: (pattern: string) => RegExp,
): void {
  const tagList = tagListNormalize(rule.tags);
  if (tagList.length === 0 || typeof rule.pattern !== 'string') return;
  const isByPath = rule.action === 'addTagByPath';
  const pattern = isByPath && !rule.pattern.startsWith('/') ? `/${rule.pattern}` : rule.pattern;
  const regex = globToRegex(pattern);
  for (const entry of entries) {
    if (!regex.test(isByPath ? entry.internalPath : entry.name)) continue;
    entry.tagList = tagListMerge(entry.tagList, tagList, { step: 'source', ruleIndex });
  }
}

// one file collected by several rules: its declarations accumulate in rule order
export function tagSourceEntryMerge(entryKept: TagEntry, entryNext: TagEntry): any[] {
  return tagListMerge(entryKept.tagList, entryNext.tagList);
}
