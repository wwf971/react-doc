import fs from 'node:fs';
import path from 'node:path';
import { parse as yamlParse } from 'yaml';

// The auth kinds a package brings (design: doc_page_impl_auth.md#auth-kinds-of-a-package). An
// auth kind is the code signing a person in against one sort of identity provider (Amazon
// Cognito, …); the auth layer of the page (DocAuthStore) knows no provider itself. A package
// declares its kinds in a file at its top, as it declares types of objects in type.yaml and
// storage types in asset-storage-type.yaml, and names the module of each, which the page imports:
//
//   # {package}/auth-kind.yaml
//   authKindList:
//     - id: cognito                         lower case letters, digits, "-": unique in the page
//       label: Amazon Cognito
//       description: ...
//       typeId: aws-utils.auth-cognito      the frontend objects of this type are its providers
//       module: { entry: ./auth/auth-kind-cognito.js, export: authKindCognito }   relative to the file
//
// the first declaration of an id is kept, in the loading order of the packages.

export const AUTH_KIND_FILE_NAME = 'auth-kind.yaml';

export type AuthKindDeclared = {
  id: string;
  label: string;
  description: string;
  // the type of the frontend objects that are providers of this kind
  typeId: string;
  definedBy: { kind: 'package'; name: string; file: string };
  // the module holding its code, absolute, and its export (not sent to the page as a path: the
  // plugin imports it)
  entryFile: string;
  export: string;
};

export type AuthKindConfig = {
  kindList: AuthKindDeclared[];
  fileList: { file: string; packageName: string; problemList: string[] }[];
  // absolute: the files to watch, whether they exist or not
  pathList: string[];
};

const KIND_KEY_LIST = ['id', 'label', 'description', 'typeId', 'module'];
const KIND_ID_REGEX = /^[a-z][a-z0-9-]*$/;

const problemWarnedSet = new Set<string>();

export function authKindConfigRead(packageList: { name: string; dir: string }[], configDir: string): AuthKindConfig {
  const config: AuthKindConfig = { kindList: [], fileList: [], pathList: [] };
  for (const onePackage of packageList) {
    const fileAbs = path.join(onePackage.dir, AUTH_KIND_FILE_NAME);
    config.pathList.push(fileAbs);
    if (!fs.existsSync(fileAbs)) continue;
    const record = { file: path.relative(configDir, fileAbs).split(path.sep).join('/'), packageName: onePackage.name, problemList: [] as string[] };
    config.fileList.push(record);
    let content: any;
    try {
      content = yamlParse(fs.readFileSync(fileAbs, 'utf-8')) ?? {};
    } catch (error: any) {
      record.problemList.push(`the file does not parse: ${String(error?.message ?? error)}`);
      continue;
    }
    if (!mappingIs(content) || !Array.isArray(content.authKindList)) {
      record.problemList.push('the file holds a mapping { authKindList: [{ id, typeId, module }] }');
      continue;
    }
    content.authKindList.forEach((item: any, index: number) => {
      const place = `authKindList[${index}]`;
      if (!mappingIs(item)) {
        record.problemList.push(`${place}: an auth kind is a mapping { id, typeId, module }`);
        return;
      }
      for (const key of Object.keys(item)) {
        if (!KIND_KEY_LIST.includes(key)) record.problemList.push(`${place}: unknown key "${key}" (known: ${KIND_KEY_LIST.join(', ')})`);
      }
      const id = String(item.id ?? '');
      if (!KIND_ID_REGEX.test(id)) {
        record.problemList.push(`${place}: "id" is lower case letters, digits and "-"`);
        return;
      }
      const kindSame = config.kindList.find((one) => one.id === id);
      if (kindSame) {
        record.problemList.push(`${place}: the auth kind ${id} is declared already (${kindSame.definedBy.file}); this one is left out`);
        return;
      }
      const typeId = String(item.typeId ?? '');
      if (!typeId) {
        record.problemList.push(`${place}: "typeId" names the type of the frontend objects that are providers of this kind`);
        return;
      }
      const module = item.module;
      if (!mappingIs(module) || typeof module.entry !== 'string' || !module.entry.trim() || typeof module.export !== 'string' || !module.export.trim()) {
        record.problemList.push(`${place}: "module" is { entry, export }: the module of the kind, relative to this file, and what it exports`);
        return;
      }
      const entryFile = path.resolve(path.dirname(fileAbs), module.entry.trim());
      if (!fs.existsSync(entryFile)) {
        record.problemList.push(`${place}: the module is not found: ${module.entry}`);
        return;
      }
      config.kindList.push({
        id, label: String(item.label ?? '') || id, description: String(item.description ?? ''), typeId,
        definedBy: { kind: 'package', name: onePackage.name, file: record.file }, entryFile, export: module.export.trim(),
      });
    });
  }
  for (const record of config.fileList) {
    for (const problem of record.problemList) {
      const text = `[doc-auth] ${record.file}: ${problem}`;
      if (problemWarnedSet.has(text)) continue;
      problemWarnedSet.add(text);
      console.warn(text);
    }
  }
  return config;
}

// what the page receives as configuration: no absolute path
export function authKindConfigForPage(config: AuthKindConfig) {
  return {
    kindList: config.kindList.map(({ entryFile: _entryFile, export: _export, ...kind }) => kind),
    problemList: config.fileList.flatMap((record) => record.problemList.map((message) => ({ file: record.file, message }))),
  };
}

function mappingIs(value: any): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
