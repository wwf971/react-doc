import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

// The entry of a document and the yaml files it reaches.
// design: doc_page_impl_side_panel.md#the-document-entry
//
// every document has one entry file, named by config docEntry.file and by
// convention called xxx-entry.yaml. the entry file and every yaml file it
// reaches share one grammar, the document yaml file:
//
//   docEntry:                # marks the file as the entry of a document;
//     title: ...             #   true, or a mapping with optional page values
//     homeDoc: ...           #   used when config.yaml does not set them
//     homeItem: ...
//   source:                  # optional: rules | { rules } | { file }
//   tag:                     # optional: { defineById } | { file }
//   sidePanelDefault: main   # optional when the file declares one side panel
//   sidePanelById:
//     main: { root?, tree }          # a side panel resource
//     other: { file?, sidePanel? }   # a reference to a side panel declared elsewhere
//
// a side-panel reference names one side panel. a string is a file path and
// means the default side panel of that file; a mapping names the file (the
// file holding the reference when absent) and the side panel id (that file's
// default when absent). the "include" property of a tree node and the alias
// values of sidePanelById are references.
//
// loading a file loads everything in it: its source rules are appended once,
// its tag definitions are merged (a file loaded earlier wins), and every side
// panel is resolved with its includes. the entry is loaded first, so its
// rules come first, followed by the rules of included files in order of
// appearance. every node of every side panel is annotated with textSource,
// the file (relative to the config directory) and yaml address of the node
// whose label it shows, for the edit layer (doc-side-panel-text.ts).

export type SidePanelTextSource = {
  file: string;
  path: (string | number)[];
};

export type SidePanelLoaded = {
  root?: Record<string, any>;
  // where the root's label is written, when the side panel has a root
  rootTextSource?: SidePanelTextSource;
  tree: any[];
};

export type DocEntryInfo = {
  title?: string;
  homeDoc?: string;
  homeItem?: string;
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
  // every yaml file read, absolute, the entry file first
  fileListLoaded: string[];
};

type DocYamlFile = {
  filePath: string;
  content: Record<string, any>;
  isEntry: boolean;
  entry: DocEntryInfo;
  sidePanelIdList: string[];
  // '' when the file declares no side panel, or several without sidePanelDefault
  sidePanelIdDefault: string;
};

type SidePanelRef = {
  file: string; // absolute
  sidePanelId: string; // '' for the default side panel of the file
};

type LoadContext = {
  configDir: string;
  fileByPath: Map<string, DocYamlFile>;
  sidePanelByKey: Map<string, SidePanelLoaded>;
  fileListLoaded: string[];
  sourceRuleList: any[];
  tagDefineById: Record<string, any>;
};

const FILE_KEY_LIST = ['docEntry', 'source', 'tag', 'sidePanelDefault', 'sidePanelById'];
const ENTRY_FILE_SUFFIX = '-entry.yaml';

export function docEntryLoad(entryFile: string, configDir: string, sidePanelIdWanted = ''): DocEntryLoaded {
  const context: LoadContext = {
    configDir,
    fileByPath: new Map(),
    sidePanelByKey: new Map(),
    fileListLoaded: [],
    sourceRuleList: [],
    tagDefineById: {},
  };
  const file = fileLoad(entryFile, context);
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

  return {
    entry: file.entry,
    sidePanelId,
    sidePanelIdList: file.sidePanelIdList,
    sidePanel,
    sourceRuleList: context.sourceRuleList,
    tagDefineById: context.tagDefineById,
    fileListLoaded: context.fileListLoaded,
  };
}

// ---------- files ----------

function fileLoad(filePath: string, context: LoadContext): DocYamlFile {
  const filePathResolved = path.resolve(filePath);
  const fileLoaded = context.fileByPath.get(filePathResolved);
  if (fileLoaded) return fileLoaded;
  if (!fs.existsSync(filePathResolved)) {
    throw new Error(`[doc-source] document yaml file not found: ${filePathResolved}`);
  }
  const content = readYaml(filePathResolved) ?? {};
  if (!mappingIs(content)) {
    throw new Error(`[doc-source] document yaml file must be a mapping: ${filePathResolved}`);
  }
  fileKeysValidate(content, filePathResolved);

  const file: DocYamlFile = {
    filePath: filePathResolved,
    content,
    isEntry: content.docEntry !== undefined && content.docEntry !== false,
    entry: entrySectionRead(content.docEntry, filePathResolved),
    sidePanelIdList: sidePanelIdListRead(content.sidePanelById, filePathResolved),
    sidePanelIdDefault: '',
  };
  file.sidePanelIdDefault = sidePanelIdDefaultRead(file);
  if (file.isEntry && !file.filePath.endsWith(ENTRY_FILE_SUFFIX)) {
    console.warn(`[doc-source] an entry file is named xxx${ENTRY_FILE_SUFFIX} by convention: ${file.filePath}`);
  }
  // registered before its side panels load, so a side panel of another file
  // that includes a side panel of this one finds the file
  context.fileByPath.set(filePathResolved, file);
  context.fileListLoaded.push(filePathResolved);

  sourceSectionLoad(content.source, file, context);
  tagSectionLoad(content.tag, file, context);
  for (const sidePanelId of file.sidePanelIdList) {
    sidePanelLoad({ file: filePathResolved, sidePanelId }, context, []);
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

// ---------- side panels ----------

function sidePanelKeyBuild(filePath: string, sidePanelId: string): string {
  return `${filePath}#${sidePanelId}`;
}

// chain: the side panels being loaded, outermost first, as keys
function sidePanelLoad(ref: SidePanelRef, context: LoadContext, chain: string[]): SidePanelLoaded {
  const file = fileLoad(ref.file, context);
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
    return { file: path.resolve(fileDir, value), sidePanelId: '' };
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
    file: value.file === undefined ? fileFrom.filePath : path.resolve(fileDir, value.file),
    sidePanelId: value.sidePanel ?? '',
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
  const tree = nodesLoad(declared.tree, file, context, chain, { file: fileRelative, path: [...addressResource, 'tree'] });
  const rootTextSource = root === undefined ? undefined : { file: fileRelative, path: [...addressResource, 'root'] };
  return { root, rootTextSource, tree };
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
    if (include !== undefined) {
      const included = sidePanelLoad(sidePanelRefParse(include, file, `"include" at ${placeNode}`), context, chain);
      childrenIncluded = included.tree;
      rootIncluded = included.root ?? {};
      rootTextSourceIncluded = included.rootTextSource;
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
