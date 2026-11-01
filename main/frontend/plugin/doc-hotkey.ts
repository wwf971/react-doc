import fs from 'node:fs';
import path from 'node:path';
import { readYaml, type EntryFileSection } from './doc-entry.ts';

// The keyboard maps (design: doc_page_impl_api_hotkey.md): the package's
// default map, the maps of the doc pages, and the workspace's map, read
// when the configuration loads and handed to the page (configDoc.hotkey),
// which stacks them (DocHotkeyStore): package < doc pages < workspace.
//
//   config.yaml "hotkey: { file }"      the package's default map, one map file
//                                       (the default keys of the built-in apis)
//   .doc-page/hotkey/main.yaml          the map a doc page activates by convention
//   .doc-page/hotkey/xxx.yaml           further maps: included by others, or
//                                       chosen by the reader in the settings panel
//   entry "hotkey: { file }"            another file as the active map (relative to the entry)
//   entry "hotkey: false"               the doc page has no keyboard maps
//   workspace "hotkey: { file }"        the workspace's map, one map file over the
//                                       doc pages' (relative to the workspace file)
//
// a map file:
//
//   hotkeyMap:
//     id: main                      # optional: the file name without .yaml
//     description: ...              # optional
//     include:                      # optional: maps stacked below this one, the
//       - ./base.yaml               #   first lowest; paths relative to this file
//     bindingList:
//       - key: ctrl+shift+p         # the key (lib/doc-hotkey.js)
//         api: palette/toggle       # the api it runs; null unbinds the key
//         params: { }               # optional: the params of the call
//         when: editMode            # optional: a condition of the page
//         description: ...          # optional
//
// includes are expanded here, so the page receives flat maps: the bindings
// of the included maps first (lowest), then the map's own; every binding
// carries where it was written (place). a map included twice in one
// expansion is read once; a cycle is a problem naming the chain. every
// problem of a file is reported with the file ([doc-hotkey]) and skips the
// map or the binding, never the page.

export const HOTKEY_DIR_NAME = 'hotkey';
export const HOTKEY_MAP_DEFAULT_FILE_NAME = 'main.yaml';
const MAP_KEY_LIST = ['id', 'description', 'include', 'bindingList'];
const BINDING_KEY_LIST = ['key', 'api', 'params', 'when', 'description'];
const ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export type HotkeyDocPageInput = {
  alias: string;
  entryFile: string;
  dirPage: string;
  hotkey: EntryFileSection;
};

export type HotkeyBinding = { key: string; api: string | null; params?: Record<string, any>; when?: string; description?: string; place: string };
export type HotkeyMapLoaded = { id: string; file: string; description: string; includeList: string[]; bindingList: HotkeyBinding[] };
export type HotkeyDocPageMaps = { alias: string; folder: string; mapList: HotkeyMapLoaded[]; mapIdActive: string };
export type HotkeyProblem = { alias: string; file: string; message: string };
export type HotkeyConfig = {
  // in stack order: the doc pages loaded last first, the first root doc
  // page (the main one) last, so the including doc page decides over the
  // ones it includes
  docPageList: HotkeyDocPageMaps[];
  problemList: HotkeyProblem[];
  // absolute: the folders and files to watch (a change reloads the page)
  pathList: string[];
};

// one map file outside a doc page: the package's (config.yaml hotkey.file)
// or the workspace's (workspace hotkey.file); id is the map's id in the
// stack ('package', 'workspace'), whatever the file says
export type HotkeyFileInput = { id: string; file: string; alias: string };

export type HotkeyConfigFull = HotkeyConfig & {
  mapPackage: HotkeyMapLoaded | undefined;
  mapWorkspace: HotkeyMapLoaded | undefined;
};

// every map of the page: the package's, the doc pages', the workspace's
export function hotkeyConfigGet(
  { filePackage, fileWorkspace, docPageInputList }: { filePackage?: HotkeyFileInput; fileWorkspace?: HotkeyFileInput; docPageInputList: HotkeyDocPageInput[] },
  configDir: string,
): HotkeyConfigFull {
  const config = hotkeyConfigOfDocPageListGet(docPageInputList, configDir);
  const mapPackage = filePackage ? hotkeyMapOfFileGet(filePackage, configDir, config.problemList) : undefined;
  const mapWorkspace = fileWorkspace ? hotkeyMapOfFileGet(fileWorkspace, configDir, config.problemList) : undefined;
  for (const input of [filePackage, fileWorkspace]) if (input) config.pathList.push(input.file);
  return { ...config, mapPackage, mapWorkspace };
}

// one map file, its includes expanded, under the id given; undefined (with
// the problem reported) when the file is missing or does not read
export function hotkeyMapOfFileGet(input: HotkeyFileInput, configDir: string, problemList: HotkeyProblem[]): HotkeyMapLoaded | undefined {
  const problemAdd = (file: string, message: string) => problemList.push({ alias: input.alias, file: relativeGet(file, configDir), message });
  if (!fs.existsSync(input.file)) {
    problemAdd(input.file, `the map file named by ${input.alias} (hotkey.file) is not found`);
    return undefined;
  }
  const map = mapLoad(input.file, configDir, problemAdd);
  return map ? { ...map, id: input.id } : undefined;
}

export function hotkeyConfigOfDocPageListGet(docPageInputList: HotkeyDocPageInput[], configDir: string): HotkeyConfig {
  const docPageList: HotkeyDocPageMaps[] = [];
  const problemList: HotkeyProblem[] = [];
  const pathList: string[] = [];
  for (const input of [...docPageInputList].reverse()) {
    if (input.hotkey === false) continue;
    const folder = path.join(path.dirname(input.entryFile), HOTKEY_DIR_NAME);
    pathList.push(folder);
    const fileActive = input.hotkey && typeof input.hotkey === 'object'
      ? path.resolve(path.dirname(input.entryFile), input.hotkey.file)
      : path.join(folder, HOTKEY_MAP_DEFAULT_FILE_NAME);
    const fileList = new Set<string>();
    if (fs.existsSync(folder) && fs.statSync(folder).isDirectory()) {
      for (const name of fs.readdirSync(folder).sort()) {
        if (/\.ya?ml$/.test(name) && !name.endsWith('.bak')) fileList.add(path.join(folder, name));
      }
    }
    if (input.hotkey && typeof input.hotkey === 'object') {
      if (fs.existsSync(fileActive)) fileList.add(fileActive);
      else problemList.push({ alias: input.alias, file: relativeGet(fileActive, configDir), message: 'the map file the entry names (hotkey.file) is not found' });
      pathList.push(fileActive);
    }
    if (fileList.size === 0) continue;
    const problemAdd = (file: string, message: string) => problemList.push({ alias: input.alias, file: relativeGet(file, configDir), message });
    const mapList: HotkeyMapLoaded[] = [];
    const idSet = new Set<string>();
    for (const file of fileList) {
      const map = mapLoad(file, configDir, problemAdd);
      if (!map) continue;
      if (idSet.has(map.id)) {
        problemAdd(file, `the map id ${map.id} is declared by another map of this doc page already; this one is left out`);
        continue;
      }
      idSet.add(map.id);
      mapList.push(map);
    }
    const mapActive = mapList.find((map) => path.resolve(configDir, map.file) === fileActive);
    docPageList.push({
      alias: input.alias,
      folder: relativeGet(folder, configDir),
      mapList,
      mapIdActive: mapActive?.id ?? '',
    });
  }
  return { docPageList, problemList, pathList };
}

// one map with its includes expanded; undefined when the file cannot be read
function mapLoad(file: string, configDir: string, problemAdd: (file: string, message: string) => void): HotkeyMapLoaded | undefined {
  const includeList: string[] = [];
  const bindingList = mapBindingListExpand(file, configDir, [], includeList, problemAdd);
  if (!bindingList) return undefined;
  const content = readYaml(file);
  const map = content?.hotkeyMap ?? {};
  const idDefault = path.basename(file).replace(/\.ya?ml$/, '');
  let id = idDefault;
  if (map.id !== undefined) {
    if (typeof map.id === 'string' && ID_REGEX.test(map.id)) id = map.id;
    else problemAdd(file, `hotkeyMap.id must be one word (letters, digits, "_", "-", "."); the file name ${idDefault} is used`);
  }
  return {
    id,
    file: relativeGet(file, configDir),
    description: typeof map.description === 'string' ? map.description : '',
    includeList,
    bindingList,
  };
}

// the bindings of a map file: those of its includes first, in list order,
// then its own. chain: the files being expanded, for cycles. answers
// undefined when the file itself cannot be read
function mapBindingListExpand(
  file: string,
  configDir: string,
  chain: string[],
  includeList: string[],
  problemAdd: (file: string, message: string) => void,
): HotkeyBinding[] | undefined {
  const fileRel = relativeGet(file, configDir);
  if (chain.includes(file)) {
    problemAdd(file, `the map includes itself: ${[...chain, file].map((item) => relativeGet(item, configDir)).join(' -> ')}`);
    return [];
  }
  let content: any;
  try {
    content = readYaml(file);
  } catch (error: any) {
    problemAdd(file, `the map file does not parse: ${String(error?.message ?? error)}`);
    return undefined;
  }
  if (content === undefined) {
    problemAdd(file, 'the map file is not found');
    return undefined;
  }
  if (!mappingIs(content) || !mappingIs(content.hotkeyMap)) {
    problemAdd(file, 'a map file holds one mapping "hotkeyMap: { id?, description?, include?, bindingList }"');
    return undefined;
  }
  for (const key of Object.keys(content)) {
    if (key !== 'hotkeyMap') problemAdd(file, `unknown key "${key}" at the top level (known: hotkeyMap)`);
  }
  const map = content.hotkeyMap;
  for (const key of Object.keys(map)) {
    if (!MAP_KEY_LIST.includes(key)) problemAdd(file, `unknown key "hotkeyMap.${key}" (known: ${MAP_KEY_LIST.join(', ')})`);
  }
  const bindingList: HotkeyBinding[] = [];
  if (map.include !== undefined) {
    const includeRawList = Array.isArray(map.include) ? map.include : [map.include];
    for (const includeRaw of includeRawList) {
      if (typeof includeRaw !== 'string' || includeRaw.trim() === '') {
        problemAdd(file, 'hotkeyMap.include lists paths of map files, relative to this file');
        continue;
      }
      const fileIncluded = path.resolve(path.dirname(file), includeRaw.trim());
      const bindingListIncluded = mapBindingListExpand(fileIncluded, configDir, [...chain, file], includeList, problemAdd);
      if (!bindingListIncluded) continue;
      const fileIncludedRel = relativeGet(fileIncluded, configDir);
      if (!includeList.includes(fileIncludedRel)) includeList.push(fileIncludedRel);
      bindingList.push(...bindingListIncluded);
    }
  }
  if (map.bindingList !== undefined && !Array.isArray(map.bindingList)) {
    problemAdd(file, 'hotkeyMap.bindingList must be a list');
  }
  (Array.isArray(map.bindingList) ? map.bindingList : []).forEach((bindingRaw: any, index: number) => {
    const place = `${fileRel} bindingList[${index}]`;
    if (!mappingIs(bindingRaw)) {
      problemAdd(file, `bindingList[${index}]: a binding is a mapping { key, api }`);
      return;
    }
    for (const key of Object.keys(bindingRaw)) {
      if (!BINDING_KEY_LIST.includes(key)) problemAdd(file, `bindingList[${index}]: unknown key "${key}" (known: ${BINDING_KEY_LIST.join(', ')})`);
    }
    if (typeof bindingRaw.key !== 'string' || bindingRaw.key.trim() === '') {
      problemAdd(file, `bindingList[${index}]: "key" is required`);
      return;
    }
    if (bindingRaw.api !== null && (typeof bindingRaw.api !== 'string' || bindingRaw.api.trim() === '')) {
      problemAdd(file, `bindingList[${index}]: "api" names an api ({layer}/{name}), or is null to unbind the key`);
      return;
    }
    if (bindingRaw.params !== undefined && !mappingIs(bindingRaw.params)) {
      problemAdd(file, `bindingList[${index}]: "params" must be a mapping`);
      return;
    }
    if (bindingRaw.when !== undefined && typeof bindingRaw.when !== 'string') {
      problemAdd(file, `bindingList[${index}]: "when" must be a string`);
      return;
    }
    bindingList.push({
      key: bindingRaw.key.trim(),
      api: bindingRaw.api === null ? null : bindingRaw.api.trim(),
      ...(bindingRaw.params !== undefined ? { params: bindingRaw.params } : {}),
      ...(bindingRaw.when !== undefined ? { when: bindingRaw.when } : {}),
      ...(typeof bindingRaw.description === 'string' ? { description: bindingRaw.description } : {}),
      place,
    });
  });
  return bindingList;
}

function mappingIs(value: any): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function relativeGet(file: string, configDir: string): string {
  return path.relative(configDir, file).split(path.sep).join('/');
}
