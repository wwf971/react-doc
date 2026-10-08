import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parse as parseYaml } from 'yaml';
import { isCSSRequest, type EnvironmentModuleNode, type Plugin } from 'vite';
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
import { DOC_EDIT_ENDPOINT_NAME, docEditMiddlewareCreate } from './doc-edit-server.ts';
import { DOC_ASSET_ENDPOINT_NAME, docAssetMiddlewareCreate } from './doc-asset-server.ts';
import { assetStoreCreate, type AssetSnapshot, type AssetStore } from './doc-asset-store.ts';
import { assetBlockTextExpand } from '../src/lib/doc-asset-ref.js';
import { docTargetResolve, sourceIndexBuild } from '../src/lib/doc-target-resolve.js';
import { textLocalizedGet } from '../src/lib/text-localized.js';

// vite plugin "doc-source".
// reads two-layer yaml config, executes source rules against the file system,
// and exposes the result as virtual module `virtual:doc-source`:
//
//   export let configDoc = {...}        // merged config (side panel yaml inlined)
//   export let fileManifest = [{ rootId, relPath, name, ext, title, internalPath,
//                                contentHash, tagList, configSource, configFrontmatter, load }]
//   export const docEditEndpoint = '/__doc-edit'    // '' in a build: no edit api
//   export const docAssetEndpoint = '/__doc-asset'  // '' in a build or without asset.folder
//   export const assetSnapshot = {...} | null       // the asset store, bundled in a build
//   export function subscribeDocSource(listener)    // dev: the source data changed
//   export function subscribeDocAsset(listener)     // dev: an object changed on disk
//
// document text is data, not code. in a build every document becomes a lazy
// `?raw` import, one chunk per document. during development the text is read
// over http from this plugin ({base}/__doc-source/file?path=...), and a
// changed document is announced to the page as the custom hmr event
// "doc-source-change" carrying the new manifest metadata: no executable
// module is replaced, so nothing in the page reloads (design:
// doc_page_impl_edit.md#saving-without-a-reload). configuration changes and
// files added to / removed from the source still reload the page.
//
// the development server also answers the edit api (doc-edit-server.ts), so
// the page can rewrite root-level blocks of a document in place, and the
// asset api (doc-asset-server.ts) over the folder named by config
// asset.folder (doc_page_impl_asset.md). the asset folder is never part of
// the collected source, wherever it is placed.

const MODULE_ID_DEFAULT = 'virtual:doc-source';
export const DOC_SOURCE_ENDPOINT_NAME = '__doc-source';

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
  // url prefixes of the source, edit and asset apis; '' when no development
  // server answers them
  let docSourceEndpoint = '';
  let docEditEndpoint = '';
  let docAssetEndpoint = '';
  // the configuration files of the page: config.yaml and its local layer,
  // the source / side-panel / tag files, and every side-panel file included
  // through childrenFile. a change of one of them regenerates the manifest
  // and reloads the page; a change of a collected document does not.
  let pathsConfiguration: string[] = [];
  const moduleId = options.moduleId ?? MODULE_ID_DEFAULT;
  const moduleIdResolved = `\0${moduleId}`;

  // the asset store of config asset.folder, or undefined without one
  const assetStoreGet = (configDoc: any): AssetStore | undefined => {
    const folder = assetFolderGet(configDoc, configDir);
    return folder ? assetStoreCreate(folder) : undefined;
  };
  // expands asset reference blocks of a document text for build-time scans
  const assetTextExpandGet = (store: AssetStore | undefined) => (text: string) => (
    store ? assetBlockTextExpand(text, store.referenceTextGet) : text
  );
  // the entries the page receives: every collected file, or only the files
  // the side panel reaches when pruning is configured
  const entriesVisibleGet = (configDoc: any, entries: FileEntry[]): FileEntry[] => (
    options.pruneSourceToSidePanel
      ? pruneSourceToSidePanel(
          configDoc,
          entries,
          options.sourceDependencyCollectByCompId,
          assetTextExpandGet(assetStoreGet(configDoc)),
        )
      : entries
  );

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
      docSourceEndpoint = isBuild ? '' : endpointBuild(viteConfig.base, DOC_SOURCE_ENDPOINT_NAME);
      docEditEndpoint = isBuild ? '' : endpointBuild(viteConfig.base, DOC_EDIT_ENDPOINT_NAME);
      const configDocEarly = loadConfigDoc(configFile, options);
      pathsConfiguration = collectPathsConfiguration(configDocEarly, configDir, configFile);
      docAssetEndpoint = isBuild || !assetFolderGet(configDocEarly, configDir)
        ? ''
        : endpointBuild(viteConfig.base, DOC_ASSET_ENDPOINT_NAME);
    },

    resolveId(id) {
      if (id === moduleId) return moduleIdResolved;
    },

    load(id) {
      if (id !== moduleIdResolved) return;
      const configDoc = loadConfigDoc(configFile, options);
      const assetStore = assetStoreGet(configDoc);
      const fileEntriesAll = scanSource(configDoc, configDir);
      const fileEntries = entriesVisibleGet(configDoc, fileEntriesAll);
      const attachmentList = configDoc.collectComponentAttachmentsOnBuild === true
        ? docAttachmentsCollect(
            configDoc,
            fileEntries,
            fileEntriesAll,
            configDir,
            [...docAttachmentFinderDefaultList, ...(options.attachmentFinderList ?? [])],
            assetTextExpandGet(assetStore),
          )
        : [];
      // the built page has no asset api: the store is bundled. the
      // development server answers the api, so nothing is bundled there.
      const assetSnapshot = isBuild && assetStore ? assetStore.snapshotBuild() : null;
      return generateModuleCode(configDoc, fileEntries, attachmentList, isBuild, {
        docSourceEndpoint,
        docEditEndpoint,
        docAssetEndpoint,
        assetSnapshot,
        moduleId,
      });
    },

    // a collected document changed on disk (an edit from the page, an
    // editor): the page receives the new source data as a custom event and
    // reads the text over http. the executable module graph is left alone,
    // except for live stylesheets that scanned the document (Tailwind
    // utilities written in the document). "pre": before Tailwind's own hook
    // sees the update. a method, so vite supplies this.environment.
    hotUpdate: {
      order: 'pre',
      async handler(context) {
        if (this.environment.name !== 'client' || context.type !== 'update') return;
        const filePath = normalizeSlashPath(context.file);
        if (pathsConfiguration.some((entry) => normalizeSlashPath(entry) === filePath)) return;
        const configDoc = loadConfigDoc(configFile, options);
        const entries = scanSource(configDoc, configDir);
        const entryChanged = entries.find((entry) => normalizeSlashPath(entry.absPath) === filePath);
        if (!entryChanged) return;

        // the cached initial manifest is stale now; a later page load gets
        // the current one. it is not an hmr root: the page is told by event.
        const manifest = this.environment.moduleGraph.getModuleById(moduleIdResolved);
        if (manifest) this.environment.moduleGraph.invalidateModule(manifest);
        this.environment.hot.send({
          type: 'custom',
          event: 'doc-source-change',
          data: { moduleId, configDoc, fileManifest: entriesVisibleGet(configDoc, entries).map(fileMetadataBuild) },
        });

        // a collected application source file (.js shown as a document) is
        // also code: its normal hmr continues
        if (entryChanged.ext !== 'md' && entryChanged.ext !== 'mdx') return;
        const stylesheets = new Set<EnvironmentModuleNode>();
        const modulesVisited = new Set<EnvironmentModuleNode>();
        const stylesheetsCollect = (mod: EnvironmentModuleNode) => {
          if (modulesVisited.has(mod)) return;
          modulesVisited.add(mod);
          if (isCSSRequest(mod.url ?? mod.id ?? '') && mod.isSelfAccepting) {
            stylesheets.add(mod);
            return;
          }
          for (const importer of mod.importers) stylesheetsCollect(importer);
        };
        for (const mod of context.modules) stylesheetsCollect(mod);
        await Promise.all([...stylesheets].map((stylesheet) => this.environment.reloadModule(stylesheet)));
        // nothing propagates: the document is data, not a module
        return [];
      },
    },

    configureServer(server) {
      const configDoc = loadConfigDoc(configFile, options);
      let pathsWatched = collectPathsToWatch(configDoc, configDir, configFile);
      for (const p of pathsWatched) server.watcher.add(p);

      // the edit api resolves internal paths against the same scan that
      // generates the manifest. the scan is kept until the manifest changes.
      let fileEntryListCached: FileEntry[] | undefined;
      const fileEntryListGet = () => {
        if (!fileEntryListCached) {
          fileEntryListCached = scanSource(loadConfigDoc(configFile, options), configDir);
        }
        return fileEntryListCached;
      };
      server.middlewares.use(docSourceMiddlewareCreate({ endpoint: docSourceEndpoint, fileEntryListGet }));

      // the current configuration, re-read, reported to the page as data:
      // the side panel tree is data of the page like the documents are
      const configDataSend = (configDocUpdated: any) => {
        fileEntryListCached = undefined;
        const entries = scanSource(configDocUpdated, configDir);
        const manifest = server.moduleGraph.getModuleById(moduleIdResolved);
        if (manifest) server.moduleGraph.invalidateModule(manifest);
        server.ws.send({
          type: 'custom',
          event: 'doc-source-change',
          data: { moduleId, configDoc: configDocUpdated, fileManifest: entriesVisibleGet(configDocUpdated, entries).map(fileMetadataBuild) },
        });
      };
      // a side-panel file the page itself rewrote (a label edit), by content
      // hash. the watcher reports that change too; when the file still has
      // this content, the change was already reported as data and must not
      // reload the page.
      const contentHashWrittenByPath = new Map<string, string>();
      const sidePanelFileWritten = (filePath: string, text: string) => {
        contentHashWrittenByPath.set(filePath, textContentHashGet(text));
        const configDocUpdated = loadConfigDoc(configFile, options);
        pathsWatched = collectPathsToWatch(configDocUpdated, configDir, configFile);
        pathsConfiguration = collectPathsConfiguration(configDocUpdated, configDir, configFile);
        for (const p of pathsWatched) server.watcher.add(p);
        configDataSend(configDocUpdated);
      };
      const changeIsOwnWrite = (filePath: string): boolean => {
        const contentHashWritten = contentHashWrittenByPath.get(filePath);
        if (contentHashWritten === undefined) return false;
        const isSameContent = fs.existsSync(filePath)
          && textContentHashGet(fs.readFileSync(filePath, 'utf-8')) === contentHashWritten;
        if (!isSameContent) contentHashWrittenByPath.delete(filePath);
        return isSameContent;
      };

      server.middlewares.use(docEditMiddlewareCreate({
        endpoint: docEditEndpoint,
        fileEntryListGet,
        sidePanel: {
          configDir,
          fileListGet: () => collectSidePanelFiles(loadConfigDoc(configFile, options), configDir),
          onFileWritten: sidePanelFileWritten,
        },
      }));

      // the asset api works on the folder of the current config; a change
      // of the asset folder on disk (an external editor, a git checkout) is
      // reported to the page as a custom hmr event, see generateModuleCode
      const assetFolder = assetFolderGet(configDoc, configDir);
      if (docAssetEndpoint && assetFolder) {
        server.middlewares.use(docAssetMiddlewareCreate({
          endpoint: docAssetEndpoint,
          storeGet: () => assetStoreCreate(assetFolderGet(loadConfigDoc(configFile, options), configDir) || assetFolder),
        }));
        server.watcher.add(assetFolder);
        const assetChangeSend = (filePath: string) => {
          if (!pathIsInside(filePath, assetFolder)) return;
          const objectId = path.relative(assetFolder, filePath).split(path.sep)[0] ?? '';
          server.ws.send({ type: 'custom', event: 'doc-asset-change', data: { objectId } });
        };
        server.watcher.on('add', assetChangeSend);
        server.watcher.on('change', assetChangeSend);
        server.watcher.on('unlink', assetChangeSend);
      }

      const invalidateManifest = (filePath: string) => {
        // files of the asset store are not documents, even inside a source folder
        if (assetFolder && pathIsInside(filePath, assetFolder)) return;
        const isRelated = pathsWatched.some(
          (p) => filePath === p || filePath.startsWith(p + path.sep),
        );
        if (!isRelated) return;
        fileEntryListCached = undefined;
        try {
          const configDocUpdated = loadConfigDoc(configFile, options);
          pathsWatched = collectPathsToWatch(configDocUpdated, configDir, configFile);
          pathsConfiguration = collectPathsConfiguration(configDocUpdated, configDir, configFile);
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
      // change of a configuration file (config.yaml, the source / side-panel /
      // tag files, included side-panel files). a changed document under a
      // source folder is not configuration: the hotUpdate hook above reports
      // it to the page as data, whatever its extension.
      server.watcher.on('change', (filePath) => {
        if (!pathsConfiguration.includes(filePath)) return;
        if (changeIsOwnWrite(filePath)) return;
        invalidateManifest(filePath);
      });
    },
  };
}

// ---------- source read api ----------
// GET {endpoint}/file?path=/root/a.md -> the text of that collected file,
// plain utf-8, never cached. the development page loads every document
// through it instead of importing the file as a module. only internal paths
// of the collected source resolve; the query is never used as a file path.

type SourceMiddlewareOptions = {
  endpoint: string;
  fileEntryListGet: () => FileEntry[];
};

export function docSourceMiddlewareCreate(options: SourceMiddlewareOptions) {
  const { endpoint, fileEntryListGet } = options;
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== `${endpoint}/file`) {
      next();
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET');
      res.end('the source api answers GET only');
      return;
    }
    const internalPath = url.searchParams.get('path') ?? '';
    const entry = fileEntryListGet().find((item) => item.internalPath === internalPath);
    if (!entry) {
      res.statusCode = 404;
      res.end(`not a file of the collected source: ${internalPath}`);
      return;
    }
    let text: string;
    try {
      text = fs.readFileSync(entry.absPath, 'utf-8');
    } catch {
      res.statusCode = 404;
      res.end(`the source file is not available: ${internalPath}`);
      return;
    }
    res.statusCode = 200;
    res.end(text);
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
//
// every node is annotated with textSource: the file (relative to the config
// directory) and yaml address of the node whose label it shows, so the edit
// layer can rewrite that label in place (doc-side-panel-text.ts). a node
// labeled by the "root" of an included file points at that root.

type SidePanelTextSource = {
  file: string;
  path: (string | number)[];
};

type SidePanelLoaded = {
  root?: Record<string, any>;
  // where the root's label is written, when the file has a root
  rootTextSource?: SidePanelTextSource;
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
  // yaml address of the resource inside the file: [] or ["sidePanel"]
  const addressResource: (string | number)[] = fileContent?.sidePanel === undefined ? [] : ['sidePanel'];
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
  const fileRelative = sidePanelFileRelativeGet(filePathResolved, context.configDir);
  const tree = loadSidePanelNodes(
    sidePanel.tree,
    path.dirname(filePathResolved),
    [...fileChain, filePathResolved],
    context,
    { file: fileRelative, path: [...addressResource, 'tree'] },
  );
  const rootTextSource = root === undefined
    ? undefined
    : { file: fileRelative, path: [...addressResource, 'root'] };
  return { root, rootTextSource, tree };
}

// side-panel files are named relative to the config directory, with "/"
function sidePanelFileRelativeGet(filePath: string, configDir: string): string {
  return path.relative(configDir, filePath).split(path.sep).join('/');
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

// addressList: file and yaml address of the list these nodes are read from
function loadSidePanelNodes(
  nodes: any[],
  fileDir: string,
  fileChain: string[],
  context: SidePanelLoadContext,
  addressList: SidePanelTextSource,
): any[] {
  return nodes.map((node, index) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return node;

    const { childrenFile, ...nodeResult } = node;
    const addressNode: SidePanelTextSource = { file: addressList.file, path: [...addressList.path, index] };
    const childrenLocal = node.children;
    if (childrenLocal !== undefined && !Array.isArray(childrenLocal)) {
      throw new Error(
        `[doc-source] side panel "children" must be a list at ${fileChain.at(-1)} tree[${index}]`,
      );
    }

    let childrenImported: any[] = [];
    let rootImported: Record<string, any> = {};
    let rootTextSourceImported: SidePanelTextSource | undefined;
    if (childrenFile !== undefined) {
      if (typeof childrenFile !== 'string' || !childrenFile.trim()) {
        throw new Error(
          `[doc-source] side panel "childrenFile" must be a non-empty path at ${fileChain.at(-1)} tree[${index}]`,
        );
      }
      const loaded = loadSidePanelFile(path.resolve(fileDir, childrenFile), context, fileChain);
      childrenImported = loaded.tree;
      rootImported = loaded.root ?? {};
      rootTextSourceImported = loaded.rootTextSource;
    }

    const childrenLoaded = Array.isArray(childrenLocal)
      ? loadSidePanelNodes(childrenLocal, fileDir, fileChain, context, { ...addressNode, path: [...addressNode.path, 'children'] })
      : [];
    // imported root metadata applies to this node; explicit local properties win.
    const nodeMerged = { ...rootImported, ...nodeResult };
    if (childrenFile !== undefined || childrenLocal !== undefined) {
      nodeMerged.children = [...childrenImported, ...childrenLoaded];
    }
    // the label is written where page-tree.js reads it from: the node's own
    // "text" when it has one, else the imported root's "text", else the node
    // itself (a "text" would be added there)
    const isTextFromRoot = nodeResult.text === undefined && rootImported.text !== undefined;
    nodeMerged.textSource = isTextFromRoot && rootTextSourceImported ? rootTextSourceImported : addressNode;
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

  // the asset store keeps its own files (doc_page_impl_asset.md); they are
  // never documents, even when the folder lies inside a source folder
  const assetFolder = assetFolderGet(configDoc, configDir);
  return [...entryByPath.values()].filter((entry) => !assetFolder || !pathIsInside(entry.absPath, assetFolder));
}

// absolute path of config asset.folder, '' when the config has none
function assetFolderGet(configDoc: any, configDir: string): string {
  const folder = configDoc?.asset?.folder;
  if (typeof folder !== 'string' || !folder.trim()) return '';
  return path.resolve(configDir, folder.trim());
}

function pathIsInside(filePath: string, folder: string): boolean {
  const relative = path.relative(folder, filePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
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
//
// textExpand(text): the document text as scanned; asset reference blocks are
// expanded to the data they stand for, so their dependencies are found too.
export function pruneSourceToSidePanel(
  configDoc: any,
  entries: FileEntry[],
  collectByCompId: Record<string, DocSourceDependencyCollect> = {},
  textExpand: (text: string) => string = (text) => text,
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
    const text = textExpand(fs.readFileSync(entry.absPath, 'utf-8'));
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

// the manifest entry of one file without its loader: what the initial module
// and every later "doc-source-change" event carry. the content hash lets the
// page keep its caches for files that did not change; title, tags and
// config travel with it so that a text-only event cannot leave them stale.
export function fileMetadataBuild(entry: FileEntry) {
  const content = fs.readFileSync(entry.absPath);
  const text = entry.ext === 'md' || entry.ext === 'mdx' ? content.toString('utf-8') : '';
  return {
    rootId: entry.rootId,
    relPath: entry.relPath,
    name: entry.name,
    ext: entry.ext,
    title: extractTitle(entry, text),
    internalPath: entry.internalPath,
    contentHash: textContentHashGet(content),
    tagList: entry.tagList ?? [],
    configSource: entry.configSource ?? {},
    configFrontmatter: configFrontmatterRead(text, entry.absPath) ?? {},
  };
}

function textContentHashGet(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export function generateModuleCode(
  configDoc: any,
  fileEntries: FileEntry[],
  attachmentList: DocAttachmentResolved[],
  isBuild: boolean,
  services: {
    docSourceEndpoint: string;
    docEditEndpoint: string;
    docAssetEndpoint: string;
    assetSnapshot: AssetSnapshot | null;
    moduleId: string;
  },
): string {
  const lines: string[] = [];
  lines.push(`export let configDoc = ${JSON.stringify(configDoc)};`);
  lines.push(`export const docEditEndpoint = ${JSON.stringify(services.docEditEndpoint)};`);
  lines.push(`export const docAssetEndpoint = ${JSON.stringify(services.docAssetEndpoint)};`);
  lines.push(`export const assetSnapshot = ${JSON.stringify(services.assetSnapshot)};`);
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
  if (!isBuild) {
    // development: the text of a file is read over http, never imported
    lines.push('async function sourceTextLoad(path) {');
    lines.push(`  const response = await fetch(${JSON.stringify(services.docSourceEndpoint)} + '/file?path=' + encodeURIComponent(path), { cache: 'no-store' });`);
    lines.push('  if (!response.ok) throw new Error(await response.text());');
    lines.push('  return response.text();');
    lines.push('}');
  }
  lines.push('export let fileManifest = [');
  for (const e of fileEntries) {
    // build: one lazy ?raw import per document, a literal specifier so the
    // bundler finds it
    const load = isBuild
      ? `() => import(${JSON.stringify(`${e.absPath}?raw`)}).then((m) => m.default)`
      : `() => sourceTextLoad(${JSON.stringify(e.internalPath)})`;
    lines.push(`  { ...${JSON.stringify(fileMetadataBuild(e))}, load: ${load} },`);
  }
  lines.push('];');
  if (!isBuild) {
    // the listeners and the latest source data survive a replacement of
    // this module (hot.data), so subscriptions a host keeps stay valid and
    // a subscriber added later gets the current data at once
    lines.push('const listenersDocSource = import.meta.hot?.data.listenersDocSource ?? new Set();');
    lines.push('const listenersDocAsset = import.meta.hot?.data.listenersDocAsset ?? new Set();');
    lines.push('const sourceState = import.meta.hot?.data.sourceState ?? {};');
    lines.push('export function subscribeDocSource(listener) {');
    lines.push('  listenersDocSource.add(listener);');
    lines.push('  if (sourceState.current) listener(sourceState.current);');
    lines.push('  return () => listenersDocSource.delete(listener);');
    lines.push('}');
    lines.push('export function subscribeDocAsset(listener) { listenersDocAsset.add(listener); return () => listenersDocAsset.delete(listener); }');
    lines.push('if (import.meta.hot) {');
    // a collected file changed: the new manifest metadata arrives as data;
    // the text of a changed file is fetched when the page needs it
    lines.push("  import.meta.hot.on('doc-source-change', (dataNext) => {");
    lines.push(`    if (dataNext.moduleId !== ${JSON.stringify(services.moduleId)}) return;`);
    lines.push('    configDoc = dataNext.configDoc;');
    lines.push('    fileManifest = dataNext.fileManifest.map((entry) => ({ ...entry, load: () => sourceTextLoad(entry.internalPath) }));');
    lines.push('    sourceState.current = { configDoc, fileManifest };');
    lines.push('    for (const listener of listenersDocSource) listener(sourceState.current);');
    lines.push('  });');
    lines.push('  import.meta.hot.dispose((data) => {');
    lines.push('    data.listenersDocSource = listenersDocSource;');
    lines.push('    data.listenersDocAsset = listenersDocAsset;');
    lines.push('    data.sourceState = sourceState;');
    lines.push('  });');
    // the module itself was replaced (a genuine regeneration, not a content save)
    lines.push('  import.meta.hot.accept((moduleNext) => {');
    lines.push('    if (!moduleNext) return;');
    lines.push('    const dataNext = { configDoc: moduleNext.configDoc, fileManifest: moduleNext.fileManifest };');
    lines.push('    sourceState.current = dataNext;');
    lines.push('    for (const listener of listenersDocSource) listener(dataNext);');
    lines.push('  });');
    // an object of the asset store changed on disk: listeners get { objectId }
    lines.push("  import.meta.hot.on('doc-asset-change', (dataChange) => {");
    lines.push('    for (const listener of listenersDocAsset) listener(dataChange);');
    lines.push('  });');
    lines.push('}');
  } else {
    lines.push('export function subscribeDocSource() { return () => {}; }');
    lines.push('export function subscribeDocAsset() { return () => {}; }');
  }
  return lines.join('\n');
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

// "/__doc-edit", or "/base/__doc-edit" when vite serves below a base path
function endpointBuild(base: string | undefined, endpointName: string): string {
  const baseNormalized = String(base ?? '/').replace(/\/+$/, '');
  const basePath = baseNormalized.startsWith('/') || baseNormalized === '' ? baseNormalized : '';
  return `${basePath}/${endpointName}`;
}

// the configuration files of the page: a change of one of them regenerates
// the manifest and reloads the page
function collectPathsConfiguration(configDoc: any, configDir: string, configFile: string): string[] {
  const extension = path.extname(configFile);
  const result = [
    configFile,
    path.join(configDir, `${path.basename(configFile, extension)}.0${extension}`),
  ];
  const configRaw = readYaml(configFile);
  if (configRaw?.source?.file) result.push(path.resolve(configDir, configRaw.source.file));
  result.push(...collectSidePanelFiles(configDoc, configDir));
  if (configDoc.tag?.file) result.push(path.resolve(configDir, configDoc.tag.file));
  return result;
}

// the side-panel files the configuration loads: the page side-panel file and
// every file included through childrenFile, absolute
function collectSidePanelFiles(configDoc: any, configDir: string): string[] {
  const result: string[] = [];
  if (configDoc.sidePanel?.file) result.push(path.resolve(configDir, configDoc.sidePanel.file));
  if (Array.isArray(configDoc.sidePanel?.fileListImported)) {
    result.push(...configDoc.sidePanel.fileListImported);
  }
  return result;
}

// the configuration files plus the source folders and files, so that the
// watcher reports additions and removals inside the source
function collectPathsToWatch(configDoc: any, configDir: string, configFile: string): string[] {
  const result = collectPathsConfiguration(configDoc, configDir, configFile);
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
