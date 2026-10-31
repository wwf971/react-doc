import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

// The packages a workspace imports (design: doc_page_impl_package.md).
// A package is a folder of components and service templates, with
// documents of its own, that a workspace names by the path of its folder;
// a package names the packages it needs the same way. Unlike a doc page,
// a package has no conventions to override: its config file has a fixed
// name and fixed required keys, its folders have fixed names, and a
// package that breaks the rules is an error of the workspace, not a
// warning.
//
//   {package}/
//     doc-package.yaml         name, description, packageDependList (all required)
//     doc/README.md            the root document of the package (required)
//     comp-mdx/                its components: comp.yaml manifests, as in a doc page
//     service-template-app/    its app service templates
//     service-template-infra/  its infra service templates
//
// the folders but doc/ may be absent (nothing of that kind). a package holds
// no service instances and no asset objects: those are state, and belong to
// a doc page.

export const PACKAGE_CONFIG_FILE_NAME = 'doc-package.yaml';
export const PACKAGE_DOC_ROOT_FILE = 'doc/README.md';
export const PACKAGE_COMP_FOLDER_NAME = 'comp-mdx';
export const PACKAGE_SERVICE_TEMPLATE_FOLDER_LIST: { path: string; kind: 'app' | 'infra' }[] = [
  { path: 'service-template-app', kind: 'app' },
  { path: 'service-template-infra', kind: 'infra' },
];
const PACKAGE_CONFIG_KEY_LIST = ['name', 'description', 'packageDependList'];
const PACKAGE_NAME_REGEX = /^[a-z][a-z0-9-]*$/;

// one package as the workspace names it: { dir }, relative to the file
// that names it
export type DocPackageSpec = { dir: string };

export type DocPackageLoaded = {
  name: string;
  description: string;
  // the package folder, absolute
  dir: string;
  configFile: string;
  // the folders of the packages it needs, absolute, as written in its config
  dependDirList: string[];
  // where it was named first, for messages
  place: string;
};

// the list of packages a workspace (or config, for one doc page) writes:
// [{ dir }], paths relative to dirBase
export function docPackageSpecListRead(value: any, dirBase: string, place: string): DocPackageSpec[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`[doc-package] ${place}: packageList is a list of { dir }`);
  return value.map((item: any, index: number) => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.dir !== 'string' || item.dir.trim() === '' || Object.keys(item).length !== 1) {
      throw new Error(`[doc-package] ${place} packageList[${index}]: a package is { dir }, the path of its folder`);
    }
    return { dir: path.resolve(dirBase, item.dir.trim()) };
  });
}

// every package the workspace needs, each once: the ones it names and,
// before each, the ones that one needs (depth first), so a package comes
// after the packages it depends on. two folders with one name, a cycle, or
// a package that breaks the rules: an error
export function docPackageListLoad(specList: DocPackageSpec[], place: string): DocPackageLoaded[] {
  const result: DocPackageLoaded[] = [];
  const packageByDir = new Map<string, DocPackageLoaded>();
  const packageByName = new Map<string, DocPackageLoaded>();
  const visit = (dir: string, placeNamed: string, chain: string[]) => {
    if (packageByDir.has(dir)) return;
    if (chain.includes(dir)) {
      throw new Error(`[doc-package] the packages depend on each other in a cycle: ${[...chain, dir].map((item) => path.basename(item)).join(' -> ')}`);
    }
    const loaded = docPackageRead(dir, placeNamed);
    for (const dependDir of loaded.dependDirList) visit(dependDir, loaded.configFile, [...chain, dir]);
    const samePackage = packageByName.get(loaded.name);
    if (samePackage) {
      throw new Error(`[doc-package] two packages are named "${loaded.name}": ${samePackage.dir} and ${loaded.dir}`);
    }
    packageByDir.set(dir, loaded);
    packageByName.set(loaded.name, loaded);
    result.push(loaded);
  };
  for (const spec of specList) visit(spec.dir, place, []);
  return result;
}

// one package folder, its config checked
export function docPackageRead(dir: string, place: string): DocPackageLoaded {
  const configFile = path.join(dir, PACKAGE_CONFIG_FILE_NAME);
  if (!fs.existsSync(configFile)) {
    throw new Error(`[doc-package] ${place}: no package at ${dir} (a package has ${PACKAGE_CONFIG_FILE_NAME} at its root)`);
  }
  let content: any;
  try {
    content = parseYaml(fs.readFileSync(configFile, 'utf-8'));
  } catch (error: any) {
    throw new Error(`[doc-package] ${configFile}: not valid yaml: ${String(error?.message ?? error)}`);
  }
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    throw new Error(`[doc-package] ${configFile}: must be a mapping { ${PACKAGE_CONFIG_KEY_LIST.join(', ')} }`);
  }
  for (const key of Object.keys(content)) {
    if (!PACKAGE_CONFIG_KEY_LIST.includes(key)) throw new Error(`[doc-package] ${configFile}: unknown key "${key}" (known: ${PACKAGE_CONFIG_KEY_LIST.join(', ')})`);
  }
  for (const key of PACKAGE_CONFIG_KEY_LIST) {
    if (content[key] === undefined) throw new Error(`[doc-package] ${configFile}: "${key}" is required`);
  }
  if (typeof content.name !== 'string' || !PACKAGE_NAME_REGEX.test(content.name)) {
    throw new Error(`[doc-package] ${configFile}: name is lower-case letters, digits and "-", starting with a letter (got ${JSON.stringify(content.name)})`);
  }
  if (typeof content.description !== 'string') throw new Error(`[doc-package] ${configFile}: description is a text`);
  const dependSpecList = docPackageSpecListRead(content.packageDependList, dir, configFile);
  const docRootFile = path.join(dir, PACKAGE_DOC_ROOT_FILE);
  if (!fs.existsSync(docRootFile)) throw new Error(`[doc-package] ${dir}: the root document ${PACKAGE_DOC_ROOT_FILE} is required`);
  return {
    name: content.name,
    description: content.description.trim(),
    dir,
    configFile,
    dependDirList: dependSpecList.map((spec) => spec.dir),
    place,
  };
}

// the component folder of a package, absolute (existing or not)
export function docPackageCompFolderGet(loaded: Pick<DocPackageLoaded, 'dir'>): string {
  return path.join(loaded.dir, PACKAGE_COMP_FOLDER_NAME);
}
