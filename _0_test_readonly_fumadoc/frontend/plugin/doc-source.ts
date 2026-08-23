import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { Plugin } from 'vite';

// vite plugin "doc-source".
// reads two-layer yaml config, executes source rules against the file system,
// and exposes the result as virtual module `virtual:doc-source`:
//
//   export const configDoc = {...}      // merged config (side panel yaml inlined)
//   export const fileManifest = [{ rootId, relPath, name, ext, title, internalPath, load }]
//
// every doc file becomes a lazy `?raw` import, so dev gets hot reload and
// build gets one lazy chunk per doc.

const MODULE_ID = 'virtual:doc-source';
const MODULE_ID_RESOLVED = '\0virtual:doc-source';

type FileEntry = {
  rootId: string;
  relPath: string; // path inside root, '' for a root file
  name: string;
  ext: string;
  absPath: string;
  internalPath: string; // /{rootId}/relPath or /{rootId}/name for root file
};

export function docSourcePlugin(): Plugin {
  let configDir = '';
  let isBuild = false;

  return {
    name: 'doc-source',

    configResolved(viteConfig) {
      isBuild = viteConfig.command === 'build';
      configDir = findConfigDir(viteConfig.root);
    },

    resolveId(id) {
      if (id === MODULE_ID) return MODULE_ID_RESOLVED;
    },

    load(id) {
      if (id !== MODULE_ID_RESOLVED) return;
      const configDoc = loadConfigDoc(configDir);
      const fileEntries = scanSource(configDoc, configDir);
      return generateModuleCode(configDoc, fileEntries, isBuild);
    },

    configureServer(server) {
      const configDoc = loadConfigDoc(configDir);
      const pathsWatched = collectPathsToWatch(configDoc, configDir);
      for (const p of pathsWatched) server.watcher.add(p);

      const invalidateManifest = (filePath: string) => {
        const isRelated = pathsWatched.some(
          (p) => filePath === p || filePath.startsWith(p + path.sep),
        );
        if (!isRelated) return;
        const mod = server.moduleGraph.getModuleById(MODULE_ID_RESOLVED);
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

function findConfigDir(viteRoot: string): string {
  const candidates = [viteRoot, path.resolve(viteRoot, '..')];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'config.yaml'))) return dir;
  }
  throw new Error(`[doc-source] config.yaml not found near ${viteRoot}`);
}

function loadConfigDoc(configDir: string): any {
  const configBase = readYaml(path.join(configDir, 'config.yaml')) ?? {};
  const configLocal = readYaml(path.join(configDir, 'config.0.yaml')) ?? {};
  const config = mergeDeep(configBase, configLocal);
  if (!Array.isArray(config.source)) {
    throw new Error('[doc-source] config "source" must be a list of rules');
  }
  // inline side panel yaml, so the browser side doesn't touch the file system
  if (config.sidePanel?.file) {
    const panelPath = path.resolve(configDir, config.sidePanel.file);
    config.sidePanel.tree = readYaml(panelPath)?.tree ?? null;
  }
  return config;
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

// ---------- module generation ----------

function generateModuleCode(configDoc: any, fileEntries: FileEntry[], isBuild: boolean): string {
  const lines: string[] = [];
  lines.push(`export const configDoc = ${JSON.stringify(configDoc)};`);
  lines.push('export const fileManifest = [');
  for (const e of fileEntries) {
    const importId = (isBuild ? e.absPath : '/@fs' + e.absPath) + '?raw';
    lines.push(
      `  { rootId: ${JSON.stringify(e.rootId)}, relPath: ${JSON.stringify(e.relPath)},` +
        ` name: ${JSON.stringify(e.name)}, ext: ${JSON.stringify(e.ext)},` +
        ` title: ${JSON.stringify(extractTitle(e))},` +
        ` internalPath: ${JSON.stringify(e.internalPath)},` +
        ` load: () => import(${JSON.stringify(importId)}).then((m) => m.default) },`,
    );
  }
  lines.push('];');
  return lines.join('\n');
}

function extractTitle(entry: FileEntry): string {
  if (entry.ext !== 'md' && entry.ext !== 'mdx') return entry.name;
  const text = fs.readFileSync(entry.absPath, 'utf-8');
  const matchFrontmatter = /^---\n[\s\S]*?\btitle:\s*["']?([^"'\n]+)["']?\n[\s\S]*?---/.exec(text);
  if (matchFrontmatter) return matchFrontmatter[1].trim();
  const matchHeading = /^#\s+(.+)$/m.exec(text);
  if (matchHeading) return matchHeading[1].trim();
  return entry.name;
}

function collectPathsToWatch(configDoc: any, configDir: string): string[] {
  const result = [path.join(configDir, 'config.yaml'), path.join(configDir, 'config.0.yaml')];
  if (configDoc.sidePanel?.file) result.push(path.resolve(configDir, configDoc.sidePanel.file));
  for (const rule of configDoc.source) {
    if (rule.action === 'addFolder' || rule.action === 'addFile') {
      result.push(path.resolve(configDir, rule.path));
    }
  }
  return result;
}
