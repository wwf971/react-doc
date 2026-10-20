import { makeAutoObservable, observable, runInAction } from 'mobx';
import { compileDoc } from '../lib/mdx-compile.js';
import { docTargetResolve } from '../lib/doc-target-resolve.js';
import { sourcePathCompleteList, sourcePathTreeBuild } from '../lib/doc-source-complete.js';
import {
  sourcePathIsInside,
  sourcePathIsRooted,
  sourcePathNameGet,
  sourcePathNormalize,
} from '../lib/doc-source-path.js';
import { multiLangSearchDataGet } from '../../../comp-mdx/multi-lang/MultiLangSearchData.js';

// lower store layer: the source layer of the page (doc_page_impl_source.md).
// owns the doc source content: the manifest of files and folders, raw text,
// compile cache, doc index, search data, and the services over the source:
// file reference resolution and urls, path completion, file creation
// through the source api of the development server.
// it never touches ui state; the upper DocStore asks it for content.

export type SourceCollectMode = 'recursive' | 'direct' | 'referenced';

export type FileEntry = {
  rootId: string;
  relPath: string;
  name: string;
  ext: string;
  title: string;
  internalPath: string;
  // how the file was collected; 'referenced' files are not pages
  collect?: SourceCollectMode;
  // sha256 of the file content, from the development server; the caches of
  // a path survive a manifest replacement while its hash is unchanged
  contentHash?: string;
  tagList?: any[];
  configSource?: Record<string, any>;
  configFrontmatter?: Record<string, any>;
  load: () => Promise<string>;
};

// a folder of the source: the folder of an addFolder rule or one below it
export type DirEntry = {
  rootId: string;
  relPath: string;
  internalPath: string;
  collect: SourceCollectMode;
};

export type SourceData = {
  configDoc: any;
  fileManifest: FileEntry[];
  dirManifest?: DirEntry[];
};

export type SourceResult = { code: number; data?: any; message: string };

// what a path completion asks for (lib/doc-source-complete.js): folders,
// files, or both, narrowed by extension, root, folder, or a rule in code
export type SourcePathSpec = {
  kind: 'dir' | 'file' | 'any';
  extList?: string[];
  rootIdList?: string[];
  dirPath?: string;
  isMatch?: (candidate: SourcePathCandidate) => boolean;
};
export type SourcePathCandidate = { path: string; kind: 'dir' | 'file'; entry: FileEntry | DirEntry };

export type CompileState = {
  status: 'loading' | 'done' | 'error';
  isContentEmpty?: boolean;
  isSourceFile?: boolean;
  Body?: any;
  componentList?: ComponentSourceEntry[];
  toc?: any[];
  titleFrontmatter?: string;
  description?: string;
  language?: string;
  languageList?: string[];
  message?: string;
};

export type ComponentSourceEntry = {
  id: string;
  compName: string;
  input: {
    lang?: string;
    propsAuthored?: Record<string, any>;
    raw?: string;
  };
  languageList?: string[];
  sourceOffset?: number;
};

export type LinkTarget = {
  internalPath: string;
  title: string;
  name: string;
};

export class DocSourceStore {
  configDoc: any;
  fileManifest: FileEntry[];
  dirManifest: DirEntry[];
  compileConfig: any;
  linkResolve: any;
  // the source api of the development server ('' in a build: the source is
  // read-only, and the bytes of a file come from fileUrlByPath)
  sourceEndpoint: string;
  // source path (or the spelling a document used) -> url of the file's bytes,
  // as the vite plugin collected them (fileUrlByPath of the virtual module)
  fileUrlByPath: Record<string, string>;
  compiledByPath: Record<string, CompileState> = {};
  rawByPath: Record<string, { status: 'loading' | 'done' | 'error'; content?: string; message?: string }> = {};
  structuredDataByPath: Record<string, any> = {};
  // source version of every path, not observable. it increases when the
  // content of the path is replaced or the path is removed; a compile, a raw
  // read or a search extraction accepts its result only while the version
  // it started with is the current one, so an older result can neither
  // overwrite a newer one nor bring a removed path back.
  versionByPath: Record<string, number> = {};
  // stable service object handed to registered components (config.source)
  sourceService: Readonly<Record<string, (...args: any[]) => any>>;

  constructor(
    sourceData: SourceData,
    options?: { compile?: any; linkResolve?: any; endpoint?: string; fileUrlByPath?: Record<string, string> },
  ) {
    this.configDoc = sourceData.configDoc;
    this.fileManifest = sourceData.fileManifest;
    this.dirManifest = sourceData.dirManifest ?? [];
    this.compileConfig = options?.compile ?? {};
    this.linkResolve = options?.linkResolve;
    this.sourceEndpoint = String(options?.endpoint ?? '').replace(/\/+$/, '');
    this.fileUrlByPath = options?.fileUrlByPath ?? {};
    this.sourceService = Object.freeze({
      isWritable: () => this.isWritable,
      fileResolve: (reference: string, fromPath: string) => this.fileResolve(reference, fromPath),
      fileUrlGet: (reference: string, fromPath: string) => this.fileUrlGet(reference, fromPath),
      dirListGet: () => this.dirManifest,
      pathComplete: (text: string, spec: SourcePathSpec) => this.pathComplete(text, spec),
      pathTreeGet: (spec: SourcePathSpec) => this.pathTreeGet(spec),
      fileNameUniqueGet: (dirPath: string, name: string) => this.fileNameUniqueGet(dirPath, name),
    });
    // compile results hold React elements (toc titles) and component functions
    // (Body); they must stay plain references. only key-level changes are
    // observable, and loadDoc always replaces the value object wholesale.
    makeAutoObservable(this, {
      compiledByPath: observable.shallow,
      rawByPath: observable.shallow,
      structuredDataByPath: observable.shallow,
      configDoc: observable.ref,
      fileManifest: observable.ref,
      dirManifest: observable.ref,
      compileConfig: false,
      linkResolve: false,
      sourceEndpoint: false,
      fileUrlByPath: false,
      sourceService: false,
      versionByPath: false,
    });
  }

  // the source api answers (development server): files can be created
  get isWritable(): boolean {
    return this.sourceEndpoint !== '';
  }

  versionGet(path: string): number {
    return this.versionByPath[path] ?? 0;
  }

  private versionBump(path: string) {
    this.versionByPath[path] = this.versionGet(path) + 1;
  }

  get entryByInternalPath(): Map<string, FileEntry> {
    const result = new Map<string, FileEntry>();
    for (const entry of this.fileManifest) result.set(entry.internalPath, entry);
    return result;
  }

  get targetsByName(): Map<string, FileEntry[]> {
    const result = new Map<string, FileEntry[]>();
    for (const entry of this.fileManifest) {
      const list = result.get(entry.name) ?? [];
      list.push(entry);
      result.set(entry.name, list);
    }
    return result;
  }

  // new source data (the development server reports a changed file, or the
  // manifest module was regenerated). only what changed is refreshed:
  //   unchanged path   compiled body, raw text, search data and pending loads
  //                    are kept; a part index of another document stays as it is
  //   changed path     its search data is dropped; a loaded body or raw text
  //                    is read and compiled again right away, the previous
  //                    result staying visible until the new one is ready
  //   removed path     its caches are dropped
  // a changed configuration also drops the compiled inline items (their
  // content is configuration) and refreshes synthesized source-file pages
  // when their display strategy changed. resolves when the refreshes are done.
  replaceSourceData(sourceData: SourceData): Promise<void> {
    const entryByPathPrevious = this.entryByInternalPath;
    const configPrevious = this.configDoc;
    const isConfigChanged = JSON.stringify(configPrevious) !== JSON.stringify(sourceData.configDoc);
    const isFileDisplayChanged = isConfigChanged
      && JSON.stringify(configPrevious?.fileDisplay ?? null) !== JSON.stringify(sourceData.configDoc?.fileDisplay ?? null);
    this.configDoc = sourceData.configDoc;
    this.fileManifest = sourceData.fileManifest;
    if (sourceData.dirManifest) this.dirManifest = sourceData.dirManifest;
    const entryByPathNext = this.entryByInternalPath;

    const pathsChanged: string[] = [];
    for (const entry of sourceData.fileManifest) {
      const entryPrevious = entryByPathPrevious.get(entry.internalPath);
      if (!entryPrevious) continue;
      const isSourceFile = entry.ext !== 'md' && entry.ext !== 'mdx';
      if (!entryIsSameContent(entryPrevious, entry) || (isFileDisplayChanged && isSourceFile)) {
        pathsChanged.push(entry.internalPath);
      }
    }
    const pathsRemoved: string[] = [];
    for (const path of entryByPathPrevious.keys()) {
      if (!entryByPathNext.has(path)) pathsRemoved.push(path);
    }
    if (isConfigChanged) {
      // compiled entries that are not files are inline items of the side panel
      for (const path of Object.keys(this.compiledByPath)) {
        if (!entryByPathNext.has(path) && !entryByPathPrevious.has(path)) pathsRemoved.push(path);
      }
    }

    for (const path of pathsRemoved) {
      this.versionBump(path);
      delete this.compiledByPath[path];
      delete this.rawByPath[path];
      delete this.structuredDataByPath[path];
    }
    const refreshList: Promise<void>[] = [];
    for (const path of pathsChanged) {
      this.versionBump(path);
      delete this.structuredDataByPath[path];
      if (this.compiledByPath[path]) refreshList.push(this.loadDoc(path, { isRefresh: true }));
      if (this.rawByPath[path]) refreshList.push(this.loadRaw(path, { isRefresh: true }));
    }
    return Promise.all(refreshList).then(() => undefined);
  }

  // isRefresh: the path is loaded again after its source changed; the
  // previous result stays until the new one replaces it
  async loadDoc(internalPath: string, options: { isRefresh?: boolean } = {}): Promise<void> {
    const stateExisting = this.compiledByPath[internalPath];
    if (!options.isRefresh && stateExisting && stateExisting.status !== 'error') return;
    const version = this.versionGet(internalPath);
    const isVersionCurrent = () => this.versionGet(internalPath) === version;

    const entry = this.entryByInternalPath.get(internalPath);
    if (!entry) {
      runInAction(() => {
        this.compiledByPath[internalPath] = {
          status: 'error',
          message: `doc not found in source: ${internalPath}`,
        };
      });
      return;
    }

    if (!options.isRefresh || stateExisting?.status !== 'done') {
      runInAction(() => {
        this.compiledByPath[internalPath] = { status: 'loading' };
      });
    }
    try {
      const raw = await entry.load();
      const { markdown, format, isSourceFile } = this.toMarkdown(entry, raw);
      const compiled = await compileDoc({
        source: markdown,
        internalPath,
        format,
        config: this.compileConfig,
      });
      if (!isVersionCurrent()) return;
      runInAction(() => {
        this.compiledByPath[internalPath] = {
          status: 'done',
          ...compiled,
          isContentEmpty: !isSourceFile && raw.trim() === '',
          isSourceFile,
          toc: Array.isArray(compiled.toc) ? compiled.toc : [],
        };
      });
    } catch (error: any) {
      if (!isVersionCurrent()) return;
      runInAction(() => {
        this.compiledByPath[internalPath] = {
          status: 'error',
          message: String(error?.message ?? error),
        };
      });
    }
  }

  async loadInline(
    itemId: string,
    content: string,
    format: 'md' | 'mdx' = 'mdx',
  ): Promise<void> {
    const stateExisting = this.compiledByPath[itemId];
    if (stateExisting && stateExisting.status !== 'error') return;
    const version = this.versionGet(itemId);
    runInAction(() => {
      this.compiledByPath[itemId] = { status: 'loading' };
    });
    try {
      const compiled = await compileDoc({
        source: content,
        internalPath: itemId,
        format,
        config: this.compileConfig,
      });
      if (this.versionGet(itemId) !== version) return;
      runInAction(() => {
        this.compiledByPath[itemId] = {
          status: 'done',
          ...compiled,
          isContentEmpty: content.trim() === '',
          isSourceFile: false,
          toc: Array.isArray(compiled.toc) ? compiled.toc : [],
        };
      });
    } catch (error: any) {
      runInAction(() => {
        this.compiledByPath[itemId] = {
          status: 'error',
          message: String(error?.message ?? error),
        };
      });
    }
  }

  async loadRaw(internalPath: string, options: { isRefresh?: boolean } = {}): Promise<void> {
    const stateExisting = this.rawByPath[internalPath];
    if (!options.isRefresh && stateExisting && stateExisting.status !== 'error') return;
    const version = this.versionGet(internalPath);
    const entry = this.entryByInternalPath.get(internalPath);
    if (!entry) {
      runInAction(() => {
        this.rawByPath[internalPath] = {
          status: 'error',
          message: `source file not found: ${internalPath}`,
        };
      });
      return;
    }
    if (!options.isRefresh || stateExisting?.status !== 'done') {
      runInAction(() => {
        this.rawByPath[internalPath] = { status: 'loading' };
      });
    }
    try {
      const content = await entry.load();
      if (this.versionGet(internalPath) !== version) return;
      runInAction(() => {
        this.rawByPath[internalPath] = { status: 'done', content };
      });
    } catch (error: any) {
      if (this.versionGet(internalPath) !== version) return;
      runInAction(() => {
        this.rawByPath[internalPath] = {
          status: 'error',
          message: String(error?.message ?? error),
        };
      });
    }
  }

  componentGet(internalPath: string, componentId: string): {
    status: 'loading' | 'done' | 'error';
    component?: ComponentSourceEntry;
    message?: string;
  } {
    const state = this.compiledByPath[internalPath];
    if (!state || state.status === 'loading') return { status: 'loading' };
    if (state.status === 'error') return { status: 'error', message: state.message };
    const componentList = (state.componentList ?? []).filter((component) => component.id === componentId);
    if (componentList.length === 0) {
      return {
        status: 'error',
        message: `Component id not found in document: ${componentId}`,
      };
    }
    if (componentList.length > 1) {
      return {
        status: 'error',
        message: `Component id is not unique in document: ${componentId}`,
      };
    }
    return { status: 'done', component: componentList[0] };
  }

  // non-md files are displayed as synthesized markdown, strategy chosen by suffix
  toMarkdown(entry: FileEntry, raw: string): { markdown: string; format: 'md' | 'mdx'; isSourceFile: boolean } {
    if (entry.ext === 'mdx') return { markdown: raw, format: 'mdx', isSourceFile: false };
    if (entry.ext === 'md') return { markdown: raw, format: 'md', isSourceFile: false };
    const lang = this.configDoc.fileDisplay?.[entry.ext] ?? '';
    const fence = '````';
    const markdown = `# ${entry.name}\n\n${fence}${lang} title="${entry.name}"\n${raw}\n${fence}\n`;
    return { markdown, format: 'md', isSourceFile: true };
  }

  // link resolution. target forms: see lib/doc-target-resolve.js, which the
  // build-time dependency discovery shares.
  resolveLink(target: string, fromPath: string): { targets: LinkTarget[]; hash: string } {
    if (this.linkResolve) {
      const result = this.linkResolve({
        target,
        fromPath,
        fileManifest: this.fileManifest,
        entryByInternalPath: this.entryByInternalPath,
        targetsByName: this.targetsByName,
      });
      if (result) return result;
    }
    const { entryList: candidates, hash } = docTargetResolve(target, fromPath, {
      entryList: this.fileManifest,
      entryByInternalPath: this.entryByInternalPath,
      entryListByName: this.targetsByName,
    }) as { entryList: FileEntry[]; hash: string };

    const targets = candidates.map((e) => ({
      internalPath: e.internalPath,
      title: e.title,
      name: e.name,
    }));
    return { targets, hash };
  }

  // ---------- files: resolution, urls ----------

  // the one file a reference names (a source path, a path relative to
  // fromPath, a suffix, a name: doc-target-resolve.js); undefined when none
  // or several match
  fileResolve(reference: string, fromPath = ''): FileEntry | undefined {
    const { entryList } = docTargetResolve(reference, fromPath, {
      entryList: this.fileManifest,
      entryByInternalPath: this.entryByInternalPath,
      entryListByName: this.targetsByName,
    }) as { entryList: FileEntry[] };
    return entryList.length === 1 ? entryList[0] : undefined;
  }

  // the url the bytes of a file are read from: the source api in
  // development, the url the build collected otherwise. a reference that is
  // not in the collected source still answers the url the build collected
  // for its spelling (a file found beside the document on disk); undefined
  // when nothing is known.
  fileUrlGet(reference: string, fromPath = ''): string | undefined {
    const text = String(reference ?? '').trim();
    if (text === '') return undefined;
    const entry = this.fileResolve(text, fromPath);
    if (entry) {
      if (this.fileUrlByPath[entry.internalPath]) return this.fileUrlByPath[entry.internalPath];
      if (this.sourceEndpoint) return `${this.sourceEndpoint}/data?path=${encodeURIComponent(entry.internalPath)}`;
    }
    return this.fileUrlByPath[text.replace(/^\.\//, '')];
  }

  // ---------- folders: completion ----------

  // the folders a file can be created in: the folder of a recursive or
  // referenced rule and every folder below, the folder of a direct rule
  get dirListWritable(): DirEntry[] {
    return this.dirManifest;
  }

  // completion of a path being typed (lib/doc-source-complete.js): the
  // folders and / or files the spec allows that match the text. an empty
  // text lists them all; a rooted text matches by prefix; another text
  // anywhere in the path (typing "image" finds ~example/mdx-usage/image).
  pathComplete(text: string, spec: SourcePathSpec = { kind: 'dir' }): SourcePathCandidate[] {
    return sourcePathCompleteList(text, spec, { fileManifest: this.fileManifest, dirManifest: this.dirManifest });
  }

  // the same candidates as a tree of nodes (lib/doc-source-complete.js
  // sourcePathTreeBuild), for the tree view of comp-doc/source
  pathTreeGet(spec: SourcePathSpec = { kind: 'dir' }): any[] {
    return sourcePathTreeBuild(spec, { fileManifest: this.fileManifest, dirManifest: this.dirManifest });
  }

  // a file name not used in the folder yet: "a.png", then "a-2.png", "a-3.png"
  fileNameUniqueGet(dirPath: string, name: string): string {
    const dir = sourcePathNormalize(dirPath);
    const nameSet = new Set(
      this.fileManifest
        .filter((entry) => sourcePathIsInside(entry.internalPath, dir) && entry.internalPath.slice(dir.length + 1).indexOf('/') < 0)
        .map((entry) => entry.name),
    );
    if (!nameSet.has(name)) return name;
    const indexDot = name.lastIndexOf('.');
    const base = indexDot > 0 ? name.slice(0, indexDot) : name;
    const ext = indexDot > 0 ? name.slice(indexDot) : '';
    for (let counter = 2; ; counter += 1) {
      const candidate = `${base}-${counter}${ext}`;
      if (!nameSet.has(candidate)) return candidate;
    }
  }

  // ---------- files: creation ----------

  // writes a file into a folder of the source through the source api
  // (POST file/create). the new file joins the manifest when the server
  // reports the source data again; its entry is answered right away.
  //   { code: 0, data: { path, entry } } | { code: -1 | -2 (exists) | -3 (folder not in the source), message }
  async fileCreate(input: { dirPath: string; name: string; text?: string; blob?: Blob; isOverwrite?: boolean }): Promise<SourceResult> {
    if (!this.isWritable) return { code: -1, message: 'The source is read-only: files are created through the development server only.' };
    const dirPath = sourcePathNormalize(input.dirPath);
    if (!sourcePathIsRooted(dirPath)) return { code: -1, message: `The folder must be a source path (~rootId/dir): ${dirPath}` };
    const body: Record<string, unknown> = { dirPath, name: input.name, isOverwrite: input.isOverwrite === true };
    if (input.blob) body.dataBase64 = await blobBase64Get(input.blob);
    else body.text = String(input.text ?? '');
    let payload: any;
    try {
      const response = await fetch(`${this.sourceEndpoint}/file/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
      });
      payload = await response.json().catch(() => undefined);
      if (!payload || typeof payload.code !== 'number') {
        return { code: -1, message: `the source api answered ${response.status} without a result` };
      }
    } catch (error: any) {
      return { code: -1, message: `the source api is not reachable: ${String(error?.message ?? error)}` };
    }
    if (payload.code !== 0) return { code: payload.code, message: payload.message };
    return { code: 0, data: payload.data, message: '' };
  }

  // the source path a file of the folder would have
  filePathBuild(dirPath: string, name: string): string {
    return `${sourcePathNormalize(dirPath)}/${sourcePathNameGet(name)}`;
  }

  // ---------- search ----------

  async ensureSearchData(): Promise<void> {
    for (const entry of this.fileManifest) {
      if (this.structuredDataByPath[entry.internalPath]) continue;
      const version = this.versionGet(entry.internalPath);
      try {
        const raw = await entry.load();
        const { markdown } = this.toMarkdown(entry, raw);
        const data = multiLangSearchDataGet(stripFrontmatter(markdown), this.compileConfig);
        if (this.versionGet(entry.internalPath) !== version) continue;
        runInAction(() => {
          this.structuredDataByPath[entry.internalPath] = data;
        });
      } catch {
        // file failed to load/parse: simply not searchable
      }
    }
  }

  async searchDocs(query: string): Promise<any[]> {
    const queryLower = query.trim().toLowerCase();
    if (queryLower === '') return [];
    await this.ensureSearchData();

    const results: any[] = [];
    for (const entry of this.fileManifest) {
      const data = this.structuredDataByPath[entry.internalPath];
      if (!data) continue;
      const matches: any[] = [];
      if (entry.title.toLowerCase().includes(queryLower) || entry.name.toLowerCase().includes(queryLower)) {
        matches.push({ type: 'page', content: entry.title });
      }
      for (const heading of data.headings ?? []) {
        if (heading.content.toLowerCase().includes(queryLower)) {
          matches.push({ type: 'heading', content: heading.content, hash: heading.id });
        }
      }
      for (const content of data.contents ?? []) {
        if (content.content.toLowerCase().includes(queryLower)) {
          matches.push({ type: 'text', content: content.content, hash: content.heading });
          if (matches.length >= 4) break;
        }
      }
      if (matches.length === 0) continue;
      // first item of a doc is shown as page row in fumadocs dialog
      results.push({
        id: entry.internalPath,
        type: 'page',
        url: entry.internalPath,
        content: entry.title,
      });
      for (const [indexMatch, match] of matches.entries()) {
        if (match.type === 'page') continue;
        results.push({
          id: `${entry.internalPath}#${indexMatch}`,
          type: match.type,
          url: match.hash ? `${entry.internalPath}#${match.hash}` : entry.internalPath,
          content: match.content,
        });
      }
      if (results.length > 40) break;
    }
    return results;
  }
}

// two manifest entries of one path describe the same text when their content
// hashes and extensions agree. entries without a hash (a host building its
// own manifest) are compared by their loader: a new loader is new content.
function entryIsSameContent(entryPrevious: FileEntry, entryNext: FileEntry): boolean {
  if (entryPrevious.ext !== entryNext.ext) return false;
  if (entryPrevious.contentHash && entryNext.contentHash) {
    return entryPrevious.contentHash === entryNext.contentHash;
  }
  return entryPrevious.load === entryNext.load;
}

// the bytes of a blob as base64, for the json body of the source api
function blobBase64Get(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('the file could not be read'));
    reader.readAsDataURL(blob);
  });
}

function stripFrontmatter(markdown: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(markdown);
  return match ? markdown.slice(match[0].length) : markdown;
}
