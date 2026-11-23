import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isMap, isPair, isScalar, isSeq, parseDocument } from 'yaml';
import { lineOperationApply } from './doc-edit-lines.ts';
import { yamlScalarTextBuild, yamlValueSetOperationBuild } from './doc-yaml-edit.ts';
import {
  docManagedDocCreate,
  docManagedDocMove,
  docManagedDocPathSet,
  docManagedRootRead,
  docPathCheck,
  docManagedTextWrite,
} from './doc-managed-store.ts';
import { sourceEntryManagedNowGet, sourceEntryTextRead, sourceEntryTextWrite, type SourceEntryManaged } from './doc-source-access.ts';
import { sourceFileBackupMove, sourceFileBackupRestore, type SourceFileMoved } from './doc-source-file.ts';
import {
  sourcePathBuild,
  sourcePathFullGet,
  sourcePathIsFull,
  sourcePathIsRooted,
  sourcePathLocalGet,
  sourcePathNormalize,
  sourcePathParse,
} from '../src/lib/doc-source-path.js';
import { sourceIndexBuild, targetQuerySplit } from '../src/lib/doc-target-resolve.js';
import { referenceEntryListGet } from '../src/lib/doc-link-index.js';
import { editTextModelBuild } from '../src/lib/doc-edit-block.js';
import { splitFrontmatter } from '../src/lib/doc-frontmatter.js';

// Relocation: files moved or renamed with every reference to them kept
// (design: doc_page_impl_nav_backlink.md#relocation). It belongs to the
// backlink layer, since what it rewrites is what the link index knows: every
// reference of every document, as written. One mechanism serves every move the
// page offers: a file renamed in its folder, moved to another folder or root,
// a document made managed (a folder of files to a virtual root,
// doc_page_impl_doc_managed.md), made a file again, or moved inside a root.
//
// core logic, read first:
//
//   relocatePlanBuild(moveList, context)        what a move would change, nothing written
//     -> the moves checked: the source is a file of the source, the target free and in a
//        folder that collects it (a document can go to a virtual root)
//     -> the source before and after, as two indexes of the resolver of the page
//     -> every reference of the link index that resolved to a moved file, or is written in
//        a moved document: resolved again after the move; one that would reach another file
//        (or none) is spelled anew, in the style it was written in (a relative path stays
//        relative where it can, a source path a source path, a bare name a name while it
//        names one file), and its text is rewritten where it stands
//     -> every document rewritten is scanned again: its references must be those expected,
//        else it is left as it is and said so
//     -> the side panels and entries naming a moved document (doc:, homeDoc:) are rewritten
//        in place in their yaml
//   relocateApply(moveList, planKey, context)   the plan made again, checked against the one
//     the author saw (planKey), then written: the documents, the moves, the yaml files; a
//     failure puts back what was done
//
// what is not rewritten is listed in the plan (problemList), never changed blindly: a
// reference that resolves to several files (a name two documents have), one whose text is not
// found where the index says, a binding written in a flow mapping.

type Answer = { code: number; data: any; message: string };

export type RelocateMove = { from: string; to: string };

// an entry of the source as the plugin scans it (doc-source.ts FileEntry)
export type RelocateEntry = {
  docPageAlias: string;
  rootAlias: string;
  relPath: string;
  name: string;
  ext: string;
  absPath: string;
  internalPath: string;
  collect: string;
  managed?: SourceEntryManaged;
};

export type RelocateRoot = {
  docPageAlias: string;
  rootAlias: string;
  absPath: string;
  rootAbsPath: string;
  kind: 'folder' | 'file' | 'managed';
  collect: string;
};

export type RelocateContext = {
  configDir: string;
  entryList: RelocateEntry[];
  rootList: RelocateRoot[];
  // the link index of the workspace (doc-link-index.ts): byDoc[docPath].linkList
  linkIndex: { byDoc: Record<string, { linkList: any[] }> };
  // the references of a text, as the link index scans them
  referenceListOfText: (text: string, entry: { internalPath: string; ext: string }) => any[];
  // the yaml files of the configuration that name documents, each with its doc page
  yamlFileList: { file: string; docPageAlias: string; dirPage: string; kind: 'sidePanel' | 'entry' | 'workspace' }[];
  readOnlyReasonGet: (absPath: string) => string;
};

export type RelocateHooks = {
  // the files a step writes, renames or removes, told before the watcher sees them
  pathListMark: (absPathList: string[]) => void;
  // yaml files of the configuration rewritten: '' when the configuration loads with them
  configFileListWritten: (fileList: { filePath: string; text: string }[]) => string;
  // the source reported to the page as data once everything is written
  dataReport: () => void;
  // the edit history of a moved document follows it
  historyPathMove: (from: string, to: string) => void;
};

type MoveChecked = {
  from: string;
  to: string;
  entry: RelocateEntry;
  kindFrom: 'file' | 'managed';
  kindTo: 'file' | 'managed';
  rootTo: RelocateRoot;
  relPathTo: string;
  absPathTo: string;
};

type DocRewrite = {
  docPath: string;
  docPathAfter: string;
  rewriteList: { line: number; before: string; after: string; construct: string }[];
  textBefore: string;
  textAfter: string;
};

type ConfigRewrite = { file: string; kind: string; rewriteList: { keyPath: (string | number)[]; before: string; after: string }[]; textBefore: string; textAfter: string };

type Problem = { docPath?: string; file?: string; line?: number; target: string; reason: string };

type Plan = {
  moveList: MoveChecked[];
  docList: DocRewrite[];
  configList: ConfigRewrite[];
  problemList: Problem[];
  planKey: string;
};

// ---------- the plan ----------

export function relocatePlanBuild(moveListInput: unknown, context: RelocateContext): Answer {
  const checked = moveListCheck(moveListInput, context);
  if (checked.code !== 0) return checked;
  const plan = planCompute(checked.data, context);
  return { code: 0, data: planPublicGet(plan, context), message: '' };
}

function planCompute(moveList: MoveChecked[], context: RelocateContext): Plan {
  const pathAfterByPath = new Map(moveList.map((move) => [move.from, move.to]));
  const pathAfterGet = (one: string) => pathAfterByPath.get(one) ?? one;
  const indexBefore = sourceIndexBuild(context.entryList);
  const entryListAfter = context.entryList.map((entry) => {
    const pathAfter = pathAfterByPath.get(entry.internalPath);
    if (!pathAfter) return entry;
    return { ...entry, internalPath: pathAfter, name: pathAfter.split('/').at(-1) ?? entry.name };
  });
  const indexAfter = sourceIndexBuild(entryListAfter);
  const problemList: Problem[] = [];
  const docList: DocRewrite[] = [];

  for (const [docPath, docIndexed] of Object.entries(context.linkIndex?.byDoc ?? {})) {
    const docPathAfter = pathAfterGet(docPath);
    const isDocMoved = docPathAfter !== docPath;
    // what each path part of this document becomes: one spelling per path part, since a
    // path written twice in one document resolves the same way
    const rewriteByPathPart = new Map<string, { after: string; lineList: number[]; construct: string }>();
    for (const reference of docIndexed?.linkList ?? []) {
      const before = referenceEntryListGet(reference, docPath, indexBefore).map((entry: any) => entry.internalPath);
      if (!isDocMoved && !before.some((one: string) => pathAfterByPath.has(one))) continue;
      if (before.length === 0) continue;
      const expected = before.map(pathAfterGet);
      const after = referenceEntryListGet(reference, docPathAfter, indexAfter).map((entry: any) => entry.internalPath);
      // a relative path written in a moved document is spelled anew when it is no longer the one
      // an author would write from its new place ("../a.md" at the top of a root still reaches
      // a.md, since ".." never leaves a root, but reads wrong)
      const isRelativeStale = isDocMoved && expected.length === 1 && relativeIsStale(String(reference.target), docPathAfter, expected[0]);
      if (setIsSame(after, expected) && !isRelativeStale) continue;
      const lineOfReference = Number(reference.sourceLine ?? reference.blockLine ?? 0);
      if (before.length > 1) {
        problemList.push({ docPath, line: lineOfReference, target: reference.target, reason: `resolves to ${before.length} files; left as it is` });
        continue;
      }
      const { pathPart, suffix } = targetPartSplit(String(reference.target));
      const spelling = spellingFind(pathPart, suffix, reference, docPathAfter, expected[0], indexAfter);
      if (!spelling) {
        problemList.push({ docPath, line: lineOfReference, target: reference.target, reason: 'no spelling reaches the file from its new place' });
        continue;
      }
      const known = rewriteByPathPart.get(pathPart);
      if (known && known.after !== spelling) {
        problemList.push({ docPath, line: lineOfReference, target: reference.target, reason: 'written the same as another reference that moves elsewhere; left as it is' });
        continue;
      }
      const rewrite = known ?? { after: spelling, lineList: [], construct: String(reference.construct ?? '') };
      rewrite.lineList.push(lineOfReference);
      rewriteByPathPart.set(pathPart, rewrite);
    }
    if (rewriteByPathPart.size === 0) continue;
    const entry = context.entryList.find((one) => one.internalPath === docPath);
    if (!entry) continue;
    const rewritten = docRewriteBuild(entry, docPathAfter, rewriteByPathPart, context, problemList);
    if (rewritten) docList.push(rewritten);
  }

  const configList = configRewriteListBuild(pathAfterByPath, context, problemList);
  const planKey = createHash('sha1')
    .update(JSON.stringify({
      moveList: moveList.map((move) => [move.from, move.to]),
      docList: docList.map((doc) => [doc.docPath, doc.textAfter]),
      configList: configList.map((config) => [config.file, config.textAfter]),
    }))
    .digest('hex');
  return { moveList, docList, configList, problemList, planKey };
}

// what the page is shown of a plan: no texts, the paths of files relative to the config folder
function planPublicGet(plan: Plan, context: RelocateContext) {
  const referenceCount = plan.docList.reduce((sum, doc) => sum + doc.rewriteList.length, 0);
  const configRewriteCount = plan.configList.reduce((sum, config) => sum + config.rewriteList.length, 0);
  return {
    planKey: plan.planKey,
    moveList: plan.moveList.map((move) => ({ from: move.from, to: move.to, kindFrom: move.kindFrom, kindTo: move.kindTo })),
    docList: plan.docList.map((doc) => ({ docPath: doc.docPath, docPathAfter: doc.docPathAfter, rewriteList: doc.rewriteList })),
    configList: plan.configList.map((config) => ({ ...yamlFileShownGet(config.file, context), kind: config.kind, rewriteList: config.rewriteList })),
    problemList: plan.problemList.map((problem) => ({ ...problem, ...(problem.file ? yamlFileShownGet(problem.file, context) : {}) })),
    summary: { referenceCount, docCount: plan.docList.length, configRewriteCount, problemCount: plan.problemList.length },
  };
}

// a yaml file as a reader is shown it: its doc page and its path in the doc page's folder
function yamlFileShownGet(file: string, context: RelocateContext): { file: string; docPageAlias: string } {
  const one = context.yamlFileList.find((item) => item.file === file);
  const dirPage = one?.dirPage ?? path.dirname(file);
  return { file: path.relative(dirPage, file).split(path.sep).join('/'), docPageAlias: one?.docPageAlias ?? '' };
}

// ---------- the moves ----------

function moveListCheck(moveListInput: unknown, context: RelocateContext): Answer {
  if (!Array.isArray(moveListInput) || moveListInput.length === 0) return { code: -1, data: null, message: 'moveList names at least one move { from, to }' };
  const moveList: MoveChecked[] = [];
  const targetSet = new Set<string>();
  const fromSet = new Set<string>();
  for (const moveInput of moveListInput as any[]) {
    const from = sourcePathNormalize(String(moveInput?.from ?? ''));
    const to = sourcePathNormalize(String(moveInput?.to ?? ''));
    if (!sourcePathIsFull(from) || !sourcePathIsFull(to)) return { code: -1, data: null, message: `a move names two full source paths (~page:root/path): ${from} -> ${to}` };
    if (from === to) return { code: -1, data: null, message: `${from} is where it would go` };
    const entry = context.entryList.find((one) => one.internalPath === from);
    if (!entry) return { code: -3, data: null, message: `not a file of the source: ${from}` };
    if (fromSet.has(from)) return { code: -1, data: null, message: `${from} is moved twice` };
    if (targetSet.has(to)) return { code: -1, data: null, message: `two files would go to ${to}` };
    fromSet.add(from);
    targetSet.add(to);
    const target = targetResolve(to, entry, context);
    if (target.code !== 0) return target;
    const reasonFrom = context.readOnlyReasonGet(entry.absPath);
    if (reasonFrom) return { code: -4, data: null, message: reasonFrom };
    moveList.push({ from, to, entry, kindFrom: entry.managed ? 'managed' : 'file', ...target.data });
  }
  // a target taken by a file that does not move away itself
  for (const move of moveList) {
    const entryAtTarget = context.entryList.find((one) => one.internalPath === move.to);
    if (entryAtTarget && !fromSet.has(entryAtTarget.internalPath)) return { code: -2, data: null, message: `the file exists: ${move.to}` };
    if (move.kindTo === 'file' && fs.existsSync(move.absPathTo) && !moveList.some((one) => one.entry.absPath === move.absPathTo)) {
      return { code: -2, data: null, message: `a file is there on disk already: ${move.to}` };
    }
  }
  return { code: 0, data: moveList, message: '' };
}

// where a target path lies: a folder of files collected by a rule, or a virtual root
function targetResolve(to: string, entry: RelocateEntry, context: RelocateContext): Answer {
  const parsed = sourcePathParse(to)!;
  if (parsed.relPath === '') return { code: -1, data: null, message: `a target names a file in its root: ${to}` };
  const rootList = context.rootList.filter((root) => root.rootAlias === parsed.rootAlias && root.docPageAlias === parsed.docPageAlias);
  const rootManaged = rootList.find((root) => root.kind === 'managed');
  const isDocument = entry.ext === 'md' || entry.ext === 'mdx';
  if (rootManaged) {
    if (!isDocument) return { code: -1, data: null, message: `a virtual root keeps documents only (.md, .mdx): ${entry.name}` };
    try {
      docPathCheck(parsed.relPath);
    } catch (error: any) {
      return { code: -1, data: null, message: String(error?.message ?? error) };
    }
    const reason = context.readOnlyReasonGet(rootManaged.rootAbsPath);
    if (reason) return { code: -4, data: null, message: reason };
    return { code: 0, data: { kindTo: 'managed', rootTo: rootManaged, relPathTo: parsed.relPath, absPathTo: rootManaged.rootAbsPath }, message: '' };
  }
  const rootFolderList = rootList.filter((root) => root.kind === 'folder');
  if (rootFolderList.length === 0) return { code: -3, data: null, message: `no folder of the source has the root ${sourcePathBuild(parsed.rootAlias, '', parsed.docPageAlias)}` };
  const absPathTo = path.resolve(rootFolderList[0].rootAbsPath, ...parsed.relPath.split('/'));
  if (!pathIsInside(absPathTo, rootFolderList[0].rootAbsPath)) return { code: -1, data: null, message: `the target leaves its root: ${to}` };
  const dirAbs = path.dirname(absPathTo);
  const rootCollecting = rootFolderList.find((root) => (root.collect === 'direct' ? dirAbs === root.absPath : pathIsInside(dirAbs, root.absPath)));
  if (!rootCollecting) return { code: -3, data: null, message: `the folder is not collected by any source rule: ${to}` };
  if (path.extname(absPathTo).toLowerCase() !== path.extname(entry.name).toLowerCase()) {
    return { code: -1, data: null, message: `a move keeps the extension of the file (${path.extname(entry.name) || 'none'}): ${to}` };
  }
  const reason = context.readOnlyReasonGet(dirAbs);
  if (reason) return { code: -4, data: null, message: reason };
  return { code: 0, data: { kindTo: 'file', rootTo: rootCollecting, relPathTo: parsed.relPath, absPathTo }, message: '' };
}

// ---------- spelling a target anew ----------

// a target split into the path it names and what follows it (?query, #place)
function targetPartSplit(target: string): { pathPart: string; suffix: string } {
  const indexHash = target.indexOf('#');
  const beforeHash = indexHash >= 0 ? target.slice(0, indexHash) : target;
  const hashPart = indexHash >= 0 ? target.slice(indexHash) : '';
  const { path: pathPart, query } = targetQuerySplitSafe(beforeHash);
  return { pathPart, suffix: `${query}${hashPart}` };
}

function targetQuerySplitSafe(text: string): { path: string; query: string } {
  const { filePart } = targetQuerySplit(text) as { filePart: string };
  return { path: filePart, query: text.slice(filePart.length) };
}

// the first spelling, in the style of the one written, that reaches exactly the file from the
// document's new place; undefined when none does
function spellingFind(pathPart: string, suffix: string, reference: any, docPathAfter: string, targetPath: string, indexAfter: any): string | undefined {
  for (const candidate of spellingCandidateListBuild(pathPart, docPathAfter, targetPath, reference.kind)) {
    const resolved = referenceEntryListGet({ ...reference, target: `${candidate}${suffix}` }, docPathAfter, indexAfter).map((entry: any) => entry.internalPath);
    if (resolved.length === 1 && resolved[0] === targetPath) return candidate;
  }
  return undefined;
}

function spellingCandidateListBuild(pathPart: string, docPath: string, targetPath: string, kind: string): string[] {
  const doc = sourcePathParse(docPath)!;
  const target = sourcePathParse(targetPath)!;
  const isSamePage = doc.docPageAlias === target.docPageAlias;
  const isSameRoot = isSamePage && doc.rootAlias === target.rootAlias;
  const full = targetPath;
  const local = sourcePathLocalGet(targetPath);
  const relative = isSameRoot ? relativeBuild(doc.relPath, target.relPath) : '';
  const nameNew = target.relPath.split('/').at(-1) ?? '';
  const listByStyle: string[] = [];
  if (kind === 'source' || sourcePathIsFull(pathPart)) listByStyle.push(full);
  else if (sourcePathIsRooted(pathPart)) listByStyle.push(...(isSamePage ? [local] : []), full);
  else if (pathPart.startsWith('./') || pathPart.startsWith('../')) listByStyle.push(...(relative ? [relative] : []), ...(isSamePage ? [local] : []), full);
  else if (pathPart.includes('/')) {
    const segmentCount = pathPart.split('/').length;
    const suffixNew = target.relPath.split('/').slice(-segmentCount).join('/');
    listByStyle.push(suffixNew, ...(relative ? [relative] : []), ...(isSamePage ? [local] : []), full);
  } else listByStyle.push(nameNew, ...(relative ? [relative] : []), ...(isSamePage ? [local] : []), full);
  return [...new Set(listByStyle.filter(Boolean))];
}

// a relative target that is not the relative path from the document to its file
function relativeIsStale(target: string, docPath: string, targetPath: string): boolean {
  const { pathPart } = targetPartSplit(target);
  if (!pathPart.startsWith('./') && !pathPart.startsWith('../')) return false;
  const doc = sourcePathParse(docPath);
  const file = sourcePathParse(targetPath);
  if (!doc || !file || doc.docPageAlias !== file.docPageAlias || doc.rootAlias !== file.rootAlias) return false;
  return relativeBuild(doc.relPath, file.relPath) !== pathPart;
}

// the path from the folder of a document to a file of the same root: ./b.md, ../x/b.md
function relativeBuild(fromRelPath: string, toRelPath: string): string {
  const dirFrom = fromRelPath.split('/').slice(0, -1);
  const segmentTo = toRelPath.split('/');
  let common = 0;
  while (common < dirFrom.length && common < segmentTo.length - 1 && dirFrom[common] === segmentTo[common]) common += 1;
  const up = dirFrom.length - common;
  const rest = segmentTo.slice(common).join('/');
  return up === 0 ? `./${rest}` : `${'../'.repeat(up)}${rest}`;
}

// ---------- rewriting a document ----------

// the text of a document with its path parts rewritten where its references stand: the line
// the index gives first, else the block holding it; then scanned again
function docRewriteBuild(
  entry: RelocateEntry,
  docPathAfter: string,
  rewriteByPathPart: Map<string, { after: string; lineList: number[]; construct: string }>,
  context: RelocateContext,
  problemList: Problem[],
): DocRewrite | undefined {
  const textBefore = sourceEntryTextRead(entry);
  const lineList = textBefore.split('\n');
  const { content } = splitFrontmatter(textBefore);
  const lineOffset = textBefore.length === content.length ? 0 : textBefore.slice(0, textBefore.length - content.length).split('\n').length - 1;
  const blockRangeList = blockRangeListGet(textBefore, entry.ext);
  const rewriteList: DocRewrite['rewriteList'] = [];
  const docPath = entry.internalPath;
  for (const [pathPart, rewrite] of rewriteByPathPart) {
    let countTotal = 0;
    for (const lineIndexed of new Set(rewrite.lineList)) {
      const lineFile = lineIndexed + lineOffset;
      // the line of the reference; a reference in the data of a component has the line of its
      // block, and is looked for in the whole block
      const range = blockRangeList.find((one) => lineFile >= one.lineStart && lineFile <= one.lineEnd);
      const lineCandidateList = [lineFile, ...(range ? rangeLineList(range).filter((one) => one !== lineFile) : [])];
      for (const lineNumber of lineCandidateList) {
        const lineText = lineList[lineNumber - 1];
        if (lineText === undefined) continue;
        const replaced = lineTokenReplace(lineText, pathPart, rewrite.after);
        if (replaced.count === 0) continue;
        lineList[lineNumber - 1] = replaced.text;
        countTotal += replaced.count;
        rewriteList.push({ line: lineNumber, before: pathPart, after: rewrite.after, construct: rewrite.construct });
        if (lineNumber === lineFile) break;
      }
    }
    if (countTotal === 0) problemList.push({ docPath, line: rewrite.lineList[0], target: pathPart, reason: 'not found as written where the index places it; left as it is' });
  }
  if (rewriteList.length === 0) return undefined;
  const textAfter = lineList.join('\n');
  // the document scanned again: every reference as before, the rewritten ones with their new path
  const referenceListBefore = context.referenceListOfText(textBefore, entry);
  const referenceListAfter = context.referenceListOfText(textAfter, { internalPath: docPathAfter, ext: entry.ext });
  const targetExpectedGet = (target: string) => {
    const { pathPart, suffix } = targetPartSplit(target);
    const rewrite = rewriteByPathPart.get(pathPart);
    return rewrite ? `${rewrite.after}${suffix}` : target;
  };
  const isSame = referenceListBefore.length === referenceListAfter.length
    && referenceListBefore.every((reference, index) => (
      referenceListAfter[index].construct === reference.construct
      && referenceListAfter[index].kind === reference.kind
      && referenceListAfter[index].target === targetExpectedGet(reference.target)
    ));
  if (!isSame) {
    problemList.push({ docPath, target: [...rewriteByPathPart.keys()].join(', '), reason: 'the rewrite would change other references of the document; it is left as it is' });
    return undefined;
  }
  return { docPath, docPathAfter, rewriteList: rewriteList.sort((a, b) => a.line - b.line), textBefore, textAfter };
}

// the root-level blocks of a text, by their lines in the file
function blockRangeListGet(text: string, ext: string): { lineStart: number; lineEnd: number }[] {
  try {
    return editTextModelBuild({ text, format: ext === 'mdx' ? 'mdx' : 'md' }).blockList.map((block: any) => ({ lineStart: block.lineStart, lineEnd: block.lineEnd }));
  } catch {
    return [];
  }
}

function rangeLineList(range: { lineStart: number; lineEnd: number }): number[] {
  const list: number[] = [];
  for (let line = range.lineStart; line <= range.lineEnd; line += 1) list.push(line);
  return list;
}

// every occurrence of a path in a line where a reference can stand: after "(", "<", a backtick,
// "[", a quote, "=", "|", or a "key:" / "- " of yaml; before ")", ">", a backtick, "]", a quote,
// "#", "?", "|", "," or a space. a path with a space written right after "(" gets its brackets
export function lineTokenReplace(line: string, pathPart: string, pathPartNew: string): { text: string; count: number } {
  if (!pathPart) return { text: line, count: 0 };
  let result = '';
  let index = 0;
  let count = 0;
  for (;;) {
    const found = line.indexOf(pathPart, index);
    if (found < 0) break;
    const before = found === 0 ? '' : line[found - 1];
    const after = line[found + pathPart.length] ?? '';
    // a space before it: only after "key:", "- ", "," or at the start of the line (yaml)
    const isBeforeOk = before === '' || '(<`["\'=|,'.includes(before) || /(^|[:,-])\s+$/.test(line.slice(0, found));
    const isAfterOk = after === '' || ')>`]"\'#?|,'.includes(after) || /\s/.test(after);
    if (!isBeforeOk || !isAfterOk) {
      result += line.slice(index, found + pathPart.length);
      index = found + pathPart.length;
      continue;
    }
    const isBracketNeeded = before === '(' && /[\s()]/.test(pathPartNew);
    result += line.slice(index, found) + (isBracketNeeded ? `<${pathPartNew}>` : pathPartNew);
    index = found + pathPart.length;
    count += 1;
  }
  result += line.slice(index);
  return { text: result, count };
}

// ---------- the configuration naming a document ----------

// side panels (doc: of a node) and entries (homeDoc) naming a moved document, rewritten in their
// yaml in place, in the form they were written in (a local path stays local in its doc page)
function configRewriteListBuild(pathAfterByPath: Map<string, string>, context: RelocateContext, problemList: Problem[]): ConfigRewrite[] {
  const configList: ConfigRewrite[] = [];
  for (const { file, docPageAlias, kind } of context.yamlFileList) {
    if (!fs.existsSync(file)) continue;
    const textBefore = fs.readFileSync(file, 'utf-8');
    if (![...pathAfterByPath.keys()].some((from) => textBefore.includes(sourcePathLocalGet(from).split('/').at(-1) ?? ''))) continue;
    const document = parseDocument(textBefore);
    if (document.errors.length > 0) continue;
    const foundList: { keyPath: (string | number)[]; value: string; isFlow: boolean }[] = [];
    yamlPathValueWalk(document.contents, [], false, (keyPath, value, isFlow) => {
      const key = keyPath.at(-1);
      const isSidePanelDoc = key === 'doc' && keyPath.some((one) => one === 'tree' || one === 'children' || one === 'sidePanelById');
      const isHomeDoc = key === 'homeDoc' && (keyPath.length === 1 || (keyPath.length === 2 && keyPath[0] === 'docEntry'));
      if (isSidePanelDoc || isHomeDoc) foundList.push({ keyPath, value, isFlow });
    });
    let text = textBefore;
    const rewriteList: ConfigRewrite['rewriteList'] = [];
    for (const found of foundList) {
      if (!sourcePathIsRooted(found.value)) continue;
      const pathFull = sourcePathFullGet(sourcePathNormalize(found.value), docPageAlias);
      const pathAfter = pathAfterByPath.get(pathFull);
      if (!pathAfter) continue;
      const isLocalKept = !sourcePathIsFull(found.value) && sourcePathParse(pathAfter)?.docPageAlias === docPageAlias;
      const valueNew = isLocalKept ? sourcePathLocalGet(pathAfter) : pathAfter;
      if (found.isFlow) {
        problemList.push({ file, target: found.value, reason: 'written in a flow mapping ({ doc: … }); change it by hand' });
        continue;
      }
      const operation = yamlValueSetOperationBuild(text, found.keyPath, yamlScalarTextBuild(valueNew));
      if (operation.code !== 0) {
        problemList.push({ file, target: found.value, reason: operation.message });
        continue;
      }
      text = lineOperationApply(text, operation.data.operation);
      rewriteList.push({ keyPath: found.keyPath, before: found.value, after: valueNew });
    }
    if (rewriteList.length > 0) configList.push({ file, kind, rewriteList, textBefore, textAfter: text });
  }
  return configList;
}

// every scalar string of a yaml tree with its key path
function yamlPathValueWalk(node: any, keyPath: (string | number)[], isFlow: boolean, visit: (keyPath: (string | number)[], value: string, isFlow: boolean) => void) {
  if (isMap(node)) {
    for (const pair of node.items) {
      if (!isPair(pair) || !isScalar(pair.key)) continue;
      const keyPathChild = [...keyPath, String(pair.key.value)];
      if (isScalar(pair.value) && typeof pair.value.value === 'string') visit(keyPathChild, pair.value.value, isFlow || node.flow === true);
      else yamlPathValueWalk(pair.value, keyPathChild, isFlow || node.flow === true, visit);
    }
  } else if (isSeq(node)) {
    node.items.forEach((item, index) => yamlPathValueWalk(item, [...keyPath, index], isFlow || node.flow === true, visit));
  }
}

// ---------- applying ----------

export function relocateApply(body: any, context: RelocateContext, hooks: RelocateHooks): Answer {
  const checked = moveListCheck(body?.moveList, context);
  if (checked.code !== 0) return checked;
  const plan = planCompute(checked.data, context);
  if (typeof body?.planKey === 'string' && body.planKey !== plan.planKey) {
    return { code: -2, data: planPublicGet(plan, context), message: 'the source changed since the plan was shown; here is the plan as it is now' };
  }
  const undoList: (() => void)[] = [];
  try {
    // 1. the documents that stay, with their references rewritten
    const textAfterByPath = new Map(plan.docList.map((doc) => [doc.docPath, doc.textAfter]));
    for (const doc of plan.docList) {
      if (plan.moveList.some((move) => move.from === doc.docPath)) continue;
      const entry = context.entryList.find((one) => one.internalPath === doc.docPath)!;
      hooks.pathListMark(entryFileListGet(entry));
      sourceEntryTextWrite(entry, doc.textAfter);
      undoList.push(() => sourceEntryTextWrite(entry, doc.textBefore));
    }
    // 2. the moves, a moved document with its own references rewritten
    for (const move of plan.moveList) undoList.push(moveApply(move, textAfterByPath.get(move.from), hooks));
    // 3. the side panels and entries
    const fileWrittenList: { filePath: string; text: string }[] = [];
    for (const config of plan.configList) {
      if (fs.existsSync(config.file)) fs.copyFileSync(config.file, `${config.file}.bak`);
      fs.writeFileSync(config.file, config.textAfter, 'utf-8');
      undoList.push(() => fs.writeFileSync(config.file, config.textBefore, 'utf-8'));
      fileWrittenList.push({ filePath: config.file, text: config.textAfter });
    }
    const messageLoad = fileWrittenList.length > 0 ? hooks.configFileListWritten(fileWrittenList) : '';
    if (messageLoad) throw new Error(`the configuration would not load after the move (${messageLoad})`);
  } catch (error: any) {
    for (const undo of undoList.reverse()) {
      try {
        undo();
      } catch {
        // best effort: what cannot be put back stays
      }
    }
    if (plan.configList.length > 0) hooks.configFileListWritten(plan.configList.map((config) => ({ filePath: config.file, text: config.textBefore })));
    hooks.dataReport();
    return { code: typeof error?.code === 'number' ? error.code : -1, data: null, message: `nothing was moved: ${error?.message ?? error}` };
  }
  for (const move of plan.moveList) hooks.historyPathMove(move.from, move.to);
  hooks.dataReport();
  return { code: 0, data: planPublicGet(plan, context), message: '' };
}

// one move done; answers what undoes it
function moveApply(move: MoveChecked, textRewritten: string | undefined, hooks: RelocateHooks): () => void {
  const { entry } = move;
  if (move.kindFrom === 'file' && move.kindTo === 'file') {
    fs.mkdirSync(path.dirname(move.absPathTo), { recursive: true });
    hooks.pathListMark([entry.absPath, move.absPathTo]);
    const textBefore = textRewritten !== undefined ? fs.readFileSync(entry.absPath, 'utf-8') : undefined;
    fs.renameSync(entry.absPath, move.absPathTo);
    if (textRewritten !== undefined) fs.writeFileSync(move.absPathTo, textRewritten, 'utf-8');
    return () => {
      if (textBefore !== undefined) fs.writeFileSync(move.absPathTo, textBefore, 'utf-8');
      fs.renameSync(move.absPathTo, entry.absPath);
    };
  }
  if (move.kindFrom === 'file' && move.kindTo === 'managed') {
    const text = textRewritten ?? fs.readFileSync(entry.absPath, 'utf-8');
    const root = docManagedRootRead(move.rootTo.rootAbsPath);
    const doc = docManagedDocCreate(root, { path: move.relPathTo, text });
    hooks.pathListMark([...doc.fileList, entry.absPath]);
    const movedList: SourceFileMoved[] = sourceFileBackupMove([{ absPath: entry.absPath, internalPath: entry.internalPath }]);
    hooks.pathListMark(movedList.map((one) => one.backup));
    return () => {
      for (const file of doc.fileList) if (fs.existsSync(file)) fs.rmSync(file);
      sourceFileBackupRestore(movedList);
    };
  }
  if (move.kindFrom === 'managed' && move.kindTo === 'file') {
    const text = textRewritten ?? sourceEntryTextRead(entry);
    const { doc } = sourceEntryManagedNowGet(entry.managed!);
    fs.mkdirSync(path.dirname(move.absPathTo), { recursive: true });
    hooks.pathListMark([move.absPathTo, ...doc.fileList]);
    fs.writeFileSync(move.absPathTo, text, 'utf-8');
    const movedList = sourceFileBackupMove(doc.fileList.map((file) => ({ absPath: file, internalPath: entry.internalPath })));
    hooks.pathListMark(movedList.map((one) => one.backup));
    return () => {
      sourceFileBackupRestore(movedList);
      if (fs.existsSync(move.absPathTo)) fs.rmSync(move.absPathTo);
    };
  }
  // managed to managed: the same document under another path, or in another root, with its id
  const { root: rootFrom, doc } = sourceEntryManagedNowGet(entry.managed!);
  const textBefore = textRewritten !== undefined ? sourceEntryTextRead(entry) : undefined;
  const rootTo = docManagedRootRead(move.rootTo.rootAbsPath);
  hooks.pathListMark(doc.fileList);
  let docMoved = rootFrom.dirAbs === rootTo.dirAbs ? docManagedDocPathSet(rootFrom, doc, move.relPathTo) : docManagedDocMove(rootFrom, doc, rootTo, move.relPathTo);
  if (textRewritten !== undefined) docMoved = docManagedTextWrite(rootTo, docMoved, textRewritten);
  hooks.pathListMark(docMoved.fileList);
  return () => {
    let docBack = rootFrom.dirAbs === rootTo.dirAbs
      ? docManagedDocPathSet(rootTo, docMoved, doc.record.path)
      : docManagedDocMove(rootTo, docMoved, rootFrom, doc.record.path);
    if (textBefore !== undefined) docBack = docManagedTextWrite(rootFrom, docBack, textBefore);
  };
}

function entryFileListGet(entry: RelocateEntry): string[] {
  return entry.managed ? entry.managed.doc.fileList : [entry.absPath];
}

// ---------- helpers ----------

function setIsSame(listA: string[], listB: string[]): boolean {
  const setA = new Set(listA);
  const setB = new Set(listB);
  return setA.size === setB.size && [...setA].every((one) => setB.has(one));
}

function pathIsInside(filePath: string, folder: string): boolean {
  const relative = path.relative(folder, filePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
