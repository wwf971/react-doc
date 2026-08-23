import { makeAutoObservable, observable, runInAction } from 'mobx';
import { compileDoc } from '../lib/mdx-compile.js';
import { structure } from 'fumadocs-core/mdx-plugins/remark-structure';

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
  load: () => Promise<string>;
};

export type CompileState = {
  status: 'loading' | 'done' | 'error';
  Body?: any;
  toc?: any[];
  titleFrontmatter?: string;
  description?: string;
  message?: string;
};

export type LinkTarget = {
  internalPath: string;
  title: string;
  name: string;
};

export class DocSourceStore {
  configDoc: any;
  fileManifest: FileEntry[];
  compiledByPath: Record<string, CompileState> = {};
  structuredDataByPath: Record<string, any> = {};

  constructor(sourceData: { configDoc: any; fileManifest: FileEntry[] }) {
    this.configDoc = sourceData.configDoc;
    this.fileManifest = sourceData.fileManifest;
    // compile results hold React elements (toc titles) and component functions
    // (Body); they must stay plain references. only key-level changes are
    // observable, and loadDoc always replaces the value object wholesale.
    makeAutoObservable(this, {
      compiledByPath: observable.shallow,
      structuredDataByPath: observable.shallow,
      configDoc: observable.ref,
      fileManifest: observable.ref,
    });
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

  async loadDoc(internalPath: string): Promise<void> {
    const stateExisting = this.compiledByPath[internalPath];
    if (stateExisting && stateExisting.status !== 'error') return;

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

    runInAction(() => {
      this.compiledByPath[internalPath] = { status: 'loading' };
    });
    try {
      const raw = await entry.load();
      const { markdown, format } = this.toMarkdown(entry, raw);
      const compiled = await compileDoc({ source: markdown, internalPath, format });
      runInAction(() => {
        this.compiledByPath[internalPath] = { status: 'done', ...compiled };
      });
    } catch (error: any) {
      runInAction(() => {
        this.compiledByPath[internalPath] = {
          status: 'error',
          message: String(error?.message ?? error),
        };
      });
    }
  }

  // non-md files are displayed as synthesized markdown, strategy chosen by suffix
  toMarkdown(entry: FileEntry, raw: string): { markdown: string; format: 'md' | 'mdx' } {
    if (entry.ext === 'mdx') return { markdown: raw, format: 'mdx' };
    if (entry.ext === 'md') return { markdown: raw, format: 'md' };
    const lang = this.configDoc.fileDisplay?.[entry.ext] ?? '';
    const fence = '````';
    const markdown = `# ${entry.name}\n\n${fence}${lang} title="${entry.name}"\n${raw}\n${fence}\n`;
    return { markdown, format: 'md' };
  }

  // link resolution. target forms:
  //   /rootId/xx/a.md  exact internal path
  //   ./a.md, ../a.md  relative to fromPath
  //   xx/a.md          suffix match on internal path
  //   a.md             lookup by file name (may give multiple candidates)
  resolveLink(target: string, fromPath: string): { targets: LinkTarget[]; hash: string } {
    const indexHash = target.indexOf('#');
    const hash = indexHash >= 0 ? target.slice(indexHash + 1) : '';
    const filePart = indexHash >= 0 ? target.slice(0, indexHash) : target;
    if (filePart === '') return { targets: [], hash };

    let candidates: FileEntry[];
    if (filePart.startsWith('/')) {
      const entry = this.entryByInternalPath.get(filePart);
      candidates = entry ? [entry] : [];
    } else if (filePart.startsWith('./') || filePart.startsWith('../')) {
      const pathResolved = resolveRelative(dirOf(fromPath), filePart);
      const entry = this.entryByInternalPath.get(pathResolved);
      candidates = entry ? [entry] : [];
    } else if (filePart.includes('/')) {
      candidates = this.fileManifest.filter((e) => e.internalPath.endsWith('/' + filePart));
    } else {
      candidates = this.targetsByName.get(filePart) ?? [];
    }

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
      try {
        const raw = await entry.load();
        const { markdown } = this.toMarkdown(entry, raw);
        const data = structure(stripFrontmatter(markdown));
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

// ---------- path utils ----------

function dirOf(internalPath: string): string {
  const index = internalPath.lastIndexOf('/');
  return index <= 0 ? '/' : internalPath.slice(0, index);
}

function resolveRelative(baseDir: string, relPath: string): string {
  const segsResult = baseDir.split('/').filter(Boolean);
  for (const seg of relPath.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') segsResult.pop();
    else segsResult.push(seg);
  }
  return '/' + segsResult.join('/');
}

function stripFrontmatter(markdown: string): string {
  const match = /^---\n[\s\S]*?\n---\n/.exec(markdown);
  return match ? markdown.slice(match[0].length) : markdown;
}
