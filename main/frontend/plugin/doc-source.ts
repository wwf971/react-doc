import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isCSSRequest, type EnvironmentModuleNode, type Plugin } from 'vite';
import {
  DOC_PAGE_META_DIR_NAME,
  docEntryFileFind,
  docPageSpecRead,
  docWorkspaceLoad,
  docWorkspaceSpecRead,
  readYaml,
  type DocWorkspaceSpec,
} from './doc-entry.ts';
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
  sourcePathFullGet,
  sourcePathIsInside,
  sourcePathIsRooted,
  sourcePathNormalize,
  sourcePathParse,
  sourcePathPatternFullGet,
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
import { excludeMatcherBuild, type ExcludeMatcher } from './doc-source-exclude.ts';
import { DOC_ASSET_ENDPOINT_NAME, docAssetMiddlewareCreate } from './doc-asset-server.ts';
import {
  DOC_SERVICE_ENDPOINT_NAME, docServiceMiddlewareCreate, serviceBackendLaunch, serviceConfigGet, serviceFolderSetGet, servicePathIs,
  serviceConfigFileGet, serviceSyncDocPageListBuild, type ServiceFolderSet,
} from './doc-service-server.ts';
import {
  compConfigOfDocPageListGet, compConfigurationFileListGet, compFolderListGet, compManifestPathIs, compPathIs,
  type CompConfig, type CompMount,
} from './doc-comp-config.ts';
import {
  assetConfigFormerReject, assetConfigOfDocPageListGet, assetStoreCreate, objectIdFromDirName,
  type AssetSnapshot, type AssetStore, type AssetStoreConfig, type AssetUsageDoc,
} from './doc-asset-store.ts';
import { assetBlockTextExpand, assetUsageListScan } from '../src/lib/doc-asset-ref.js';
import { docTargetResolve, sourceIndexBuild } from '../src/lib/doc-target-resolve.js';
import { textLocalizedGet } from '../src/lib/text-localized.js';

// vite plugin "doc-source" (design: doc_page_impl_source.md).
// reads two-layer yaml config, loads the workspace (config "workspace", or
// the one doc page of config "docEntry" as a virtual workspace), executes
// the source rules of its doc pages against the file system, and exposes
// the result as virtual module `virtual:doc-source`:
//
//   export let configDoc = {...}        // merged config (the workspace loaded: source rules,
//                                       //   the page side panel inlined, tag definitions merged,
//                                       //   "workspace": its doc pages and their includes)
//   export let fileManifest = [{ docPageAlias, rootAlias, relPath, name, ext, title, internalPath,
//                                collect, contentHash, tagList, configSource, configFrontmatter, load }]
//   export let dirManifest = [{ docPageAlias, rootAlias, relPath, internalPath, collect }]   // the folders of the source
//   export const fileUrlByPath = {...}              // source path -> url of the file's bytes (build: data url)
//   export const docEnv = { kind }                   // 'viteDevServer' | 'staticBuild' (DocEnvStore)
//   export const docSourceEndpoint = '/__doc-source' // '' in a build: no source api
//   export const docEditEndpoint = '/__doc-edit'    // '' in a build: no edit api
//   export const docAssetEndpoint = '/__doc-asset'  // '' in a build or without asset.file
//   export const docServiceEndpoint = '/__doc-service' // '' in a build or without config service
//   export const assetSnapshot = {...} | null       // the asset service layer, bundled in a build
//   export const docCompMountList = [{ docPageAlias, tagName, id, export, defineOptionsExport, entryFile, module }]
//                                                   // the components of the loaded doc pages, their modules imported
//   export function subscribeDocSource(listener)    // dev: the source data changed
//   export function subscribeDocAsset(listener)     // dev: an object or the store's folders changed on disk
//
// every file is named by its source path, in the full form
// ~docPageAlias:rootAlias/relPath (doc-source-path.js); a rule of a doc page
// writes the local form ~rootAlias/..., which is made full with the alias
// of that doc page (rule.docPageAlias, set by the loader).
// an addFolder rule says how its folder is collected (rule.collect):
//   recursive   every file in the folder and its subfolders is a document
//   direct      the files right in the folder are documents
//   referenced  the files in the folder (and its subfolders) are collectable:
//               they are part of the page only when something uses them (an
//               image an Image block names, a dependency of an asset version)
// a referenced file is in the manifest with collect "referenced"; it is not
// a page of the side panel, and a build keeps it only when it is used.
// a root alias names one folder of its doc page: the first add rule with
// the alias fixes it; a later rule with the same alias names a folder
// inside it and sets the collect mode of that part (a file collected twice
// takes the later rule).
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
// store of the asset service layer, whose config file is named by config asset.file and whose
// folders are listed in that file (doc_page_impl_asset.md). the store's
// files are never part of the collected source, wherever they are placed.
// it forwards the service api to the service backend of config service
// (doc-service-server.ts: the address its backendConfigFile says, which it
// starts with service.launch); the folders of the backend's config file
// are not part of the source either.
//
// a doc page folder also holds, by convention, what is never a document
// whatever rule collects the folder around it (sourceExcludeGet): the
// metadata folder .doc-page/, the asset folders (doc-asset-store.ts), the
// service folders (doc-service-server.ts) and the component folders
// (doc-comp-config.ts). the components of the component folders are
// mounted into the component registry of the page: the virtual module
// imports every module a comp.yaml manifest names and exports the mounts as
// docCompMountList, and the tag names they declare are written into
// configDoc.compRegistry over those of config.yaml.

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
  docPageAlias: string;
  rootAlias: string;
  relPath: string; // path inside root, the file name for a root file
  name: string;
  ext: string;
  absPath: string;
  internalPath: string; // the full source path ~{docPageAlias}:{rootAlias}/relPath (doc-source-path.js)
  collect: SourceCollectMode; // 'referenced': part of the page only when used
  tagList?: any[]; // tags declared by source rules, see doc-tag-source.ts
  configSource?: Record<string, any>; // config declared by source rules, see doc-config-source.ts
};

// a folder of the source: the folder of an addFolder rule and (recursive,
// referenced) every folder below it. the page lists them (a location to
// create a file in) without the file system.
export type DirEntry = {
  docPageAlias: string;
  rootAlias: string;
  relPath: string; // '' for the folder of the rule
  absPath: string;
  internalPath: string; // ~{docPageAlias}:{rootAlias} or ~{docPageAlias}:{rootAlias}/relPath
  collect: SourceCollectMode;
};

// the folder or file of an add rule, as the source api resolves paths
// what one add rule collects. a root alias names one folder on disk
// (rootAbsPath) in its doc page: the first rule with the alias fixes it, and
// a later rule with the same alias collects a folder inside it (with its
// own collect mode), so the source paths of both are
// ~docPageAlias:rootAlias/<path from the root folder>.
export type SourceRoot = {
  docPageAlias: string;
  rootAlias: string;
  // the full source path of the root: ~docPageAlias:rootAlias
  rootPath: string;
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
  let docServiceEndpoint = '';
  // the configuration files of the page: config.yaml and its local layer,
  // the entry file of the document and every yaml file it reaches (included
  // side panels, source and tag files), and the tag file of config. a change
  // of one of them regenerates the manifest and reloads the page; a change
  // of a collected document does not.
  let pathsConfiguration: string[] = [];
  const moduleId = options.moduleId ?? MODULE_ID_DEFAULT;
  const moduleIdResolved = `\0${moduleId}`;

  // the local store of the asset service layer (config asset.file), or undefined without one;
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
      // the service section likewise; a built page has no backend to reach
      docServiceEndpoint = isBuild || !serviceConfigGet(configDocEarly, configDir)
        ? ''
        : endpointBuild(viteConfig.base, DOC_SERVICE_ENDPOINT_NAME);
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
        docServiceEndpoint,
        assetSnapshot,
        moduleId,
        compMountList: compConfigGet(configDoc).mountList,
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
      // the files that are never documents, as the doc pages loaded now
      // declare them (the service and component folders follow a mount);
      // declared below the middlewares, refreshed with every configuration load
      let sourceExclude: SourceExclude | undefined;
      const sourceExcludeSet = (configDocUpdated: any) => {
        sourceExclude = sourceExcludeGet(configDocUpdated, configDir);
      };
      // the configuration changed without a file write (a temporary doc
      // page mounted): watched again and reported as data
      const configurationReload = (): string => {
        let configDocUpdated: any;
        try {
          configDocUpdated = loadConfigDoc(configFile, options);
        } catch (error: any) {
          return String(error?.message ?? error);
        }
        pathsWatched = collectPathsToWatch(configDocUpdated, configDir);
        pathsConfiguration = collectPathsConfiguration(configDocUpdated);
        sourceExcludeSet(configDocUpdated);
        for (const p of pathsWatched) server.watcher.add(p);
        configDataSend(configDocUpdated);
        return '';
      };
      const workspaceDirBaseGet = () => loadConfigDoc(configFile, options).workspace.dirBaseAbs ?? configDir;
      server.middlewares.use(docSourceMiddlewareCreate({
        endpoint: docSourceEndpoint,
        fileEntryListGet,
        sourceRootListGet: () => sourceRootListGet(loadConfigDoc(configFile, options), configDir),
        onFileCreated: (filePath) => {
          pathsCreatedByPage.add(filePath);
          configDataSend(loadConfigDoc(configFile, options));
        },
        workspace: {
          dirBaseGet: workspaceDirBaseGet,
          // { kind: 'dir' | 'file', path, alias?, sidePanel? }: the doc page
          // joins the workspace when the configuration loads with it
          mount: (body) => {
            const kind = body?.kind === 'file' ? 'file' : body?.kind === 'dir' ? 'dir' : '';
            const pathText = String(body?.path ?? '').trim();
            if (!kind || pathText === '') return { code: -1, data: null, message: 'a mount names "kind" (dir | file) and "path"' };
            const pathAbs = osPathResolve(pathText, workspaceDirBaseGet());
            let entryFile = pathAbs;
            try {
              if (kind === 'dir') entryFile = docEntryFileFind(pathAbs);
              else if (!fs.statSync(pathAbs).isFile()) return { code: -1, data: null, message: `not a file: ${pathAbs}` };
            } catch (error: any) {
              return { code: -3, data: null, message: String(error?.message ?? error).replace(/^\[doc-source\] /, '') };
            }
            const alias = String(body?.alias ?? '').trim();
            const sidePanel = String(body?.sidePanel ?? '').trim();
            const mount: WorkspaceMount = { [kind]: pathAbs };
            if (alias) mount.alias = alias;
            if (sidePanel) mount.sidePanel = sidePanel;
            const mountList = [...workspaceMountListGet(configFile)];
            workspaceMountListByConfigFile.set(configFile, [...mountList, mount]);
            fileEntryListCached = undefined;
            const messageLoad = configurationReload();
            if (messageLoad !== '') {
              workspaceMountListByConfigFile.set(configFile, mountList);
              fileEntryListCached = undefined;
              return { code: -1, data: null, message: messageLoad.replace(/^\[doc-source\] /, '') };
            }
            const docPage = loadConfigDoc(configFile, options).docEntry.docPageList
              .find((item: any) => item.isTemporary && item.entryFile === entryFile);
            return { code: 0, data: { alias: docPage?.alias ?? '' }, message: '' };
          },
          // { alias }: a temporary doc page leaves the workspace
          unmount: (body) => {
            const alias = String(body?.alias ?? '');
            const docPage = loadConfigDoc(configFile, options).docEntry.docPageList
              .find((item: any) => item.isTemporary && item.alias === alias);
            if (!docPage) return { code: -3, data: null, message: `no temporary doc page has the alias "${alias}"` };
            const mountList = workspaceMountListGet(configFile);
            workspaceMountListByConfigFile.set(configFile, mountList.filter((mount) => (
              entryPathOfMount(mount) !== docPage.entryFile
            )));
            fileEntryListCached = undefined;
            const messageLoad = configurationReload();
            if (messageLoad !== '') {
              workspaceMountListByConfigFile.set(configFile, mountList);
              return { code: -1, data: null, message: messageLoad };
            }
            return { code: 0, data: { alias }, message: '' };
          },
        },
      }));
      // a configuration file the page itself rewrote (a side-panel label, a
      // side-panel item moved, a config value), by content hash. the watcher
      // reports that change too; when the file still has this content, the
      // change was already reported as data and must not reload the page.
      // the files of one write (a move between two files) are reported once.
      const contentHashWrittenByPath = new Map<string, string>();
      // answers '' when the configuration loads with the files written, else
      // why it does not; nothing is reported to the page then
      const configurationFileListWritten = (fileList: { filePath: string; text: string }[]): string => {
        for (const { filePath, text } of fileList) contentHashWrittenByPath.set(filePath, textContentHashGet(text));
        let configDocUpdated: any;
        try {
          configDocUpdated = loadConfigDoc(configFile, options);
        } catch (error: any) {
          return String(error?.message ?? error);
        }
        pathsWatched = collectPathsToWatch(configDocUpdated, configDir);
        pathsConfiguration = collectPathsConfiguration(configDocUpdated);
        sourceExcludeSet(configDocUpdated);
        for (const p of pathsWatched) server.watcher.add(p);
        configDataSend(configDocUpdated);
        return '';
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
          onFileListWritten: configurationFileListWritten,
        },
        // the doc page config layer (doc_page_impl_config.md#the-doc-page-layer):
        // the config declarations of the entry and the files it reaches
        config: {
          configDir,
          declarationListGet: () => loadConfigDoc(configFile, options).docEntry.configDeclarationList,
          onFileListWritten: configurationFileListWritten,
        },
        // the workspace file (doc_page_impl_source.md#editing-the-workspace-file)
        workspace: {
          fileGet: () => {
            const { file } = loadConfigDoc(configFile, options).workspace;
            return file ? path.resolve(configDir, file) : '';
          },
          onFileListWritten: configurationFileListWritten,
        },
      }));

      // the asset api works on the store as its config file says now; a
      // change on disk (an external editor, a git checkout, the panel's own
      // write) is reported to the page as a custom hmr event, see
      // generateModuleCode: { objectId } for an object, { isStoreChanged }
      // when the folder list changed
      let assetConfig = assetConfigGet(configDoc, configDir);
      if (docAssetEndpoint && assetConfig) {
        // the store as the files say now: read again for every request
        const assetConfigCurrentGet = () => assetConfigGet(loadConfigDoc(configFile, options), configDir) ?? assetConfig!;
        server.middlewares.use(docAssetMiddlewareCreate({
          endpoint: docAssetEndpoint,
          storeGet: () => assetStoreCreate(assetConfigCurrentGet()),
          rootAbsPathByPathGet: () => sourceRootAbsPathByPathGet(loadConfigDoc(configFile, options), configDir),
          usageScan: (docPathList) => assetUsageDocListScan(fileEntryListGet(), docPathList),
        }));
        // the config file of every doc page (watched whether it exists or
        // not: one created from the page is seen) and every folder
        const assetWatch = () => {
          for (const docPage of assetConfig!.docPageList) server.watcher.add(docPage.configFile);
          for (const folder of assetConfig!.folderList) server.watcher.add(folder.pathAbs);
        };
        assetWatch();
        const assetChangeSend = (filePath: string) => {
          if (assetConfig!.docPageList.some((docPage) => docPage.configFile === filePath)) {
            try {
              assetConfig = assetConfigCurrentGet();
            } catch (error: any) {
              // keep the last valid store while a config file is being edited
              console.warn(String(error?.message ?? error));
              return;
            }
            assetWatch();
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

      // the service api is the backend's; the plugin only forwards it. like
      // the asset section, the service section is read once: a change of
      // the backend's address or folders needs a restart of the server.
      // the sync route is the plugin's own: the doc pages loaded now.
      // with service.launch the server starts the backend as well
      const serviceConfig = serviceConfigGet(configDoc, configDir);
      if (docServiceEndpoint && serviceConfig) {
        server.middlewares.use(docServiceMiddlewareCreate({
          endpoint: docServiceEndpoint,
          backendUrlGet: () => serviceConfig.backendUrl,
          docPageListGet: () => serviceSyncDocPageListBuild(loadConfigDoc(configFile, options).docEntry.docPageList),
        }));
        if (serviceConfig.isLaunch) void serviceBackendLaunch(serviceConfig);
      }

      sourceExcludeSet(configDoc);
      const invalidateManifest = (filePath: string) => {
        // a comp config file or a manifest of a component folder is
        // configuration: the mounts change with it
        if (!compManifestPathIs(sourceExclude!.compConfig, filePath)) {
          // files of the asset service layer, of the service layer (a
          // database, a built dashboard) and of the component folders (code,
          // with vite's own hmr) are not documents, even inside a source folder
          if (sourceExcludePathIs(sourceExclude!, filePath)) return;
        }
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
          sourceExcludeSet(configDocUpdated);
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
// the doc page source service layer of the development server (doc_page_impl_source.md#the-source-api):
//
//   GET  {endpoint}/file?path=~page:root/a.md   the text of a collected file, plain utf-8, never
//                                          cached. the development page loads every document
//                                          through it instead of importing the file as a module.
//   GET  {endpoint}/data?path=~page:root/x.png  the bytes of a collected file with their media type
//                                          (an image an Image block names)
//   POST {endpoint}/file/create            { dirPath, name, text | dataBase64, isOverwrite? }
//                                          -> { code, data: { path, entry }, message }
//                                          writes a file into a folder of the source. dirPath is a
//                                          source path (~page:root or ~page:root/dir) inside the folder of an
//                                          addFolder rule; the folders on the way are created. codes:
//                                          -1 bad request, -2 the file exists (isOverwrite false),
//                                          -3 the folder is not in the source
//
// only source paths resolve; a query is never used as a file path. the folder
// of a "direct" rule accepts files right in it only; "recursive" and
// "referenced" folders accept any folder below. a local path (~root/dir)
// names the root of whichever doc page has it, when exactly one does.

type SourceMiddlewareOptions = {
  endpoint: string;
  fileEntryListGet: () => FileEntry[];
  sourceRootListGet: () => SourceRoot[];
  onFileCreated: (filePath: string) => void;
  // the folder a relative path typed in the page is read from (os/list,
  // workspace/mount); the temporary doc pages, mounted and unmounted
  workspace?: {
    dirBaseGet: () => string;
    mount: (body: any) => { code: number; data: any; message: string };
    unmount: (body: any) => { code: number; data: any; message: string };
  };
};

export function docSourceMiddlewareCreate(options: SourceMiddlewareOptions) {
  const { endpoint, fileEntryListGet, sourceRootListGet, onFileCreated, workspace } = options;
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
    const isWorkspaceRoute = route === '/os/list' || route === '/workspace/mount' || route === '/workspace/unmount';
    if (route !== '/file' && route !== '/data' && route !== '/file/create' && !isWorkspaceRoute) {
      next();
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    if (isWorkspaceRoute) {
      if (!workspace) {
        jsonSend(res, 404, { code: -3, data: null, message: 'the server has no workspace routes' });
        return;
      }
      if (route === '/os/list') {
        const result = osDirList(url.searchParams.get('path') ?? '', workspace.dirBaseGet());
        jsonSend(res, statusByCode[result.code] ?? 400, result);
        return;
      }
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        jsonSend(res, 405, { code: -1, data: null, message: `${route.slice(1)} answers POST only` });
        return;
      }
      void jsonBodyRead(req)
        .then((body) => {
          const result = route === '/workspace/mount' ? workspace.mount(body) : workspace.unmount(body);
          jsonSend(res, statusByCode[result.code] ?? 400, result);
        })
        .catch((error) => jsonSend(res, 400, { code: -1, data: null, message: String(error?.message ?? error) }));
      return;
    }

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
  if (!sourcePathIsRooted(dirPath)) return { code: -1, data: null, message: `dirPath must be a source path (~page:root/dir or ~root/dir): ${dirPath}` };
  if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    return { code: -1, data: null, message: `name must be a file name without a folder: ${name}` };
  }
  let data: Buffer;
  if (typeof body?.text === 'string') data = Buffer.from(body.text, 'utf-8');
  else if (typeof body?.dataBase64 === 'string') data = Buffer.from(body.dataBase64, 'base64');
  else return { code: -1, data: null, message: 'text or dataBase64 is required' };

  const parsed = sourcePathParse(dirPath)!;
  // a local path names the root in whichever doc page has it, when one does
  const docPageAliasList = [...new Set(sourceRootList
    .filter((item) => item.rootAlias === parsed.rootAlias && (parsed.docPageAlias === '' || item.docPageAlias === parsed.docPageAlias))
    .map((item) => item.docPageAlias))];
  if (docPageAliasList.length > 1) {
    return { code: -1, data: null, message: `${dirPath} names a root of several doc pages (${docPageAliasList.join(', ')}); write ~docPageAlias:${parsed.rootAlias}/...` };
  }
  const rootRuleList = sourceRootList.filter((item) => (
    item.kind === 'folder' && item.rootAlias === parsed.rootAlias && item.docPageAlias === docPageAliasList[0]
  ));
  if (rootRuleList.length === 0) return { code: -3, data: null, message: `no source folder has the root ${sourcePathBuild(parsed.rootAlias, '', parsed.docPageAlias)}` };
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
    return { code: -2, data: null, message: `the file exists: ${sourcePathBuild(parsed.rootAlias, relPath, root.docPageAlias)}` };
  }
  fs.mkdirSync(dirAbs, { recursive: true });
  fs.writeFileSync(fileAbs, data);
  const entryExisting = fileEntryList.find((item) => item.absPath === fileAbs);
  const entry = entryExisting ?? makeEntry(root.docPageAlias, parsed.rootAlias, relPath, fileAbs, root.collect);
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

// ---------- temporary doc pages ----------
// a doc page mounted from the Workspace tab of the settings panel: a root
// doc page of the workspace for as long as this development server runs,
// written in no file (doc_page_impl_source.md#temporary-doc-pages). by
// config file, so every load of the configuration sees them.

type WorkspaceMount = { alias?: string; dir?: string; file?: string; sidePanel?: string };
const workspaceMountListByConfigFile = new Map<string, WorkspaceMount[]>();

function workspaceMountListGet(configFile: string): WorkspaceMount[] {
  return workspaceMountListByConfigFile.get(configFile) ?? [];
}

// the entry file a mount names, absolute
function entryPathOfMount(mount: WorkspaceMount): string {
  try {
    return mount.dir ? docEntryFileFind(mount.dir) : path.resolve(mount.file ?? '');
  } catch {
    return '';
  }
}

// a path typed in the page, absolute: "~/" is the home folder, a relative
// path is read from dirBase (the workspace file's folder)
export function osPathResolve(text: string, dirBase: string): string {
  const textTrimmed = String(text ?? '').trim();
  if (textTrimmed === '~' || textTrimmed.startsWith('~/')) return path.join(os.homedir(), textTrimmed.slice(1));
  return path.resolve(dirBase, textTrimmed);
}

// GET os/list: the entries of one folder of the file system, for the
// completion of a path typed in the page (lib/doc-os-path-complete.js).
// folders first, then files, by name; a folder holding a doc page entry
// (.doc-page/entry.yaml) is marked. at most OS_LIST_LIMIT entries.
const OS_LIST_LIMIT = 400;

export function osDirList(text: string, dirBase: string): { code: number; data: any; message: string } {
  const dirAbs = osPathResolve(text === '' ? '.' : text, dirBase);
  let itemList: fs.Dirent[];
  try {
    if (!fs.statSync(dirAbs).isDirectory()) return { code: -3, data: null, message: `not a folder: ${dirAbs}` };
    itemList = fs.readdirSync(dirAbs, { withFileTypes: true });
  } catch (error: any) {
    return { code: -3, data: null, message: `the folder cannot be read: ${dirAbs} (${error?.code ?? error?.message ?? error})` };
  }
  const entryList: { name: string; kind: 'dir' | 'file'; isDocPage: boolean }[] = [];
  for (const item of itemList) {
    let isDir = item.isDirectory();
    if (item.isSymbolicLink()) {
      try {
        isDir = fs.statSync(path.join(dirAbs, item.name)).isDirectory();
      } catch {
        continue;
      }
    } else if (!isDir && !item.isFile()) continue;
    entryList.push({ name: item.name, kind: isDir ? 'dir' : 'file', isDocPage: false });
  }
  entryList.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
  const entryListKept = entryList.slice(0, OS_LIST_LIMIT);
  for (const entry of entryListKept) {
    if (entry.kind === 'dir') entry.isDocPage = fs.existsSync(path.join(dirAbs, entry.name, DOC_PAGE_META_DIR_NAME, 'entry.yaml'));
  }
  return { code: 0, data: { dirPath: dirAbs, entryList: entryListKept, isTruncated: entryList.length > OS_LIST_LIMIT }, message: '' };
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
  assetConfigFormerReject(config, configFile);
  // the workspace (doc_page_impl_source.md#the-workspace): config "workspace"
  // names it (a workspace file, or its doc pages in place); config "docEntry"
  // names one doc page, which the page serves as a virtual workspace
  // holding it alone. exactly one of the two.
  const isWorkspaceGiven = config.workspace !== undefined;
  const isEntryGiven = config.docEntry !== undefined;
  if (isWorkspaceGiven === isEntryGiven) {
    throw new Error(
      `[doc-source] config names either "workspace" ({ file } or { docPageList }) or "docEntry" (one doc page: "dir",`
        + ` its folder with its entry in ${DOC_PAGE_META_DIR_NAME}/, or "file", its entry file; "alias", "sidePanel" optional): ${configFile}`,
    );
  }
  const workspaceSpec: DocWorkspaceSpec = isWorkspaceGiven
    ? docWorkspaceSpecRead(config.workspace, configDir, configFile)
    : { isVirtual: true, docPageList: [docPageSpecRead(config.docEntry, configDir, `config "docEntry" (${configFile})`)] };
  // the doc pages mounted from the settings panel while this development
  // server runs, after the ones written (doc_page_impl_source.md#temporary-doc-pages)
  for (const mount of workspaceMountListGet(configFile)) workspaceSpec.docPageList.push({ ...mount, isTemporary: true });

  // the workspace loaded: the source rules of its doc pages, the page side
  // panel inlined (so the browser side never touches the file system), tag
  // definitions, config declarations, and the doc pages with their
  // includes. design: doc_page_impl_side_panel.md#the-document-entry
  const entryLoaded = docWorkspaceLoad(workspaceSpec, configDir);
  const entryFile = entryLoaded.entryFile;
  config.source = entryLoaded.sourceRuleList;
  config.sidePanel = { ...(config.sidePanel ?? {}), tree: entryLoaded.sidePanel?.tree };
  config.workspace = entryLoaded.workspace;
  config.docEntry = {
    // the first root doc page: its entry file, relative to the config
    // directory, also when a folder was given, and its alias
    file: path.relative(configDir, entryFile).split(path.sep).join('/'),
    alias: entryLoaded.docPageList[0].alias,
    sidePanel: entryLoaded.sidePanelId,
    sidePanelIdList: entryLoaded.sidePanelIdList,
    // the hash of every document yaml file the side panels were read from:
    // a move of a side-panel item names the files it was built on
    fileHashByFile: entryLoaded.fileHashByFile,
    // the doc page config layer (doc_page_impl_config.md#the-doc-page-layer):
    // every config declaration of the entry and the files it reaches, in stack order
    configDeclarationList: entryLoaded.configDeclarationList,
  };
  // variables of the doc page config files over those of config.yaml
  if (Object.keys(entryLoaded.variableByName).length > 0) {
    const variableBase = config.variable && typeof config.variable === 'object' && !Array.isArray(config.variable)
      ? config.variable
      : {};
    config.variable = { ...variableBase, ...entryLoaded.variableByName };
  }
  // every yaml file the workspace reaches, for the edit api; not part of
  // the data sent to the page
  Object.defineProperty(config.docEntry, 'fileListLoaded', {
    enumerable: false,
    value: entryLoaded.fileListLoaded,
  });
  // the doc pages loaded, for the asset service layer, the service layer
  // and the components of the doc pages: absolute paths, not part of the
  // data sent to the page
  Object.defineProperty(config.docEntry, 'docPageList', {
    enumerable: false,
    value: entryLoaded.docPageList,
  });
  // the components of the doc pages (doc_page_impl_mdx_comp.md#components-of-a-doc-page):
  // their modules are imported by the virtual module, and the tag names
  // they declare are compRegistry entries, over those of config.yaml: a doc
  // page's own tag names win for that name
  const compConfig = compConfigOfDocPageListGet(entryLoaded.docPageList, configDir);
  Object.defineProperty(config.docEntry, 'compConfig', { enumerable: false, value: compConfig });
  if (compConfig.mountList.length > 0) {
    config.compRegistry = {
      ...(config.compRegistry && typeof config.compRegistry === 'object' ? config.compRegistry : {}),
      ...Object.fromEntries(compConfig.mountList.map((mount) => [mount.tagName, mount.id])),
    };
  }
  // page values the workspace or its first doc page supplies when
  // config.yaml does not set them, so that a doc page used in another
  // deployment brings its own. a home document written in config.yaml is a
  // full source path, or a local path of the first doc page
  config.siteTitle ??= entryLoaded.entry.title;
  config.homeDoc = config.homeDoc === undefined ? entryLoaded.entry.homeDoc : sourcePathFullGet(config.homeDoc, config.docEntry.alias);
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
  if (workspaceSpec.file) fileListConfiguration.push(workspaceSpec.file);
  if (config.tag.file) fileListConfiguration.push(path.resolve(configDir, config.tag.file));
  // the service config file of every doc page (the service folders follow
  // it), its comp config file and the manifests of its component folders
  // (the mounts follow them); watched whether they exist or not
  for (const docPage of entryLoaded.docPageList) {
    if (docPage.service !== false) fileListConfiguration.push(serviceConfigFileGet(docPage));
  }
  fileListConfiguration.push(...compConfigurationFileListGet(compConfig));
  Object.defineProperty(config, 'fileListConfiguration', { enumerable: false, value: fileListConfiguration });
  return config;
}

// the keys of the former configuration, which named the source rules and the
// side-panel file from config itself (both are declared by the entry now),
// and wrote the page values of the config keys as "globalConfig" and
// "compConfig" (now "configDefault", the default config layer, with its
// component keys under configDefault.compConfig)
function configFormerKeysReject(config: any, configFile: string) {
  if (config.globalConfig !== undefined || config.compConfig !== undefined) {
    throw new Error(
      `[doc-source] config "globalConfig" / "compConfig" are not read any more: write the default values as`
        + ` "configDefault" ({ Key: value, compConfig: { Comp: { Key: value } } }); values of one doc page belong`
        + ` to the "config" of its entry (doc_page_impl_config.md#config-layers): ${configFile}`,
    );
  }
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

  const rootAbsPathByPath = new Map<string, string>();
  for (const [ruleIndex, ruleRead] of configDoc.source.entries()) {
    const rule = ruleWithFullPattern(ruleRead);
    if (rule.action === 'addFolder') {
      const root = sourceRootOfRule(rule, configDir, rootAbsPathByPath);
      if (!fs.existsSync(root.absPath)) {
        console.warn(`[doc-source] addFolder: not found: ${root.absPath}`);
        continue;
      }
      for (const fileAbs of walkFiles(root.absPath, root.collect !== 'direct', excludeMatcherOfRule(rule))) {
        const entry = makeEntry(root.docPageAlias, root.rootAlias, path.relative(root.rootAbsPath, fileAbs), fileAbs, root.collect);
        tagSourceAddRuleApply(entry, rule, ruleIndex);
        configSourceAddRuleApply(entry, rule, ruleIndex);
        entryAdd(entry);
      }
    } else if (rule.action === 'addFile') {
      const root = sourceRootOfRule(rule, configDir, rootAbsPathByPath);
      if (!fs.existsSync(root.absPath)) {
        console.warn(`[doc-source] addFile: not found: ${root.absPath}`);
        continue;
      }
      const entry = makeEntry(root.docPageAlias, root.rootAlias, path.relative(root.rootAbsPath, root.absPath), root.absPath, root.collect);
      tagSourceAddRuleApply(entry, rule, ruleIndex);
      configSourceAddRuleApply(entry, rule, ruleIndex);
      entryAdd(entry);
    } else if (rule.action === 'removeByName') {
      const regex = globToRegex(rule.pattern);
      entryRemoveIf((e) => regex.test(e.name));
    } else if (rule.action === 'removeByPath') {
      // a glob over the whole source path (~docPageAlias:rootAlias/...)
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
  // the files of the asset service layer (doc_page_impl_asset.md), of the
  // service layer (doc_page_impl_service.md) and of the component folders
  // (doc_page_impl_mdx_comp.md#components-of-a-doc-page) are never
  // documents, even when they lie inside a source folder
  const pathsConfiguration = collectPathsConfiguration(configDoc);
  const configurationPathSet = new Set(pathsConfiguration);
  const sourceExclude = sourceExcludeGet(configDoc, configDir);
  return [...entryByPath.values()].filter((entry) => (
    !configurationPathSet.has(entry.absPath)
    && !configurationBackupPathIs(pathsConfiguration, entry.absPath)
    && !sourceExcludePathIs(sourceExclude, entry.absPath)
  ));
}

// what is never a document whatever rule collects the folder around it: the
// asset folders, the service folders and files, the component folders of
// the doc pages the page loads, and the plain folders of the backend config
type SourceExclude = {
  assetConfig: AssetStoreConfig | undefined;
  serviceFolderSet: ServiceFolderSet;
  compConfig: CompConfig;
};

function sourceExcludeGet(configDoc: any, configDir: string): SourceExclude {
  const docPageList = Array.isArray(configDoc.docEntry?.docPageList) ? configDoc.docEntry.docPageList : [];
  return {
    assetConfig: assetConfigGet(configDoc, configDir),
    serviceFolderSet: serviceFolderSetGet(serviceConfigGet(configDoc, configDir), docPageList),
    compConfig: compConfigGet(configDoc),
  };
}

function sourceExcludePathIs(exclude: SourceExclude, filePath: string): boolean {
  return (exclude.assetConfig !== undefined && assetPathIs(exclude.assetConfig, filePath))
    || servicePathIs(exclude.serviceFolderSet, filePath)
    || compPathIs(exclude.compConfig, filePath);
}

// the components of the doc pages, as loadConfigDoc read them
function compConfigGet(configDoc: any): CompConfig {
  return configDoc.docEntry?.compConfig ?? { docPageList: [], mountList: [] };
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

// the local store of the asset service layer as the doc pages the page
// loads describe it now (doc_page_impl_asset.md#the-local-store-folders-fully-reflected):
// the asset store config of each, its folders resolved against the roots
// of the source rules; undefined when no doc page has a store (asset: false)
function assetConfigGet(configDoc: any, configDir: string): AssetStoreConfig | undefined {
  const docPageList = configDoc.docEntry?.docPageList;
  if (!Array.isArray(docPageList)) return undefined;
  const assetConfig = assetConfigOfDocPageListGet(docPageList, sourceRootAbsPathByPathGet(configDoc, configDir), configDir);
  return assetConfig.docPageList.length > 0 ? assetConfig : undefined;
}

// the local store as the configuration file and the doc pages it reaches
// describe it now (for a tool or a test that has no plugin instance)
export function docAssetConfigLoad(configFile: string): AssetStoreConfig | undefined {
  return assetConfigGet(loadConfigDoc(configFile), path.dirname(configFile));
}

// the full path of a root (~docPageAlias:rootAlias) -> its folder, from the source rules
function sourceRootAbsPathByPathGet(configDoc: any, configDir: string): Map<string, string> {
  const rootAbsPathByPath = new Map<string, string>();
  for (const root of sourceRootListGet(configDoc, configDir)) {
    if (!rootAbsPathByPath.has(root.rootPath)) rootAbsPathByPath.set(root.rootPath, root.rootAbsPath);
  }
  return rootAbsPathByPath;
}

// a file of the asset service layer: an asset store config file of a doc
// page (and the backup / temporary file written beside it), or anything
// inside one of its folders
function assetPathIs(assetConfig: AssetStoreConfig, filePath: string): boolean {
  const isConfigFile = assetConfig.docPageList.some(({ configFile }) => (
    filePath === configFile || filePath === `${configFile}.bak` || filePath === `${configFile}.tmp`
  ));
  if (isConfigFile) return true;
  return assetConfig.folderList.some((folder) => pathIsInside(filePath, folder.pathAbs));
}

function pathIsInside(filePath: string, folder: string): boolean {
  const relative = path.relative(folder, filePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

// a rule whose "pattern" is a glob over source paths, written in its doc
// page in the local form: the glob in the full form of that doc page
function ruleWithFullPattern(rule: any): any {
  const isByPath = rule?.action === 'removeByPath' || rule?.action === 'addTagByPath' || rule?.action === 'setConfigByPath';
  if (!isByPath || typeof rule.pattern !== 'string') return rule;
  return { ...rule, pattern: sourcePathPatternFullGet(rule.pattern, rule.docPageAlias ?? '') };
}

// the root an add rule declares. an addFolder rule must say how it collects
// (collect: recursive | direct | referenced); a file of addFile is a
// document. rootAbsPathByPath remembers the folder of every root (by its
// full path ~docPageAlias:rootAlias) seen so far: the first rule with an
// alias fixes it (for addFile, the folder of the file), a later rule with
// the same alias must name a folder inside it. a rule read without the
// loader (a test, a host) may still write "rootId" for its alias.
function sourceRootOfRule(rule: any, configDir: string, rootAbsPathByPath: Map<string, string>): SourceRoot {
  const absPath = path.resolve(configDir, rule.path);
  const kind = rule.action === 'addFile' ? 'file' : 'folder';
  const rootAlias: string = String(rule.alias ?? rule.rootId ?? path.basename(kind === 'file' ? path.dirname(absPath) : absPath));
  const docPageAlias: string = String(rule.docPageAlias ?? '');
  const rootPath = sourcePathBuild(rootAlias, '', docPageAlias);
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
  const rootAbsPath = rootAbsPathByPath.get(rootPath) ?? rootAbsPathOwn;
  if (!pathIsInside(rootAbsPathOwn, rootAbsPath)) {
    throw new Error(
      `[doc-source] ${rule.action} "${rule.path}": the root ${rootPath} is the folder ${rootAbsPath};`
      + ' a later rule with the same alias must name a path inside it',
    );
  }
  rootAbsPathByPath.set(rootPath, rootAbsPath);
  return { docPageAlias, rootAlias, rootPath, absPath, rootAbsPath, kind, collect };
}

// the roots of every add rule, in rule order
export function sourceRootListGet(configDoc: any, configDir: string): SourceRoot[] {
  const rootAbsPathByPath = new Map<string, string>();
  return (configDoc.source as any[])
    .filter((rule) => rule.action === 'addFolder' || rule.action === 'addFile')
    .map((rule) => sourceRootOfRule(rule, configDir, rootAbsPathByPath));
}

// the folders of the source: for every addFolder rule its folder, and for a
// recursive or referenced rule every folder below it. removeByPath rules
// remove the folders they cover (a pattern "~root/sub/**" removes what is
// inside ~root/sub and the folder itself).
export function scanSourceDirs(configDoc: any, configDir: string): DirEntry[] {
  const dirByPath = new Map<string, DirEntry>();
  const rootAbsPathByPath = new Map<string, string>();
  for (const ruleRead of configDoc.source as any[]) {
    const rule = ruleWithFullPattern(ruleRead);
    if (rule.action === 'addFolder' || rule.action === 'addFile') {
      const root = sourceRootOfRule(rule, configDir, rootAbsPathByPath);
      if (root.kind === 'file' || !fs.existsSync(root.absPath)) continue;
      const dirAbsList = root.collect === 'direct' ? [root.absPath] : [root.absPath, ...walkDirs(root.absPath, excludeMatcherOfRule(rule))];
      for (const dirAbs of dirAbsList) {
        const relPath = path.relative(root.rootAbsPath, dirAbs).split(path.sep).join('/');
        const internalPath = sourcePathBuild(root.rootAlias, relPath, root.docPageAlias);
        dirByPath.set(internalPath, { docPageAlias: root.docPageAlias, rootAlias: root.rootAlias, relPath, absPath: dirAbs, internalPath, collect: root.collect });
      }
    } else if (rule.action === 'removeByPath') {
      const regex = globToRegex(rule.pattern);
      for (const dir of [...dirByPath.values()]) {
        if (regex.test(dir.internalPath) || regex.test(`${dir.internalPath}/`)) dirByPath.delete(dir.internalPath);
      }
    }
  }
  const sourceExclude = sourceExcludeGet(configDoc, configDir);
  return [...dirByPath.values()].filter((dir) => !sourceExcludePathIs(sourceExclude, dir.absPath));
}

function makeEntry(docPageAlias: string, rootAlias: string, relPath: string, absPath: string, collect: SourceCollectMode): FileEntry {
  const relSlash = relPath.split(path.sep).join('/');
  const name = path.basename(absPath);
  return {
    docPageAlias,
    rootAlias,
    relPath: relSlash,
    name,
    ext: path.extname(name).slice(1).toLowerCase(),
    absPath,
    internalPath: sourcePathBuild(rootAlias, relSlash, docPageAlias),
    collect,
  };
}

// the metadata folder of a doc page (doc_page_impl_dir.md) is never source
const dirNameSkipSet = new Set(['.git', 'node_modules', DOC_PAGE_META_DIR_NAME]);

// the "exclude" patterns of an addFolder rule (doc-source-exclude.ts), or
// undefined without any
function excludeMatcherOfRule(rule: any): ExcludeMatcher | undefined {
  return Array.isArray(rule.exclude) && rule.exclude.length > 0 ? excludeMatcherBuild(rule.exclude) : undefined;
}

// the files below dirAbs. an excluded folder is not entered, so nothing
// inside it can be collected again (as in git); relDir is the path of
// dirAbs from the rule's folder
function walkFiles(dirAbs: string, isRecursive: boolean, exclude?: ExcludeMatcher, relDir = ''): string[] {
  const result: string[] = [];
  for (const item of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    if (dirNameSkipSet.has(item.name)) continue;
    const itemAbs = path.join(dirAbs, item.name);
    const relPath = relDir === '' ? item.name : `${relDir}/${item.name}`;
    if (item.isDirectory()) {
      if (!isRecursive || exclude?.isExcluded(relPath, true)) continue;
      result.push(...walkFiles(itemAbs, true, exclude, relPath));
    } else if (item.isFile()) {
      if (!exclude?.isExcluded(relPath, false)) result.push(itemAbs);
    }
  }
  return result;
}

function walkDirs(dirAbs: string, exclude?: ExcludeMatcher, relDir = ''): string[] {
  const result: string[] = [];
  for (const item of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    if (!item.isDirectory() || dirNameSkipSet.has(item.name)) continue;
    const relPath = relDir === '' ? item.name : `${relDir}/${item.name}`;
    if (exclude?.isExcluded(relPath, true)) continue;
    const itemAbs = path.join(dirAbs, item.name);
    result.push(itemAbs, ...walkDirs(itemAbs, exclude, relPath));
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
        for (const entry of resolveSourceReference(String(node.doc), node.docPageAlias, sourceIndex)) entryRetain(entry);
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
          const entryList = resolveSourceReference(reference, node.docPageAlias, sourceIndex);
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
// (DocSourceStore.resolveLink), source targets as source paths (SourceLink),
// local to the document that names them. every match is retained: a build
// cannot know which the reader will pick.
function dependencyEntryListGet(
  dependency: DocSourceDependency,
  sourceIndex: any,
  sourceLabel: string,
): FileEntry[] {
  const declared = `${sourceLabel}: ${dependency.construct} "${dependency.target}"`;
  if (dependency.kind === 'source') {
    const entryList = sourcePathIsRooted(dependency.target)
      ? (docTargetResolve(dependency.target, dependency.sourcePath, sourceIndex, { isLocalFirst: false }) as { entryList: FileEntry[] }).entryList
      : [];
    if (entryList.length === 0) {
      console.warn(
        `[doc-source] ${declared} is not a source path (~root/... or ~page:root/...) of the collected source;`
        + ' nothing was retained for it.',
      );
    }
    return entryList;
  }
  const { entryList } = docTargetResolve(dependency.target, dependency.sourcePath, sourceIndex, { isLocalFirst: false }) as {
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

// matches page-tree.js convertSourceFolder: the pages of a source folder
// (the loader wrote it in the full form of the node's doc page); files
// collected for reference only are not pages
function sourceFolderEntryListGet(node: any, entries: FileEntry[]): FileEntry[] {
  const pathFolder = node.sourceFolder !== undefined
    ? sourcePathFullGet(sourcePathNormalize(String(node.sourceFolder)), node.docPageAlias ?? '')
    : sourcePathBuild(String(node.sourceRoot), '', node.docPageAlias ?? '');
  if (!sourcePathIsRooted(pathFolder)) return [];
  return entries.filter((entry) => entry.collect !== 'referenced' && sourcePathIsInside(entry.internalPath, pathFolder));
}

// matches page-tree.js resolveDocEntries: the item's doc page first, every
// match otherwise (the page shows them as candidates; a build keeps them)
function resolveSourceReference(reference: string, docPageAlias: string | undefined, sourceIndex: any): FileEntry[] {
  const { entryList } = docTargetResolve(reference.replace(/^\.\//, ''), '', sourceIndex, { docPageAlias: docPageAlias ?? '' }) as { entryList: FileEntry[] };
  return entryList;
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
    docPageAlias: entry.docPageAlias,
    rootAlias: entry.rootAlias,
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
  return { docPageAlias: dir.docPageAlias, rootAlias: dir.rootAlias, relPath: dir.relPath, internalPath: dir.internalPath, collect: dir.collect };
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
    docServiceEndpoint?: string;
    assetSnapshot: AssetSnapshot | null;
    moduleId: string;
    compMountList?: CompMount[];
  },
): string {
  const lines: string[] = [];
  // the components of the doc pages: every module a manifest names is a
  // static import (bundled by a build, hot-replaced by vite in development),
  // and the mounts carry their module (doc_page_impl_mdx_comp.md#components-of-a-doc-page)
  const compMountList = services.compMountList ?? [];
  const moduleNameByEntryFile = new Map<string, string>();
  for (const mount of compMountList) {
    if (moduleNameByEntryFile.has(mount.entryFile)) continue;
    const moduleName = `docCompModule${moduleNameByEntryFile.size}`;
    moduleNameByEntryFile.set(mount.entryFile, moduleName);
    lines.push(`import * as ${moduleName} from ${JSON.stringify(normalizeSlashPath(mount.entryFile))};`);
  }
  lines.push(`export let configDoc = ${JSON.stringify(configDoc)};`);
  lines.push('export const docCompMountList = [');
  for (const mount of compMountList) {
    const { manifestFile: _manifestFile, ...mountData } = mount;
    lines.push(`  { ...${JSON.stringify({ ...mountData, entryFile: normalizeSlashPath(mount.entryFile) })}, module: ${moduleNameByEntryFile.get(mount.entryFile)} },`);
  }
  lines.push('];');
  // the environment the page runs in (doc_page_impl.md#the-environment)
  lines.push(`export const docEnv = ${JSON.stringify({ kind: isBuild ? 'staticBuild' : 'viteDevServer' })};`);
  lines.push(`export const docSourceEndpoint = ${JSON.stringify(services.docSourceEndpoint)};`);
  lines.push(`export const docEditEndpoint = ${JSON.stringify(services.docEditEndpoint)};`);
  lines.push(`export const docAssetEndpoint = ${JSON.stringify(services.docAssetEndpoint)};`);
  lines.push(`export const docServiceEndpoint = ${JSON.stringify(services.docServiceEndpoint ?? '')};`);
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
    // the asset service layer changed on disk: listeners get { objectId, isStoreChanged }
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
  // the component folders of the doc pages: a manifest added or removed
  // there changes the mounts (they usually lie inside a root already)
  for (const folder of compFolderListGet(compConfigGet(configDoc))) {
    if (fs.existsSync(folder)) result.push(folder);
  }
  return result;
}

// the folders vite may serve files from: the source roots and the
// component folders of the doc pages (their modules are imported)
function collectSourceRoots(configDoc: any, configDir: string): string[] {
  const result = new Set<string>([configDir]);
  for (const rule of configDoc.source) {
    if (rule.action === 'addFolder') {
      result.add(path.resolve(configDir, rule.path));
    } else if (rule.action === 'addFile') {
      result.add(path.dirname(path.resolve(configDir, rule.path)));
    }
  }
  for (const folder of compFolderListGet(compConfigGet(configDoc))) result.add(folder);
  return [...result];
}
