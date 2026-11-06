import fs from 'node:fs';
import path from 'node:path';
import { readYaml, type DocPageRoot, type EntryFileSection } from './doc-entry.ts';
import { sourceFileBackupMove } from './doc-source-file.ts';

// The playground documents of the doc pages (design: doc_page_impl_test.md): a document
// for trying things out, which belongs to one checkout. Git ignores it, so a clone has
// no such file: the side panel keeps its item and opens an error page that offers to
// create it from its template, which is what git keeps.
//
//   .doc-page/playground.yaml       read when it exists (the convention)
//   entry "playground: { file }"    another file, relative to the entry
//   entry "playground: false"       the doc page has none
//
//   playgroundList:
//     - id: card-diagram
//       title: Card diagram playground       # how the page names it
//       doc: ~my-root/doc/card-diagram.playground.md     # where it lives when it exists
//       template: ./playground/card-diagram.md           # relative to this file
//
// A document of a playground is named *.playground.md (or .mdx): the name is what one
// rule of a .gitignore catches (`**/*.playground.md*`), so a new playground needs no
// rule of its own and cannot be a tracked document by accident. It may lie in a
// read-only doc page, a package: it is the one file there the page may write.
// Every problem is reported with the file ([doc-playground]) and skips the item.

export const PLAYGROUND_CONFIG_FILE_NAME = 'playground.yaml';
const DOC_NAME_PATTERN = /\.playground\.mdx?$/;
const ITEM_KEY_LIST = ['id', 'title', 'description', 'doc', 'template'];
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export type PlaygroundDocPageInput = {
  alias: string;
  entryFile: string;
  playground: EntryFileSection;
  rootList: DocPageRoot[];
};

export type PlaygroundItem = {
  id: string;
  docPageAlias: string;
  title: string;
  description: string;
  // the full source path of the document, and its local form (~root/path)
  doc: string;
  docLocal: string;
  // whether the file is there now
  isPresent: boolean;
};

export type PlaygroundConfig = {
  list: PlaygroundItem[];
  // the same items with what stays on the server
  itemByIdGet: () => Map<string, PlaygroundItem & { docAbs: string; templateAbs: string }>;
  problemList: { alias: string; file: string; message: string }[];
  pathList: string[];
};

const mappingIs = (value: any) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function playgroundConfigOfDocPageListGet(docPageInputList: PlaygroundDocPageInput[], configDir: string): PlaygroundConfig {
  const itemList: (PlaygroundItem & { docAbs: string; templateAbs: string })[] = [];
  const problemList: PlaygroundConfig['problemList'] = [];
  const pathList: string[] = [];
  const idSet = new Set<string>();
  for (const input of docPageInputList) {
    if (input.playground === false) continue;
    const file = input.playground && typeof input.playground === 'object'
      ? path.resolve(path.dirname(input.entryFile), input.playground.file)
      : path.join(path.dirname(input.entryFile), PLAYGROUND_CONFIG_FILE_NAME);
    pathList.push(file);
    const fileRel = path.relative(configDir, file).split(path.sep).join('/');
    const problemAdd = (message: string) => problemList.push({ alias: input.alias, file: fileRel, message });
    if (!fs.existsSync(file)) {
      if (input.playground && typeof input.playground === 'object') problemAdd('the playground file the entry names (playground.file) is not found');
      continue;
    }
    let content: any;
    try {
      content = readYaml(file);
    } catch (error: any) {
      problemAdd(`the playground file does not parse: ${String(error?.message ?? error)}`);
      continue;
    }
    if (!mappingIs(content) || !Array.isArray(content.playgroundList)) {
      problemAdd('a playground file holds one list "playgroundList: [{ id, doc, template }]"');
      continue;
    }
    content.playgroundList.forEach((item: any, index: number) => {
      const place = `playgroundList[${index}]`;
      if (!mappingIs(item)) return problemAdd(`${place} must be a mapping`);
      for (const key of Object.keys(item)) if (!ITEM_KEY_LIST.includes(key)) problemAdd(`${place}: unknown key "${key}" (known: ${ITEM_KEY_LIST.join(', ')})`);
      const { id, doc, template } = item;
      if (typeof id !== 'string' || !ID_PATTERN.test(id)) return problemAdd(`${place}: id must be a word of letters, digits, - and _`);
      const idFull = `${input.alias}/${id}`;
      if (idSet.has(idFull)) return problemAdd(`${place}: duplicate id "${id}"`);
      const docMatch = /^~([^:/]+)\/(.+)$/.exec(String(doc ?? ''));
      if (!docMatch) return problemAdd(`${place}: doc must be a source path of this doc page, ~root/path`);
      const root = input.rootList.find((candidate) => candidate.alias === docMatch[1] && candidate.kind === 'folder');
      if (!root) return problemAdd(`${place}: this doc page has no folder root "${docMatch[1]}"`);
      if (!DOC_NAME_PATTERN.test(docMatch[2])) return problemAdd(`${place}: the name of a playground document ends with .playground.md or .playground.mdx, which is what git ignores`);
      const docAbs = path.resolve(root.path, ...docMatch[2].split('/'));
      if (!docAbs.startsWith(`${root.path}${path.sep}`)) return problemAdd(`${place}: doc leaves its root`);
      if (typeof template !== 'string' || !template) return problemAdd(`${place}: template must be a file, relative to this file`);
      const templateAbs = path.resolve(path.dirname(file), template);
      if (!fs.existsSync(templateAbs)) return problemAdd(`${place}: the template is not found: ${template}`);
      idSet.add(idFull);
      pathList.push(templateAbs);
      itemList.push({
        id: idFull,
        docPageAlias: input.alias,
        title: typeof item.title === 'string' && item.title ? item.title : id,
        description: typeof item.description === 'string' ? item.description : '',
        doc: `~${input.alias}:${docMatch[1]}/${docMatch[2]}`,
        docLocal: String(doc),
        isPresent: fs.existsSync(docAbs),
        docAbs,
        templateAbs,
      });
    });
  }
  const itemById = new Map(itemList.map((item) => [item.id, item]));
  return {
    list: itemList.map(({ docAbs: _docAbs, templateAbs: _templateAbs, ...item }) => item),
    itemByIdGet: () => itemById,
    problemList,
    pathList,
  };
}

// create or reset: the document as its template says, what was there kept as a hidden
// backup beside it (doc_page_impl_source.md#creating-and-deleting-files). delete: only
// that backup is left. the document of a playground is the only file this ever touches
export function playgroundApply(item: { docAbs: string; templateAbs: string; doc: string }, action: string): { code: number; message: string; docAbs: string } {
  if (action !== 'reset' && action !== 'delete') return { code: -1, message: `unknown action "${action}"`, docAbs: item.docAbs };
  const isPresent = fs.existsSync(item.docAbs);
  if (action === 'delete' && !isPresent) return { code: 0, message: '', docAbs: item.docAbs };
  if (isPresent) sourceFileBackupMove([{ absPath: item.docAbs, internalPath: item.doc }]);
  if (action === 'reset') {
    fs.mkdirSync(path.dirname(item.docAbs), { recursive: true });
    fs.copyFileSync(item.templateAbs, item.docAbs);
  }
  return { code: 0, message: '', docAbs: item.docAbs };
}
