import { makeAutoObservable, observable, runInAction } from 'mobx';
import { compileDoc } from '../lib/mdx-compile.js';
import { docTargetResolve } from '../lib/doc-target-resolve.js';
import { multiLangSearchDataGet } from '../../../comp-mdx/multi-lang/MultiLangSearchData.js';

// lower store layer: owns the doc source content.
// manifest + raw text + compile cache + doc index + search data.
// it never touches ui state; the upper DocStore asks it for content.

export type FileEntry = {
  rootId: string;
  relPath: string;
  name: string;
  ext: string;
  title: string;
  internalPath: string;
  // sha256 of the file content, from the development server; the caches of
  // a path survive a manifest replacement while its hash is unchanged
  contentHash?: string;
  tagList?: any[];
  configSource?: Record<string, any>;
  configFrontmatter?: Record<string, any>;
  load: () => Promise<string>;
};

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
  compileConfig: any;
  linkResolve: any;
  compiledByPath: Record<string, CompileState> = {};
  rawByPath: Record<string, { status: 'loading' | 'done' | 'error'; content?: string; message?: string }> = {};
  structuredDataByPath: Record<string, any> = {};
  // source version of every path, not observable. it increases when the
  // content of the path is replaced or the path is removed; a compile, a raw
  // read or a search extraction accepts its result only while the version
  // it started with is the current one, so an older result can neither
  // overwrite a newer one nor bring a removed path back.
  versionByPath: Record<string, number> = {};

  constructor(
    sourceData: { configDoc: any; fileManifest: FileEntry[] },
    options?: { compile?: any; linkResolve?: any },
  ) {
    this.configDoc = sourceData.configDoc;
    this.fileManifest = sourceData.fileManifest;
    this.compileConfig = options?.compile ?? {};
    this.linkResolve = options?.linkResolve;
    // compile results hold React elements (toc titles) and component functions
    // (Body); they must stay plain references. only key-level changes are
    // observable, and loadDoc always replaces the value object wholesale.
    makeAutoObservable(this, {
      compiledByPath: observable.shallow,
      rawByPath: observable.shallow,
      structuredDataByPath: observable.shallow,
      configDoc: observable.ref,
      fileManifest: observable.ref,
      compileConfig: false,
      linkResolve: false,
      versionByPath: false,
    });
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
  replaceSourceData(sourceData: { configDoc: any; fileManifest: FileEntry[] }): Promise<void> {
    const entryByPathPrevious = this.entryByInternalPath;
    const configPrevious = this.configDoc;
    const isConfigChanged = JSON.stringify(configPrevious) !== JSON.stringify(sourceData.configDoc);
    const isFileDisplayChanged = isConfigChanged
      && JSON.stringify(configPrevious?.fileDisplay ?? null) !== JSON.stringify(sourceData.configDoc?.fileDisplay ?? null);
    this.configDoc = sourceData.configDoc;
    this.fileManifest = sourceData.fileManifest;
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

function stripFrontmatter(markdown: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(markdown);
  return match ? markdown.slice(match[0].length) : markdown;
}
