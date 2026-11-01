import fs from 'node:fs';
import path from 'node:path';
import { readYaml, type EntryFileSection } from './doc-entry.ts';

// The apis a doc page declares in yaml (design: doc_page_impl_api.md#declared-apis):
// an api of the unified api registry that is an alias of another api with
// fixed parameters, or a sequence of such calls, so that a doc page offers
// "Open the guide" to the palette and the hotkeys without code.
//
//   .doc-page/api.yaml              read when it exists (the convention)
//   entry "api: { file }"           another file, relative to the entry
//   entry "api: false"              the doc page declares none
//
//   apiList:
//     - id: example/openGuide       # {layer}/{name}; the doc page's alias is a good layer
//       label: Open the guide
//       description: ...            # optional
//       category: Example           # optional: the group the palette shows
//       run:                        # one call, or a list of calls run in order
//         api: nav/goTo
//         params: { target: ~example/doc.md }
//       palette: true               # optional: false keeps it out of the palette
//
// the page defines them (lib/doc-api.js apiDeclaredDefine): the api is
// available while every api it calls is registered, and a hotkey bound to
// it is hidden otherwise. every problem is reported with the file
// ([doc-api]) and skips the item, never the page.

export const API_CONFIG_FILE_NAME = 'api.yaml';
const ITEM_KEY_LIST = ['id', 'label', 'description', 'category', 'run', 'palette'];
const ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9_.-]*(\/[A-Za-z0-9][A-Za-z0-9_.-]*)+$/;

export type ApiDocPageInput = {
  alias: string;
  entryFile: string;
  api: EntryFileSection;
};

export type ApiDeclaredItem = {
  id: string;
  docPageAlias: string;
  file: string;
  label: string;
  description: string;
  category: string;
  runList: { api: string; params: Record<string, any> }[];
  palette: boolean;
};

export type ApiDeclaredConfig = {
  list: ApiDeclaredItem[];
  problemList: { alias: string; file: string; message: string }[];
  // absolute: the files to watch (a change reloads the page)
  pathList: string[];
};

export function apiDeclaredConfigOfDocPageListGet(docPageInputList: ApiDocPageInput[], configDir: string): ApiDeclaredConfig {
  const list: ApiDeclaredItem[] = [];
  const problemList: ApiDeclaredConfig['problemList'] = [];
  const pathList: string[] = [];
  const idSet = new Set<string>();
  for (const input of docPageInputList) {
    if (input.api === false) continue;
    const file = input.api && typeof input.api === 'object'
      ? path.resolve(path.dirname(input.entryFile), input.api.file)
      : path.join(path.dirname(input.entryFile), API_CONFIG_FILE_NAME);
    pathList.push(file);
    const fileRel = path.relative(configDir, file).split(path.sep).join('/');
    const problemAdd = (message: string) => problemList.push({ alias: input.alias, file: fileRel, message });
    if (!fs.existsSync(file)) {
      if (input.api && typeof input.api === 'object') problemAdd('the api file the entry names (api.file) is not found');
      continue;
    }
    let content: any;
    try {
      content = readYaml(file);
    } catch (error: any) {
      problemAdd(`the api file does not parse: ${String(error?.message ?? error)}`);
      continue;
    }
    if (!mappingIs(content) || !Array.isArray(content.apiList)) {
      problemAdd('an api file holds one list "apiList: [{ id, label, run }]"');
      continue;
    }
    for (const key of Object.keys(content)) {
      if (key !== 'apiList') problemAdd(`unknown key "${key}" at the top level (known: apiList)`);
    }
    content.apiList.forEach((item: any, index: number) => {
      const place = `apiList[${index}]`;
      if (!mappingIs(item)) {
        problemAdd(`${place}: an api is a mapping { id, label, run }`);
        return;
      }
      for (const key of Object.keys(item)) {
        if (!ITEM_KEY_LIST.includes(key)) problemAdd(`${place}: unknown key "${key}" (known: ${ITEM_KEY_LIST.join(', ')})`);
      }
      if (typeof item.id !== 'string' || !ID_REGEX.test(item.id)) {
        problemAdd(`${place}: "id" is {layer}/{name} (letters, digits, "_", "-", ".")`);
        return;
      }
      if (idSet.has(item.id)) {
        problemAdd(`${place}: the id ${item.id} is declared already; this one is left out`);
        return;
      }
      const runRawList = Array.isArray(item.run) ? item.run : item.run === undefined ? [] : [item.run];
      if (runRawList.length === 0) {
        problemAdd(`${place}: "run" names the api to call ({ api, params? }), or lists several`);
        return;
      }
      const runList: ApiDeclaredItem['runList'] = [];
      for (const runRaw of runRawList) {
        if (!mappingIs(runRaw) || typeof runRaw.api !== 'string' || runRaw.api.trim() === '') {
          problemAdd(`${place}: a step of "run" is { api, params? }`);
          return;
        }
        if (runRaw.params !== undefined && !mappingIs(runRaw.params)) {
          problemAdd(`${place}: "params" of a step must be a mapping`);
          return;
        }
        for (const key of Object.keys(runRaw)) {
          if (key !== 'api' && key !== 'params') problemAdd(`${place}: unknown key "${key}" of a step (known: api, params)`);
        }
        runList.push({ api: runRaw.api.trim(), params: runRaw.params ?? {} });
      }
      if (item.palette !== undefined && typeof item.palette !== 'boolean') {
        problemAdd(`${place}: "palette" is true or false`);
        return;
      }
      idSet.add(item.id);
      list.push({
        id: item.id,
        docPageAlias: input.alias,
        file: fileRel,
        label: typeof item.label === 'string' && item.label !== '' ? item.label : item.id,
        description: typeof item.description === 'string' ? item.description : '',
        category: typeof item.category === 'string' ? item.category : '',
        runList,
        palette: item.palette !== false,
      });
    });
  }
  return { list, problemList, pathList };
}

function mappingIs(value: any): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
