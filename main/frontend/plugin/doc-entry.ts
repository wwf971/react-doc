import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { textHashGet } from './doc-edit-lines.ts';
import { sourceAliasIsValid, sourcePathFullGet, sourcePathIsRooted } from '../src/lib/doc-source-path.js';
import { excludePatternTextListRead } from './doc-source-exclude.ts';
import { sidePanelEffectiveGet, sidePanelRootHiddenApply } from './doc-sidebar-effective.ts';

// The workspace, its doc pages, the entry of each and the yaml files it reaches.
// design: doc_page_impl_source.md#the-workspace, doc_page_impl_side_panel.md#the-document-entry
//
// a workspace is what one deployment (or the development server) serves:
// a list of root-level doc pages, each with an alias unique in the
// workspace. config.yaml names it ("workspace", docWorkspaceLoad), or names
// one doc page ("docEntry"): a virtual workspace holding that doc page
// alone (docEntryLoad). every doc page has one entry file, named directly
// or found in the doc page folder (docEntryFileFind: .doc-page/entry.yaml
// by convention, design: doc_page_impl_dir.md). the entry file and every
// yaml file it reaches share one grammar, the document yaml file:
//
//   docEntry:                # marks the file as the entry of a doc page;
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
//   service:                 # optional, an entry only: the service folders of the doc page,
//                            #   { file: ./service.yaml } | false (none); absent: service.yaml
//                            #   beside the entry, else the convention folders (doc-service-server.ts)
//   comp:                    # optional, an entry only: the component folders of the doc page,
//                            #   { file: ./comp.yaml } | false (none); absent: comp.yaml beside
//                            #   the entry, else comp-mdx/ of the doc page (doc-comp-config.ts)
//   sidePanelDefault: main   # optional when the file declares one side panel
//   sidePanelById:
//     main: { root?, tree }          # a side panel resource
//     other: { file?, sidePanel? }   # a reference to a side panel declared elsewhere
//
// a reference to a doc page (a workspace item, docEntry.dir, an "include"
// path) may name the folder of the doc page instead of its entry file.
//
// a side-panel reference names one side panel. a string is a file path (or
// the folder of a doc page: its entry) and means the default side panel of
// that file; a mapping names the file ("file" or "dir"; the file holding
// the reference when absent), the side panel id ("sidePanel", that file's
// default when absent) and, when the file is the entry of another doc
// page, the alias that doc page gets in the workspace ("alias"; its folder
// name when absent). the "include" property of a tree node and the alias
// values of sidePanelById are references.
//
// a doc page is one thing however often it is reached (its entry file is
// its identity): its files load once, its alias is the one of its first
// mention, root-level mentions first; a later mention with another alias
// is reported (warningList) and ignored. two doc pages with one alias, and
// two roots of one doc page with one alias, are errors.
//
// loading a file loads everything in it: its source rules are appended once
// (each carrying the alias of its doc page), its tag definitions are merged
// (a file loaded earlier wins), its config declarations are recorded, and
// every side panel is resolved with its includes. the entry is loaded
// first, so its rules come first, followed by the rules of included files
// in order of appearance. every node of every side panel is annotated for
// the page with docPageAlias (the doc page it is written in, so a local
// path in it resolves there) and for the edit layer with the file
// (relative to the config directory) and yaml address of
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
  // the alias of the included doc page (isDocEntry only)
  docPageAlias?: string;
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
  // config directory, and its alias
  entryFile: string;
  docPageAlias: string;
};

// a root of a doc page: an add rule of its source rules
export type DocPageRoot = {
  alias: string;
  // the folder of the root (for addFile, the folder of the file), absolute
  path: string;
  // the path the rule names, absolute
  pathRule: string;
  kind: 'folder' | 'file';
};

// where a doc page is mentioned: the workspace (fromEntryFile '') or a
// reference in a file of another doc page
export type DocPageMention = {
  alias: string;
  isAliasGiven: boolean;
  // the entry of the doc page the mention is written in, absolute; '' for
  // the workspace
  fromEntryFile: string;
  // the file holding the mention, absolute ('' for the workspace), and the
  // place in it, for messages
  file: string;
  place: string;
};

// one doc page the workspace loads: a root-level one, and every one
// reached through includes, in order of first loading
export type DocPageLoaded = {
  // the alias of the doc page, unique in the workspace
  alias: string;
  // absolute
  entryFile: string;
  // the folder of the doc page: the parent of .doc-page/, or the entry's folder
  dirPage: string;
  title: string;
  // named by the workspace (or the only doc page of a virtual one)
  isRoot: boolean;
  // mounted from the settings panel for as long as the development server
  // runs, not written in any file (a root doc page)
  isTemporary: boolean;
  rootList: DocPageRoot[];
  mentionList: DocPageMention[];
  // "asset", "service" and "comp" of the entry as written: undefined (the
  // convention), false (none), or { file } (relative to the entry)
  asset: EntryFileSection;
  service: EntryFileSection;
  comp: EntryFileSection;
};

// a section of the entry that names a config file of the doc page, or
// switches the feature off: undefined (the convention file beside the
// entry, or the defaults without it), false (none), { file } (another file)
export type EntryFileSection = undefined | false | { file: string };

// a doc page of the workspace as the page receives it (paths relative to
// the config directory, no absolute path)
export type DocPageInfo = {
  alias: string;
  entryFile: string;
  dirPage: string;
  title: string;
  isRoot: boolean;
  isTemporary: boolean;
  rootList: { alias: string; path: string; kind: 'folder' | 'file' }[];
  mentionList: { alias: string; isAliasGiven: boolean; fromAlias: string; file: string; place: string }[];
};

// the workspace as the page receives it (configDoc.workspace)
export type DocWorkspaceInfo = {
  // config.yaml named one doc page (docEntry), not a workspace
  isVirtual: boolean;
  title: string;
  // the workspace file, relative to the config directory ('' when the
  // workspace is written in config.yaml or is virtual), its content hash,
  // and its items as written there (paths relative to the file), for the
  // Workspace tab to edit (doc-workspace-edit.ts)
  file: string;
  fileHash: string;
  itemList: { alias?: string; dir?: string; file?: string; sidePanel?: string; isRootVisible?: boolean }[];
  // the folder relative paths of the workspace are read from, absolute: the
  // workspace file's, else the config directory. the os path completion of
  // the Workspace tab starts there
  dirBaseAbs: string;
  docPageList: DocPageInfo[];
  // every mention as an edge: from the workspace ('') or a doc page, to a doc page
  includeList: { fromAlias: string; toAlias: string; alias: string; isAliasGiven: boolean; file: string; place: string }[];
  warningList: string[];
};

// what config.yaml says about the workspace, normalized
export type DocWorkspaceSpec = {
  isVirtual: boolean;
  title?: string;
  homeDoc?: string;
  homeItem?: string;
  // isTemporary: mounted from the settings panel, after the doc pages written.
  // isRootVisible false: the sole wrapper item of the side panel shown
  // for the doc page is not drawn as a row (doc-sidebar-effective.ts)
  docPageList: { alias?: string; dir?: string; file?: string; sidePanel?: string; isRootVisible?: boolean; isTemporary?: boolean }[];
  // the file the spec was read from, absolute, when it is a workspace file;
  // its content hash and its items as written
  file?: string;
  fileHash?: string;
  itemListWritten?: { alias?: string; dir?: string; file?: string; sidePanel?: string; isRootVisible?: boolean }[];
  // the folder the paths of the items are relative to, absolute
  dirBase?: string;
};

export type DocWorkspaceLoaded = {
  // page values: the workspace's, else the first root doc page's
  entry: DocEntryInfo;
  // the first root doc page's entry file, absolute, and the side panel shown
  entryFile: string;
  sidePanelId: string;
  sidePanelIdList: string[];
  sidePanel: SidePanelLoaded | undefined;
  // every rule, paths relative to the config directory, each with docPageAlias
  sourceRuleList: any[];
  tagDefineById: Record<string, any>;
  // the doc page config layer: every config declaration, in stack order
  // (a later one wins): the documents included last first, the root doc
  // pages last (the first root last); within one document in the order read
  configDeclarationList: ConfigDeclaration[];
  // the variables the config files declare, in the same order merged
  variableByName: Record<string, string>;
  // the doc pages loaded, the root ones first
  docPageList: DocPageLoaded[];
  workspace: DocWorkspaceInfo;
  // every yaml file read, absolute, the entry file first
  fileListLoaded: string[];
  // the content hash (doc-edit-lines.ts textHashGet) of every document yaml
  // file as it was loaded, by file relative to the config directory: an edit
  // of a side panel's structure is refused when a file changed since
  fileHashByFile: Record<string, string>;
};

// the shape docEntryLoad returned before workspaces; kept as the same type
export type DocEntryLoaded = DocWorkspaceLoaded;

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
  // the alias given to the doc page the file is the entry of ('' when none given)
  alias: string;
  // where the reference is written, for the mention of the doc page
  fileFrom: string;
  place: string;
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
  warningList: string[];
};

const FILE_KEY_LIST = ['docEntry', 'source', 'tag', 'config', 'asset', 'service', 'comp', 'sidePanelDefault', 'sidePanelById'];
// the sections an entry alone may hold: each names a config file of the doc
// page (or switches the feature off), found beside the entry by convention
const ENTRY_FILE_SECTION_KEY_LIST = ['asset', 'service', 'comp'] as const;
const CONFIG_FILE_KEY_LIST = ['config', 'variable'];
const WORKSPACE_FILE_KEY_LIST = ['title', 'homeDoc', 'homeItem', 'docPageList'];
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

// the folder of a doc page from its entry: the parent of .doc-page/, or the
// folder of the entry
export function docPageDirGet(entryFile: string): string {
  const dirEntry = path.dirname(entryFile);
  return path.basename(dirEntry) === DOC_PAGE_META_DIR_NAME ? path.dirname(dirEntry) : dirEntry;
}

// the alias a doc page gets when none is given: the name of its folder
export function docPageAliasDefaultGet(entryFile: string): string {
  return path.basename(docPageDirGet(entryFile));
}

// ---------- the workspace ----------

// the workspace file (design: doc_page_impl_source.md#the-workspace-file):
//   title: ...               # optional page values, over those of the first doc page
//   homeDoc: ~page:root/a.md
//   homeItem: ...
//   docPageList:             # the root-level doc pages, in side-panel order
//     - alias: guide         # unique in the workspace; the folder name when absent
//       dir: ../guide        # the doc page folder, or "file": its entry file
//       sidePanel: main      # optional: the side panel shown for it
//       isRootVisible: false # optional: its sole wrapper item shows its children only
export function docWorkspaceSpecRead(workspace: any, configDir: string, configFile: string): DocWorkspaceSpec {
  let content = workspace;
  let fileWorkspace: string | undefined;
  let fileHash: string | undefined;
  let dirBase = configDir;
  const placeConfig = `config "workspace" (${configFile})`;
  if (!mappingIs(content)) throw new Error(`[doc-source] ${placeConfig} must be { file } or { docPageList, title?, homeDoc?, homeItem? }`);
  if (content.file !== undefined) {
    if (typeof content.file !== 'string' || !content.file.trim() || Object.keys(content).length !== 1) {
      throw new Error(`[doc-source] ${placeConfig}: "file" names the workspace file and stands alone`);
    }
    fileWorkspace = path.resolve(configDir, content.file);
    content = readYaml(fileWorkspace);
    if (content !== undefined) fileHash = textHashGet(fs.readFileSync(fileWorkspace, 'utf-8'));
    if (content === undefined) throw new Error(`[doc-source] workspace file not found: ${fileWorkspace}`);
    if (!mappingIs(content)) throw new Error(`[doc-source] the workspace file must be a mapping: ${fileWorkspace}`);
    dirBase = path.dirname(fileWorkspace);
  }
  const place = fileWorkspace ?? placeConfig;
  for (const key of Object.keys(content)) {
    if (!WORKSPACE_FILE_KEY_LIST.includes(key)) {
      throw new Error(`[doc-source] unknown key "${key}" in the workspace (known: ${WORKSPACE_FILE_KEY_LIST.join(', ')}): ${place}`);
    }
  }
  if (!Array.isArray(content.docPageList) || content.docPageList.length === 0) {
    throw new Error(`[doc-source] the workspace needs "docPageList", a list of its root-level doc pages: ${place}`);
  }
  const spec: DocWorkspaceSpec = {
    isVirtual: false,
    docPageList: [],
    file: fileWorkspace,
    fileHash,
    dirBase,
    // the items as written: the strings of each, for the Workspace tab
    itemListWritten: content.docPageList.map((item: any) => {
      const written: Record<string, string | boolean> = {};
      for (const key of ['alias', 'dir', 'file', 'sidePanel']) {
        if (typeof item?.[key] === 'string') written[key] = item[key];
      }
      if (typeof item?.isRootVisible === 'boolean') written.isRootVisible = item.isRootVisible;
      return written;
    }),
  };
  for (const key of ['title', 'homeDoc', 'homeItem'] as const) {
    if (content[key] === undefined) continue;
    if (typeof content[key] !== 'string') throw new Error(`[doc-source] workspace "${key}" must be a string: ${place}`);
    spec[key] = content[key];
  }
  content.docPageList.forEach((item: any, index: number) => {
    spec.docPageList.push(docPageSpecRead(item, dirBase, `${place} docPageList[${index}]`));
  });
  return spec;
}

// one doc page named by the workspace or by config docEntry:
// { alias?, dir | file, sidePanel?, isRootVisible? }
export function docPageSpecRead(item: any, dirBase: string, place: string): DocWorkspaceSpec['docPageList'][number] {
  if (!mappingIs(item)) throw new Error(`[doc-source] ${place}: a doc page is { alias?, dir | file, sidePanel?, isRootVisible? }`);
  for (const key of Object.keys(item)) {
    if (!['alias', 'dir', 'file', 'sidePanel', 'isRootVisible'].includes(key)) {
      throw new Error(`[doc-source] ${place}: unknown key "${key}" of a doc page (known: alias, dir, file, sidePanel, isRootVisible)`);
    }
  }
  if (item.isRootVisible !== undefined && typeof item.isRootVisible !== 'boolean') {
    throw new Error(
      `[doc-source] ${place}: "isRootVisible" must be a yaml boolean, true or false (not the text ${JSON.stringify(item.isRootVisible)})`,
    );
  }
  const isFileGiven = typeof item.file === 'string' && item.file.trim() !== '';
  const isDirGiven = typeof item.dir === 'string' && item.dir.trim() !== '';
  if (isFileGiven === isDirGiven) {
    throw new Error(
      `[doc-source] ${place}: a doc page names either "dir", its folder (the entry is found in ${DOC_PAGE_META_DIR_NAME}/),`
        + ' or "file", its entry file',
    );
  }
  if (item.sidePanel !== undefined && typeof item.sidePanel !== 'string') {
    throw new Error(`[doc-source] ${place}: "sidePanel" must be a side panel id`);
  }
  if (item.alias !== undefined && !sourceAliasIsValid(item.alias)) {
    throw new Error(`[doc-source] ${place}: "alias" must be one word (letters, digits, "_", "-", "."): ${JSON.stringify(item.alias)}`);
  }
  return {
    alias: item.alias,
    dir: isDirGiven ? path.resolve(dirBase, item.dir) : undefined,
    file: isFileGiven ? path.resolve(dirBase, item.file) : undefined,
    sidePanel: item.sidePanel,
    isRootVisible: item.isRootVisible,
  };
}

// one doc page as the workspace: what config docEntry names (the former
// form, kept): a virtual workspace holding it alone
export function docEntryLoad(entryFile: string, configDir: string, sidePanelIdWanted = '', alias?: string, isRootVisible?: boolean): DocEntryLoaded {
  return docWorkspaceLoad({
    isVirtual: true,
    docPageList: [{ alias, file: path.resolve(entryFile), sidePanel: sidePanelIdWanted || undefined, isRootVisible }],
  }, configDir);
}

export function docWorkspaceLoad(spec: DocWorkspaceSpec, configDir: string): DocWorkspaceLoaded {
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
    warningList: [],
  };
  const placeWorkspace = spec.file ?? (spec.isVirtual ? 'config docEntry' : 'config workspace');

  // the root-level doc pages are registered before anything loads, so their
  // aliases win over the ones an include gives
  const entryFileRootList: string[] = [];
  spec.docPageList.forEach((item, index) => {
    const entryFile = entryPathResolve(item.dir ?? item.file ?? '');
    let place = spec.isVirtual ? placeWorkspace : `${placeWorkspace} docPageList[${index}]`;
    if (item.isTemporary) place = 'a temporary mount (settings panel, Workspace tab)';
    if (entryFileRootList.includes(entryFile)) {
      throw new Error(`[doc-source] ${place} names a doc page the workspace holds already: ${entryFile}`);
    }
    entryFileRootList.push(entryFile);
    const docPage = docPageRegister(entryFile, {
      alias: item.alias ?? docPageAliasDefaultGet(entryFile),
      isAliasGiven: item.alias !== undefined,
      fromEntryFile: '',
      file: item.isTemporary ? '' : spec.file ?? '',
      place,
    }, true, context);
    docPage.isTemporary = item.isTemporary === true;
  });

  // load every root doc page; the first one's files come first
  const fileRootList = entryFileRootList.map((entryFile) => fileLoad(entryFile, context, '', undefined));
  fileRootList.forEach((file, index) => {
    if (!file.isEntry) {
      throw new Error(`[doc-source] the file named by ${placeWorkspace} is not an entry: it must declare "docEntry": ${file.filePath}`);
    }
    const sidePanelIdWanted = spec.docPageList[index].sidePanel ?? '';
    if (sidePanelIdWanted !== '' && !file.sidePanelIdList.includes(sidePanelIdWanted)) {
      throw new Error(
        `[doc-source] ${placeWorkspace} names the side panel "${sidePanelIdWanted}", which the entry does not declare`
          + ` (declared: ${file.sidePanelIdList.join(', ') || 'none'}): ${file.filePath}`,
      );
    }
  });

  // the side panel shown: of one root doc page, its own; of several, one
  // section per root doc page holding its side panel: the alias as a muted
  // heading above the tree (docPageSection, drawn by DocSidebarFolder), not
  // a folder of the tree
  const sidePanelOfRoot = (file: DocYamlFile, index: number): { id: string; sidePanel: SidePanelLoaded | undefined } => {
    const sidePanelIdWanted = spec.docPageList[index].sidePanel ?? '';
    let id = '';
    if (sidePanelIdWanted !== '') id = sidePanelIdWanted;
    else if (file.sidePanelIdList.length > 0) id = sidePanelIdDefaultGet(file, placeWorkspace);
    return { id, sidePanel: id === '' ? undefined : context.sidePanelByKey.get(sidePanelKeyBuild(file.filePath, id)) };
  };
  //
  // the tree shown is then projected (doc-sidebar-effective.ts): a doc page
  // has one effective occurrence (its mount, else the first include reached;
  // later includes are shielded with their subtree), and a mount with
  // isRootVisible false shows the children of its sole wrapper item without
  // the wrapper's row. the cached side panels are not touched: the
  // projection clones what it keeps.
  const aliasRootList = entryFileRootList.map((entryFile) => context.docPageByEntryFile.get(entryFile)!.alias);
  const treeOfRootGet = (sidePanelRoot: SidePanelLoaded | undefined, index: number): any[] => {
    const tree = sidePanelRoot?.tree ?? [];
    return spec.docPageList[index].isRootVisible === false ? sidePanelRootHiddenApply(tree) : tree;
  };
  const fileFirst = fileRootList[0];
  const { id: sidePanelId, sidePanel: sidePanelFirst } = sidePanelOfRoot(fileFirst, 0);
  let sidePanel: SidePanelLoaded | undefined;
  if (fileRootList.length > 1) {
    const tree = fileRootList.map((file, index) => {
      const docPage = context.docPageByEntryFile.get(file.filePath)!;
      const { sidePanel: sidePanelRoot } = sidePanelOfRoot(file, index);
      // the root properties that reach the documents (tags, config) are
      // kept; the label and the bound document are the alias heading's
      const { doc: _doc, text: _text, ...root } = rootPropsFullGet(sidePanelRoot?.root ?? {}, docPage.alias);
      const node: Record<string, any> = {
        ...root,
        id: `doc-page-${docPage.alias}`,
        text: docPage.alias,
        children: treeOfRootGet(sidePanelRoot, index),
        docPageAlias: docPage.alias,
        docPageSection: { alias: docPage.alias, title: docPage.title, isTemporary: docPage.isTemporary, isFirst: index === 0 },
      };
      if (sidePanelRoot) {
        node.includeSource = { ...sidePanelRoot.treeSource, isDocEntry: true, docPageAlias: docPage.alias, isChildrenLocal: false };
      }
      return node;
    });
    sidePanel = { treeSource: { file: '', path: [] }, tree: sidePanelEffectiveGet(tree, aliasRootList) };
  } else if (sidePanelFirst) {
    sidePanel = { ...sidePanelFirst, tree: sidePanelEffectiveGet(treeOfRootGet(sidePanelFirst, 0), aliasRootList) };
  }

  const fileHashByFile: Record<string, string> = {};
  for (const fileLoaded of context.fileByPath.values()) {
    fileHashByFile[fileRelativeGet(fileLoaded.filePath, configDir)] = fileLoaded.contentHash;
  }

  // the doc page config layer: the documents included last first, so a
  // root doc page decides over what it includes (as for tags)
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

  const docPageList = context.entryFileList.map((entryFile) => context.docPageByEntryFile.get(entryFile)!);
  const docPageFirst = docPageList[0];
  const entry: DocEntryInfo = {
    title: spec.title ?? fileFirst.entry.title,
    homeDoc: spec.homeDoc !== undefined
      ? sourcePathFullGet(spec.homeDoc, docPageFirst.alias)
      : fileFirst.entry.homeDoc === undefined ? undefined : sourcePathFullGet(fileFirst.entry.homeDoc, docPageFirst.alias),
    homeItem: spec.homeItem ?? fileFirst.entry.homeItem,
  };
  for (const warning of context.warningList) console.warn(`[doc-source] ${warning}`);

  return {
    entry,
    entryFile: fileFirst.filePath,
    sidePanelId,
    sidePanelIdList: fileFirst.sidePanelIdList,
    sidePanel,
    sourceRuleList: context.sourceRuleList,
    tagDefineById: context.tagDefineById,
    configDeclarationList,
    variableByName,
    docPageList,
    workspace: workspaceInfoBuild(spec, docPageList, entry.title ?? '', context),
    fileListLoaded: context.fileListLoaded,
    fileHashByFile,
  };
}

// the workspace as data for the page: the doc pages, every mention as an
// edge, the warnings
function workspaceInfoBuild(spec: DocWorkspaceSpec, docPageList: DocPageLoaded[], title: string, context: LoadContext): DocWorkspaceInfo {
  const aliasOfEntry = (entryFile: string) => (entryFile === '' ? '' : context.docPageByEntryFile.get(entryFile)?.alias ?? '');
  const relative = (filePath: string) => (filePath === '' ? '' : fileRelativeGet(filePath, context.configDir));
  const docPageInfoList: DocPageInfo[] = docPageList.map((docPage) => ({
    alias: docPage.alias,
    entryFile: relative(docPage.entryFile),
    dirPage: relative(docPage.dirPage) || '.',
    title: docPage.title,
    isRoot: docPage.isRoot,
    isTemporary: docPage.isTemporary,
    rootList: docPage.rootList.map((root) => ({ alias: root.alias, path: relative(root.pathRule) || '.', kind: root.kind })),
    mentionList: docPage.mentionList.map((mention) => ({
      alias: mention.alias,
      isAliasGiven: mention.isAliasGiven,
      fromAlias: aliasOfEntry(mention.fromEntryFile),
      file: relative(mention.file),
      place: mention.place,
    })),
  }));
  const includeList: DocWorkspaceInfo['includeList'] = [];
  for (const docPage of docPageInfoList) {
    for (const mention of docPage.mentionList) {
      includeList.push({ fromAlias: mention.fromAlias, toAlias: docPage.alias, alias: mention.alias, isAliasGiven: mention.isAliasGiven, file: mention.file, place: mention.place });
    }
  }
  return {
    isVirtual: spec.isVirtual,
    title,
    file: spec.file ? relative(spec.file) : '',
    fileHash: spec.fileHash ?? '',
    itemList: spec.itemListWritten ?? [],
    dirBaseAbs: spec.dirBase ?? context.configDir,
    docPageList: docPageInfoList,
    includeList,
    warningList: [...context.warningList],
  };
}

// ---------- doc pages ----------

// a doc page mentioned: registered at its first mention with that alias; a
// later mention adds itself, and its alias is checked against the one kept
function docPageRegister(entryFile: string, mention: DocPageMention, isRoot: boolean, context: LoadContext): DocPageLoaded {
  const docPageExisting = context.docPageByEntryFile.get(entryFile);
  if (docPageExisting) {
    docPageExisting.mentionList.push(mention);
    if (mention.alias !== docPageExisting.alias) {
      const mentionFirst = docPageExisting.mentionList[0];
      context.warningList.push(
        `the doc page ${fileRelativeGet(entryFile, context.configDir)} is mentioned as "${mention.alias}" at ${mentionPlaceGet(mention, context)},`
          + ` but is "${docPageExisting.alias}" already (${mentionPlaceGet(mentionFirst, context)}); "${docPageExisting.alias}" is used`,
      );
    }
    return docPageExisting;
  }
  if (!sourceAliasIsValid(mention.alias)) {
    throw new Error(`[doc-source] ${mentionPlaceGet(mention, context)}: the alias of a doc page must be one word (letters, digits, "_", "-", "."): ${JSON.stringify(mention.alias)}`);
  }
  for (const docPageOther of context.docPageByEntryFile.values()) {
    if (docPageOther.alias !== mention.alias) continue;
    throw new Error(
      `[doc-source] ${mentionPlaceGet(mention, context)}: the alias "${mention.alias}" names the doc page ${fileRelativeGet(docPageOther.entryFile, context.configDir)} already`
        + ` (${mentionPlaceGet(docPageOther.mentionList[0], context)}); give ${fileRelativeGet(entryFile, context.configDir)} another alias`,
    );
  }
  const docPage: DocPageLoaded = {
    alias: mention.alias,
    entryFile,
    dirPage: docPageDirGet(entryFile),
    title: '',
    isRoot,
    isTemporary: false,
    rootList: [],
    mentionList: [mention],
    asset: undefined,
    service: undefined,
    comp: undefined,
  };
  context.docPageByEntryFile.set(entryFile, docPage);
  return docPage;
}

// where a mention is written, for a message: "{file} {place}"
function mentionPlaceGet(mention: DocPageMention, context: LoadContext): string {
  return mention.file === '' ? mention.place : `${fileRelativeGet(mention.file, context.configDir)} ${mention.place}`;
}

// the alias of the doc page a file belongs to
function docPageAliasOfFile(file: DocYamlFile, context: LoadContext): string {
  return context.docPageByEntryFile.get(file.entryOwner)?.alias ?? '';
}

// ---------- files ----------

// entryOwnerFrom: the entry of the file that reaches this one ('' for a root
// entry); mention: how the file is mentioned, when the reference may name
// the entry of another doc page
function fileLoad(filePath: string, context: LoadContext, entryOwnerFrom: string, mention: DocPageMention | undefined): DocYamlFile {
  const filePathResolved = path.resolve(filePath);
  const fileLoaded = context.fileByPath.get(filePathResolved);
  if (fileLoaded) {
    if (fileLoaded.isEntry && mention) docPageRegister(filePathResolved, mention, false, context);
    return fileLoaded;
  }
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
    let docPage = context.docPageByEntryFile.get(filePathResolved);
    if (!docPage && !mention) {
      throw new Error(`[doc-source] the entry of a doc page is reached without a reference naming it: ${filePathResolved}`);
    }
    // a root doc page reached by an include before it loaded: the include
    // is one more mention of it
    if (!docPage) docPage = docPageRegister(filePathResolved, mention!, false, context);
    else if (mention) docPageRegister(filePathResolved, mention, false, context);
    context.entryFileList.push(filePathResolved);
    docPage.title = file.entry.title ?? '';
    for (const key of ENTRY_FILE_SECTION_KEY_LIST) docPage[key] = entryFileSectionRead(content[key], key, filePathResolved);
  } else if (ENTRY_FILE_SECTION_KEY_LIST.some((key) => content[key] !== undefined)) {
    const key = ENTRY_FILE_SECTION_KEY_LIST.find((keyItem) => content[keyItem] !== undefined);
    throw new Error(
      `[doc-source] "${key}" belongs to the entry of a doc page, not to a resource file: ${filePathResolved}`,
    );
  } else if (mention?.isAliasGiven) {
    throw new Error(
      `[doc-source] ${mentionPlaceGet(mention, context)}: "alias" is for the entry of another doc page, and ${filePathResolved} is not an entry`,
    );
  }

  sourceSectionLoad(content.source, file, context);
  tagSectionLoad(content.tag, file, context);
  configSectionLoad(content.config, file.filePath, ['config'], file.entryOwner, context);
  for (const sidePanelId of file.sidePanelIdList) {
    sidePanelLoad({ file: filePathResolved, sidePanelId, entryOwner: file.entryOwner, alias: '', fileFrom: filePathResolved, place: `sidePanelById.${sidePanelId}` }, context, []);
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
// every add rule declares a root by its alias ("alias"; the folder name when
// absent): the first rule with an alias fixes its folder, a later one with
// the same alias names a folder inside it; two different folders with one
// alias are an error. every rule carries the alias of its doc page.

function sourceSectionLoad(source: any, file: DocYamlFile, context: LoadContext) {
  if (source === undefined) return;
  let ruleList: any;
  let ruleDir = path.dirname(file.filePath);
  let placeRules = file.filePath;
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
    placeRules = sourceFile;
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
  const docPage = context.docPageByEntryFile.get(file.entryOwner);
  const docPageAlias = docPage?.alias ?? '';
  const ruleListRebased = ruleList.map((rule: any, index: number) => {
    if (!mappingIs(rule)) throw new Error(`[doc-source] a source rule must be a mapping: ${placeRules} rules[${index}]`);
    if (rule.action !== 'addFolder' && rule.action !== 'addFile') return { ...rule, docPageAlias };
    if (typeof rule.path !== 'string' || !rule.path.trim()) {
      throw new Error(`[doc-source] ${rule.action} needs "path": ${placeRules} rules[${index}]`);
    }
    const pathAbsolute = path.resolve(ruleDir, rule.path);
    const { rootId, alias: aliasGiven, ...ruleRest } = rule;
    if (rootId !== undefined && aliasGiven === undefined) {
      console.warn(`[doc-source] "rootId" of a source rule is now "alias" (the same meaning): ${placeRules} rules[${index}]`);
    }
    const kind = rule.action === 'addFile' ? 'file' : 'folder';
    const pathRoot = kind === 'file' ? path.dirname(pathAbsolute) : pathAbsolute;
    // the alias: as given, else the name of the root folder
    const alias = String(aliasGiven ?? rootId ?? path.basename(pathRoot));
    if (!sourceAliasIsValid(alias)) {
      throw new Error(`[doc-source] the alias of a root must be one word (letters, digits, "_", "-", "."): ${JSON.stringify(alias)} at ${placeRules} rules[${index}]`);
    }
    if (docPage) {
      const rootSame = docPage.rootList.find((root) => root.alias === alias);
      if (rootSame && !pathIsInside(pathRoot, rootSame.path)) {
        throw new Error(
          `[doc-source] two roots of the doc page "${docPageAlias}" share the alias "${alias}": ${rootSame.path} and ${pathRoot}`
            + ` (${placeRules} rules[${index}]); give one of them another alias`,
        );
      }
      if (!rootSame) docPage.rootList.push({ alias, path: pathRoot, pathRule: pathAbsolute, kind });
    }
    const ruleLoaded: Record<string, any> = { ...ruleRest, alias, path: path.relative(context.configDir, pathAbsolute) || '.', docPageAlias };
    // the files and folders the rule does not collect, like a .gitignore
    // (doc-source-exclude.ts): checked here, kept as a list of patterns
    if (rule.exclude !== undefined) {
      if (kind === 'file') throw new Error(`[doc-source] "exclude" belongs to an addFolder rule: ${placeRules} rules[${index}]`);
      ruleLoaded.exclude = excludePatternTextListRead(rule.exclude, `${placeRules} rules[${index}]`);
    }
    return ruleLoaded;
  });
  context.sourceRuleList.push(...ruleListRebased);
}

function pathIsInside(filePath: string, folder: string): boolean {
  const relative = path.relative(folder, filePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

// ---------- asset, service and comp sections ----------
// the config files of the doc page that are found beside the entry by
// convention: the asset store config (doc_page_impl_asset.md), the service
// folders (doc_page_impl_service.md) and the component folders
// (doc_page_impl_mdx_comp.md#components-of-a-doc-page). each is { file },
// relative to the entry, or false for none. absent: {key}.yaml beside the
// entry, read when it exists, the defaults of the feature otherwise

function entryFileSectionRead(value: any, key: string, filePath: string): EntryFileSection {
  if (value === undefined || value === null) return undefined;
  if (value === false) return false;
  if (mappingIs(value) && typeof value.file === 'string' && value.file.trim() !== '' && Object.keys(value).length === 1) {
    return { file: value.file.trim() };
  }
  throw new Error(`[doc-source] "${key}" of an entry is { file: ./${key}.yaml } or false: ${filePath}`);
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
      docPageAlias: context.docPageByEntryFile.get(entryOwner)?.alias ?? '',
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

// the mention a reference makes of the doc page its file is the entry of
function mentionOfRef(ref: SidePanelRef): DocPageMention {
  return {
    alias: ref.alias || docPageAliasDefaultGet(ref.file),
    isAliasGiven: ref.alias !== '',
    fromEntryFile: ref.entryOwner,
    file: ref.fileFrom,
    place: ref.place,
  };
}

// chain: the side panels being loaded, outermost first, as keys
function sidePanelLoad(ref: SidePanelRef, context: LoadContext, chain: string[]): SidePanelLoaded {
  // a reference to the entry of another doc page mentions that doc page;
  // a file of a doc page naming its own entry does not
  const isMention = ref.file !== ref.fileFrom && ref.file !== ref.entryOwner;
  const file = fileLoad(ref.file, context, ref.entryOwner, isMention ? mentionOfRef(ref) : undefined);
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
// (a string, or { file?, dir?, sidePanel?, alias? })
function sidePanelDeclaredIsReference(declared: any): boolean {
  if (typeof declared === 'string') return true;
  return mappingIs(declared) && declared.tree === undefined && declared.root === undefined;
}

function sidePanelRefParse(value: any, fileFrom: DocYamlFile, place: string): SidePanelRef {
  const fileDir = path.dirname(fileFrom.filePath);
  const refBase = { entryOwner: fileFrom.entryOwner, fileFrom: fileFrom.filePath, place };
  if (typeof value === 'string') {
    if (!value.trim()) {
      throw new Error(`[doc-source] ${place}: a side panel reference must not be empty: ${fileFrom.filePath}`);
    }
    return { ...refBase, file: entryPathResolve(path.resolve(fileDir, value)), sidePanelId: '', alias: '' };
  }
  if (!mappingIs(value)) {
    throw new Error(
      `[doc-source] ${place}: a side panel reference is a file path or { file | dir, sidePanel?, alias? }: ${fileFrom.filePath}`,
    );
  }
  for (const key of Object.keys(value)) {
    if (!['file', 'dir', 'sidePanel', 'alias'].includes(key)) {
      throw new Error(`[doc-source] ${place}: unknown key "${key}" in a side panel reference: ${fileFrom.filePath}`);
    }
  }
  if (value.file !== undefined && value.dir !== undefined) {
    throw new Error(`[doc-source] ${place}: a side panel reference names "file" or "dir", not both: ${fileFrom.filePath}`);
  }
  const pathGiven = value.file ?? value.dir;
  if (pathGiven === undefined && value.sidePanel === undefined) {
    throw new Error(`[doc-source] ${place}: a side panel reference needs "file", "dir" or "sidePanel": ${fileFrom.filePath}`);
  }
  if (pathGiven !== undefined && (typeof pathGiven !== 'string' || !pathGiven.trim())) {
    throw new Error(`[doc-source] ${place}: "file" / "dir" of a side panel reference must be a path: ${fileFrom.filePath}`);
  }
  if (value.sidePanel !== undefined && (typeof value.sidePanel !== 'string' || !value.sidePanel.trim())) {
    throw new Error(`[doc-source] ${place}: "sidePanel" of a side panel reference must be an id: ${fileFrom.filePath}`);
  }
  if (value.alias !== undefined && !sourceAliasIsValid(value.alias)) {
    throw new Error(`[doc-source] ${place}: "alias" of a side panel reference must be one word (letters, digits, "_", "-", "."): ${fileFrom.filePath}`);
  }
  if (value.alias !== undefined && pathGiven === undefined) {
    throw new Error(`[doc-source] ${place}: "alias" goes with "file" / "dir", the entry of another doc page: ${fileFrom.filePath}`);
  }
  if (value.dir !== undefined) {
    const dirResolved = path.resolve(fileDir, value.dir);
    if (!fs.existsSync(dirResolved) || !fs.statSync(dirResolved).isDirectory()) {
      throw new Error(`[doc-source] ${place}: "dir" must name the folder of a doc page: ${dirResolved} (${fileFrom.filePath})`);
    }
  }
  return {
    ...refBase,
    file: pathGiven === undefined ? fileFrom.filePath : entryPathResolve(path.resolve(fileDir, pathGiven)),
    sidePanelId: value.sidePanel ?? '',
    alias: value.alias ?? '',
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
  // the root's paths are written in its own doc page: made full here, since
  // the root is merged onto a node of another doc page
  return { root: root === undefined ? undefined : rootPropsFullGet(root, docPageAliasOfFile(file, context)), rootTextSource, treeSource, tree };
}

// the keys of a side-panel node that hold a source path
const NODE_PATH_KEY_LIST = ['doc', 'sourceFolder'];

// a node's local source paths in the full form of its doc page; sourceRoot
// (a root alias) becomes the folder of that root
function rootPropsFullGet(node: Record<string, any>, docPageAlias: string): Record<string, any> {
  const result = { ...node };
  for (const key of NODE_PATH_KEY_LIST) {
    if (typeof result[key] === 'string' && sourcePathIsRooted(result[key])) result[key] = sourcePathFullGet(result[key], docPageAlias);
  }
  if (result.sourceRoot !== undefined && result.sourceFolder === undefined) {
    const { sourceRoot, ...rest } = result;
    return { ...rest, sourceFolder: sourcePathFullGet(`~${String(sourceRoot)}`, docPageAlias) };
  }
  return result;
}

// addressList: file and yaml address of the list these nodes are read from
function nodesLoad(
  nodes: any[],
  file: DocYamlFile,
  context: LoadContext,
  chain: string[],
  addressList: SidePanelTextSource,
): any[] {
  const docPageAlias = docPageAliasOfFile(file, context);
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
      const ref = sidePanelRefParse(include, file, `"include" at ${addressList.path.join('.')}[${index}]`);
      const included = sidePanelLoad(ref, context, chain);
      childrenIncluded = included.tree;
      rootIncluded = included.root ?? {};
      rootTextSourceIncluded = included.rootTextSource;
      // a sub document: the entry of another document, not a side panel of
      // this file nor of a resource file
      const fileIncluded = ref.file !== file.filePath ? context.fileByPath.get(ref.file) : undefined;
      const isDocEntry = fileIncluded?.isEntry === true;
      includeSource = {
        ...included.treeSource,
        isDocEntry,
        isChildrenLocal: Array.isArray(childrenLocal) && childrenLocal.length > 0,
      };
      if (isDocEntry) includeSource.docPageAlias = context.docPageByEntryFile.get(ref.file)?.alias ?? '';
    }

    const childrenLoaded = Array.isArray(childrenLocal)
      ? nodesLoad(childrenLocal, file, context, chain, { ...addressNode, path: [...addressNode.path, 'children'] })
      : [];
    // the included root applies to this node; explicit local properties win.
    // the node's own paths are local to this file's doc page, the root's
    // were made full when its side panel loaded
    const nodeMerged = { ...rootIncluded, ...rootPropsFullGet(nodeResult, docPageAlias) };
    if (include !== undefined || childrenLocal !== undefined) {
      nodeMerged.children = [...childrenIncluded, ...childrenLoaded];
    }
    // the label is written where page-tree.js reads it from: the node's own
    // "text" when it has one, else the included root's "text", else the node
    // itself (a "text" would be added there)
    const isTextFromRoot = nodeResult.text === undefined && rootIncluded.text !== undefined;
    nodeMerged.textSource = isTextFromRoot && rootTextSourceIncluded ? rootTextSourceIncluded : addressNode;
    nodeMerged.nodeSource = addressNode;
    nodeMerged.docPageAlias = docPageAlias;
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
