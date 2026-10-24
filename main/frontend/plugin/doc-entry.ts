import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { textHashGet } from './doc-edit-lines.ts';

// The entry of a document and the yaml files it reaches.
// design: doc_page_impl_side_panel.md#the-document-entry
//
// every document has one entry file, named by config docEntry.file, or
// found in the doc page folder named by config docEntry.dir
// (docEntryFileFind: .doc-page/entry.yaml by convention, design:
// doc_page_impl_dir.md). the entry file and every yaml file it reaches share
// one grammar, the document yaml file:
//
//   docEntry:                # marks the file as the entry of a document;
//     title: ...             #   true, or a mapping with optional page values
//     homeDoc: ...           #   used when config.yaml does not set them
//     homeItem: ...
//   source:                  # optional: rules | { rules } | { file }
//   tag:                     # optional: { defineById } | { file }
//   config:                  # optional: the doc page config layer
//                            #   { Key: value, compConfig } | { file } | a list of both
//   asset:                   # optional, an entry only: the asset store config of the doc
//                            #   page, { file: ./asset.yaml } | false (no store); absent:
//                            #   asset.yaml beside the entry (doc_page_impl_asset.md)
//   sidePanelDefault: main   # optional when the file declares one side panel
//   sidePanelById:
//     main: { root?, tree }          # a side panel resource
//     other: { file?, sidePanel? }   # a reference to a side panel declared elsewhere
//
// a reference to a document entry (docEntry.dir, an "include" path) may name
// the folder of a doc page instead of its entry file.
//
// a side-panel reference names one side panel. a string is a file path (or
// the folder of a doc page: its entry) and means the default side panel of
// that file; a mapping names the file (the
// file holding the reference when absent) and the side panel id (that file's
// default when absent). the "include" property of a tree node and the alias
// values of sidePanelById are references.
//
// loading a file loads everything in it: its source rules are appended once,
// its tag definitions are merged (a file loaded earlier wins), its config
// declarations are recorded, and every side panel is resolved with its
// includes. the entry is loaded first, so its
// rules come first, followed by the rules of included files in order of
// appearance. every node of every side panel is annotated for the edit layer
// with the file (relative to the config directory) and yaml address of
//   textSource     the node whose label it shows (doc-side-panel-text.ts):
//                  the node itself, or the root of the side panel it includes
//   nodeSource     the node itself, as an item of its list (doc-side-panel-move.ts)
//   includeSource  a node with "include" only: the tree list of the included
//                  side panel, and whether it is a sub document (another
//                  document's entry file)

export type SidePanelTextSource = {
  file: string;
  path: (string | number)[];
};

export type SidePanelIncludeSource = {
  file: string;
  // yaml address of the included side panel's "tree" list
  path: (string | number)[];
  // the included file is the entry of another document: a sub document
  isDocEntry: boolean;
  // the including node also has "children" of its own, after the included ones
  isChildrenLocal: boolean;
};

export type SidePanelLoaded = {
  root?: Record<string, any>;
  // where the root's label is written, when the side panel has a root
  rootTextSource?: SidePanelTextSource;
  // where the "tree" list is written
  treeSource: SidePanelTextSource;
  tree: any[];
};

export type DocEntryInfo = {
  title?: string;
  homeDoc?: string;
  homeItem?: string;
};

// one config declaration of the doc page config layer
// (doc_page_impl_config.md#the-doc-page-layer): a mapping of config keys
// written in a document yaml file or a config file
export type ConfigDeclaration = {
  // file and yaml address, as one text: "{file}#{path}"
  id: string;
  // relative to the config directory
  file: string;
  // yaml address of the mapping in the file, e.g. ['config'] or ['config', 1]
  path: (string | number)[];
  config: Record<string, any>;
  // the entry of the document the declaration belongs to, relative to the
  // config directory
  entryFile: string;
};

// one doc page the page loads: its own, and every one it includes (by entry
// file or by folder), in order of first loading. what the asset service
// layer needs to find the store config of each (doc_page_impl_asset.md#the-local-store-folders-fully-reflected)
export type DocPageLoaded = {
  // absolute
  entryFile: string;
  // the folder of the doc page: the parent of .doc-page/, or the entry's folder
  dirPage: string;
  // the root ids the source rules of the doc page's own files declare
  rootIdList: string[];
  // "asset" of the entry as written: undefined (the convention), false, or { file }
  asset: undefined | false | { file: string };
};

export type DocEntryLoaded = {
  entry: DocEntryInfo;
  // the side panel shown by the page: config docEntry.sidePanel, or the
  // entry's default. '' when the entry declares no side panel at all.
  sidePanelId: string;
  sidePanelIdList: string[];
  sidePanel: SidePanelLoaded | undefined;
  // every rule, paths relative to the config directory
  sourceRuleList: any[];
  tagDefineById: Record<string, any>;
  // the doc page config layer: every config declaration, in stack order
  // (a later one wins): the documents included last first, the entry's own
  // document last; within one document in the order read
  configDeclarationList: ConfigDeclaration[];
  // the variables the config files declare, in the same order merged
  variableByName: Record<string, string>;
  // the doc pages loaded, the page's own first
  docPageList: DocPageLoaded[];
  // every yaml file read, absolute, the entry file first
  fileListLoaded: string[];
  // the content hash (doc-edit-lines.ts textHashGet) of every document yaml
  // file as it was loaded, by file relative to the config directory: an edit
  // of a side panel's structure is refused when a file changed since
  fileHashByFile: Record<string, string>;
};

type DocYamlFile = {
  filePath: string;
  content: Record<string, any>;
  contentHash: string;
  isEntry: boolean;
  // the entry of the document this file belongs to: the file itself for an
  // entry, else the entry of the file that first reached it
  entryOwner: string;
  entry: DocEntryInfo;
  sidePanelIdList: string[];
  // '' when the file declares no side panel, or several without sidePanelDefault
  sidePanelIdDefault: string;
};

type SidePanelRef = {
  file: string; // absolute
  sidePanelId: string; // '' for the default side panel of the file
  entryOwner: string; // the entry of the file holding the reference
};

type LoadContext = {
  configDir: string;
  fileByPath: Map<string, DocYamlFile>;
  sidePanelByKey: Map<string, SidePanelLoaded>;
  fileListLoaded: string[];
  sourceRuleList: any[];
  tagDefineById: Record<string, any>;
  // the entries reached, in order of first loading
  entryFileList: string[];
  docPageByEntryFile: Map<string, DocPageLoaded>;
  configDeclarationList: ConfigDeclaration[];
  variableDeclarationList: { entryOwner: string; variableByName: Record<string, string> }[];
  // config files being read, for cycles
  configFileChain: string[];
};

const FILE_KEY_LIST = ['docEntry', 'source', 'tag', 'config', 'asset', 'sidePanelDefault', 'sidePanelById'];
const CONFIG_FILE_KEY_LIST = ['config', 'variable'];
const ENTRY_FILE_SUFFIX = '-entry.yaml';
const ENTRY_FILE_NAME = 'entry.yaml';

// the folder of a doc page that holds its metadata files: the entry, the
// files it names (source, tag, side panels, config) and the configs of the
// services of the page. never part of the collected source.
// design: doc_page_impl_dir.md
export const DOC_PAGE_META_DIR_NAME = '.doc-page';

// the entry file of a doc page given by its folder, first match:
//   {dir}/.doc-page/entry.yaml, {dir}/.doc-page/xxx-entry.yaml (the only one),
//   {dir}/entry.yaml,           {dir}/xxx-entry.yaml           (the only one)
export function docEntryFileFind(dirPath: string): string {
  const dirResolved = path.resolve(dirPath);
  if (!fs.existsSync(dirResolved) || !fs.statSync(dirResolved).isDirectory()) {
    throw new Error(`[doc-source] doc page folder not found: ${dirResolved}`);
  }
  for (const dirSeek of [path.join(dirResolved, DOC_PAGE_META_DIR_NAME), dirResolved]) {
    if (!fs.existsSync(dirSeek) || !fs.statSync(dirSeek).isDirectory()) continue;
    const fileEntry = path.join(dirSeek, ENTRY_FILE_NAME);
    if (fs.existsSync(fileEntry)) return fileEntry;
    const nameList = fs.readdirSync(dirSeek).filter((name) => name.endsWith(ENTRY_FILE_SUFFIX)).sort();
    if (nameList.length === 1) return path.join(dirSeek, nameList[0]);
    if (nameList.length > 1) {
      throw new Error(
        `[doc-source] several entry files in ${dirSeek} (${nameList.join(', ')}); name one, or keep one as ${ENTRY_FILE_NAME}`,
      );
    }
  }
  throw new Error(
    `[doc-source] no entry file in the doc page folder ${dirResolved}: expected ${DOC_PAGE_META_DIR_NAME}/${ENTRY_FILE_NAME}`
      + ` (or xxx${ENTRY_FILE_SUFFIX} there, or either in the folder itself)`,
  );
}

// a path naming an entry: the file itself, or the entry found in a folder
function entryPathResolve(filePath: string): string {
  const filePathResolved = path.resolve(filePath);
  if (fs.existsSync(filePathResolved) && fs.statSync(filePathResolved).isDirectory()) {
    return docEntryFileFind(filePathResolved);
  }
  return filePathResolved;
}

export function docEntryLoad(entryFile: string, configDir: string, sidePanelIdWanted = ''): DocEntryLoaded {
  const context: LoadContext = {
    configDir,
    fileByPath: new Map(),
    sidePanelByKey: new Map(),
    fileListLoaded: [],
    sourceRuleList: [],
    tagDefineById: {},
    entryFileList: [],
    docPageByEntryFile: new Map(),
    configDeclarationList: [],
    variableDeclarationList: [],
    configFileChain: [],
  };
  const file = fileLoad(entryPathResolve(entryFile), context, '');
  if (!file.isEntry) {
    throw new Error(
      `[doc-source] the file named by config docEntry.file is not an entry: it must declare "docEntry": ${file.filePath}`,
    );
  }

  let sidePanelId = '';
  if (sidePanelIdWanted !== '') {
    if (!file.sidePanelIdList.includes(sidePanelIdWanted)) {
      throw new Error(
        `[doc-source] config docEntry.sidePanel names "${sidePanelIdWanted}", which the entry does not declare`
          + ` (declared: ${file.sidePanelIdList.join(', ') || 'none'}): ${file.filePath}`,
      );
    }
    sidePanelId = sidePanelIdWanted;
  } else if (file.sidePanelIdList.length > 0) {
    sidePanelId = sidePanelIdDefaultGet(file, 'config docEntry');
  }
  const sidePanel = sidePanelId === ''
    ? undefined
    : context.sidePanelByKey.get(sidePanelKeyBuild(file.filePath, sidePanelId));

  const fileHashByFile: Record<string, string> = {};
  for (const fileLoaded of context.fileByPath.values()) {
    fileHashByFile[fileRelativeGet(fileLoaded.filePath, configDir)] = fileLoaded.contentHash;
  }

  // the doc page config layer: the documents included last first, so the
  // entry of the page decides over what it includes (as for tags)
  const configDeclarationList: ConfigDeclaration[] = [];
  const variableByName: Record<string, string> = {};
  for (const entryOwner of [...context.entryFileList].reverse()) {
    for (const declaration of context.configDeclarationList) {
      if (declaration.entryFile === fileRelativeGet(entryOwner, configDir)) configDeclarationList.push(declaration);
    }
    for (const declaration of context.variableDeclarationList) {
      if (declaration.entryOwner === entryOwner) Object.assign(variableByName, declaration.variableByName);
    }
  }

  return {
    entry: file.entry,
    sidePanelId,
    sidePanelIdList: file.sidePanelIdList,
    sidePanel,
    sourceRuleList: context.sourceRuleList,
    tagDefineById: context.tagDefineById,
    configDeclarationList,
    variableByName,
    docPageList: context.entryFileList.map((entryFile) => context.docPageByEntryFile.get(entryFile)!),
    fileListLoaded: context.fileListLoaded,
    fileHashByFile,
  };
}

// ---------- files ----------

// entryOwnerFrom: the entry of the file that reaches this one ('' for the entry of the page)
function fileLoad(filePath: string, context: LoadContext, entryOwnerFrom: string): DocYamlFile {
  const filePathResolved = path.resolve(filePath);
  const fileLoaded = context.fileByPath.get(filePathResolved);
  if (fileLoaded) return fileLoaded;
  if (!fs.existsSync(filePathResolved)) {
    throw new Error(`[doc-source] document yaml file not found: ${filePathResolved}`);
  }
  const text = fs.readFileSync(filePathResolved, 'utf-8');
  const content = parseYaml(text) ?? {};
  if (!mappingIs(content)) {
    throw new Error(`[doc-source] document yaml file must be a mapping: ${filePathResolved}`);
  }
  fileKeysValidate(content, filePathResolved);

  const isEntry = content.docEntry !== undefined && content.docEntry !== false;
  const file: DocYamlFile = {
    filePath: filePathResolved,
    content,
    contentHash: textHashGet(text),
    isEntry,
    entryOwner: isEntry || entryOwnerFrom === '' ? filePathResolved : entryOwnerFrom,
    entry: entrySectionRead(content.docEntry, filePathResolved),
    sidePanelIdList: sidePanelIdListRead(content.sidePanelById, filePathResolved),
    sidePanelIdDefault: '',
  };
  file.sidePanelIdDefault = sidePanelIdDefaultRead(file);
  if (file.isEntry && !file.filePath.endsWith(ENTRY_FILE_SUFFIX) && path.basename(file.filePath) !== ENTRY_FILE_NAME) {
    console.warn(
      `[doc-source] an entry file is named ${DOC_PAGE_META_DIR_NAME}/${ENTRY_FILE_NAME} (or xxx${ENTRY_FILE_SUFFIX}) by convention: ${file.filePath}`,
    );
  }
  // registered before its side panels load, so a side panel of another file
  // that includes a side panel of this one finds the file
  context.fileByPath.set(filePathResolved, file);
  context.fileListLoaded.push(filePathResolved);
  if (file.isEntry) {
    context.entryFileList.push(filePathResolved);
    context.docPageByEntryFile.set(filePathResolved, {
      entryFile: filePathResolved,
      dirPage: docPageDirGet(filePathResolved),
      rootIdList: [],
      asset: assetSectionRead(content.asset, filePathResolved),
    });
  } else if (content.asset !== undefined) {
    throw new Error(
      `[doc-source] "asset" belongs to the entry of a doc page, not to a resource file: ${filePathResolved}`,
    );
  }

  sourceSectionLoad(content.source, file, context);
  tagSectionLoad(content.tag, file, context);
  configSectionLoad(content.config, file.filePath, ['config'], file.entryOwner, context);
  for (const sidePanelId of file.sidePanelIdList) {
    sidePanelLoad({ file: filePathResolved, sidePanelId, entryOwner: file.entryOwner }, context, []);
  }
  return file;
}

function fileKeysValidate(content: Record<string, any>, filePath: string) {
  for (const key of Object.keys(content)) {
    if (FILE_KEY_LIST.includes(key)) continue;
    if (key === 'tree' || key === 'root' || key === 'sidePanel') {
      throw new Error(
        `[doc-source] "${key}" at the top level is the former side-panel resource form; declare the side panel`
          + ` as sidePanelById.{id}: { root?, tree } (see doc_page_impl_side_panel.md): ${filePath}`,
      );
    }
    throw new Error(
      `[doc-source] unknown key "${key}" in a document yaml file (known: ${FILE_KEY_LIST.join(', ')}): ${filePath}`,
    );
  }
}

function entrySectionRead(docEntry: any, filePath: string): DocEntryInfo {
  if (docEntry === undefined || docEntry === false || docEntry === true) return {};
  if (!mappingIs(docEntry)) {
    throw new Error(`[doc-source] "docEntry" must be true or a mapping: ${filePath}`);
  }
  const entry: DocEntryInfo = {};
  for (const key of ['title', 'homeDoc', 'homeItem'] as const) {
    if (docEntry[key] === undefined) continue;
    if (typeof docEntry[key] !== 'string') {
      throw new Error(`[doc-source] "docEntry.${key}" must be a string: ${filePath}`);
    }
    entry[key] = docEntry[key];
  }
  return entry;
}

function sidePanelIdListRead(sidePanelById: any, filePath: string): string[] {
  if (sidePanelById === undefined) return [];
  if (!mappingIs(sidePanelById)) {
    throw new Error(`[doc-source] "sidePanelById" must be a mapping of side panel id to side panel: ${filePath}`);
  }
  return Object.keys(sidePanelById);
}

function sidePanelIdDefaultRead(file: DocYamlFile): string {
  const declared = file.content.sidePanelDefault;
  if (declared !== undefined) {
    if (typeof declared !== 'string' || !file.sidePanelIdList.includes(declared)) {
      throw new Error(
        `[doc-source] "sidePanelDefault" must name a side panel of sidePanelById`
          + ` (declared: ${file.sidePanelIdList.join(', ') || 'none'}): ${file.filePath}`,
      );
    }
    return declared;
  }
  return file.sidePanelIdList.length === 1 ? file.sidePanelIdList[0] : '';
}

// the default side panel of a file, for a reference that names none
function sidePanelIdDefaultGet(file: DocYamlFile, place: string): string {
  if (file.sidePanelIdDefault !== '') return file.sidePanelIdDefault;
  if (file.sidePanelIdList.length === 0) {
    throw new Error(`[doc-source] ${place} needs a side panel, but the file declares none: ${file.filePath}`);
  }
  throw new Error(
    `[doc-source] ${place} needs the default side panel of a file that declares several`
      + ` (${file.sidePanelIdList.join(', ')}) and no "sidePanelDefault": ${file.filePath}`,
  );
}

// ---------- source section ----------
// rules | { rules } | { file }. rule paths are written relative to the file
// holding the rules; the scan reads them relative to the config directory.

function sourceSectionLoad(source: any, file: DocYamlFile, context: LoadContext) {
  if (source === undefined) return;
  let ruleList: any;
  let ruleDir = path.dirname(file.filePath);
  if (mappingIs(source) && source.file !== undefined) {
    if (typeof source.file !== 'string' || !source.file.trim()) {
      throw new Error(`[doc-source] "source.file" must be a path: ${file.filePath}`);
    }
    const sourceFile = path.resolve(ruleDir, source.file);
    if (!fs.existsSync(sourceFile)) {
      throw new Error(`[doc-source] source file not found: ${sourceFile} (named in ${file.filePath})`);
    }
    const sourceContent = readYaml(sourceFile);
    ruleList = Array.isArray(sourceContent) ? sourceContent : sourceContent?.rules;
    ruleDir = path.dirname(sourceFile);
    context.fileListLoaded.push(sourceFile);
    if (!Array.isArray(ruleList)) {
      throw new Error(`[doc-source] source file must be a rule list or contain "rules": ${sourceFile}`);
    }
  } else {
    ruleList = Array.isArray(source) ? source : source?.rules;
    if (!Array.isArray(ruleList)) {
      throw new Error(`[doc-source] "source" must be a rule list, { rules }, or { file }: ${file.filePath}`);
    }
  }
  context.sourceRuleList.push(...sourceRulesRebase(ruleList, ruleDir, context.configDir));
  // the roots this doc page declares: where its asset folders are named
  const docPage = context.docPageByEntryFile.get(file.entryOwner);
  for (const rule of ruleList) {
    if ((rule?.action !== 'addFolder' && rule?.action !== 'addFile') || !docPage) continue;
    const rootId = rule.rootId ?? path.basename(path.resolve(ruleDir, String(rule.path ?? '')));
    if (!docPage.rootIdList.includes(rootId)) docPage.rootIdList.push(rootId);
  }
}

// ---------- asset section ----------
// the asset store config of a doc page (doc_page_impl_asset.md): { file },
// relative to the entry, or false for none. absent: asset.yaml beside the
// entry, read when it exists (asset store config defaults otherwise)

function assetSectionRead(asset: any, filePath: string): DocPageLoaded['asset'] {
  if (asset === undefined || asset === null) return undefined;
  if (asset === false) return false;
  if (mappingIs(asset) && typeof asset.file === 'string' && asset.file.trim() !== '' && Object.keys(asset).length === 1) {
    return { file: asset.file.trim() };
  }
  throw new Error(`[doc-source] "asset" of an entry is { file: ./asset.yaml } or false: ${filePath}`);
}

// the folder of a doc page from its entry: the parent of .doc-page/, or the
// folder of the entry
export function docPageDirGet(entryFile: string): string {
  const dirEntry = path.dirname(entryFile);
  return path.basename(dirEntry) === DOC_PAGE_META_DIR_NAME ? path.dirname(dirEntry) : dirEntry;
}

function sourceRulesRebase(rules: any[], fileDir: string, configDir: string): any[] {
  return rules.map((rule) => {
    if ((rule.action !== 'addFolder' && rule.action !== 'addFile') || !rule.path) return rule;
    const pathAbsolute = path.resolve(fileDir, rule.path);
    return { ...rule, path: path.relative(configDir, pathAbsolute) || '.' };
  });
}

// ---------- tag section ----------
// { defineById } | { file }; the file contains defineById. definitions of a
// file loaded earlier win, so the entry decides over what it includes.

function tagSectionLoad(tag: any, file: DocYamlFile, context: LoadContext) {
  if (tag === undefined) return;
  if (!mappingIs(tag)) {
    throw new Error(`[doc-source] "tag" must be { defineById } or { file }: ${file.filePath}`);
  }
  let defineById: any = tag.defineById;
  if (tag.file !== undefined) {
    if (typeof tag.file !== 'string' || !tag.file.trim()) {
      throw new Error(`[doc-source] "tag.file" must be a path: ${file.filePath}`);
    }
    const tagFile = path.resolve(path.dirname(file.filePath), tag.file);
    const tagContent = readYaml(tagFile);
    if (tagContent === undefined) {
      throw new Error(`[doc-source] tag file not found: ${tagFile} (named in ${file.filePath})`);
    }
    context.fileListLoaded.push(tagFile);
    defineById = { ...(tagContent?.defineById ?? {}), ...(defineById ?? {}) };
  }
  if (defineById === undefined) return;
  if (!mappingIs(defineById)) {
    throw new Error(`[doc-source] tag definitions must be a mapping "defineById": ${file.filePath}`);
  }
  // a tag already defined by a file loaded earlier keeps that definition;
  // new tags are appended, so the entry's tags stay first
  for (const [tagId, define] of Object.entries(defineById)) {
    if (context.tagDefineById[tagId] === undefined) context.tagDefineById[tagId] = define;
  }
}

// ---------- config section ----------
// the doc page config layer (doc_page_impl_config.md#the-doc-page-layer).
// "config" of a document yaml file, or of a config file, is one of
//   { Key: value, compConfig: {...} }   one declaration, written in place
//   { file: ./config.yaml }             a config file: { config?, variable? }
//   [ item, item, ... ]                 several, each one of the two above
// declarations are recorded in the order read; a config file is read where
// it is named. a config file holds "config" (the same forms, its paths
// relative to it) and "variable", ${name} values used by any declaration.

function configSectionLoad(
  config: any,
  filePath: string,
  address: (string | number)[],
  entryOwner: string,
  context: LoadContext,
) {
  if (config === undefined || config === null) return;
  const place = `${filePath} ${address.join('.')}`;
  if (Array.isArray(config)) {
    config.forEach((item, index) => {
      if (!mappingIs(item)) {
        throw new Error(`[doc-source] an item of "config" must be a mapping of keys or { file }: ${place}[${index}]`);
      }
      configItemLoad(item, filePath, [...address, index], entryOwner, context);
    });
    return;
  }
  if (!mappingIs(config)) {
    throw new Error(`[doc-source] "config" must be a mapping of keys, { file }, or a list of them: ${place}`);
  }
  configItemLoad(config, filePath, address, entryOwner, context);
}

function configItemLoad(
  item: Record<string, any>,
  filePath: string,
  address: (string | number)[],
  entryOwner: string,
  context: LoadContext,
) {
  if (item.file === undefined) {
    const file = fileRelativeGet(filePath, context.configDir);
    context.configDeclarationList.push({
      id: `${file}#${address.join('.')}`,
      file,
      path: address,
      config: item,
      entryFile: fileRelativeGet(entryOwner, context.configDir),
    });
    return;
  }
  const place = `${filePath} ${address.join('.')}`;
  const keyListOther = Object.keys(item).filter((key) => key !== 'file');
  if (keyListOther.length > 0) {
    throw new Error(
      `[doc-source] a config file reference holds "file" only (found ${keyListOther.join(', ')});`
        + ` write the keys in the file, or in another item of a "config" list: ${place}`,
    );
  }
  if (typeof item.file !== 'string' || !item.file.trim()) {
    throw new Error(`[doc-source] "file" of a config reference must be a path: ${place}`);
  }
  const configFile = path.resolve(path.dirname(filePath), item.file);
  if (!fs.existsSync(configFile)) {
    throw new Error(`[doc-source] config file not found: ${configFile} (named in ${place})`);
  }
  if (context.configFileChain.includes(configFile)) {
    throw new Error(`[doc-source] config file cycle: ${[...context.configFileChain, configFile].join(' -> ')}`);
  }
  const content = readYaml(configFile) ?? {};
  if (!mappingIs(content)) throw new Error(`[doc-source] a config file must be a mapping: ${configFile}`);
  for (const key of Object.keys(content)) {
    if (!CONFIG_FILE_KEY_LIST.includes(key)) {
      throw new Error(
        `[doc-source] unknown key "${key}" in a config file (known: ${CONFIG_FILE_KEY_LIST.join(', ')}): ${configFile}`,
      );
    }
  }
  if (!context.fileListLoaded.includes(configFile)) context.fileListLoaded.push(configFile);
  if (content.variable !== undefined) {
    if (!mappingIs(content.variable)) throw new Error(`[doc-source] "variable" must be a mapping: ${configFile}`);
    context.variableDeclarationList.push({ entryOwner, variableByName: content.variable });
  }
  context.configFileChain.push(configFile);
  try {
    configSectionLoad(content.config, configFile, ['config'], entryOwner, context);
  } finally {
    context.configFileChain.pop();
  }
}

// ---------- side panels ----------

function sidePanelKeyBuild(filePath: string, sidePanelId: string): string {
  return `${filePath}#${sidePanelId}`;
}

// chain: the side panels being loaded, outermost first, as keys
function sidePanelLoad(ref: SidePanelRef, context: LoadContext, chain: string[]): SidePanelLoaded {
  const file = fileLoad(ref.file, context, ref.entryOwner);
  const sidePanelId = ref.sidePanelId !== '' ? ref.sidePanelId : sidePanelIdDefaultGet(file, 'a reference');
  const key = sidePanelKeyBuild(file.filePath, sidePanelId);
  const sidePanelLoaded = context.sidePanelByKey.get(key);
  if (sidePanelLoaded) return sidePanelLoaded;
  const cycleIndex = chain.indexOf(key);
  if (cycleIndex >= 0) {
    throw new Error(`[doc-source] side panel include cycle: ${[...chain.slice(cycleIndex), key].join(' -> ')}`);
  }
  const declared = file.content.sidePanelById?.[sidePanelId];
  if (declared === undefined) {
    throw new Error(
      `[doc-source] no side panel "${sidePanelId}" in sidePanelById`
        + ` (declared: ${file.sidePanelIdList.join(', ') || 'none'}): ${file.filePath}`,
    );
  }

  const chainNext = [...chain, key];
  const place = `sidePanelById.${sidePanelId}`;
  let result: SidePanelLoaded;
  if (sidePanelDeclaredIsReference(declared)) {
    result = sidePanelLoad(sidePanelRefParse(declared, file, place), context, chainNext);
  } else {
    result = sidePanelResourceLoad(declared, file, sidePanelId, context, chainNext);
  }
  context.sidePanelByKey.set(key, result);
  return result;
}

// a value of sidePanelById is a resource ({ root?, tree }) or a reference
// (a string, or { file?, sidePanel? })
function sidePanelDeclaredIsReference(declared: any): boolean {
  if (typeof declared === 'string') return true;
  return mappingIs(declared) && declared.tree === undefined && declared.root === undefined;
}

function sidePanelRefParse(value: any, fileFrom: DocYamlFile, place: string): SidePanelRef {
  const fileDir = path.dirname(fileFrom.filePath);
  if (typeof value === 'string') {
    if (!value.trim()) {
      throw new Error(`[doc-source] ${place}: a side panel reference must not be empty: ${fileFrom.filePath}`);
    }
    return { file: entryPathResolve(path.resolve(fileDir, value)), sidePanelId: '', entryOwner: fileFrom.entryOwner };
  }
  if (!mappingIs(value)) {
    throw new Error(
      `[doc-source] ${place}: a side panel reference is a file path or { file?, sidePanel? }: ${fileFrom.filePath}`,
    );
  }
  for (const key of Object.keys(value)) {
    if (key !== 'file' && key !== 'sidePanel') {
      throw new Error(`[doc-source] ${place}: unknown key "${key}" in a side panel reference: ${fileFrom.filePath}`);
    }
  }
  if (value.file === undefined && value.sidePanel === undefined) {
    throw new Error(`[doc-source] ${place}: a side panel reference needs "file" or "sidePanel": ${fileFrom.filePath}`);
  }
  if (value.file !== undefined && (typeof value.file !== 'string' || !value.file.trim())) {
    throw new Error(`[doc-source] ${place}: "file" of a side panel reference must be a path: ${fileFrom.filePath}`);
  }
  if (value.sidePanel !== undefined && (typeof value.sidePanel !== 'string' || !value.sidePanel.trim())) {
    throw new Error(`[doc-source] ${place}: "sidePanel" of a side panel reference must be an id: ${fileFrom.filePath}`);
  }
  return {
    file: value.file === undefined ? fileFrom.filePath : entryPathResolve(path.resolve(fileDir, value.file)),
    sidePanelId: value.sidePanel ?? '',
    entryOwner: fileFrom.entryOwner,
  };
}

function sidePanelResourceLoad(
  declared: Record<string, any>,
  file: DocYamlFile,
  sidePanelId: string,
  context: LoadContext,
  chain: string[],
): SidePanelLoaded {
  const place = `sidePanelById.${sidePanelId}`;
  for (const key of Object.keys(declared)) {
    if (key !== 'root' && key !== 'tree') {
      throw new Error(`[doc-source] ${place}: a side panel is { root?, tree }; unknown key "${key}": ${file.filePath}`);
    }
  }
  if (!Array.isArray(declared.tree)) {
    throw new Error(`[doc-source] ${place}: a side panel must contain a "tree" list: ${file.filePath}`);
  }
  // optional "root": properties applied to the node that includes this side
  // panel. never a visible child item.
  const root = declared.root;
  if (root !== undefined) {
    if (!mappingIs(root)) {
      throw new Error(`[doc-source] ${place}: "root" must be a mapping: ${file.filePath}`);
    }
    if (root.children !== undefined || root.include !== undefined) {
      throw new Error(
        `[doc-source] ${place}: "root" must not contain "children" or "include"`
          + ` (children belong to the "tree" list): ${file.filePath}`,
      );
    }
  }

  const fileRelative = fileRelativeGet(file.filePath, context.configDir);
  const addressResource = ['sidePanelById', sidePanelId];
  const treeSource = { file: fileRelative, path: [...addressResource, 'tree'] };
  const tree = nodesLoad(declared.tree, file, context, chain, treeSource);
  const rootTextSource = root === undefined ? undefined : { file: fileRelative, path: [...addressResource, 'root'] };
  return { root, rootTextSource, treeSource, tree };
}

// addressList: file and yaml address of the list these nodes are read from
function nodesLoad(
  nodes: any[],
  file: DocYamlFile,
  context: LoadContext,
  chain: string[],
  addressList: SidePanelTextSource,
): any[] {
  return nodes.map((node, index) => {
    if (!mappingIs(node)) return node;
    const placeNode = `${file.filePath} ${addressList.path.join('.')}[${index}]`;
    if (node.childrenFile !== undefined) {
      throw new Error(
        `[doc-source] "childrenFile" was replaced by "include" (a side panel reference) at ${placeNode}`,
      );
    }

    const { include, ...nodeResult } = node;
    const addressNode: SidePanelTextSource = { file: addressList.file, path: [...addressList.path, index] };
    const childrenLocal = node.children;
    if (childrenLocal !== undefined && !Array.isArray(childrenLocal)) {
      throw new Error(`[doc-source] side panel "children" must be a list at ${placeNode}`);
    }

    let childrenIncluded: any[] = [];
    let rootIncluded: Record<string, any> = {};
    let rootTextSourceIncluded: SidePanelTextSource | undefined;
    let includeSource: SidePanelIncludeSource | undefined;
    if (include !== undefined) {
      const ref = sidePanelRefParse(include, file, `"include" at ${placeNode}`);
      const included = sidePanelLoad(ref, context, chain);
      childrenIncluded = included.tree;
      rootIncluded = included.root ?? {};
      rootTextSourceIncluded = included.rootTextSource;
      // a sub document: the entry of another document, not a side panel of
      // this file nor of a resource file
      const isDocEntry = ref.file !== file.filePath && fileLoad(ref.file, context, ref.entryOwner).isEntry;
      includeSource = {
        ...included.treeSource,
        isDocEntry,
        isChildrenLocal: Array.isArray(childrenLocal) && childrenLocal.length > 0,
      };
    }

    const childrenLoaded = Array.isArray(childrenLocal)
      ? nodesLoad(childrenLocal, file, context, chain, { ...addressNode, path: [...addressNode.path, 'children'] })
      : [];
    // the included root applies to this node; explicit local properties win
    const nodeMerged = { ...rootIncluded, ...nodeResult };
    if (include !== undefined || childrenLocal !== undefined) {
      nodeMerged.children = [...childrenIncluded, ...childrenLoaded];
    }
    // the label is written where page-tree.js reads it from: the node's own
    // "text" when it has one, else the included root's "text", else the node
    // itself (a "text" would be added there)
    const isTextFromRoot = nodeResult.text === undefined && rootIncluded.text !== undefined;
    nodeMerged.textSource = isTextFromRoot && rootTextSourceIncluded ? rootTextSourceIncluded : addressNode;
    nodeMerged.nodeSource = addressNode;
    if (includeSource) nodeMerged.includeSource = includeSource;
    return nodeMerged;
  });
}

// ---------- helpers ----------

// document yaml files are named relative to the config directory, with "/"
function fileRelativeGet(filePath: string, configDir: string): string {
  return path.relative(configDir, filePath).split(path.sep).join('/');
}

function mappingIs(value: any): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readYaml(filePath: string): any {
  if (!fs.existsSync(filePath)) return undefined;
  return parseYaml(fs.readFileSync(filePath, 'utf-8'));
}
