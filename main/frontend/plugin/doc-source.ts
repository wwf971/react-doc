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
import {
  tagSourceAddRuleApply,
  tagSourceEntryMerge,
  tagSourceRuleApply,
  tagSourceRuleIs,
} from './doc-tag-source.ts';
import {
  configFrontmatterRead,
  configSourceAddRuleApply,
  configSourceEntryMerge,
  configSourceRuleApply,
  configSourceRuleIs,
} from './doc-config-source.ts';
import {
  docSourceDependenciesCollect,
  type DocSourceDependency,
  type DocSourceDependencyCollect,
} from './doc-source-dependency.ts';
import { docTargetResolve, sourceIndexBuild } from '../src/lib/doc-target-resolve.js';
import { textLocalizedGet } from '../src/lib/text-localized.js';

// vite plugin "doc-source".
// reads two-layer yaml config, executes source rules against the file system,
// and exposes the result as virtual module `virtual:doc-source`:
//
//   export const configDoc = {...}      // merged config (side panel yaml inlined)
//   export const fileManifest = [{ rootId, relPath, name, ext, title, internalPath,
//                                  tagList, configSource, configFrontmatter, load }]
//
// every doc file becomes a lazy `?raw` import, so dev gets hot reload and
// build gets one lazy chunk per doc.

const MODULE_ID_DEFAULT = 'virtual:doc-source';

export type DocSourcePluginOptions = {
  configFile?: string;
  moduleId?: string;
  excludeSidePanelItemIds?: string[];
  pruneSourceToSidePanel?: boolean;
  // extractors for the consumer's own component ids, used when pruning;
  // see comp-doc/registry/registry-source-dependency.js
  sourceDependencyCollectByCompId?: Record<string, DocSourceDependencyCollect>;
  attachmentFinderList?: DocAttachmentFinder[];
};

type FileEntry = {
  rootId: string;
  relPath: string; // path inside root, '' for a root file
  name: string;
  ext: string;
  absPath: string;
  internalPath: string; // /{rootId}/relPath or /{rootId}/name for root file
  tagList?: any[]; // tags declared by source rules, see doc-tag-source.ts
  configSource?: Record<string, any>; // config declared by source rules, see doc-config-source.ts
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
        ? pruneSourceToSidePanel(configDoc, fileEntriesAll, options.sourceDependencyCollectByCompId)
        : fileEntriesAll;
      const attachmentList = configDoc.collectComponentAttachmentsOnBuild === true
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
      let pathsWatched = collectPathsToWatch(configDoc, configDir, configFile);
      for (const p of pathsWatched) server.watcher.add(p);

      const invalidateManifest = (filePath: string) => {
        const isRelated = pathsWatched.some(
          (p) => filePath === p || filePath.startsWith(p + path.sep),
        );
        if (!isRelated) return;
        try {
          const configDocUpdated = loadConfigDoc(configFile, options);
          pathsWatched = collectPathsToWatch(configDocUpdated, configDir, configFile);
          for (const p of pathsWatched) server.watcher.add(p);
        } catch {
          // Keep the last valid watch set while an edited config is incomplete.
        }
        const mod = server.moduleGraph.getModuleById(moduleIdResolved);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };

      // file added/removed inside source roots, or config/side panel yaml edited:
      // the manifest itself must be regenerated.
      server.watcher.on('add', invalidateManifest);
      server.watcher.on('unlink', invalidateManifest);
      // change: yaml configuration, or an exactly watched dependency such as a
      // side-panel file imported through childrenFile with a non-yaml extension.
      // ordinary document content under a watched source folder does not match
      // exactly and keeps its generated raw-import HMR path.
      server.watcher.on('change', (filePath) => {
        if (filePath.endsWith('.yaml') || pathsWatched.includes(filePath)) {
          invalidateManifest(filePath);
        }
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
  const sourceRuleList = loadSourceRules(config.source, configDir);
  if (!Array.isArray(sourceRuleList)) {
    throw new Error('[doc-source] config "source" must be a list of rules');
  }
  // inline side panel yaml, so the browser side doesn't touch the file system.
  // "source" sections of the loaded side-panel resource files are appended to
  // the source rules, in load order. a file already read as config "source"
  // is not read twice.
  const context: SidePanelLoadContext = {
    configDir,
    fileList: [],
    sourceFileUsedSet: new Set(
      config.source?.file ? [path.resolve(configDir, config.source.file)] : [],
    ),
    sourceRuleList: [],
  };
  if (config.sidePanel?.file) {
    const panelPath = path.resolve(configDir, config.sidePanel.file);
    const sidePanelLoaded = loadSidePanelFile(panelPath, context);
    config.sidePanel.tree = sidePanelLoaded.tree;
    Object.defineProperty(config.sidePanel, 'fileListImported', {
      enumerable: false,
      value: context.fileList.slice(1),
    });
  }
  config.source = [...sourceRuleList, ...context.sourceRuleList];
  // inline tag definitions; entries written in config itself win
  if (config.tag?.file) {
    const tagFile = path.resolve(configDir, config.tag.file);
    const tagFileContent = readYaml(tagFile);
    if (tagFileContent === undefined) {
      throw new Error(`[doc-source] tag file not found: ${tagFile}`);
    }
    config.tag.defineById = {
      ...(tagFileContent?.defineById ?? {}),
      ...(config.tag.defineById ?? {}),
    };
  }
  const itemIdsExcluded = new Set(options.excludeSidePanelItemIds ?? []);
  if (itemIdsExcluded.size > 0 && Array.isArray(config.sidePanel?.tree)) {
    config.sidePanel.tree = excludeSidePanelItems(config.sidePanel.tree, itemIdsExcluded);
  }
  return config;
}

// ---------- side-panel resources ----------
// a side-panel resource is one { root?, tree } mapping. it is read from a
// YAML file in one of two forms:
//   sectioned   "sidePanel" section, next to an optional "source" section
//   legacy      top-level "root" / "tree" (a file holding only a side panel)
// the page side panel is the resource named by config sidePanel.file; a node's
// childrenFile includes another resource. design: doc_page_impl_side_panel.md

type SidePanelLoaded = {
  root?: Record<string, any>;
  tree: any[];
};

type SidePanelLoadContext = {
  configDir: string;
  // every side-panel file loaded, the page side-panel file first
  fileList: string[];
  // files whose "source" section is already taken
  sourceFileUsedSet: Set<string>;
  // rules of the "source" sections, paths relative to configDir
  sourceRuleList: any[];
};

function loadSidePanelFile(
  filePath: string,
  context: SidePanelLoadContext,
  fileChain: string[] = [],
): SidePanelLoaded {
  const filePathResolved = path.resolve(filePath);
  const cycleIndex = fileChain.indexOf(filePathResolved);
  if (cycleIndex >= 0) {
    const cycle = [...fileChain.slice(cycleIndex), filePathResolved].join(' -> ');
    throw new Error(`[doc-source] side panel childrenFile cycle: ${cycle}`);
  }
  if (!fs.existsSync(filePathResolved)) {
    throw new Error(`[doc-source] side panel file not found: ${filePathResolved}`);
  }

  const fileContent = readYaml(filePathResolved);
  const sidePanel = sidePanelResourceGet(fileContent, filePathResolved);
  if (!Array.isArray(sidePanel?.tree)) {
    throw new Error(
      `[doc-source] side panel file must contain a "tree" list, at top level or in a "sidePanel" section: ${filePathResolved}`,
    );
  }

  if (fileContent?.source !== undefined && !context.sourceFileUsedSet.has(filePathResolved)) {
    context.sourceFileUsedSet.add(filePathResolved);
    const ruleList = sourceRuleListGet(fileContent);
    if (!Array.isArray(ruleList)) {
      throw new Error(`[doc-source] "source" section must be a rule list or contain "rules": ${filePathResolved}`);
    }
    context.sourceRuleList.push(
      ...sourceRulesRebase(ruleList, path.dirname(filePathResolved), context.configDir),
    );
  }

  // optional "root" metadata: properties applied to the parent node that
  // imports this file through childrenFile. never a visible child item.
  const root = sidePanel.root;
  if (root !== undefined) {
    if (root === null || typeof root !== 'object' || Array.isArray(root)) {
      throw new Error(`[doc-source] side panel "root" must be a mapping: ${filePathResolved}`);
    }
    if (root.children !== undefined || root.childrenFile !== undefined) {
      throw new Error(
        `[doc-source] side panel "root" must not contain "children" or "childrenFile"` +
          ` (children belong to the top-level "tree" list): ${filePathResolved}`,
      );
    }
  }

  context.fileList.push(filePathResolved);
  const tree = loadSidePanelNodes(
    sidePanel.tree,
    path.dirname(filePathResolved),
    [...fileChain, filePathResolved],
    context,
  );
  return { root, tree };
}

function sidePanelResourceGet(fileContent: any, filePath: string): any {
  if (fileContent?.sidePanel === undefined) return fileContent;
  if (fileContent.tree !== undefined || fileContent.root !== undefined) {
    throw new Error(
      `[doc-source] side panel file must not combine a "sidePanel" section with top-level "tree" or "root": ${filePath}`,
    );
  }
  return fileContent.sidePanel;
}

function loadSidePanelNodes(
  nodes: any[],
  fileDir: string,
  fileChain: string[],
  context: SidePanelLoadContext,
): any[] {
  return nodes.map((node, index) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return node;

    const { childrenFile, ...nodeResult } = node;
    const childrenLocal = node.children;
    if (childrenLocal !== undefined && !Array.isArray(childrenLocal)) {
      throw new Error(
        `[doc-source] side panel "children" must be a list at ${fileChain.at(-1)} tree[${index}]`,
      );
    }

    let childrenImported: any[] = [];
    let rootImported: Record<string, any> = {};
    if (childrenFile !== undefined) {
      if (typeof childrenFile !== 'string' || !childrenFile.trim()) {
        throw new Error(
          `[doc-source] side panel "childrenFile" must be a non-empty path at ${fileChain.at(-1)} tree[${index}]`,
        );
      }
      const loaded = loadSidePanelFile(path.resolve(fileDir, childrenFile), context, fileChain);
      childrenImported = loaded.tree;
      rootImported = loaded.root ?? {};
    }

    const childrenLoaded = Array.isArray(childrenLocal)
      ? loadSidePanelNodes(childrenLocal, fileDir, fileChain, context)
      : [];
    // imported root metadata applies to this node; explicit local properties win.
    const nodeMerged = { ...rootImported, ...nodeResult };
    if (childrenFile !== undefined || childrenLocal !== undefined) {
      nodeMerged.children = [...childrenImported, ...childrenLoaded];
    }
    return nodeMerged;
  });
}

function excludeSidePanelItems(nodes: any[], itemIdsExcluded: Set<string>): any[] {
  return nodes
    .filter((node) => !itemIdsExcluded.has(String(node?.id ?? '')))
    .map((node) => Array.isArray(node?.children)
      ? { ...node, children: excludeSidePanelItems(node.children, itemIdsExcluded) }
      : node);
}

// config "source": a rule list, { file }, or absent when every rule comes from
// "source" sections of side-panel resource files.
function loadSourceRules(source: any, configDir: string): any[] | any {
  if (source === undefined || source === null) return [];
  if (Array.isArray(source)) return source;
  if (!source?.file) return source;
  const sourceFile = path.resolve(configDir, source.file);
  const rules = sourceRuleListGet(readYaml(sourceFile));
  if (!Array.isArray(rules)) {
    throw new Error(`[doc-source] source file must contain a rule list: ${sourceFile}`);
  }
  return sourceRulesRebase(rules, path.dirname(sourceFile), configDir);
}

// a source file is a rule list, { rules }, or a file with a "source" section
// (itself a rule list or { rules }), possibly next to a "sidePanel" section.
function sourceRuleListGet(fileContent: any): any[] | undefined {
  const section = fileContent?.source !== undefined ? fileContent.source : fileContent;
  return Array.isArray(section) ? section : section?.rules;
}

// rule paths are written relative to their own file; the scan reads them
// relative to configDir.
function sourceRulesRebase(rules: any[], fileDir: string, configDir: string): any[] {
  return rules.map((rule) => {
    if ((rule.action !== 'addFolder' && rule.action !== 'addFile') || !rule.path) return rule;
    const pathAbsolute = path.resolve(fileDir, rule.path);
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
  // keyed by internal path. a file added again while still collected keeps
  // its original position, takes the later entry, and accumulates its tags
  // and config in rule order.
  const entryByPath = new Map<string, FileEntry>();
  const entryAdd = (entry: FileEntry) => {
    const entryKept = entryByPath.get(entry.internalPath);
    if (entryKept) {
      entry.tagList = tagSourceEntryMerge(entryKept, entry);
      entry.configSource = configSourceEntryMerge(entryKept, entry);
    }
    entryByPath.set(entry.internalPath, entry);
  };
  const entryRemoveIf = (isRemoved: (entry: FileEntry) => boolean) => {
    for (const entry of [...entryByPath.values()]) {
      if (isRemoved(entry)) entryByPath.delete(entry.internalPath);
    }
  };

  for (const [ruleIndex, rule] of configDoc.source.entries()) {
    if (rule.action === 'addFolder') {
      const dirAbs = path.resolve(configDir, rule.path);
      if (!fs.existsSync(dirAbs)) {
        console.warn(`[doc-source] addFolder: not found: ${dirAbs}`);
        continue;
      }
      const rootId = rule.rootId ?? path.basename(dirAbs);
      for (const fileAbs of walkFiles(dirAbs)) {
        const entry = makeEntry(rootId, path.relative(dirAbs, fileAbs), fileAbs);
        tagSourceAddRuleApply(entry, rule, ruleIndex);
        configSourceAddRuleApply(entry, rule, ruleIndex);
        entryAdd(entry);
      }
    } else if (rule.action === 'addFile') {
      const fileAbs = path.resolve(configDir, rule.path);
      if (!fs.existsSync(fileAbs)) {
        console.warn(`[doc-source] addFile: not found: ${fileAbs}`);
        continue;
      }
      const rootId = rule.rootId ?? path.basename(fileAbs);
      const entry = makeEntry(rootId, path.basename(fileAbs), fileAbs);
      tagSourceAddRuleApply(entry, rule, ruleIndex);
      configSourceAddRuleApply(entry, rule, ruleIndex);
      entryAdd(entry);
    } else if (rule.action === 'removeByName') {
      const regex = globToRegex(rule.pattern);
      entryRemoveIf((e) => regex.test(e.name));
    } else if (rule.action === 'removeByPath') {
      const regex = globToRegex(normalizeSlash(rule.pattern));
      entryRemoveIf((e) => regex.test(e.internalPath));
    } else if (tagSourceRuleIs(rule)) {
      tagSourceRuleApply([...entryByPath.values()], rule, ruleIndex, globToRegex);
    } else if (configSourceRuleIs(rule)) {
      configSourceRuleApply([...entryByPath.values()], rule, ruleIndex, globToRegex);
    } else {
      throw new Error(`[doc-source] unknown source rule action: ${rule.action}`);
    }
  }

  return [...entryByPath.values()];
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

// Optional deployment optimization: retain only the files the side panel
// navigates to, plus every file they statically reach.
//
// roots: side-panel `doc` items and source folders (after side-panel
// exclusions), and the content of inline items. each retained .md/.mdx file is
// scanned by doc-source-dependency.ts; reached documents are scanned in turn,
// other files are retained without parsing. the side panel itself stays
// navigation only.
//
// a recognized local target that cannot be resolved is reported, never
// silently dropped. the manifest keeps the order of source rules.
//
// `sourceDependencies` on a side-panel item is the former manual list; it is
// still read, with a deprecation warning, and merged with the discovered files.
export function pruneSourceToSidePanel(
  configDoc: any,
  entries: FileEntry[],
  collectByCompId: Record<string, DocSourceDependencyCollect> = {},
): FileEntry[] {
  const sourceIndex = sourceIndexBuild(entries);
  const pathsRetained = new Set<string>();
  const docQueue: FileEntry[] = [];
  const entryRetain = (entry: FileEntry) => {
    if (pathsRetained.has(entry.internalPath)) return;
    pathsRetained.add(entry.internalPath);
    if (entry.ext === 'md' || entry.ext === 'mdx') docQueue.push(entry);
  };
  const collected = (
    result: { dependencyList: DocSourceDependency[]; warningList: string[] },
    sourceLabel: string,
  ) => {
    for (const warning of result.warningList) console.warn(`[doc-source] ${warning}`);
    for (const dependency of result.dependencyList) {
      for (const entry of dependencyEntryListGet(dependency, sourceIndex, sourceLabel)) entryRetain(entry);
    }
  };

  const visit = (nodes: any[]) => {
    for (const node of nodes) {
      if (node?.doc !== undefined) {
        for (const entry of resolveSourceReference(String(node.doc), entries)) entryRetain(entry);
      }
      if (node?.sourceFolder !== undefined || node?.sourceRoot !== undefined) {
        for (const entry of sourceFolderEntryListGet(node, entries)) entryRetain(entry);
      }
      if (node?.inline !== undefined) {
        const inline = typeof node.inline === 'string' ? { content: node.inline } : node.inline;
        const sourceLabel = `side-panel inline item "${node.id ?? textLocalizedGet(node.text).text}"`;
        collected(
          docSourceDependenciesCollect(
            String(inline?.content ?? ''),
            { internalPath: '', ext: inline?.format === 'md' ? 'md' : 'mdx' },
            configDoc,
            collectByCompId,
          ),
          sourceLabel,
        );
      }
      if (Array.isArray(node?.sourceDependencies)) {
        console.warn(
          `[doc-source] side-panel item "${node.id ?? node.doc ?? ''}": sourceDependencies is deprecated.`
          + ' Files referenced by retained documents are now discovered automatically; remove the list.',
        );
        for (const reference of node.sourceDependencies.map(String)) {
          const entryList = resolveSourceReference(reference, entries);
          if (entryList.length === 0) {
            console.warn(`[doc-source] sourceDependencies entry not in the collected source: ${reference}`);
          }
          for (const entry of entryList) entryRetain(entry);
        }
      }
      if (Array.isArray(node?.children)) visit(node.children);
    }
  };
  visit(Array.isArray(configDoc.sidePanel?.tree) ? configDoc.sidePanel.tree : []);

  while (docQueue.length > 0) {
    const entry = docQueue.shift()!;
    const text = fs.readFileSync(entry.absPath, 'utf-8');
    collected(docSourceDependenciesCollect(text, entry, configDoc, collectByCompId), entry.internalPath);
  }
  return entries.filter((entry) => pathsRetained.has(entry.internalPath));
}

// same rules as at runtime: documents and assets through docTargetResolve
// (DocSourceStore.resolveLink), source targets as exact internal paths
// (SourceLink).
function dependencyEntryListGet(
  dependency: DocSourceDependency,
  sourceIndex: any,
  sourceLabel: string,
): FileEntry[] {
  const declared = `${sourceLabel}: ${dependency.construct} "${dependency.target}"`;
  if (dependency.kind === 'source') {
    const entry = sourceIndex.entryByInternalPath.get(dependency.target);
    if (!entry) {
      console.warn(
        `[doc-source] ${declared} is not an exact internal path (/rootId/...) of the collected source;`
        + ' nothing was retained for it.',
      );
    }
    return entry ? [entry] : [];
  }
  const { entryList } = docTargetResolve(dependency.target, dependency.sourcePath, sourceIndex) as {
    entryList: FileEntry[];
  };
  if (entryList.length === 0 && dependency.kind === 'document') {
    console.warn(`[doc-source] ${declared} is not in the collected source; nothing was retained for it.`);
  }
  if (entryList.length > 1) {
    console.warn(
      `[doc-source] ${declared} matches ${entryList.length} files; all are retained: `
      + entryList.map((entry) => entry.internalPath).join(', '),
    );
  }
  return entryList;
}

// matches page-tree.js convertSourceFolder
function sourceFolderEntryListGet(node: any, entries: FileEntry[]): FileEntry[] {
  let pathFolder = `/${node.sourceRoot}`;
  if (node.sourceFolder !== undefined) {
    pathFolder = `/${String(node.sourceFolder)}`.replace(/\\/g, '/').replace(/\/+/g, '/');
    if (pathFolder.length > 1) pathFolder = pathFolder.replace(/\/$/, '');
  }
  if (pathFolder === '/') return entries;
  return entries.filter((entry) => (
    entry.internalPath === pathFolder || entry.internalPath.startsWith(`${pathFolder}/`)
  ));
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
    const url = isBuild
      ? attachmentDataUrlGet(attachment.absPath)
      : `/@fs/${normalizeSlashPath(attachment.absPath)}`;
    for (const reference of attachment.referenceList) {
      attachmentUrlByPath[reference.replace(/^\.?\//, '')] = url;
    }
  }
  lines.push(`export const attachmentUrlByPath = ${JSON.stringify(attachmentUrlByPath)};`);
  lines.push('export const fileManifest = [');
  for (const e of fileEntries) {
    const importId = (isBuild ? e.absPath : '/@fs/' + normalizeSlashPath(e.absPath)) + '?raw';
    const text = docTextRead(e);
    lines.push(
      `  { rootId: ${JSON.stringify(e.rootId)}, relPath: ${JSON.stringify(e.relPath)},` +
        ` name: ${JSON.stringify(e.name)}, ext: ${JSON.stringify(e.ext)},` +
        ` title: ${JSON.stringify(extractTitle(e, text))},` +
        ` internalPath: ${JSON.stringify(e.internalPath)},` +
        ` tagList: ${JSON.stringify(e.tagList ?? [])},` +
        ` configSource: ${JSON.stringify(e.configSource ?? {})},` +
        ` configFrontmatter: ${JSON.stringify(configFrontmatterRead(text, e.absPath) ?? {})},` +
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

// md/mdx text, read once for title and frontmatter config; '' for other files
function docTextRead(entry: FileEntry): string {
  if (entry.ext !== 'md' && entry.ext !== 'mdx') return '';
  return fs.readFileSync(entry.absPath, 'utf-8');
}

function extractTitle(entry: FileEntry, text: string): string {
  if (entry.ext !== 'md' && entry.ext !== 'mdx') return entry.name;
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
  if (configDoc.tag?.file) result.push(path.resolve(configDir, configDoc.tag.file));
  if (Array.isArray(configDoc.sidePanel?.fileListImported)) {
    result.push(...configDoc.sidePanel.fileListImported);
  }
  for (const rule of configDoc.source) {
    if (rule.action === 'addFolder') {
      result.push(path.resolve(configDir, rule.path));
    } else if (rule.action === 'addFile') {
      const filePath = path.resolve(configDir, rule.path);
      result.push(fs.existsSync(filePath) ? filePath : path.dirname(filePath));
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
