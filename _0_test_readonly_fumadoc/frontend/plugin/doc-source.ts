import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { Plugin } from 'vite';
import {
  attachmentDataUrlGet,
  docAttachmentFinderDefaultList,
  docAttachmentsCollect,
  type DocAttachmentFinder,
  type DocAttachmentResolved,
} from './doc-attachment.ts';

// vite plugin "doc-source".
// reads two-layer yaml config, executes source rules against the file system,
// and exposes the result as virtual module `virtual:doc-source`:
//
//   export const configDoc = {...}      // merged config (side panel yaml inlined)
//   export const fileManifest = [{ rootId, relPath, name, ext, title, internalPath, load }]
//
// every doc file becomes a lazy `?raw` import, so dev gets hot reload and
// build gets one lazy chunk per doc.

const MODULE_ID_DEFAULT = 'virtual:doc-source';

export type DocSourcePluginOptions = {
  configFile?: string;
  moduleId?: string;
  excludeSidePanelItemIds?: string[];
  pruneSourceToSidePanel?: boolean;
  attachmentFinderList?: DocAttachmentFinder[];
};

type FileEntry = {
  rootId: string;
  relPath: string; // path inside root, '' for a root file
  name: string;
  ext: string;
  absPath: string;
  internalPath: string; // /{rootId}/relPath or /{rootId}/name for root file
};

export function docSourcePlugin(options: DocSourcePluginOptions = {}): Plugin {
  let configDir = '';
  let configFile = '';
  let isBuild = false;
  const moduleId = options.moduleId ?? MODULE_ID_DEFAULT;
  const moduleIdResolved = `\0${moduleId}`;

  return {
    name: `doc-source:${moduleId}`,

    config(viteConfig) {
      const viteRoot = path.resolve(process.cwd(), viteConfig.root ?? '.');
      const configFileEarly = findConfigFile(viteRoot, options.configFile);
      const configDirEarly = path.dirname(configFileEarly);
      const configDoc = loadConfigDoc(configFileEarly, options);
      return {
        server: {
          fs: {
            allow: collectSourceRoots(configDoc, configDirEarly),
          },
        },
      };
    },

    configResolved(viteConfig) {
      isBuild = viteConfig.command === 'build';
      configFile = findConfigFile(viteConfig.root, options.configFile);
      configDir = path.dirname(configFile);
    },

    resolveId(id) {
      if (id === moduleId) return moduleIdResolved;
    },

    load(id) {
      if (id !== moduleIdResolved) return;
      const configDoc = loadConfigDoc(configFile, options);
      const fileEntriesAll = scanSource(configDoc, configDir);
      const fileEntries = options.pruneSourceToSidePanel
        ? pruneSourceToSidePanel(configDoc, fileEntriesAll)
        : fileEntriesAll;
      const attachmentList = isBuild && configDoc.collectComponentAttachmentsOnBuild === true
        ? docAttachmentsCollect(
            configDoc,
            fileEntries,
            fileEntriesAll,
            configDir,
            [...docAttachmentFinderDefaultList, ...(options.attachmentFinderList ?? [])],
          )
        : [];
      return generateModuleCode(configDoc, fileEntries, attachmentList, isBuild);
    },

    configureServer(server) {
      const configDoc = loadConfigDoc(configFile, options);
      const pathsWatched = collectPathsToWatch(configDoc, configDir, configFile);
      for (const p of pathsWatched) server.watcher.add(p);

      const invalidateManifest = (filePath: string) => {
        const isRelated = pathsWatched.some(
          (p) => filePath === p || filePath.startsWith(p + path.sep),
        );
        if (!isRelated) return;
        const mod = server.moduleGraph.getModuleById(moduleIdResolved);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };

      // file added/removed inside source roots, or config/side panel yaml edited:
      // the manifest itself must be regenerated.
      server.watcher.on('add', invalidateManifest);
      server.watcher.on('unlink', invalidateManifest);
      server.watcher.on('change', (filePath) => {
        if (filePath.endsWith('.yaml')) invalidateManifest(filePath);
      });
    },
  };
}

// ---------- config ----------

function findConfigFile(viteRoot: string, configFileOption?: string): string {
  if (configFileOption) {
    const configFile = path.isAbsolute(configFileOption)
      ? configFileOption
      : path.resolve(viteRoot, configFileOption);
    if (!fs.existsSync(configFile)) {
      throw new Error(`[doc-source] config file not found: ${configFile}`);
    }
    return configFile;
  }
  const candidates = [viteRoot, path.resolve(viteRoot, '..')];
  for (const dir of candidates) {
    const configFile = path.join(dir, 'config.yaml');
    if (fs.existsSync(configFile)) return configFile;
  }
  throw new Error(`[doc-source] config.yaml not found near ${viteRoot}`);
}

function loadConfigDoc(configFile: string, options: DocSourcePluginOptions = {}): any {
  const configDir = path.dirname(configFile);
  const extension = path.extname(configFile);
  const configLocalFile = path.join(
    configDir,
    `${path.basename(configFile, extension)}.0${extension}`,
  );
  const configBase = readYaml(configFile) ?? {};
  const configLocal = readYaml(configLocalFile) ?? {};
  const config = mergeDeep(configBase, configLocal);
  config.source = loadSourceRules(config.source, configDir);
  if (!Array.isArray(config.source)) {
    throw new Error('[doc-source] config "source" must be a list of rules');
  }
  // inline side panel yaml, so the browser side doesn't touch the file system
  if (config.sidePanel?.file) {
    const panelPath = path.resolve(configDir, config.sidePanel.file);
    config.sidePanel.tree = readYaml(panelPath)?.tree ?? null;
  }
  const itemIdsExcluded = new Set(options.excludeSidePanelItemIds ?? []);
  if (itemIdsExcluded.size > 0 && Array.isArray(config.sidePanel?.tree)) {
    config.sidePanel.tree = excludeSidePanelItems(config.sidePanel.tree, itemIdsExcluded);
  }
  return config;
}

function excludeSidePanelItems(nodes: any[], itemIdsExcluded: Set<string>): any[] {
  return nodes
    .filter((node) => !itemIdsExcluded.has(String(node?.id ?? '')))
    .map((node) => Array.isArray(node?.children)
      ? { ...node, children: excludeSidePanelItems(node.children, itemIdsExcluded) }
      : node);
}

function loadSourceRules(source: any, configDir: string): any[] | any {
  if (Array.isArray(source)) return source;
  if (!source?.file) return source;
  const sourceFile = path.resolve(configDir, source.file);
  const sourceConfig = readYaml(sourceFile);
  const rules = Array.isArray(sourceConfig) ? sourceConfig : sourceConfig?.rules;
  if (!Array.isArray(rules)) {
    throw new Error(`[doc-source] source file must contain a rule list: ${sourceFile}`);
  }
  const sourceDir = path.dirname(sourceFile);
  return rules.map((rule) => {
    if ((rule.action !== 'addFolder' && rule.action !== 'addFile') || !rule.path) return rule;
    const pathAbsolute = path.resolve(sourceDir, rule.path);
    return { ...rule, path: path.relative(configDir, pathAbsolute) || '.' };
  });
}

function readYaml(filePath: string): any {
  if (!fs.existsSync(filePath)) return undefined;
  return parseYaml(fs.readFileSync(filePath, 'utf-8'));
}

// objects merge recursively; arrays and scalars from local layer replace base layer
function mergeDeep(base: any, overlay: any): any {
  if (overlay === undefined || overlay === null) return base;
  const isObj = (v: any) => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isObj(base) || !isObj(overlay)) return overlay;
  const result: Record<string, any> = { ...base };
  for (const key of Object.keys(overlay)) result[key] = mergeDeep(base[key], overlay[key]);
  return result;
}

// ---------- source rules ----------

function scanSource(configDoc: any, configDir: string): FileEntry[] {
  let entries: FileEntry[] = [];

  for (const rule of configDoc.source) {
    if (rule.action === 'addFolder') {
      const dirAbs = path.resolve(configDir, rule.path);
      if (!fs.existsSync(dirAbs)) {
        console.warn(`[doc-source] addFolder: not found: ${dirAbs}`);
        continue;
      }
      const rootId = rule.rootId ?? path.basename(dirAbs);
      for (const fileAbs of walkFiles(dirAbs)) {
        entries.push(makeEntry(rootId, path.relative(dirAbs, fileAbs), fileAbs));
      }
    } else if (rule.action === 'addFile') {
      const fileAbs = path.resolve(configDir, rule.path);
      if (!fs.existsSync(fileAbs)) {
        console.warn(`[doc-source] addFile: not found: ${fileAbs}`);
        continue;
      }
      const rootId = rule.rootId ?? path.basename(fileAbs);
      entries.push(makeEntry(rootId, path.basename(fileAbs), fileAbs));
    } else if (rule.action === 'removeByName') {
      const regex = globToRegex(rule.pattern);
      entries = entries.filter((e) => !regex.test(e.name));
    } else if (rule.action === 'removeByPath') {
      const regex = globToRegex(normalizeSlash(rule.pattern));
      entries = entries.filter((e) => !regex.test(e.internalPath));
    } else {
      throw new Error(`[doc-source] unknown source rule action: ${rule.action}`);
    }
  }

  // same file re-added: keep last occurrence
  const byInternalPath = new Map<string, FileEntry>();
  for (const e of entries) byInternalPath.set(e.internalPath, e);
  return [...byInternalPath.values()];
}

function makeEntry(rootId: string, relPath: string, absPath: string): FileEntry {
  const relSlash = relPath.split(path.sep).join('/');
  const name = path.basename(absPath);
  return {
    rootId,
    relPath: relSlash,
    name,
    ext: path.extname(name).slice(1).toLowerCase(),
    absPath,
    internalPath: `/${rootId}/${relSlash}`,
  };
}

function walkFiles(dirAbs: string): string[] {
  const result: string[] = [];
  for (const item of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    if (item.name === '.git' || item.name === 'node_modules') continue;
    const itemAbs = path.join(dirAbs, item.name);
    if (item.isDirectory()) result.push(...walkFiles(itemAbs));
    else if (item.isFile()) result.push(itemAbs);
  }
  return result;
}

// supports **, *, ? ; matches against full string
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0001')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0001/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function normalizeSlash(pattern: string): string {
  return pattern.startsWith('/') ? pattern : `/${pattern}`;
}

// Optional deployment optimization: retain only files explicitly referenced by
// the semantic side panel. Components that load raw files declare those paths
// through sourceDependencies, keeping this build policy out of rendering code.
function pruneSourceToSidePanel(configDoc: any, entries: FileEntry[]): FileEntry[] {
  const references: string[] = [];
  const visit = (nodes: any[]) => {
    for (const node of nodes) {
      if (node?.doc !== undefined) references.push(String(node.doc));
      if (Array.isArray(node?.sourceDependencies)) {
        references.push(...node.sourceDependencies.map(String));
      }
      if (Array.isArray(node?.children)) visit(node.children);
    }
  };
  visit(Array.isArray(configDoc.sidePanel?.tree) ? configDoc.sidePanel.tree : []);

  const pathsIncluded = new Set<string>();
  for (const reference of references) {
    for (const entry of resolveSourceReference(reference, entries)) {
      pathsIncluded.add(entry.internalPath);
    }
  }
  return entries.filter((entry) => pathsIncluded.has(entry.internalPath));
}

function resolveSourceReference(reference: string, entries: FileEntry[]): FileEntry[] {
  if (reference.startsWith('/')) {
    return entries.filter((entry) => entry.internalPath === reference);
  }
  if (reference.includes('/')) {
    const suffix = `/${reference.replace(/^\.\//, '')}`;
    return entries.filter((entry) => entry.internalPath.endsWith(suffix));
  }
  return entries.filter((entry) => entry.name === reference);
}

// ---------- module generation ----------

function generateModuleCode(
  configDoc: any,
  fileEntries: FileEntry[],
  attachmentList: DocAttachmentResolved[],
  isBuild: boolean,
): string {
  const lines: string[] = [];
  lines.push(`export const configDoc = ${JSON.stringify(configDoc)};`);
  const attachmentUrlByPath: Record<string, string> = {};
  for (const attachment of attachmentList) {
    const url = attachmentDataUrlGet(attachment.absPath);
    for (const reference of attachment.referenceList) {
      attachmentUrlByPath[reference.replace(/^\.?\//, '')] = url;
    }
  }
  lines.push(`export const attachmentUrlByPath = ${JSON.stringify(attachmentUrlByPath)};`);
  lines.push('export const fileManifest = [');
  for (const e of fileEntries) {
    const importId = (isBuild ? e.absPath : '/@fs/' + normalizeSlashPath(e.absPath)) + '?raw';
    lines.push(
      `  { rootId: ${JSON.stringify(e.rootId)}, relPath: ${JSON.stringify(e.relPath)},` +
        ` name: ${JSON.stringify(e.name)}, ext: ${JSON.stringify(e.ext)},` +
        ` title: ${JSON.stringify(extractTitle(e))},` +
        ` internalPath: ${JSON.stringify(e.internalPath)},` +
        ` load: () => import(${JSON.stringify(importId)}).then((m) => m.default) },`,
    );
  }
  lines.push('];');
  if (!isBuild) {
    lines.push('const listenersDocSource = import.meta.hot?.data.listenersDocSource ?? new Set();');
    lines.push('export function subscribeDocSource(listener) { listenersDocSource.add(listener); return () => listenersDocSource.delete(listener); }');
    lines.push('if (import.meta.hot) {');
    lines.push('  import.meta.hot.dispose((data) => { data.listenersDocSource = listenersDocSource; });');
    lines.push('  import.meta.hot.accept((moduleNext) => {');
    lines.push('    if (!moduleNext) return;');
    lines.push('    const dataNext = { configDoc: moduleNext.configDoc, fileManifest: moduleNext.fileManifest };');
    lines.push('    for (const listener of listenersDocSource) listener(dataNext);');
    lines.push('  });');
    lines.push('}');
  } else {
    lines.push('export function subscribeDocSource() { return () => {}; }');
  }
  return lines.join('\n');
}

function extractTitle(entry: FileEntry): string {
  if (entry.ext !== 'md' && entry.ext !== 'mdx') return entry.name;
  const text = fs.readFileSync(entry.absPath, 'utf-8');
  const matchFrontmatter = /^---\r?\n[\s\S]*?\btitle:\s*["']?([^"'\r\n]+)["']?\r?\n[\s\S]*?---/.exec(text);
  if (matchFrontmatter) return matchFrontmatter[1].trim();
  const heading = firstLevelOneHeadingGet(text);
  if (heading) return heading;
  return entry.name;
}

function firstLevelOneHeadingGet(text: string): string {
  let fenceCharacter = '';
  let fenceLength = 0;
  for (const line of text.split(/\r?\n/)) {
    const matchFence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (matchFence) {
      const marker = matchFence[1];
      if (!fenceCharacter) {
        fenceCharacter = marker[0];
        fenceLength = marker.length;
      } else if (marker[0] === fenceCharacter && marker.length >= fenceLength) {
        fenceCharacter = '';
        fenceLength = 0;
      }
      continue;
    }
    if (fenceCharacter) continue;
    const matchHeading = /^ {0,3}#\s+(.+?)\s*$/.exec(line);
    if (matchHeading) return matchHeading[1].replace(/\s+#+\s*$/, '').trim();
  }
  return '';
}

function normalizeSlashPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function collectPathsToWatch(configDoc: any, configDir: string, configFile: string): string[] {
  const extension = path.extname(configFile);
  const result = [
    configFile,
    path.join(configDir, `${path.basename(configFile, extension)}.0${extension}`),
  ];
  const configRaw = readYaml(configFile);
  if (configRaw?.source?.file) result.push(path.resolve(configDir, configRaw.source.file));
  if (configDoc.sidePanel?.file) result.push(path.resolve(configDir, configDoc.sidePanel.file));
  for (const rule of configDoc.source) {
    if (rule.action === 'addFolder' || rule.action === 'addFile') {
      result.push(path.resolve(configDir, rule.path));
    }
  }
  return result;
}

function collectSourceRoots(configDoc: any, configDir: string): string[] {
  const result = new Set<string>([configDir]);
  for (const rule of configDoc.source) {
    if (rule.action === 'addFolder') {
      result.add(path.resolve(configDir, rule.path));
    } else if (rule.action === 'addFile') {
      result.add(path.dirname(path.resolve(configDir, rule.path)));
    }
  }
  return [...result];
}
