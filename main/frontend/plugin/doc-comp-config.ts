import fs from 'node:fs';
import path from 'node:path';
import { readYaml, type EntryFileSection } from './doc-entry.ts';
import { problemListReport } from './doc-service-server.ts';

// The components of a doc page (design:
// doc_page_impl_mdx_comp.md#components-of-a-doc-page). A doc page carries
// the components its documents use in component folders of its own,
// found by convention and mounted into the component registry of the page
// by the plugin, so a doc page that brings its own components is included
// or deployed without touching the host's registry.
//
//   where      the entry's "comp: { file }", relative to the entry; absent:
//              comp.yaml beside the entry (.doc-page/comp.yaml); "comp: false":
//              the doc page has no component folders
//   folders    folderList of that file: paths relative to the file
//   no file    the default folders: COMP_FOLDER_DEFAULT_LIST, relative to the
//              doc page folder (comp-mdx/)
//
// inside a component folder, a manifest comp.yaml describes the components:
// one at the folder root listing several, and any number in its sub folders
// at any depth ({folder}/{group}/.../{name}/comp.yaml), so components are
// grouped in folders by function, a group in another. every manifest found
// is read (a manifest beside sub folders does not end the search); the
// folders named in COMP_FOLDER_SKIP_NAME_LIST and dot folders are not read.
//
//   compList:
//     - tagName: StockTable              # the tag documents write (a compRegistry entry;
//                                        #   a built-in name such as SidePanelItem replaces the default)
//       id: specific/StockTable          # the registry id; default {docPageAlias}/{tagName}
//       entry: ./StockTable.jsx          # the module, relative to the manifest
//       export: StockTable               # the export: a compDefine() definition or a React
//                                        #   component; default: the tag name
//       defineOptionsExport: stockTableDefineOptions
//                                        # optional: an export of the same module holding the
//                                        #   options of compDefine(Comp, options) when the export
//                                        #   is a plain component
//
// a mapping without compList is one entry. every problem is reported with
// the file and the place ([doc-comp] ...), and skips that entry, never the
// page. the folders are never documents, whatever source rule collects the
// folder around them.

export const COMP_CONFIG_FILE_NAME = 'comp.yaml';
// the component folders of a doc page without a comp config file, relative
// to the doc page folder
export const COMP_FOLDER_DEFAULT_LIST = ['comp-mdx'];
// the manifest inside a component folder (at its root, or in a sub folder at any depth)
export const COMP_MANIFEST_FILE_NAME = 'comp.yaml';
// the folders of a component folder that never hold a manifest: what a
// component's own project brings along
export const COMP_FOLDER_SKIP_NAME_LIST = ['node_modules', 'dist'];
// how deep the groups of a component folder are read
export const COMP_GROUP_DEPTH_MAX = 8;

const TAG_NAME_REGEX = /^[A-Za-z][A-Za-z0-9_]*$/;
const EXPORT_NAME_REGEX = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const ENTRY_KEY_LIST = ['tagName', 'id', 'entry', 'export', 'defineOptionsExport'];

// what the reader needs of a loaded doc page (DocPageLoaded has it)
export type CompDocPageInput = {
  alias: string;
  entryFile: string;
  dirPage: string;
  comp: EntryFileSection;
};

// one component a doc page mounts, as the plugin knows it; the virtual
// module adds the imported module
export type CompMount = {
  docPageAlias: string;
  tagName: string;
  id: string;
  export: string;
  // '' when the export is used as it is
  defineOptionsExport: string;
  // the module file, absolute
  entryFile: string;
  // the manifest it is declared in, absolute
  manifestFile: string;
};

export type CompDocPage = {
  alias: string;
  entryFile: string;
  dirPage: string;
  // the comp config file, absolute, whether it exists or not
  configFile: string;
  isConfigFileExists: boolean;
  // the component folders, absolute (existing or not)
  folderList: string[];
  // the manifests found in the folders, absolute
  manifestFileList: string[];
  mountList: CompMount[];
  problemList: string[];
};

export type CompConfig = {
  docPageList: CompDocPage[];
  // every mount of every doc page, in loading order; a tag name or an id
  // declared twice keeps its first declaration
  mountList: CompMount[];
};

// the comp config file of a doc page: the one its entry names, else the
// convention file beside the entry
export function compConfigFileGet(input: Pick<CompDocPageInput, 'entryFile' | 'comp'>): string {
  const dirEntry = path.dirname(input.entryFile);
  return input.comp ? path.resolve(dirEntry, input.comp.file) : path.join(dirEntry, COMP_CONFIG_FILE_NAME);
}

// the components of every doc page the page loads, in loading order. a tag
// name declared by two doc pages belongs to the first loaded (reported);
// an id likewise
export function compConfigOfDocPageListGet(docPageInputList: CompDocPageInput[], configDir: string): CompConfig {
  const docPageList: CompDocPage[] = [];
  const mountList: CompMount[] = [];
  const mountByTagName = new Map<string, CompMount>();
  const mountById = new Map<string, CompMount>();
  for (const input of docPageInputList) {
    if (input.comp === false) continue;
    const docPage = compDocPageRead(input, configDir);
    for (const mount of docPage.mountList) {
      const mountSameTag = mountByTagName.get(mount.tagName);
      if (mountSameTag) {
        docPage.problemList.push(
          `${pathRelativeGet(mount.manifestFile, configDir)}: the tag name ${mount.tagName} is declared by doc page "${mountSameTag.docPageAlias}" already`
            + ` (${pathRelativeGet(mountSameTag.manifestFile, configDir)}); the first loaded is kept`,
        );
        continue;
      }
      const mountSameId = mountById.get(mount.id);
      if (mountSameId) {
        docPage.problemList.push(
          `${pathRelativeGet(mount.manifestFile, configDir)}: the id ${mount.id} is declared for the tag ${mountSameId.tagName}`
            + ` of doc page "${mountSameId.docPageAlias}" already (${pathRelativeGet(mountSameId.manifestFile, configDir)}); the first loaded is kept`,
        );
        continue;
      }
      mountByTagName.set(mount.tagName, mount);
      mountById.set(mount.id, mount);
      mountList.push(mount);
    }
    problemListReport('doc-comp', pathRelativeGet(docPage.configFile, configDir), docPage.problemList);
    docPageList.push(docPage);
  }
  return { docPageList, mountList };
}

// the component folders and manifests of one doc page (pure: nothing is created)
export function compDocPageRead(input: CompDocPageInput, configDir: string): CompDocPage {
  const configFile = compConfigFileGet(input);
  const docPage: CompDocPage = {
    alias: input.alias,
    entryFile: input.entryFile,
    dirPage: input.dirPage,
    configFile,
    isConfigFileExists: fs.existsSync(configFile),
    folderList: [],
    manifestFileList: [],
    mountList: [],
    problemList: [],
  };
  if (!docPage.isConfigFileExists) {
    docPage.folderList = COMP_FOLDER_DEFAULT_LIST.map((folderName) => path.join(input.dirPage, folderName));
  } else {
    let content: any;
    try {
      content = readYaml(configFile) ?? {};
    } catch (error: any) {
      docPage.problemList.push(`not valid yaml: ${String(error?.message ?? error)}`);
      return docPage;
    }
    if (typeof content !== 'object' || Array.isArray(content)) {
      docPage.problemList.push('must be a mapping { folderList: [paths relative to this file] }');
      return docPage;
    }
    if (content.folderList !== undefined && !Array.isArray(content.folderList)) {
      docPage.problemList.push('folderList must be a list of paths relative to this file');
      return docPage;
    }
    const dirBase = path.dirname(configFile);
    (content.folderList ?? []).forEach((item: any, index: number) => {
      const pathWritten = typeof item === 'string' ? item.trim() : typeof item?.path === 'string' ? item.path.trim() : '';
      if (pathWritten === '') {
        docPage.problemList.push(`folderList[${index}]: a path relative to this file`);
        return;
      }
      const folderAbs = path.resolve(dirBase, pathWritten);
      if (!docPage.folderList.includes(folderAbs)) docPage.folderList.push(folderAbs);
    });
  }
  for (const folderAbs of docPage.folderList) {
    for (const manifestFile of compManifestFileListFind(folderAbs)) {
      docPage.manifestFileList.push(manifestFile);
      compManifestRead(manifestFile, input, configDir, docPage);
    }
  }
  return docPage;
}

// the manifests of a component folder: the one at its root, then those of
// its sub folders at any depth, each folder before the folders inside it
function compManifestFileListFind(folderAbs: string): string[] {
  if (!fs.existsSync(folderAbs) || !fs.statSync(folderAbs).isDirectory()) return [];
  const result: string[] = [];
  const folderRead = (dirAbs: string, depth: number) => {
    const manifest = path.join(dirAbs, COMP_MANIFEST_FILE_NAME);
    if (fs.existsSync(manifest)) result.push(manifest);
    if (depth >= COMP_GROUP_DEPTH_MAX) return;
    for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || COMP_FOLDER_SKIP_NAME_LIST.includes(entry.name)) continue;
      folderRead(path.join(dirAbs, entry.name), depth + 1);
    }
  };
  folderRead(folderAbs, 0);
  return result;
}

// one manifest: its entries appended to the doc page's mounts, its problems
// to the doc page's list, each naming the file and the place
function compManifestRead(manifestFile: string, input: CompDocPageInput, configDir: string, docPage: CompDocPage) {
  const place = pathRelativeGet(manifestFile, configDir);
  let content: any;
  try {
    content = readYaml(manifestFile) ?? {};
  } catch (error: any) {
    docPage.problemList.push(`${place}: not valid yaml: ${String(error?.message ?? error)}`);
    return;
  }
  if (typeof content !== 'object' || Array.isArray(content)) {
    docPage.problemList.push(`${place}: must be a mapping, compList: [{ tagName, id?, entry, export?, defineOptionsExport? }] or one such entry`);
    return;
  }
  let entryList: any[];
  if (content.compList !== undefined) {
    if (!Array.isArray(content.compList)) {
      docPage.problemList.push(`${place}: compList must be a list of { tagName, id?, entry, export?, defineOptionsExport? }`);
      return;
    }
    entryList = content.compList;
  } else {
    entryList = [content];
  }
  const dirBase = path.dirname(manifestFile);
  entryList.forEach((item: any, index: number) => {
    const placeEntry = content.compList !== undefined ? `${place} compList[${index}]` : place;
    const mount = compMountRead(item, dirBase, input.alias, manifestFile, docPage.problemList, placeEntry);
    if (!mount) return;
    const mountSameTag = docPage.mountList.find((mountKept) => mountKept.tagName === mount.tagName);
    if (mountSameTag) {
      docPage.problemList.push(`${placeEntry}: the tag name ${mount.tagName} is declared in ${pathRelativeGet(mountSameTag.manifestFile, configDir)} already; the first is kept`);
      return;
    }
    const mountSameId = docPage.mountList.find((mountKept) => mountKept.id === mount.id);
    if (mountSameId) {
      docPage.problemList.push(`${placeEntry}: the id ${mount.id} is declared for the tag ${mountSameId.tagName} already; the first is kept`);
      return;
    }
    docPage.mountList.push(mount);
  });
}

function compMountRead(item: any, dirBase: string, docPageAlias: string, manifestFile: string, problemList: string[], place: string): CompMount | undefined {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    problemList.push(`${place}: an entry is a mapping { tagName, id?, entry, export?, defineOptionsExport? }`);
    return undefined;
  }
  for (const key of Object.keys(item)) {
    if (!ENTRY_KEY_LIST.includes(key)) problemList.push(`${place}: unknown key "${key}" (${ENTRY_KEY_LIST.join(', ')})`);
  }
  const tagName = typeof item.tagName === 'string' ? item.tagName.trim() : '';
  if (!TAG_NAME_REGEX.test(tagName)) {
    problemList.push(`${place}: tagName must be a component tag name, letters and digits starting with a letter (got ${JSON.stringify(item.tagName)})`);
    return undefined;
  }
  const entryWritten = typeof item.entry === 'string' ? item.entry.trim() : '';
  if (entryWritten === '') {
    problemList.push(`${place}: entry names the module file of ${tagName}, relative to the manifest`);
    return undefined;
  }
  const entryFile = path.resolve(dirBase, entryWritten);
  if (!fs.existsSync(entryFile) || !fs.statSync(entryFile).isFile()) {
    problemList.push(`${place}: entry of ${tagName} not found: ${entryWritten}`);
    return undefined;
  }
  let id = `${docPageAlias}/${tagName}`;
  if (item.id !== undefined) {
    if (typeof item.id !== 'string' || item.id.trim() === '') {
      problemList.push(`${place}: id of ${tagName} must be a non-empty string`);
      return undefined;
    }
    id = item.id.trim();
  }
  let exportName = tagName;
  if (item.export !== undefined) {
    if (typeof item.export !== 'string' || !EXPORT_NAME_REGEX.test(item.export.trim())) {
      problemList.push(`${place}: export of ${tagName} must be an export name (got ${JSON.stringify(item.export)})`);
      return undefined;
    }
    exportName = item.export.trim();
  }
  let defineOptionsExport = '';
  if (item.defineOptionsExport !== undefined) {
    if (typeof item.defineOptionsExport !== 'string' || !EXPORT_NAME_REGEX.test(item.defineOptionsExport.trim())) {
      problemList.push(`${place}: defineOptionsExport of ${tagName} must be an export name (got ${JSON.stringify(item.defineOptionsExport)})`);
      return undefined;
    }
    defineOptionsExport = item.defineOptionsExport.trim();
  }
  return { docPageAlias, tagName, id, export: exportName, defineOptionsExport, entryFile, manifestFile };
}

// ---------- what is never a document ----------

// a file of a component folder of a doc page, manifests included: never a
// document, and a change in it is code (vite's own hmr), not a reload
export function compPathIs(compConfig: CompConfig, filePath: string): boolean {
  return compConfig.docPageList.some((docPage) => docPage.folderList.some((folder) => pathIsInside(filePath, folder)));
}

// a comp config file of a doc page, or a manifest a component folder holds
// or could hold (at its root or in a group at any depth): configuration, so
// a change, an addition or a removal regenerates the manifest of the page
export function compManifestPathIs(compConfig: CompConfig, filePath: string): boolean {
  return compConfig.docPageList.some((docPage) => {
    if (filePath === docPage.configFile) return true;
    if (path.basename(filePath) !== COMP_MANIFEST_FILE_NAME) return false;
    return docPage.folderList.some((folder) => {
      const relative = path.relative(folder, filePath);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
      const partList = relative.split(path.sep);
      return partList.length <= COMP_GROUP_DEPTH_MAX + 1
        && !partList.some((part) => part.startsWith('.') || COMP_FOLDER_SKIP_NAME_LIST.includes(part));
    });
  });
}

// the files a change of which regenerates the manifest of the page: the
// comp config file of every doc page (existing or not) and the manifests found
export function compConfigurationFileListGet(compConfig: CompConfig): string[] {
  const result: string[] = [];
  for (const docPage of compConfig.docPageList) result.push(docPage.configFile, ...docPage.manifestFileList);
  return result;
}

// the component folders, absolute (existing or not)
export function compFolderListGet(compConfig: CompConfig): string[] {
  const result: string[] = [];
  for (const docPage of compConfig.docPageList) {
    for (const folder of docPage.folderList) if (!result.includes(folder)) result.push(folder);
  }
  return result;
}

function pathIsInside(filePath: string, folder: string): boolean {
  const relative = path.relative(folder, filePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function pathRelativeGet(filePath: string, configDir: string): string {
  const relative = path.relative(configDir, filePath);
  return relative.startsWith('..') ? filePath : relative.split(path.sep).join('/');
}
