import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isCSSRequest, type EnvironmentModuleNode, type Plugin } from 'vite';
import { docEntryLoad, readYaml } from './doc-entry.ts';
import {
  attachmentDataUrlGet,
  attachmentExtIsBinary,
  attachmentMimeGet,
  docAttachmentFinderDefaultList,
  docAttachmentsCollect,
  type DocAttachmentFinder,
  type DocAttachmentResolved,
} from './doc-attachment.ts';
import {
  sourcePathBuild,
  sourcePathIsInside,
  sourcePathIsRooted,
  sourcePathNormalize,
  sourcePathParse,
} from '../src/lib/doc-source-path.js';
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
import {
  assetConfigOfConfigDocGet, assetConfigRead, assetStoreCreate, objectIdFromDirName,
  type AssetSnapshot, type AssetStore, type AssetStoreConfig, type AssetUsageDoc,
} from './doc-asset-store.ts';
import { assetBlockTextExpand, assetUsageListScan } from '../src/lib/doc-asset-ref.js';
import { docTargetResolve, sourceIndexBuild } from '../src/lib/doc-target-resolve.js';
import { textLocalizedGet } from '../src/lib/text-localized.js';

// vite plugin "doc-source" (design: doc_page_impl_source.md).
// reads two-layer yaml config, executes source rules against the file system,
// and exposes the result as virtual module `virtual:doc-source`:
//
//   export let configDoc = {...}        // merged config (the document entry loaded: source rules,
//                                       //   the page side panel inlined, tag definitions merged)
//   export let fileManifest = [{ rootId, relPath, name, ext, title, internalPath, collect,
//                                contentHash, tagList, configSource, configFrontmatter, load }]
//   export let dirManifest = [{ rootId, relPath, internalPath, collect }]   // the folders of the source
//   export const fileUrlByPath = {...}              // source path -> url of the file's bytes (build: data url)
//   export const docSourceEndpoint = '/__doc-source' // '' in a build: no source api
//   export const docEditEndpoint = '/__doc-edit'    // '' in a build: no edit api
//   export const docAssetEndpoint = '/__doc-asset'  // '' in a build or without asset.file
//   export const assetSnapshot = {...} | null       // the asset store, bundled in a build
//   export function subscribeDocSource(listener)    // dev: the source data changed
//   export function subscribeDocAsset(listener)     // dev: an object or the store's folders changed on disk
//
// every file is named by its source path ~rootId/relPath (doc-source-path.js).
// an addFolder rule says how its folder is collected (rule.collect):
//   recursive   every file in the folder and its subfolders is a document
//   direct      the files right in the folder are documents
//   referenced  the files in the folder (and its subfolders) are collectable:
//               they are part of the page only when something uses them (an
//               image an Image block names, a dependency of an asset version)
// a referenced file is in the manifest with collect "referenced"; it is not
// a page of the side panel, and a build keeps it only when it is used.
// a root id names one folder: the first add rule with the id fixes it; a
// later rule with the same id names a folder inside it and sets the
// collect mode of that part (a file collected twice takes the later rule).
//
// document text is data, not code. in a build every document becomes a lazy
// `?raw` import, one chunk per document. during development the text is read
// over http from this plugin ({base}/__doc-source/file?path=...), and a
// changed document is announced to the page as the custom hmr event
// "doc-source-change" carrying the new manifest metadata: no executable
// module is replaced, so nothing in the page reloads (design:
// doc_page_impl_edit.md#saving-without-a-reload). configuration changes and
// files added to / removed from the source still reload the page, except a
// file the page itself created through the source api: that is reported as
// data too.
//
// the development server also answers the source api (file text and bytes,
// file creation; docSourceMiddlewareCreate), the edit api
// (doc-edit-server.ts), so the page can rewrite root-level blocks of a
// document in place, and the asset api (doc-asset-server.ts) over the local
// asset store, whose config file is named by config asset.file and whose
// folders are listed in that file (doc_page_impl_asset.md). the store's
// files are never part of the collected source, wherever they are placed.

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

// how an addFolder rule collects its folder, and how a file was collected
export type SourceCollectMode = 'recursive' | 'direct' | 'referenced';
const sourceCollectModeList: SourceCollectMode[] = ['recursive', 'direct', 'referenced'];

export type FileEntry = {
  rootId: string;
  relPath: string; // path inside root, the file name for a root file
  name: string;
  ext: string;
  absPath: string;
  internalPath: string; // the source path ~{rootId}/relPath (doc-source-path.js)
  collect: SourceCollectMode; // 'referenced': part of the page only when used
  tagList?: any[]; // tags declared by source rules, see doc-tag-source.ts
  configSource?: Record<string, any>; // config declared by source rules, see doc-config-source.ts
};

// a folder of the source: the folder of an addFolder rule and (recursive,
// referenced) every folder below it. the page lists them (a location to
// create a file in) without the file system.
export type DirEntry = {
  rootId: string;
  relPath: string; // '' for the folder of the rule
  absPath: string;
  internalPath: string; // ~{rootId} or ~{rootId}/relPath
  collect: SourceCollectMode;
};

// the folder or file of an add rule, as the source api resolves paths
// what one add rule collects. a root id names one folder on disk
// (rootAbsPath): the first rule with the id fixes it, and a later rule with
// the same id collects a folder inside it (with its own collect mode), so
// the source paths of both are ~rootId/<path from the root folder>.
export type SourceRoot = {
  rootId: string;
  // the folder (or file) the rule names
  absPath: string;
  // the folder of the root id, which source paths are relative to
  rootAbsPath: string;
  kind: 'folder' | 'file';
  collect: SourceCollectMode;
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
  // the entry file of the document and every yaml file it reaches (included
  // side panels, source and tag files), and the tag file of config. a change
  // of one of them regenerates the manifest and reloads the page; a change
  // of a collected document does not.
  let pathsConfiguration: string[] = [];
  const moduleId = options.moduleId ?? MODULE_ID_DEFAULT;
  const moduleIdResolved = `\0${moduleId}`;

  // the local asset store of config asset.file, or undefined without one;
  // created from the config file as it is now
  const assetStoreGet = (configDoc: any): AssetStore | undefined => {
    const assetConfig = assetConfigGet(configDoc, configDir);
    return assetConfig ? assetStoreCreate(assetConfig) : undefined;
  };
  // expands asset reference blocks of a document text for build-time scans
  const assetTextExpandGet = (store: AssetStore | undefined) => (text: string) => (
    store ? assetBlockTextExpand(text, store.referenceTextGet) : text
  );
  // the entries the page receives: every collected file, or only the files
  // the side panel reaches when pruning is configured
  const entriesVisibleGet = (configDoc: any, entries: FileEntry[]): FileEntry[] => {
    if (!options.pruneSourceToSidePanel) return entries;
    const assetStore = assetStoreGet(configDoc);
    return pruneSourceToSidePanel(
      configDoc,
      entries,
      options.sourceDependencyCollectByCompId,
      assetTextExpandGet(assetStore),
      assetStore ? assetStore.dependencySourcePathList() : [],
    );
  };
  // the data of one "doc-source-change" event: the manifest and the folders
  const sourceDataBuild = (configDoc: any, entries: FileEntry[]) => ({
    moduleId,
    configDoc,
    fileManifest: entriesVisibleGet(configDoc, entries).map(fileMetadataBuild),
    dirManifest: scanSourceDirs(configDoc, configDir).map(dirMetadataBuild),
  });

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
      pathsConfiguration = collectPathsConfiguration(configDocEarly);
      // the asset section is checked here, before the endpoint is chosen: a
      // wrong one stops the server with the migration instead of leaving the
      // page without a store. the endpoint and the middleware
      // (configureServer) are chosen once, so a store added to config.yaml
      // later needs a restart of the server
      docAssetEndpoint = isBuild || !assetConfigGet(configDocEarly, configDir)
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
      const dirEntries = scanSourceDirs(configDoc, configDir);
      // the files a component names (an Image src) and the source files the
      // asset versions depend on, so a build carries their bytes
      const attachmentList = configDoc.collectComponentAttachmentsOnBuild === true
        ? docAttachmentsCollect(
            configDoc,
            fileEntries,
            fileEntriesAll,
            configDir,
            [...docAttachmentFinderDefaultList, ...(options.attachmentFinderList ?? [])],
            assetTextExpandGet(assetStore),
            assetStore ? assetStore.dependencySourcePathList() : [],
          )
        : [];
      // the built page has no asset api: the store is bundled. the
      // development server answers the api, so nothing is bundled there.
      // the references of its documents travel with it, so a built page
      // still knows which objects its blocks use (doc_page_impl_asset.md#usage)
      const assetSnapshot = isBuild && assetStore
        ? { ...assetStore.snapshotBuild(), usageDocList: assetUsageDocListScan(fileEntries, []) }
        : null;
      return generateModuleCode(configDoc, fileEntries, dirEntries, attachmentList, isBuild, {
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
          data: sourceDataBuild(configDoc, entries),
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
      let pathsWatched = collectPathsToWatch(configDoc, configDir);
      for (const p of pathsWatched) server.watcher.add(p);

      // the source and edit apis resolve source paths against the same scan
      // that generates the manifest. the scan is kept until the manifest changes.
      let fileEntryListCached: FileEntry[] | undefined;
      const fileEntryListGet = () => {
        if (!fileEntryListCached) {
          fileEntryListCached = scanSource(loadConfigDoc(configFile, options), configDir);
        }
        return fileEntryListCached;
      };

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
          data: sourceDataBuild(configDocUpdated, entries),
        });
      };

      // a file the page created through the source api: the watcher reports
      // the addition too, and must report it as data, not reload the page
      const pathsCreatedByPage = new Set<string>();
      server.middlewares.use(docSourceMiddlewareCreate({
        endpoint: docSourceEndpoint,
        fileEntryListGet,
        sourceRootListGet: () => sourceRootListGet(loadConfigDoc(configFile, options), configDir),
        onFileCreated: (filePath) => {
          pathsCreatedByPage.add(filePath);
          configDataSend(loadConfigDoc(configFile, options));
        },
      }));
      // a configuration file the page itself rewrote (a side-panel label, a
      // config value), by content hash. the watcher reports that change
      // too; when the file still has this content, the change was already
      // reported as data and must not reload the page.
      const contentHashWrittenByPath = new Map<string, string>();
      const configurationFileWritten = (filePath: string, text: string) => {
        contentHashWrittenByPath.set(filePath, textContentHashGet(text));
        const configDocUpdated = loadConfigDoc(configFile, options);
        pathsWatched = collectPathsToWatch(configDocUpdated, configDir);
        pathsConfiguration = collectPathsConfiguration(configDocUpdated);
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
          fileListGet: () => collectDocYamlFiles(loadConfigDoc(configFile, options)),
          onFileWritten: configurationFileWritten,
        },
        // the global config layer (doc_page_impl_config.md#config-layers):
        // config.yaml and its local layer
        config: {
          fileList: [configFile, configLocalFileGet(configFile)],
          onFileWritten: configurationFileWritten,
        },
      }));

      // the asset api works on the store as its config file says now; a
      // change on disk (an external editor, a git checkout, the panel's own
      // write) is reported to the page as a custom hmr event, see
      // generateModuleCode: { objectId } for an object, { isStoreChanged }
      // when the folder list changed
      let assetConfig = assetConfigGet(configDoc, configDir);
      if (docAssetEndpoint && assetConfig) {
        const assetConfigFile = assetConfig.file;
        server.middlewares.use(docAssetMiddlewareCreate({
          endpoint: docAssetEndpoint,
          storeGet: () => assetStoreCreate(assetConfigGet(loadConfigDoc(configFile, options), configDir) ?? assetConfig!),
          usageScan: (docPathList) => assetUsageDocListScan(fileEntryListGet(), docPathList),
        }));
        const assetFoldersWatch = () => {
          for (const folder of assetConfig!.folderList) server.watcher.add(folder.pathAbs);
        };
        server.watcher.add(assetConfigFile);
        assetFoldersWatch();
        const assetChangeSend = (filePath: string) => {
          if (filePath === assetConfigFile) {
            assetConfig = assetConfigRead(assetConfigFile);
            assetFoldersWatch();
            server.ws.send({ type: 'custom', event: 'doc-asset-change', data: { objectId: '', isStoreChanged: true } });
            return;
          }
          const folder = assetConfig!.folderList.find((item) => pathIsInside(filePath, item.pathAbs));
          if (!folder) return;
          // the object's folder is {objectId}--{name}; a file right in the
          // store folder is not an object's
          const objectId = objectIdFromDirName(path.relative(folder.pathAbs, filePath).split(path.sep)[0] ?? '');
          if (!objectId) return;
          server.ws.send({ type: 'custom', event: 'doc-asset-change', data: { objectId, isStoreChanged: false } });
        };
        server.watcher.on('add', assetChangeSend);
        server.watcher.on('change', assetChangeSend);
        server.watcher.on('unlink', assetChangeSend);
      }

      const invalidateManifest = (filePath: string) => {
        // files of the asset store are not documents, even inside a source folder
        if (assetConfig && assetPathIs(assetConfig, filePath)) return;
        // the backup the edit api writes beside a configuration file is not a document
        if (configurationBackupPathIs(pathsConfiguration, filePath)) return;
        const isRelated = pathsWatched.some(
          (p) => filePath === p || filePath.startsWith(p + path.sep),
        );
        if (!isRelated) return;
        // the page created it and was already told as data
        if (pathsCreatedByPage.delete(filePath)) return;
        fileEntryListCached = undefined;
        try {
          const configDocUpdated = loadConfigDoc(configFile, options);
          pathsWatched = collectPathsToWatch(configDocUpdated, configDir);
          pathsConfiguration = collectPathsConfiguration(configDocUpdated);
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
      // change of a configuration file (config.yaml, the entry and every yaml
      // file it reaches, the tag file of config). a changed document under a
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

// ---------- source api ----------
// the source layer of the development server (doc_page_impl_source.md#the-source-api):
//
//   GET  {endpoint}/file?path=~root/a.md   the text of a collected file, plain utf-8, never
//                                          cached. the development page loads every document
//                                          through it instead of importing the file as a module.
//   GET  {endpoint}/data?path=~root/x.png  the bytes of a collected file with their media type
//                                          (an image an Image block names)
//   POST {endpoint}/file/create            { dirPath, name, text | dataBase64, isOverwrite? }
//                                          -> { code, data: { path, entry }, message }
//                                          writes a file into a folder of the source. dirPath is a
//                                          source path (~root or ~root/dir) inside the folder of an
//                                          addFolder rule; the folders on the way are created. codes:
//                                          -1 bad request, -2 the file exists (isOverwrite false),
//                                          -3 the folder is not in the source
//
// only source paths resolve; a query is never used as a file path. the folder
// of a "direct" rule accepts files right in it only; "recursive" and
// "referenced" folders accept any folder below.

type SourceMiddlewareOptions = {
  endpoint: string;
  fileEntryListGet: () => FileEntry[];
  sourceRootListGet: () => SourceRoot[];
  onFileCreated: (filePath: string) => void;
};

export function docSourceMiddlewareCreate(options: SourceMiddlewareOptions) {
  const { endpoint, fileEntryListGet, sourceRootListGet, onFileCreated } = options;
  const textSend = (res: ServerResponse, statusCode: number, text: string) => {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(text);
  };
  const jsonSend = (res: ServerResponse, statusCode: number, payload: { code: number; data: any; message: string }) => {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(payload));
  };
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = url.pathname.startsWith(`${endpoint}/`) ? url.pathname.slice(endpoint.length) : '';
    if (route !== '/file' && route !== '/data' && route !== '/file/create') {
      next();
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (route === '/file/create') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        jsonSend(res, 405, { code: -1, data: null, message: 'file/create answers POST only' });
        return;
      }
      void jsonBodyRead(req)
        .then((body) => {
          const result = sourceFileCreate(body, sourceRootListGet(), fileEntryListGet());
          if (result.code === 0) onFileCreated(result.data.entry.absPath);
          jsonSend(res, statusByCode[result.code] ?? 400, {
            code: result.code,
            data: result.code === 0 ? { path: result.data.path, entry: fileMetadataBuild(result.data.entry) } : null,
            message: result.message,
          });
        })
        .catch((error) => jsonSend(res, 400, { code: -1, data: null, message: String(error?.message ?? error) }));
      return;
    }

    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      textSend(res, 405, 'the source api answers GET here');
      return;
    }
    const internalPath = sourcePathNormalize(url.searchParams.get('path') ?? '');
    const entry = fileEntryListGet().find((item) => item.internalPath === internalPath);
    if (!entry) {
      textSend(res, 404, `not a file of the collected source: ${internalPath}`);
      return;
    }
    if (route === '/data') {
      let bytes: Buffer;
      try {
        bytes = fs.readFileSync(entry.absPath);
      } catch {
        textSend(res, 404, `the source file is not available: ${internalPath}`);
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', attachmentMimeGet(entry.absPath));
      res.setHeader('Content-Length', String(bytes.length));
      res.end(bytes);
      return;
    }
    let text: string;
    try {
      text = fs.readFileSync(entry.absPath, 'utf-8');
    } catch {
      textSend(res, 404, `the source file is not available: ${internalPath}`);
      return;
    }
    textSend(res, 200, text);
  };
}

const statusByCode: Record<number, number> = { 0: 200, [-1]: 400, [-2]: 409, [-3]: 404 };

// the file of POST file/create, written; { code, data: { path, entry }, message }
export function sourceFileCreate(
  body: any,
  sourceRootList: SourceRoot[],
  fileEntryList: FileEntry[],
): { code: number; data: any; message: string } {
  const dirPath = sourcePathNormalize(body?.dirPath ?? '');
  const name = String(body?.name ?? '').trim();
  if (!sourcePathIsRooted(dirPath)) return { code: -1, data: null, message: `dirPath must be a source path (~rootId/dir): ${dirPath}` };
  if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    return { code: -1, data: null, message: `name must be a file name without a folder: ${name}` };
  }
  let data: Buffer;
  if (typeof body?.text === 'string') data = Buffer.from(body.text, 'utf-8');
  else if (typeof body?.dataBase64 === 'string') data = Buffer.from(body.dataBase64, 'base64');
  else return { code: -1, data: null, message: 'text or dataBase64 is required' };

  const parsed = sourcePathParse(dirPath)!;
  const rootRuleList = sourceRootList.filter((item) => item.kind === 'folder' && item.rootId === parsed.rootId);
  if (rootRuleList.length === 0) return { code: -3, data: null, message: `no source folder has the root ${parsed.rootId}` };
  const dirAbs = path.resolve(rootRuleList[0].rootAbsPath, ...parsed.relPath.split('/').filter(Boolean));
  if (!pathIsInside(dirAbs, rootRuleList[0].rootAbsPath)) return { code: -1, data: null, message: `dirPath leaves its root: ${dirPath}` };
  // the folder must be collected by a folder rule: inside a recursive or
  // referenced folder, or the folder of a direct rule itself
  const root = rootRuleList.find((item) => (
    item.collect === 'direct' ? dirAbs === item.absPath : pathIsInside(dirAbs, item.absPath)
  ));
  if (!root) return { code: -3, data: null, message: `the folder is not collected by any source rule: ${dirPath}` };
  const fileAbs = path.join(dirAbs, name);
  const relPath = path.relative(root.rootAbsPath, fileAbs);
  if (fs.existsSync(fileAbs) && body?.isOverwrite !== true) {
    return { code: -2, data: null, message: `the file exists: ${sourcePathBuild(parsed.rootId, relPath)}` };
  }
  fs.mkdirSync(dirAbs, { recursive: true });
  fs.writeFileSync(fileAbs, data);
  const entryExisting = fileEntryList.find((item) => item.absPath === fileAbs);
  const entry = entryExisting ?? makeEntry(parsed.rootId, relPath, fileAbs, root.collect);
  return { code: 0, data: { path: entry.internalPath, entry }, message: '' };
}

function jsonBodyRead(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunkList: Buffer[] = [];
    req.on('data', (chunk) => chunkList.push(Buffer.from(chunk)));
    req.on('end', () => {
      const text = Buffer.concat(chunkList).toString('utf-8');
      if (text === '') {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error('request body is not valid JSON'));
      }
    });
    req.on('error', reject);
  });
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

// the local layer of config.yaml: config.0.yaml beside it, merged over it
// key by key when it exists
function configLocalFileGet(configFile: string): string {
  const extension = path.extname(configFile);
  return path.join(path.dirname(configFile), `${path.basename(configFile, extension)}.0${extension}`);
}

function loadConfigDoc(configFile: string, options: DocSourcePluginOptions = {}): any {
  const configDir = path.dirname(configFile);
  const configLocalFile = configLocalFileGet(configFile);
  const configBase = readYaml(configFile) ?? {};
  const configLocal = readYaml(configLocalFile) ?? {};
  const config = mergeDeep(configBase, configLocal);
  configFormerKeysReject(config, configFile);
  if (typeof config.docEntry?.file !== 'string' || !config.docEntry.file.trim()) {
    throw new Error(
      `[doc-source] config "docEntry.file" must name the entry file of the document (xxx-entry.yaml): ${configFile}`,
    );
  }
  if (config.docEntry.sidePanel !== undefined && typeof config.docEntry.sidePanel !== 'string') {
    throw new Error(`[doc-source] config "docEntry.sidePanel" must be a side panel id: ${configFile}`);
  }

  // the document entry: its source rules, its page side panel inlined (so the
  // browser side never touches the file system), its tag definitions.
  // design: doc_page_impl_side_panel.md#the-document-entry
  const entryFile = path.resolve(configDir, config.docEntry.file);
  const entryLoaded = docEntryLoad(entryFile, configDir, config.docEntry.sidePanel ?? '');
  config.source = entryLoaded.sourceRuleList;
  config.sidePanel = { ...(config.sidePanel ?? {}), tree: entryLoaded.sidePanel?.tree };
  config.docEntry = {
    ...config.docEntry,
    sidePanel: entryLoaded.sidePanelId,
    sidePanelIdList: entryLoaded.sidePanelIdList,
  };
  // every yaml file the entry reaches, for the edit api; not part of the
  // data sent to the page
  Object.defineProperty(config.docEntry, 'fileListLoaded', {
    enumerable: false,
    value: entryLoaded.fileListLoaded,
  });
  // page values the entry supplies when config.yaml does not set them, so
  // that a document used as the entry of another deployment brings its own
  config.siteTitle ??= entryLoaded.entry.title;
  config.homeDoc ??= entryLoaded.entry.homeDoc;
  config.homeItem ??= entryLoaded.entry.homeItem;

  // tag definitions: the entry's (its own over what it includes), then the
  // tag file of config, then entries written in config itself
  let tagDefineByIdConfigFile: Record<string, any> = {};
  if (config.tag?.file) {
    const tagFile = path.resolve(configDir, config.tag.file);
    const tagFileContent = readYaml(tagFile);
    if (tagFileContent === undefined) {
      throw new Error(`[doc-source] tag file not found: ${tagFile}`);
    }
    tagDefineByIdConfigFile = tagFileContent?.defineById ?? {};
  }
  config.tag = {
    ...(config.tag ?? {}),
    defineById: {
      ...entryLoaded.tagDefineById,
      ...tagDefineByIdConfigFile,
      ...(config.tag?.defineById ?? {}),
    },
  };

  const itemIdsExcluded = new Set(options.excludeSidePanelItemIds ?? []);
  if (itemIdsExcluded.size > 0 && Array.isArray(config.sidePanel?.tree)) {
    config.sidePanel.tree = excludeSidePanelItems(config.sidePanel.tree, itemIdsExcluded);
  }
  // the configuration files of the page: config.yaml and its local layer,
  // the yaml files of the document, the tag file of config. the watcher
  // reloads the page when one changes; the scan never collects them as
  // documents. not part of the data sent to the page.
  const fileListConfiguration = [configFile, configLocalFile, ...entryLoaded.fileListLoaded];
  if (config.tag.file) fileListConfiguration.push(path.resolve(configDir, config.tag.file));
  Object.defineProperty(config, 'fileListConfiguration', { enumerable: false, value: fileListConfiguration });
  return config;
}

// the keys of the former configuration, which named the source rules and the
// side-panel file from config itself; both are declared by the entry now
function configFormerKeysReject(config: any, configFile: string) {
  if (config.source !== undefined) {
    throw new Error(
      `[doc-source] config "source" is not read any more: declare the source rules in the entry file`
        + ` named by "docEntry.file" (its "source" section): ${configFile}`,
    );
  }
  if (config.sidePanel?.file !== undefined) {
    throw new Error(
      `[doc-source] config "sidePanel.file" is not read any more: declare the side panel in the entry file`
        + ` named by "docEntry.file" (its "sidePanelById" section): ${configFile}`,
    );
  }
}

function excludeSidePanelItems(nodes: any[], itemIdsExcluded: Set<string>): any[] {
  return nodes
    .filter((node) => !itemIdsExcluded.has(String(node?.id ?? '')))
    .map((node) => Array.isArray(node?.children)
      ? { ...node, children: excludeSidePanelItems(node.children, itemIdsExcluded) }
      : node);
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

  const rootAbsPathById = new Map<string, string>();
  for (const [ruleIndex, rule] of configDoc.source.entries()) {
    if (rule.action === 'addFolder') {
      const root = sourceRootOfRule(rule, configDir, rootAbsPathById);
      if (!fs.existsSync(root.absPath)) {
        console.warn(`[doc-source] addFolder: not found: ${root.absPath}`);
        continue;
      }
      for (const fileAbs of walkFiles(root.absPath, root.collect !== 'direct')) {
        const entry = makeEntry(root.rootId, path.relative(root.rootAbsPath, fileAbs), fileAbs, root.collect);
        tagSourceAddRuleApply(entry, rule, ruleIndex);
        configSourceAddRuleApply(entry, rule, ruleIndex);
        entryAdd(entry);
      }
    } else if (rule.action === 'addFile') {
      const root = sourceRootOfRule(rule, configDir, rootAbsPathById);
      if (!fs.existsSync(root.absPath)) {
        console.warn(`[doc-source] addFile: not found: ${root.absPath}`);
        continue;
      }
      const entry = makeEntry(root.rootId, path.relative(root.rootAbsPath, root.absPath), root.absPath, root.collect);
      tagSourceAddRuleApply(entry, rule, ruleIndex);
      configSourceAddRuleApply(entry, rule, ruleIndex);
      entryAdd(entry);
    } else if (rule.action === 'removeByName') {
      const regex = globToRegex(rule.pattern);
      entryRemoveIf((e) => regex.test(e.name));
    } else if (rule.action === 'removeByPath') {
      // a glob over the whole source path (~rootId/...)
      const regex = globToRegex(rule.pattern);
      entryRemoveIf((e) => regex.test(e.internalPath));
    } else if (tagSourceRuleIs(rule)) {
      tagSourceRuleApply([...entryByPath.values()], rule, ruleIndex, globToRegex);
    } else if (configSourceRuleIs(rule)) {
      configSourceRuleApply([...entryByPath.values()], rule, ruleIndex, globToRegex);
    } else {
      throw new Error(`[doc-source] unknown source rule action: ${rule.action}`);
    }
  }

  // the configuration files (config.yaml, the yaml files of the document),
  // their backups (the edit api keeps {file}.bak when it rewrites one) and
  // the files of the asset store (doc_page_impl_asset.md) are never
  // documents, even when they lie inside a source folder
  const pathsConfiguration = collectPathsConfiguration(configDoc);
  const configurationPathSet = new Set(pathsConfiguration);
  const assetConfig = assetConfigGet(configDoc, configDir);
  return [...entryByPath.values()].filter((entry) => (
    !configurationPathSet.has(entry.absPath)
    && !configurationBackupPathIs(pathsConfiguration, entry.absPath)
    && (!assetConfig || !assetPathIs(assetConfig, entry.absPath))
  ));
}

// the backup the edit api keeps beside a configuration file it rewrote
function configurationBackupPathIs(pathsConfiguration: string[], filePath: string): boolean {
  return pathsConfiguration.some((configurationPath) => filePath === `${configurationPath}.bak`);
}

// the asset references of the md/mdx documents among the entries, read from
// disk now (doc_page_impl_asset.md#usage); docPathList names the documents
// to read, every document when empty. contentHash is the hash the manifest
// gives the file, so the page knows which documents changed since.
function assetUsageDocListScan(entries: FileEntry[], docPathList: string[]): AssetUsageDoc[] {
  const docPathSet = new Set(docPathList);
  const docList: AssetUsageDoc[] = [];
  for (const entry of entries) {
    if (entry.ext !== 'md' && entry.ext !== 'mdx') continue;
    if (docPathSet.size > 0 && !docPathSet.has(entry.internalPath)) continue;
    if (!fs.existsSync(entry.absPath)) continue;
    const content = fs.readFileSync(entry.absPath);
    docList.push({
      docPath: entry.internalPath,
      contentHash: textContentHashGet(content),
      usageList: assetUsageListScan(content.toString('utf-8'), entry.internalPath),
    });
  }
  return docList;
}

// the local asset store as config asset.file describes it now; undefined
// when the config names no store, an error when it names one wrongly
// (assetConfigOfConfigDocGet)
function assetConfigGet(configDoc: any, configDir: string): AssetStoreConfig | undefined {
  return assetConfigOfConfigDocGet(configDoc, configDir);
}

// a file of the asset store: its config file (and the backup / temporary
// file the store writes beside it), or anything inside one of its folders
function assetPathIs(assetConfig: AssetStoreConfig, filePath: string): boolean {
  if (filePath === assetConfig.file || filePath === `${assetConfig.file}.bak` || filePath === `${assetConfig.file}.tmp`) return true;
  return assetConfig.folderList.some((folder) => pathIsInside(filePath, folder.pathAbs));
}

function pathIsInside(filePath: string, folder: string): boolean {
  const relative = path.relative(folder, filePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

// the root an add rule declares. an addFolder rule must say how it collects
// (collect: recursive | direct | referenced); a file of addFile is a
// document. rootAbsPathById remembers the folder of every root id seen so
// far: the first rule with an id fixes it (for addFile, the folder of the
// file), a later rule with the same id must name a folder inside it.
function sourceRootOfRule(rule: any, configDir: string, rootAbsPathById: Map<string, string>): SourceRoot {
  const absPath = path.resolve(configDir, rule.path);
  const rootId: string = rule.rootId ?? path.basename(absPath);
  const kind = rule.action === 'addFile' ? 'file' : 'folder';
  let collect: SourceCollectMode = 'direct';
  if (kind === 'folder') {
    if (!sourceCollectModeList.includes(rule.collect)) {
      throw new Error(
        `[doc-source] addFolder "${rule.path}": "collect" must be one of ${sourceCollectModeList.join(', ')}`
        + ` (got ${JSON.stringify(rule.collect)})`,
      );
    }
    collect = rule.collect;
  }
  const rootAbsPathOwn = kind === 'file' ? path.dirname(absPath) : absPath;
  const rootAbsPath = rootAbsPathById.get(rootId) ?? rootAbsPathOwn;
  if (!pathIsInside(rootAbsPathOwn, rootAbsPath)) {
    throw new Error(
      `[doc-source] ${rule.action} "${rule.path}": root "${rootId}" is the folder ${rootAbsPath};`
      + ' a later rule with the same rootId must name a path inside it',
    );
  }
  rootAbsPathById.set(rootId, rootAbsPath);
  return { rootId, absPath, rootAbsPath, kind, collect };
}

// the roots of every add rule, in rule order
export function sourceRootListGet(configDoc: any, configDir: string): SourceRoot[] {
  const rootAbsPathById = new Map<string, string>();
  return (configDoc.source as any[])
    .filter((rule) => rule.action === 'addFolder' || rule.action === 'addFile')
    .map((rule) => sourceRootOfRule(rule, configDir, rootAbsPathById));
}

// the folders of the source: for every addFolder rule its folder, and for a
// recursive or referenced rule every folder below it. removeByPath rules
// remove the folders they cover (a pattern "~root/sub/**" removes what is
// inside ~root/sub and the folder itself).
export function scanSourceDirs(configDoc: any, configDir: string): DirEntry[] {
  const dirByPath = new Map<string, DirEntry>();
  const rootAbsPathById = new Map<string, string>();
  for (const rule of configDoc.source as any[]) {
    if (rule.action === 'addFolder' || rule.action === 'addFile') {
      const root = sourceRootOfRule(rule, configDir, rootAbsPathById);
      if (root.kind === 'file' || !fs.existsSync(root.absPath)) continue;
      const dirAbsList = root.collect === 'direct' ? [root.absPath] : [root.absPath, ...walkDirs(root.absPath)];
      for (const dirAbs of dirAbsList) {
        const relPath = path.relative(root.rootAbsPath, dirAbs).split(path.sep).join('/');
        const internalPath = sourcePathBuild(root.rootId, relPath);
        dirByPath.set(internalPath, { rootId: root.rootId, relPath, absPath: dirAbs, internalPath, collect: root.collect });
      }
    } else if (rule.action === 'removeByPath') {
      const regex = globToRegex(rule.pattern);
      for (const dir of [...dirByPath.values()]) {
        if (regex.test(dir.internalPath) || regex.test(`${dir.internalPath}/`)) dirByPath.delete(dir.internalPath);
      }
    }
  }
  const assetConfig = assetConfigGet(configDoc, configDir);
  return [...dirByPath.values()].filter((dir) => !assetConfig || !assetPathIs(assetConfig, dir.absPath));
}

function makeEntry(rootId: string, relPath: string, absPath: string, collect: SourceCollectMode): FileEntry {
  const relSlash = relPath.split(path.sep).join('/');
  const name = path.basename(absPath);
  return {
    rootId,
    relPath: relSlash,
    name,
    ext: path.extname(name).slice(1).toLowerCase(),
    absPath,
    internalPath: sourcePathBuild(rootId, relSlash),
    collect,
  };
}

const dirNameSkipSet = new Set(['.git', 'node_modules']);

function walkFiles(dirAbs: string, isRecursive: boolean): string[] {
  const result: string[] = [];
  for (const item of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    if (dirNameSkipSet.has(item.name)) continue;
    const itemAbs = path.join(dirAbs, item.name);
    if (item.isDirectory()) {
      if (isRecursive) result.push(...walkFiles(itemAbs, true));
    } else if (item.isFile()) {
      result.push(itemAbs);
    }
  }
  return result;
}

function walkDirs(dirAbs: string): string[] {
  const result: string[] = [];
  for (const item of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    if (!item.isDirectory() || dirNameSkipSet.has(item.name)) continue;
    const itemAbs = path.join(dirAbs, item.name);
    result.push(itemAbs, ...walkDirs(itemAbs));
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

// Optional deployment optimization: retain only the files the side panel
// navigates to, plus every file they statically reach.
//
// roots: side-panel `doc` items and source folders (after side-panel
// exclusions), and the content of inline items. each retained .md/.mdx file is
// scanned by doc-source-dependency.ts; reached documents are scanned in turn,
// other files are retained without parsing. the side panel itself stays
// navigation only. a file collected as "referenced" is never a root: it is
// retained when a document reaches it or an asset version depends on it
// (assetDependencyPathList, the source paths of every version's
// dependencies; doc_page_impl_asset.md#dependencies).
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
  assetDependencyPathList: string[] = [],
): FileEntry[] {
  const sourceIndex = sourceIndexBuild(entries);
  const pathsRetained = new Set<string>();
  const docQueue: FileEntry[] = [];
  const entryRetain = (entry: FileEntry) => {
    if (pathsRetained.has(entry.internalPath)) return;
    pathsRetained.add(entry.internalPath);
    if (entry.ext === 'md' || entry.ext === 'mdx') docQueue.push(entry);
  };
  for (const dependencyPath of assetDependencyPathList) {
    const { entryList } = docTargetResolve(dependencyPath, '', sourceIndex) as { entryList: FileEntry[] };
    if (entryList.length === 0) {
      console.warn(`[doc-source] asset dependency "${dependencyPath}" is not in the collected source; nothing was retained for it.`);
    }
    for (const entry of entryList) entryRetain(entry);
  }
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
    const entry = sourceIndex.entryByInternalPath.get(sourcePathNormalize(dependency.target));
    if (!entry) {
      console.warn(
        `[doc-source] ${declared} is not an exact source path (~rootId/...) of the collected source;`
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

// matches page-tree.js convertSourceFolder: the pages of a source folder;
// files collected for reference only are not pages
function sourceFolderEntryListGet(node: any, entries: FileEntry[]): FileEntry[] {
  const pathFolder = node.sourceFolder !== undefined
    ? sourcePathNormalize(String(node.sourceFolder))
    : sourcePathBuild(String(node.sourceRoot));
  if (!sourcePathIsRooted(pathFolder)) return [];
  return entries.filter((entry) => entry.collect !== 'referenced' && sourcePathIsInside(entry.internalPath, pathFolder));
}

// matches page-tree.js resolveDocEntries
function resolveSourceReference(reference: string, entries: FileEntry[]): FileEntry[] {
  if (sourcePathIsRooted(reference)) {
    const pathWanted = sourcePathNormalize(reference);
    return entries.filter((entry) => entry.internalPath === pathWanted);
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
    collect: entry.collect,
    contentHash: textContentHashGet(content),
    tagList: entry.tagList ?? [],
    configSource: entry.configSource ?? {},
    configFrontmatter: configFrontmatterRead(text, entry.absPath) ?? {},
  };
}

export function dirMetadataBuild(dir: DirEntry) {
  return { rootId: dir.rootId, relPath: dir.relPath, internalPath: dir.internalPath, collect: dir.collect };
}

function textContentHashGet(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export function generateModuleCode(
  configDoc: any,
  fileEntries: FileEntry[],
  dirEntries: DirEntry[],
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
  lines.push(`export const docSourceEndpoint = ${JSON.stringify(services.docSourceEndpoint)};`);
  lines.push(`export const docEditEndpoint = ${JSON.stringify(services.docEditEndpoint)};`);
  lines.push(`export const docAssetEndpoint = ${JSON.stringify(services.docAssetEndpoint)};`);
  lines.push(`export const assetSnapshot = ${JSON.stringify(services.assetSnapshot)};`);
  // the bytes of the files components name: a build inlines them as data
  // urls, keyed by source path and by the spelling the reference used; in
  // development the page reads them through the source api instead, and the
  // table only covers files found outside the collected source
  const fileUrlByPath: Record<string, string> = {};
  for (const attachment of attachmentList) {
    const url = isBuild
      ? attachmentDataUrlGet(attachment.absPath)
      : `/@fs/${normalizeSlashPath(attachment.absPath)}`;
    for (const reference of attachment.referenceList) {
      fileUrlByPath[reference.replace(/^\.\//, '')] = url;
    }
  }
  lines.push(`export const fileUrlByPath = ${JSON.stringify(fileUrlByPath)};`);
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
    // bundler finds it. a binary file (an image) has no text to load: its
    // bytes are reached through fileUrlByPath.
    let load: string;
    if (!isBuild) load = `() => sourceTextLoad(${JSON.stringify(e.internalPath)})`;
    else if (attachmentExtIsBinary(e.ext)) load = `() => Promise.reject(new Error(${JSON.stringify(`${e.internalPath} is not a text file`)}))`;
    else load = `() => import(${JSON.stringify(`${e.absPath}?raw`)}).then((m) => m.default)`;
    lines.push(`  { ...${JSON.stringify(fileMetadataBuild(e))}, load: ${load} },`);
  }
  lines.push('];');
  lines.push(`export let dirManifest = ${JSON.stringify(dirEntries.map(dirMetadataBuild))};`);
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
    lines.push('    dirManifest = dataNext.dirManifest;');
    lines.push('    sourceState.current = { configDoc, fileManifest, dirManifest };');
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
    lines.push('    const dataNext = { configDoc: moduleNext.configDoc, fileManifest: moduleNext.fileManifest, dirManifest: moduleNext.dirManifest };');
    lines.push('    sourceState.current = dataNext;');
    lines.push('    for (const listener of listenersDocSource) listener(dataNext);');
    lines.push('  });');
    // the asset store changed on disk: listeners get { objectId, isStoreChanged }
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

// the configuration files of the page, as loadConfigDoc recorded them: a
// change of one of them regenerates the manifest and reloads the page
function collectPathsConfiguration(configDoc: any): string[] {
  const fileListConfiguration = configDoc.fileListConfiguration;
  return Array.isArray(fileListConfiguration) ? [...fileListConfiguration] : [];
}

// the yaml files of the document the configuration loads: the entry file and
// every file it reaches (included side panels, source and tag files), absolute
function collectDocYamlFiles(configDoc: any): string[] {
  const fileListLoaded = configDoc.docEntry?.fileListLoaded;
  return Array.isArray(fileListLoaded) ? [...fileListLoaded] : [];
}

// the configuration files plus the source folders and files, so that the
// watcher reports additions and removals inside the source
function collectPathsToWatch(configDoc: any, configDir: string): string[] {
  const result = collectPathsConfiguration(configDoc);
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
