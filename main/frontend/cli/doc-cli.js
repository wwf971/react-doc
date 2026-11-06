#!/usr/bin/env node
// The command line of the react-doc package (design: main/doc_page_impl_cli.md).
//
//   react-doc init page <dir>       a doc page folder: .doc-page/ with its entry, a home document
//   react-doc init workspace <dir>  a workspace folder: .doc-workspace/workspace.yaml and a first doc page
//   react-doc init package <dir>    a package folder: doc-package.yaml, doc/README.md, .doc-page/
//   react-doc dev [<path>]          serves a doc page, a package or a workspace
//   react-doc build [<path>] --out  the same as a static page: one html file, or a folder
//   react-doc where                 where this copy of react-doc finds what it needs
//   react-doc pack [--out <dir>]    the folder `npm publish` publishes (the installed mode)
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
//
// `dev` needs the page's dependencies (vite is imported when it runs), and hands
// what to serve to vite.config.ts in the environment: the launch layer, over
// config.yaml (doc_page_impl_cli.md#the-launch-layer). It works the same way from
// a checkout (the source mode) and from an installed npm package (the installed
// mode): the package keeps the layout of the project, so the paths below hold
// in both; an installed copy is served from a folder out of node_modules/
// (docLayoutRunGet).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { docBuildFontSlim, docBuildSlimPlugin } from '../plugin/doc-build-slim.js';

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
const DEV_PORT_DEFAULT = 45174;
const DEV_KIND_LIST = ['page', 'package', 'workspace'];

const USAGE_TEXT = `react-doc: create and serve doc pages, workspaces and packages (main/doc_page_impl_cli.md)

usage
  react-doc init page <dir>       [--alias <alias>] [--title <title>]
  react-doc init workspace <dir>  [--page <alias>] [--title <title>]
  react-doc init package <dir>    [--name <name>] [--title <title>]
  react-doc dev [<path>]          [options below]
  react-doc build [<path>] --out <file.html | dir>  [options below]
  react-doc where
  react-doc pack                  [--out <dir>]

init options
  --alias  the alias of the doc page and of its root  (default: the folder name)
  --page   the alias and folder of the first doc page (default: ${WORKSPACE_PAGE_ALIAS_DEFAULT})
  --name   the name of the package                     (default: the folder name)
  --title  the title                                   (default: from the folder name)
  --force         write into a folder that is not empty; existing files are kept
  --folder-empty  write the managed folders too (components, assets, services), empty;
                  by default the first item put in one makes it

dev options
  <path>           a doc page folder or entry file, a package folder, a workspace folder or
                   file (default: the current folder); which one is found from what it holds
  --kind <kind>    say which one: page | package | workspace
  --alias <alias>  the alias of the doc page in its virtual workspace
  --side-panel <id>  the side panel of the doc page to show
  --mount <path>[,alias=<alias>][,side-panel=<id>]
                   one more doc page for this run, written in no file (repeatable): a doc page
                   folder or entry file, or a package folder. alias: default the folder name
  --package <dir|name>   a package the virtual workspace imports (repeatable)
  --package-dir <dir>    a folder of packages, where a package named by name is found (repeatable);
                         the packages of this react-doc are always searched
  --backend <file>       the service backend config to start with the page
                         (default: .doc-page/service-backend.yaml of the doc page, when it has one)
  --no-backend           no service backend, even when the doc page has a config for one
  --config <file>        the package config (default: main/config.yaml of this react-doc)
  --port <n>             (default: the first free one from ${DEV_PORT_DEFAULT})
  --host                 listen on every address
  --open                 open the browser
  --root <dir>           serve with the react-doc of this folder (a checkout) instead of this one

build options (and --kind, --alias, --side-panel, --mount, --package, --package-dir, --config, --root above)
  --out <file.html>      one html file holding everything: it opens from disk, offline. What no document
                         seems to use is left out (mermaid, the spreadsheet engine, code languages)
  --out <dir>            a folder of static files to put on a web server (a folder holding
                         something else is refused without --force)
  --keep-all             one file with everything the page can use, however large
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
      `  serve it alone: react-doc dev ${dirText}`,
      '  or list it in the docPageList of a workspace file',
      `    - { alias: ${result.valueByName.alias}, dir: ${dirText} }`,
      '  or mount it for a while from the Workspace tab of the settings panel (Mount, then its folder)',
    ];
  }
  if (result.kind === 'workspace') {
    return [
      'next',
      `  serve it: react-doc dev ${dirText}`,
    ];
  }
  return [
    'next',
    `  see it as a read-only doc page: react-doc dev ${dirText}`,
    '  import it from a workspace file',
    `    packageList: [{ dir: ${dirText} }]`,
  ];
}

// ---------- where this copy of react-doc finds what it needs ----------

// the folders of this copy, from the place of this script: the same layout in
// a checkout and in the published package (`pack` keeps it). the source mode is
// a checkout; the installed mode lies in node_modules/
export function docLayoutGet(scriptFile = fileURLToPath(import.meta.url)) {
  const fileReal = fs.realpathSync(scriptFile);
  const dirFrontend = path.resolve(path.dirname(fileReal), '..');
  const dirRoot = path.resolve(dirFrontend, '..', '..');
  return {
    mode: fileReal.split(path.sep).includes('node_modules') ? 'installed' : 'source',
    dirRoot,
    dirFrontend,
    configFile: path.join(dirRoot, 'main', 'config.yaml'),
    dirBuiltIn: path.join(dirRoot, 'built-in'),
    dirPackage: path.join(dirRoot, 'package'),
    fileBackend: path.join(dirRoot, 'main', 'service-backend', 'server.py'),
  };
}

// ---------- dev: what a path is, and the launch layer ----------

// what a folder or file holds: { kind, dir?, file? }; a folder holding several
// kinds needs --kind (a package is a doc page too, and says so itself)
export function docTargetRead(pathAbs, kindWanted) {
  if (!fs.existsSync(pathAbs)) throw new DocCliError(`nothing at ${pathAbs}`);
  if (kindWanted !== undefined && !DEV_KIND_LIST.includes(kindWanted)) {
    throw new DocCliError(`unknown kind "${kindWanted}": one of ${DEV_KIND_LIST.join(', ')}`);
  }
  if (fs.statSync(pathAbs).isFile()) {
    const name = path.basename(pathAbs);
    const isWorkspaceFile = name === 'workspace.yaml' || path.basename(path.dirname(pathAbs)) === '.doc-workspace';
    const kind = kindWanted ?? (isWorkspaceFile ? 'workspace' : 'page');
    if (kind === 'package') throw new DocCliError(`a package is named by its folder, not by a file: ${pathAbs}`);
    return { kind, file: pathAbs };
  }
  const has = (...part) => fs.existsSync(path.join(pathAbs, ...part));
  const isPackage = has('doc-package.yaml');
  const isWorkspace = has('.doc-workspace', 'workspace.yaml') || has('workspace.yaml');
  const isDocPage = has('.doc-page') || has('entry.yaml');
  const kindList = [isPackage && 'package', isWorkspace && 'workspace', !isPackage && isDocPage && 'page'].filter(Boolean);
  if (kindWanted) {
    if (!kindList.includes(kindWanted) && !(kindWanted === 'page' && isPackage)) {
      throw new DocCliError(`${pathAbs} holds no ${kindWanted}${kindList.length > 0 ? ` (it holds: ${kindList.join(', ')})` : ''}`);
    }
    return { kind: kindWanted, dir: pathAbs };
  }
  if (kindList.length === 0) {
    throw new DocCliError(`${pathAbs} is neither a doc page (.doc-page/entry.yaml), a package (doc-package.yaml) nor a workspace (.doc-workspace/workspace.yaml); react-doc init makes one`);
  }
  if (kindList.length > 1) throw new DocCliError(`${pathAbs} holds a ${kindList.join(' and a ')}: say which with --kind`);
  if (kindList[0] === 'package' && !isDocPage) {
    throw new DocCliError(`the package at ${pathAbs} has no doc page (.doc-page/entry.yaml); react-doc init package ${pathAbs} --force adds one`);
  }
  return { kind: kindList[0], dir: pathAbs };
}

// a --package value: a folder when one is there, else the name of a package
function packageSpecRead(text, cwd) {
  const pathAbs = path.resolve(cwd, text);
  if (fs.existsSync(path.join(pathAbs, 'doc-package.yaml'))) return { dir: pathAbs };
  if (/^[a-z][a-z0-9-]*$/.test(text)) return { name: text };
  throw new DocCliError(`--package ${text}: no package there (a folder holding doc-package.yaml, or the name of one)`);
}

// a --mount value: <path>[,alias=<alias>][,side-panel=<id>]. the options are read
// from the right, so a path may hold commas; a value that is a path whole is one
const MOUNT_KEY_BY_OPTION = { alias: 'alias', 'side-panel': 'sidePanel' };

export function docMountRead(text, cwd) {
  let pathText = text;
  const mount = {};
  while (!fs.existsSync(path.resolve(cwd, pathText))) {
    const match = /^(.*),([^,=]*)=([^,]*)$/.exec(pathText);
    if (!match) break;
    const key = MOUNT_KEY_BY_OPTION[match[2]];
    if (!key || match[3] === '') {
      throw new DocCliError(`--mount ${text}: "${match[2]}=${match[3]}" is not one of ${Object.keys(MOUNT_KEY_BY_OPTION).map((name) => `${name}=<value>`).join(', ')}`);
    }
    if (mount[key] !== undefined) throw new DocCliError(`--mount ${text}: ${match[2]} is given twice`);
    mount[key] = match[3];
    pathText = match[1];
  }
  if (mount.alias !== undefined && !ALIAS_REGEX.test(mount.alias)) {
    throw new DocCliError(`--mount ${text}: the alias "${mount.alias}" is not one word (letters, digits, "_", "-", ".")`);
  }
  if (pathText === '') throw new DocCliError(`--mount ${text}: the path comes first`);
  let target;
  try {
    target = docTargetRead(path.resolve(cwd, pathText), 'page');
  } catch (error) {
    throw new DocCliError(`--mount ${text}: ${error.message}`);
  }
  return { ...(target.dir ? { dir: target.dir } : { file: target.file }), ...mount };
}

// the launch layer of a `dev` (doc_page_impl_cli.md#the-launch-layer)
export function docLaunchBuild(pathText, option, layout = docLayoutGet()) {
  const cwd = option.cwd ?? process.cwd();
  const target = docTargetRead(path.resolve(cwd, pathText ?? '.'), option.kind);
  const packageSearchDirList = [...(option['package-dir'] ?? []).map((dir) => path.resolve(cwd, dir)), layout.dirPackage];
  const launch = {
    kind: target.kind,
    target: target.dir ?? target.file,
    mode: layout.mode,
    command: [option.commandName ?? 'react-doc dev', path.relative(cwd, target.dir ?? target.file) || '.', ...(option.mount ?? []).map((text) => `--mount ${text}`)].join(' '),
    packageSearchDirList,
  };
  if (option.config) {
    launch.configFile = path.resolve(cwd, option.config);
    if (!fs.existsSync(launch.configFile)) throw new DocCliError(`--config: no file at ${launch.configFile}`);
  }
  const mountList = (option.mount ?? []).map((text) => docMountRead(text, cwd));
  if (mountList.length > 0) launch.mountList = mountList;
  const packageSpecList = (option.package ?? []).map((text) => packageSpecRead(text, cwd));
  if (target.kind === 'workspace') {
    for (const name of ['package', 'alias', 'side-panel']) {
      if (option[name] !== undefined) throw new DocCliError(`--${name} is for a doc page; a workspace says it in its file`);
    }
    launch.workspace = target.dir ? { dir: target.dir } : { file: target.file };
  } else {
    launch.docEntry = {
      ...(target.dir ? { dir: target.dir } : { file: target.file }),
      ...(option.alias ? { alias: option.alias } : {}),
      ...(option['side-panel'] ? { sidePanel: option['side-panel'] } : {}),
    };
    if (packageSpecList.length > 0) launch.packageList = packageSpecList;
  }
  // the service backend: named, or the config the doc page keeps for one
  if (option.backend && option['no-backend']) throw new DocCliError('--backend and --no-backend exclude each other');
  if (option.backend) {
    launch.backendConfigFile = path.resolve(cwd, option.backend);
    if (!fs.existsSync(launch.backendConfigFile)) throw new DocCliError(`--backend: no file at ${launch.backendConfigFile}`);
  } else if (!option['no-backend'] && target.dir && target.kind === 'page') {
    const backendConfigFile = path.join(target.dir, '.doc-page', 'service-backend.yaml');
    if (fs.existsSync(backendConfigFile)) launch.backendConfigFile = backendConfigFile;
  }
  return launch;
}

// the folders an installed copy is served from. vite treats anything under
// node_modules/ as a dependency: it adds version queries (two urls of one module,
// two instances of its state) and pre-bundles the page's own source. so the source
// is copied once per version out of node_modules/, into a folder with a node_modules/
// of links to the dependencies, and from there it is a checkout like any other
function docLayoutRunGet(layout) {
  if (layout.mode === 'source') return layout;
  const { version } = JSON.parse(fs.readFileSync(path.join(layout.dirRoot, 'package.json'), 'utf-8'));
  const hash = createHash('sha256').update(layout.dirRoot).digest('hex').slice(0, 10);
  const dirRun = path.join(process.env.REACT_DOC_CACHE_DIR ?? path.join(os.homedir(), '.cache', 'react-doc'), `${version}-${hash}`);
  const fileDone = path.join(dirRun, '.copied');
  if (!fs.existsSync(fileDone)) {
    fs.rmSync(dirRun, { recursive: true, force: true });
    for (const name of fs.readdirSync(layout.dirRoot)) {
      if (name !== 'node_modules') fs.cpSync(path.join(layout.dirRoot, name), path.join(dirRun, name), { recursive: true });
    }
    fs.writeFileSync(fileDone, '');
  }
  // the links, made anew each time: what the install holds may have changed. its
  // own node_modules/ first (the bundled dependencies), then the folder it lies in
  const dirLink = path.join(dirRun, 'node_modules');
  fs.rmSync(dirLink, { recursive: true, force: true });
  const linkAll = (dirFrom, dirTo) => {
    if (!fs.existsSync(dirFrom)) return;
    fs.mkdirSync(dirTo, { recursive: true });
    for (const name of fs.readdirSync(dirFrom)) {
      if (name === '.bin' || fs.existsSync(path.join(dirTo, name))) continue;
      const from = path.join(dirFrom, name);
      if (name.startsWith('@')) linkAll(from, path.join(dirTo, name));
      else fs.symlinkSync(fs.realpathSync(from), path.join(dirTo, name));
    }
  };
  linkAll(path.join(layout.dirRoot, 'node_modules'), dirLink);
  // .../node_modules/@scope/react-doc: the node_modules/ holding its dependencies
  const partList = layout.dirRoot.split(path.sep);
  linkAll(partList.slice(0, partList.lastIndexOf('node_modules') + 1).join(path.sep), dirLink);
  return { ...docLayoutGet(path.join(dirRun, 'main', 'frontend', 'cli', 'doc-cli.js')), mode: 'installed', dirInstalled: layout.dirRoot };
}

// `dev`: vite started on the frontend of this copy, with the launch layer in
// the environment. the cache of vite is per target, so several servers (and
// the one pnpm dev starts) do not fight over one folder
async function docDev(pathText, option, out) {
  const layout = docLayoutRunGet(docLayoutGet());
  const launch = docLaunchBuild(pathText, option, layout);
  process.env.REACT_DOC_LAUNCH = JSON.stringify(launch);
  const isPortGiven = option.port !== undefined;
  const port = isPortGiven ? Number(option.port) : DEV_PORT_DEFAULT;
  if (!Number.isInteger(port) || port <= 0) throw new DocCliError(`--port ${option.port}: not a port`);
  let vite;
  try {
    vite = await import('vite');
  } catch (error) {
    throw new DocCliError(`react-doc dev needs the dependencies of the page, which are not installed beside ${layout.dirFrontend}: ${String(error?.message ?? error)}`);
  }
  const hash = createHash('sha256').update(`${layout.dirRoot}\n${launch.target}`).digest('hex').slice(0, 12);
  // what cannot be served is told in a line: a mount refused, a doc page that does not load
  const loadFailureReport = (error) => {
    const message = String(error?.message ?? error);
    throw /^\[doc-[a-z-]+\] /.test(message) ? new DocCliError(message.replace(/^\[doc-[a-z-]+\] /, '')) : error;
  };
  const server = await vite.createServer({
    root: layout.dirFrontend,
    configFile: path.join(layout.dirFrontend, 'vite.config.ts'),
    cacheDir: path.join(os.tmpdir(), 'react-doc-vite', hash),
    server: {
      port,
      strictPort: isPortGiven,
      host: option.host === true ? true : undefined,
      open: option.open === true,
      // the links of the installed mode lead to the install; the rest is added by the plugin
      fs: { allow: [layout.dirRoot, ...(layout.dirInstalled ? [path.dirname(layout.dirInstalled.split(`${path.sep}node_modules${path.sep}`)[0])] : [])] },
    },
  }).catch(loadFailureReport);
  await server.listen();
  const kindLabel = { page: 'doc page', package: 'package, as a read-only doc page', workspace: 'workspace' }[launch.kind];
  out(`react-doc (${layout.mode} mode, ${layout.dirInstalled ?? layout.dirRoot})`);
  out(`  serving the ${kindLabel} ${launch.target}${launch.kind === 'workspace' ? '' : ', in a virtual workspace'}`);
  for (const mount of launch.mountList ?? []) {
    out(`  mounted for this run: ${mount.dir ?? mount.file}${mount.alias ? ` (alias ${mount.alias})` : ''}`);
  }
  out(`  service backend: ${launch.backendConfigFile ?? 'none'}`);
  for (const url of server.resolvedUrls?.local ?? []) out(`  ${url}`);
  for (const url of server.resolvedUrls?.network ?? []) out(`  ${url}`);
  const close = () => server.close().finally(() => process.exit(0));
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
  return new Promise(() => {});
}

// `build`: vite builds the frontend of this copy with the launch layer, as `dev` serves it.
// a built page has no backend, and no write reaches its files
async function docBuild(pathText, option, out) {
  const cwd = option.cwd ?? process.cwd();
  if (!option.out) throw new DocCliError('react-doc build needs --out <file.html> or --out <dir>');
  const outPath = path.resolve(cwd, option.out);
  const isOneFile = outPath.toLowerCase().endsWith('.html');
  const layout = docLayoutRunGet(docLayoutGet());
  const launch = docLaunchBuild(pathText, { ...option, 'no-backend': true, commandName: 'react-doc build' }, layout);
  // the source rules of a doc page collect its folder: a build put there would be built next time
  const dirTarget = launch.target.toLowerCase().endsWith('.yaml') ? path.dirname(path.dirname(launch.target)) : launch.target;
  const outRelative = path.relative(dirTarget, outPath);
  if (!outRelative.startsWith('..') && !path.isAbsolute(outRelative)) {
    throw new DocCliError(`--out ${option.out} is inside what is being built (${dirTarget}), whose source rules would collect it: put it outside`);
  }
  if (!isOneFile && fs.existsSync(outPath) && fs.readdirSync(outPath).length > 0 && !fs.existsSync(path.join(outPath, 'index.html')) && !option.force) {
    throw new DocCliError(`--out ${option.out} holds files that are not a build, which would be deleted: name an empty folder, or give --force`);
  }
  process.env.REACT_DOC_LAUNCH = JSON.stringify(launch);
  let vite;
  try {
    vite = await import('vite');
  } catch (error) {
    throw new DocCliError(`react-doc build needs the dependencies of the page, which are not installed beside ${layout.dirFrontend}: ${String(error?.message ?? error)}`);
  }
  const loadFailureReport = (error) => {
    const message = String(error?.message ?? error);
    throw /^\[doc-[a-z-]+\] /.test(message) ? new DocCliError(message.replace(/^\[doc-[a-z-]+\] /, '')) : error;
  };
  const configBase = {
    root: layout.dirFrontend,
    configFile: path.join(layout.dirFrontend, 'vite.config.ts'),
    base: './',
    logLevel: 'warn',
  };
  if (!isOneFile) {
    await vite.build({ ...configBase, build: { outDir: outPath, emptyOutDir: true } }).catch(loadFailureReport);
    out(`built ${launch.target}`);
    out(`  into ${outPath}: static files for a web server (opened from disk, a browser refuses their scripts)`);
    return 0;
  }
  const slim = option['keep-all'] ? undefined : docBuildSlimPlugin();
  const dirOut = fs.mkdtempSync(path.join(os.tmpdir(), 'react-doc-build-'));
  try {
    await vite.build({
      ...configBase,
      plugins: slim ? [slim] : [],
      build: {
        outDir: dirOut,
        emptyOutDir: true,
        // fonts and images in the file; documents and assets are in the code (a built page has them as a snapshot)
        assetsInlineLimit: 1024 * 1024 * 1024,
        cssCodeSplit: false,
        chunkSizeWarningLimit: 1e9,
        // one chunk. a module also imported lazily is wrapped in an init function, and a static
        // importer may not call it, leaving its bindings undefined at run time: without the strict
        // order of execution, which makes every module run when the import graph says, the page crashes on load
        rollupOptions: { output: { codeSplitting: false, strictExecutionOrder: true }, checks: { pluginTimings: false } },
      },
    }).catch(loadFailureReport);
    docBuildOneFileWrite(dirOut, outPath, { isFontSlim: Boolean(slim) });
  } finally {
    fs.rmSync(dirOut, { recursive: true, force: true });
  }
  out(`built ${launch.target}`);
  out(`  into ${outPath}: ${(fs.statSync(outPath).size / 1e6).toFixed(1)} MB, one file that opens from disk, offline`);
  if (slim) {
    const { omitList, langList, langLeftOutCount, themeLeftOutCount } = slim.report;
    out(`  code languages kept: ${langList.join(', ') || 'none'} (${langLeftOutCount} left out, drawn as plain text; ${themeLeftOutCount} themes left out)`);
    if (omitList.length > 0) out(`  left out, no document seems to use it: ${omitList.join(', ')}`);
    out('  --keep-all keeps everything');
  }
  return 0;
}

// the html of a build with its scripts and styles put into it
export function docBuildOneFileWrite(dirBuild, outPath, { isFontSlim = false } = {}) {
  const inlined = [];
  const fileRead = (href) => {
    inlined.push(href);
    return fs.readFileSync(path.join(dirBuild, href), 'utf-8');
  };
  let html = fs.readFileSync(path.join(dirBuild, 'index.html'), 'utf-8');
  html = html.replace(/<link\s+rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_all, href) => {
    const text = fileRead(href);
    return `<style>${(isFontSlim ? docBuildFontSlim(text) : text).replace(/<\/style/gi, '<\\/style')}</style>`;
  });
  const scriptList = [];
  html = html.replace(/<script\s+type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g, (_all, src) => {
    scriptList.push(fileRead(src).replace(/<\/script/gi, '<\\/script'));
    return '';
  });
  html = html.replace(/<link\s+rel="modulepreload"[^>]*>/g, '');
  // a module script runs after the page is parsed anyway; at the end of the body the text of the script cannot be taken for markup
  const scriptTag = scriptList.map((text) => `<script type="module">${text}</script>`).join('\n');
  const index = html.lastIndexOf('</body>');
  html = `${html.slice(0, index)}${scriptTag}\n${html.slice(index)}`;
  const leftover = fs.readdirSync(path.join(dirBuild, 'assets')).filter((name) => !inlined.some((href) => href.endsWith(name)));
  if (leftover.length > 0) throw new DocCliError(`these files were not put into the html, so it would not be complete: ${leftover.join(', ')}`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);
}

function docWhere(out) {
  const layout = docLayoutGet();
  out(`mode       ${layout.mode}   (${layout.mode === 'source' ? 'a checkout' : 'an npm package in node_modules/'})`);
  out(`root       ${layout.dirRoot}`);
  out(`config     ${layout.configFile}   (with config.0.yaml beside it, when it exists)`);
  out(`built-in   ${layout.dirBuiltIn}`);
  out(`packages   ${layout.dirPackage}   (searched for a package named by name)`);
  out(`backend    ${layout.fileBackend}`);
  return 0;
}

// ---------- pack: the folder npm publishes ----------

// what the published package holds, relative to the project root. the layout of
// the project is kept, since its modules import each other by relative path
const PACK_FILE_LIST = [
  'README.md',
  'built-in',
  'package',
  'third_party',
  'main/config.yaml',
  'main/hotkey',
  'main/comp-doc',
  'main/service-backend',
  'main/frontend/src',
  'main/frontend/plugin',
  'main/frontend/cli',
  'main/frontend/UICommon.js',
  'main/frontend/UICommonExternal.js',
  'main/frontend/index.html',
  'main/frontend/vite.config.ts',
  'main/frontend/tsconfig.json',
];
const PACK_SKIP_NAME_SET = new Set(['node_modules', 'dist', '__pycache__', '.DS_Store', '.git', '.vite']);
const PACK_SKIP_NAME_REGEX = /\.(bak|tmp|pyc)$|^\..*\.deleted$|\.test\.js$|\.playground\.mdx?$/;
// the devDependency of the checkout that is a local package, not on npm: it goes
// into the published package itself (bundleDependencies)
const PACK_BUNDLED_LIST = ['@wwf971/react-comp-misc'];

// the folder of a dependency, looked for upward from a folder, links followed
function moduleDirFind(name, dirFrom) {
  for (let dir = dirFrom; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', ...name.split('/'));
    if (fs.existsSync(candidate)) return fs.realpathSync(candidate);
    if (dir === path.dirname(dir)) throw new DocCliError(`${name} is not installed above ${dirFrom}`);
  }
}

function packCopy(fromPath, toPath) {
  const stat = fs.statSync(fromPath);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(fromPath)) {
      if (PACK_SKIP_NAME_SET.has(name) || PACK_SKIP_NAME_REGEX.test(name)) continue;
      packCopy(path.join(fromPath, name), path.join(toPath, name));
    }
    return;
  }
  fs.mkdirSync(path.dirname(toPath), { recursive: true });
  fs.copyFileSync(fromPath, toPath);
}

// the bare packages the modules below a folder import, declared or not: the
// checkout resolves an undeclared one from its hoisted node_modules, an install
// would not have it
function packImportNameSet(dir, nameSet = new Set()) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (PACK_SKIP_NAME_SET.has(item.name)) continue;
    const itemPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      packImportNameSet(itemPath, nameSet);
    } else if (/\.(m?[jt]sx?)$/.test(item.name)) {
      const text = fs.readFileSync(itemPath, 'utf-8');
      for (const match of text.matchAll(/(?:\bfrom\s+|\bimport\s*\(?\s*)['"]([^'"./][^'"]*)['"]/g)) {
        const [first, second] = match[1].split('/');
        if (match[1].startsWith('node:') || match[1].startsWith('virtual:') || first === '@') continue;
        nameSet.add(first.startsWith('@') ? `\${first}/\${second}` : first);
      }
    }
  }
  return nameSet;
}

// the staged folder of `npm publish`, or `npm pack`: the project's layout, with
// a package.json of the whole at its root, the paths of its bin and exports
// starting at that root, and whatever a dev server needs among the dependencies
export function docPack(option = {}) {
  const layout = docLayoutGet();
  if (layout.mode !== 'source') throw new DocCliError('react-doc pack makes the published package from a checkout');
  const dirOut = path.resolve(option.cwd ?? process.cwd(), option.out ?? path.join(os.tmpdir(), 'react-doc-pack'));
  fs.rmSync(dirOut, { recursive: true, force: true });
  for (const item of PACK_FILE_LIST) {
    const fromPath = path.join(layout.dirRoot, item);
    if (fs.existsSync(fromPath)) packCopy(fromPath, path.join(dirOut, item));
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(layout.dirFrontend, 'package.json'), 'utf-8'));
  const dependencies = { ...manifest.peerDependencies, ...manifest.devDependencies, ...manifest.dependencies };
  for (const name of PACK_BUNDLED_LIST) {
    const dirFrom = moduleDirFind(name, layout.dirFrontend);
    packCopy(dirFrom, path.join(dirOut, 'node_modules', ...name.split('/')));
    const bundled = JSON.parse(fs.readFileSync(path.join(dirFrom, 'package.json'), 'utf-8'));
    Object.assign(dependencies, Object.fromEntries(Object.entries({ ...bundled.dependencies, ...bundled.peerDependencies }).filter(([key]) => !(key in dependencies))));
    dependencies[name] = bundled.version;
  }
  // what the modules import without declaring it, at the version the checkout has
  const importNameSet = packImportNameSet(dirOut);
  for (const name of PACK_BUNDLED_LIST) packImportNameSet(path.join(dirOut, 'node_modules', ...name.split('/')), importNameSet);
  // and the peers its dependencies need, which a package manager that leaves peers
  // out would not bring (a peer optional there stays optional)
  for (const name of Object.keys(dependencies)) {
    try {
      const manifestOther = JSON.parse(fs.readFileSync(path.join(moduleDirFind(name, layout.dirFrontend), 'package.json'), 'utf-8'));
      for (const peer of Object.keys(manifestOther.peerDependencies ?? {})) {
        if (manifestOther.peerDependenciesMeta?.[peer]?.optional !== true) importNameSet.add(peer);
      }
    } catch {
      // not installed in the checkout: nothing to read
    }
  }
  for (const name of importNameSet) {
    if (name in dependencies || name === manifest.name) continue;
    try {
      dependencies[name] = JSON.parse(fs.readFileSync(path.join(moduleDirFind(name, layout.dirFrontend), 'package.json'), 'utf-8')).version;
    } catch {
      // a name that is no package (an example in a comment, a path alias) stays out
    }
  }
  const rewrite = (value) => (typeof value === 'string' ? `./main/frontend/${value.replace(/^\.\//, '')}` : value);
  fs.writeFileSync(path.join(dirOut, 'package.json'), `${JSON.stringify({
    name: manifest.name,
    version: manifest.version,
    type: 'module',
    main: rewrite(manifest.main),
    exports: Object.fromEntries(Object.entries(manifest.exports).map(([key, value]) => [key, rewrite(value)])),
    bin: Object.fromEntries(Object.entries(manifest.bin).map(([key, value]) => [key, rewrite(value)])),
    dependencies,
    bundleDependencies: PACK_BUNDLED_LIST,
  }, null, 2)}\n`);
  return { dirOut, name: manifest.name, version: manifest.version };
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
        kind: { type: 'string' },
        'side-panel': { type: 'string' },
        mount: { type: 'string', multiple: true },
        package: { type: 'string', multiple: true },
        'package-dir': { type: 'string', multiple: true },
        backend: { type: 'string' },
        'no-backend': { type: 'boolean' },
        config: { type: 'string' },
        port: { type: 'string' },
        host: { type: 'boolean' },
        open: { type: 'boolean' },
        root: { type: 'string' },
        out: { type: 'string' },
        'keep-all': { type: 'boolean' },
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
  if (command === 'dev' || command === 'build') {
    if (parsed.values.root) {
      const scriptOther = path.join(path.resolve(option.cwd ?? process.cwd(), parsed.values.root), 'main', 'frontend', 'cli', 'doc-cli.js');
      if (!fs.existsSync(scriptOther)) throw new DocCliError(`--root: no react-doc at ${parsed.values.root}`);
      const argListOther = argList.filter((arg, index) => arg !== '--root' && argList[index - 1] !== '--root' && !arg.startsWith('--root='));
      return spawnSync(process.execPath, [scriptOther, ...argListOther], { stdio: 'inherit', cwd: option.cwd ?? process.cwd() }).status ?? 1;
    }
    return (command === 'dev' ? docDev : docBuild)(kind, { ...parsed.values, cwd: option.cwd }, out);
  }
  if (command === 'where') return docWhere(out);
  if (command === 'pack') {
    const result = docPack({ ...parsed.values, cwd: option.cwd });
    out(`staged ${result.name}@${result.version} in ${result.dirOut}`);
    out('next');
    out(`  npm pack ${result.dirOut}       or  npm publish ${result.dirOut}`);
    out('  then, in any project: npm install <the tarball>; npx react-doc dev <path>');
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
  const failureReport = (error) => {
    if (!(error instanceof DocCliError)) throw error;
    process.stderr.write(`react-doc: ${error.message}\n`);
    process.exitCode = 1;
  };
  try {
    const result = docCliRun(process.argv.slice(2));
    if (result instanceof Promise) result.catch(failureReport);
    else process.exitCode = result;
  } catch (error) {
    failureReport(error);
  }
}
