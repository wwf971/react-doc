#!/usr/bin/env node
// The command line of the react-doc package (design: main/doc_page_impl_cli.md).
//
//   react-doc init page <dir>       a doc page folder: .doc-page/ with its entry, a home document
//   react-doc init workspace <dir>  a workspace folder: .doc-workspace/workspace.yaml and a first doc page
//   react-doc init package <dir>    a package folder: doc-package.yaml, doc/README.md, comp-mdx/
//
// Each kind is a folder of scaffold/ copied with its placeholders filled
// ({{alias}}, {{title}}, {{name}}, {{pageAlias}}; a "_gitignore" becomes
// ".gitignore", since npm leaves .gitignore files out of a published
// package). Only node's own modules are used, so the command runs from a
// checkout without an install. It never overwrites a file: a folder that is
// not empty is refused, and with --force only the files missing are written.
// The managed folders of a kind (components, assets, services) are not
// written: the first item put there makes the folder, as the page does with
// folderManaged.isLazy (doc_page_impl_dir.md#managed-folders-made-when-first-used);
// --folder-empty writes them, with what the scaffold has inside them.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const SCAFFOLD_DIR = fileURLToPath(new URL('./scaffold/', import.meta.url));

// the kinds of `init`, each a folder of scaffold/
export const INIT_KIND_LIST = ['page', 'workspace', 'package'];
const SCAFFOLD_DIR_NAME_BY_KIND = { page: 'doc-page', workspace: 'workspace', package: 'package' };
// the managed folders of each scaffold, relative to it (doc_page_impl_dir.md)
const FOLDER_MANAGED_LIST_BY_KIND = {
  page: ['asset', 'comp-mdx', 'service-template-app', 'service-template-infra', 'service-app', 'service-infra'].map((name) => `.doc-page/${name}`),
  workspace: [],
  package: ['comp-mdx', 'service-template-app', 'service-template-infra'],
};

// as the page checks them: an alias of a doc page or a root (doc-source-path.js
// sourceAliasIsValid), the name of a package (doc-package.ts)
const ALIAS_REGEX = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const PACKAGE_NAME_REGEX = /^[a-z][a-z0-9-]*$/;
// the folder of the first doc page of a new workspace, and its alias
const WORKSPACE_PAGE_ALIAS_DEFAULT = 'guide';

const USAGE_TEXT = `react-doc: scaffold a doc page, a workspace or a package (main/doc_page_impl_cli.md)

usage
  react-doc init page <dir>       [--alias <alias>] [--title <title>]
  react-doc init workspace <dir>  [--page <alias>] [--title <title>]
  react-doc init package <dir>    [--name <name>] [--title <title>]

options
  --alias  the alias of the doc page and of its root  (default: the folder name)
  --page   the alias and folder of the first doc page (default: ${WORKSPACE_PAGE_ALIAS_DEFAULT})
  --name   the name of the package                     (default: the folder name)
  --title  the title                                   (default: from the folder name)
  --force         write into a folder that is not empty; existing files are kept
  --folder-empty  write the managed folders too (components, assets, services), empty;
                  by default the first item put in one makes it
`;

export class DocCliError extends Error {}

// "my-notes_2" -> "My Notes 2"
function titleFromName(name) {
  return name.split(/[-_.\s]+/).filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join(' ') || name;
}

// a value as a yaml scalar: plain when it reads back as the same string
function yamlScalarText(value) {
  return /^[A-Za-z0-9][A-Za-z0-9 _.,()/-]*$/.test(value) && !/^(true|false|null|yes|no|on|off|~)$/i.test(value) && !/^[0-9.]+$/.test(value)
    ? value
    : JSON.stringify(value);
}

// the files of a scaffold folder, relative to it, sorted
function scaffoldFileList(dirScaffold, dirRel = '') {
  const result = [];
  for (const item of fs.readdirSync(path.join(dirScaffold, dirRel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const itemRel = dirRel === '' ? item.name : path.join(dirRel, item.name);
    if (item.isDirectory()) result.push(...scaffoldFileList(dirScaffold, itemRel));
    else if (item.isFile() && item.name !== '.DS_Store') result.push(itemRel);
  }
  return result;
}

// copies one scaffold folder into dirTarget; returns { written, kept }, paths relative to dirTarget
function scaffoldCopy(kind, dirTarget, valueByName, isForce, isFolderEmpty) {
  const dirScaffold = path.join(SCAFFOLD_DIR, SCAFFOLD_DIR_NAME_BY_KIND[kind]);
  const result = { written: [], kept: [] };
  const folderManagedList = FOLDER_MANAGED_LIST_BY_KIND[kind].map((folder) => folder.split('/').join(path.sep));
  const isInFolderManaged = (fileRel) => folderManagedList.some((folder) => fileRel.startsWith(folder + path.sep));
  for (const fileRel of scaffoldFileList(dirScaffold)) {
    if (!isFolderEmpty && isInFolderManaged(fileRel)) continue;
    const fileRelTarget = fileRel.split(path.sep).map((part) => (part === '_gitignore' ? '.gitignore' : part)).join(path.sep);
    const fileTarget = path.join(dirTarget, fileRelTarget);
    if (fs.existsSync(fileTarget)) {
      if (!isForce) throw new DocCliError(`${fileTarget} exists already`);
      result.kept.push(fileRelTarget);
      continue;
    }
    const isYaml = /\.ya?ml$/.test(fileRel);
    const text = fs.readFileSync(path.join(dirScaffold, fileRel), 'utf-8').replace(/\{\{(\w+)\}\}/g, (whole, name) => {
      if (!(name in valueByName)) return whole;
      return isYaml ? yamlScalarText(valueByName[name]) : valueByName[name];
    });
    fs.mkdirSync(path.dirname(fileTarget), { recursive: true });
    fs.writeFileSync(fileTarget, text);
    result.written.push(fileRelTarget);
  }
  if (isFolderEmpty) {
    for (const folder of folderManagedList) {
      if (fs.existsSync(path.join(dirTarget, folder))) continue;
      fs.mkdirSync(path.join(dirTarget, folder), { recursive: true });
      result.written.push(folder + path.sep);
    }
  }
  return result;
}

// a target folder that may be written: absent, empty, or anything with --force
function targetCheck(dirTarget, isForce) {
  if (!fs.existsSync(dirTarget)) return;
  if (!fs.statSync(dirTarget).isDirectory()) throw new DocCliError(`${dirTarget} is a file`);
  const nameList = fs.readdirSync(dirTarget).filter((name) => name !== '.DS_Store' && name !== '.git');
  if (nameList.length > 0 && !isForce) {
    throw new DocCliError(`${dirTarget} is not empty (${nameList.slice(0, 5).join(', ')}${nameList.length > 5 ? ', ...' : ''}); pass --force to add the missing files only`);
  }
}

function aliasCheck(alias, place) {
  if (!ALIAS_REGEX.test(alias)) {
    throw new DocCliError(`${place} "${alias}" must be one word: letters, digits, "_", "-", "." (give one with --${place === 'the package name' ? 'name' : place.includes('first') ? 'page' : 'alias'})`);
  }
}

// `init`: { kind, dirTarget, written, kept, valueByName }
export function docInit(kind, dirText, option = {}) {
  if (!INIT_KIND_LIST.includes(kind)) throw new DocCliError(`unknown kind "${kind ?? ''}": one of ${INIT_KIND_LIST.join(', ')}`);
  if (!dirText) throw new DocCliError(`the folder to create is missing: react-doc init ${kind} <dir>`);
  const dirTarget = path.resolve(option.cwd ?? process.cwd(), dirText);
  const isForce = option.force === true;
  const isFolderEmpty = option['folder-empty'] === true;
  const folderName = path.basename(dirTarget);
  const valueByName = { title: option.title ?? titleFromName(folderName) };
  const result = { kind, dirTarget, written: [], kept: [], valueByName };
  const resultAdd = (part, prefix = '') => {
    result.written.push(...part.written.map((file) => path.join(prefix, file)));
    result.kept.push(...part.kept.map((file) => path.join(prefix, file)));
  };
  targetCheck(dirTarget, isForce);
  if (kind === 'page') {
    valueByName.alias = option.alias ?? folderName;
    aliasCheck(valueByName.alias, 'the alias');
    resultAdd(scaffoldCopy('page', dirTarget, valueByName, isForce, isFolderEmpty));
  } else if (kind === 'workspace') {
    valueByName.pageAlias = option.page ?? WORKSPACE_PAGE_ALIAS_DEFAULT;
    aliasCheck(valueByName.pageAlias, 'the first doc page alias');
    resultAdd(scaffoldCopy('workspace', dirTarget, valueByName, isForce, isFolderEmpty));
    const dirPage = path.join(dirTarget, valueByName.pageAlias);
    resultAdd(scaffoldCopy('page', dirPage, { alias: valueByName.pageAlias, title: titleFromName(valueByName.pageAlias) }, isForce, isFolderEmpty), valueByName.pageAlias);
  } else {
    valueByName.name = option.name ?? folderName;
    if (!PACKAGE_NAME_REGEX.test(valueByName.name)) {
      throw new DocCliError(`the package name "${valueByName.name}" must be lowercase letters, digits and "-", starting with a letter (give one with --name)`);
    }
    resultAdd(scaffoldCopy('package', dirTarget, valueByName, isForce, isFolderEmpty));
  }
  return result;
}

// what to do next with what `init` created, as lines
function nextStepLineList(result) {
  const dirText = result.dirTarget;
  if (result.kind === 'page') {
    return [
      'next',
      '  list it in the docPageList of a workspace file',
      `    - { alias: ${result.valueByName.alias}, dir: ${dirText} }`,
      '  or mount it for a while from the Workspace tab of the settings panel (Mount, then its folder)',
    ];
  }
  if (result.kind === 'workspace') {
    return [
      'next',
      '  serve it: in main/config.0.yaml (the local layer of the package config)',
      `    workspace: { dir: ${dirText} }`,
      '  then start the development server (pnpm -C main dev)',
    ];
  }
  return [
    'next',
    '  import it from a workspace file',
    `    packageList: [{ dir: ${dirText} }]`,
  ];
}

export function docCliRun(argList, option = {}) {
  const out = option.out ?? ((text) => process.stdout.write(`${text}\n`));
  let parsed;
  try {
    parsed = parseArgs({
      args: argList,
      allowPositionals: true,
      options: {
        alias: { type: 'string' },
        page: { type: 'string' },
        name: { type: 'string' },
        title: { type: 'string' },
        force: { type: 'boolean' },
        'folder-empty': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (error) {
    throw new DocCliError(String(error?.message ?? error));
  }
  const [command, kind, dirText] = parsed.positionals;
  if (parsed.values.help || command === undefined || command === 'help') {
    out(USAGE_TEXT.trimEnd());
    return 0;
  }
  if (command !== 'init') throw new DocCliError(`unknown command "${command}" (react-doc --help)`);
  const result = docInit(kind, dirText, { ...parsed.values, cwd: option.cwd });
  const kindLabel = { page: 'doc page', workspace: 'workspace', package: 'package' }[result.kind];
  out(`created a ${kindLabel} in ${result.dirTarget}`);
  for (const file of result.written) out(`  written  ${file}`);
  for (const file of result.kept) out(`  kept     ${file}`);
  for (const line of nextStepLineList(result)) out(line);
  return 0;
}

// run as a program (a bin link resolves to this file)
const isMain = process.argv[1] && pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url;
if (isMain) {
  try {
    process.exitCode = docCliRun(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof DocCliError)) throw error;
    process.stderr.write(`react-doc: ${error.message}\n`);
    process.exitCode = 1;
  }
}
