import fs from 'node:fs';
import path from 'node:path';
import { parse as yamlParse } from 'yaml';
import { commentPropsParse } from '../src/lib/remark-comment-comp.js';
import { docTargetResolve, sourceIndexBuild } from '../src/lib/doc-target-resolve.js';

// Build-time collection of the files components name (an Image src, the
// lane icons of a diagram, a FileDownload): their bytes travel with the
// built page as data urls (doc_page_impl_source.md#files-in-a-build).
// a reference resolves like every file reference of the page: a source path
// (~root/... or ~page:root/...), a path relative to the document, a suffix, a file name
// (doc-target-resolve.js); a file outside the collected source is still
// found on disk relative to the document or the config folder.

export type DocAttachmentFinderContext = {
  configDoc: any;
  doc: {
    absPath: string;
    internalPath: string;
  };
  text: string;
};

export type DocAttachmentFinder = (context: DocAttachmentFinderContext) => string[];

export type DocAttachmentResolved = {
  absPath: string;
  referenceList: string[];
};

type SourceEntry = {
  absPath: string;
  internalPath: string;
};

const commentComponentPattern = /<!--\s*renderComp=([\w/]+(?:-[\w/]+)*)([\s\S]*?)-->/g;
const mermaidMdxPattern = /<(?:Doc)?DiagramMermaid\b[^>]*\blaneIcons\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const imageMdxPattern = /<(?:Doc)?Image\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
// the closing fence may be indented: a block inside a list item is indented
// to the item's text column (doc_page_impl_mdx_li.md). YAML accepts the
// uniformly indented content as is.
const imageCommentBlockPattern = /<!--\s*renderComp=(?:Doc)?Image(?:\s*,[^>]*)?-->\s*```(?:yaml|yml)\s*\r?\n([\s\S]*?)\r?\n[ \t]*```/g;
const imageGridCommentPattern = /<!--\s*renderComp=(?:Doc)?ImageGrid(?:\s*,[^>]*)?-->\s*```(?:yaml|yml)\s*\r?\n([\s\S]*?)\r?\n[ \t]*```/g;
const fileDownloadCommentPattern = /<!--\s*renderComp=FileDownload(?:\s*,[^>]*)?-->\s*```(?:yaml|yml)\s*\r?\n([\s\S]*?)\r?\n[ \t]*```/g;

export const docAttachmentFinderDefaultList: DocAttachmentFinder[] = [
  attachmentMermaidLaneIconFind,
  attachmentImageFind,
  attachmentImageGridFind,
  attachmentFileDownloadFind,
];

export function attachmentFileDownloadFind(context: DocAttachmentFinderContext): string[] {
  const result: string[] = [];
  for (const match of context.text.matchAll(fileDownloadCommentPattern)) {
    try {
      const data = yamlParse(match[1]);
      const src = mappingIs(data) ? data.src : undefined;
      if (typeof src === 'string' && src.trim()) result.push(src.trim());
    } catch (error) {
      console.warn(
        `[doc-source] invalid FileDownload YAML in ${context.doc.internalPath}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return result;
}

export function attachmentMermaidLaneIconFind(context: DocAttachmentFinderContext): string[] {
  const valueList: string[] = [];

  for (const match of context.text.matchAll(commentComponentPattern)) {
    if (match[1] !== 'DiagramMermaid' && match[1] !== 'DocDiagramMermaid') continue;
    const props = commentPropsParse(match[2]);
    if (props.laneIcons) valueList.push(props.laneIcons);
  }

  for (const match of context.text.matchAll(mermaidMdxPattern)) {
    valueList.push(match[1] ?? match[2] ?? '');
  }

  return valueList.flatMap(laneIconPathListParse);
}

export function attachmentImageFind(context: DocAttachmentFinderContext): string[] {
  const result: string[] = [];
  for (const match of context.text.matchAll(imageCommentBlockPattern)) {
    try {
      const data = yamlParse(match[1]);
      const src = mappingIs(data) ? data.src : undefined;
      if (typeof src === 'string' && src.trim()) result.push(src.trim());
    } catch (error) {
      console.warn(
        `[doc-source] invalid Image YAML in ${context.doc.internalPath}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  for (const match of context.text.matchAll(commentComponentPattern)) {
    if (match[1] !== 'Image' && match[1] !== 'DocImage') continue;
    const src = commentPropsParse(match[2]).src;
    if (src) result.push(src);
  }
  for (const match of context.text.matchAll(imageMdxPattern)) {
    const src = match[1] ?? match[2] ?? '';
    if (src) result.push(src);
  }
  return result;
}

function mappingIs(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function attachmentImageGridFind(context: DocAttachmentFinderContext): string[] {
  const result: string[] = [];
  for (const match of context.text.matchAll(imageGridCommentPattern)) {
    for (const line of match[1].split(/\r?\n/)) {
      const srcMatch = /^\s*-?\s*src:\s*(.+?)\s*$/.exec(line);
      if (srcMatch) result.push(srcMatch[1].replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2'));
    }
  }
  return result;
}

// textExpand(text): the document text as the finders see it; asset reference
// blocks are expanded to the data they stand for (doc_page_impl_asset.md).
// assetDependencyPathList: the source files the versions of the asset service layer
// depend on (doc_page_impl_asset.md#dependencies); they are collected too.
// a file of the source collected as "referenced" that a document reaches
// (docEntryList holds the pruned manifest) is collected with them.
export function docAttachmentsCollect(
  configDoc: any,
  docEntryList: SourceEntry[],
  sourceEntryList: SourceEntry[],
  configDir: string,
  finderList: DocAttachmentFinder[],
  textExpand: (text: string) => string = (text) => text,
  assetDependencyPathList: string[] = [],
): DocAttachmentResolved[] {
  const attachmentByPath = new Map<string, { absPath: string; referenceSet: Set<string> }>();
  const attachmentAdd = (absPath: string, reference: string) => {
    const item = attachmentByPath.get(absPath) ?? { absPath, referenceSet: new Set<string>() };
    item.referenceSet.add(reference);
    item.referenceSet.add(attachmentInternalPathGet(absPath, sourceEntryList));
    attachmentByPath.set(absPath, item);
  };

  for (const doc of docEntryList) {
    const extension = path.extname(doc.absPath).toLowerCase();
    if (extension !== '.md' && extension !== '.mdx') {
      // a binary file of the manifest (an image of a referenced folder) is
      // reached through its url, so its bytes are collected
      if (attachmentExtIsBinary(extension.slice(1))) attachmentAdd(doc.absPath, doc.internalPath);
      continue;
    }
    const text = textExpand(fs.readFileSync(doc.absPath, 'utf-8'));
    const context = { configDoc, doc, text };

    for (const finder of finderList) {
      for (const reference of finder(context)) {
        const referenceNormalized = attachmentReferenceNormalize(reference);
        if (!referenceNormalized || isExternalReference(referenceNormalized)) continue;
        const absPath = attachmentPathResolve(referenceNormalized, doc, sourceEntryList, configDir);
        if (!absPath) {
          console.warn(
            `[doc-source] component attachment not found: ${referenceNormalized} ` +
            `(referenced by ${doc.internalPath})`,
          );
          continue;
        }
        attachmentAdd(absPath, referenceNormalized);
      }
    }
  }

  for (const dependencyPath of assetDependencyPathList) {
    const absPath = attachmentPathResolve(dependencyPath, undefined, sourceEntryList, configDir);
    if (!absPath) {
      console.warn(`[doc-source] asset dependency not found in the collected source: ${dependencyPath}`);
      continue;
    }
    attachmentAdd(absPath, dependencyPath);
  }

  return [...attachmentByPath.values()].map((item) => ({
    absPath: item.absPath,
    referenceList: [...item.referenceSet].filter(Boolean),
  }));
}

export function attachmentMimeGet(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  return mimeByExtension[extension] ?? mimeTextByExtension[extension] ?? 'application/octet-stream';
}

// a file whose content is not text the page compiles or shows as code
export function attachmentExtIsBinary(ext: string): boolean {
  return `.${String(ext ?? '').toLowerCase()}` in mimeByExtension;
}

export function attachmentDataUrlGet(filePath: string): string {
  return `data:${attachmentMimeGet(filePath)};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

function laneIconPathListParse(value: string): string[] {
  return value.split('|').flatMap((entry) => {
    const index = entry.indexOf(':');
    const imagePath = index < 0 ? '' : entry.slice(index + 1).trim();
    return imagePath ? [imagePath] : [];
  });
}

function attachmentReferenceNormalize(value: string): string {
  return value.trim().replaceAll('\\', '/');
}

function isExternalReference(value: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value);
}

// doc: the document the reference is written in; undefined for a reference
// without one (an asset dependency), which then resolves as a source path,
// a suffix or a name only
function attachmentPathResolve(
  reference: string,
  doc: SourceEntry | undefined,
  sourceEntryList: SourceEntry[],
  configDir: string,
): string | undefined {
  const { entryList } = docTargetResolve(reference, doc?.internalPath ?? '', sourceIndexBuild(sourceEntryList)) as {
    entryList: SourceEntry[];
  };
  if (entryList.length === 1) return entryList[0].absPath;
  if (entryList.length > 1) {
    console.warn(
      `[doc-source] component attachment is ambiguous: ${reference}; using ${entryList[0].internalPath}`,
    );
    return entryList[0].absPath;
  }
  if (!doc) return undefined;

  // outside the collected source: on disk, beside the document or below the config folder
  const referenceWithoutPrefix = reference.replace(/^\.\//, '').replace(/^\//, '');
  const candidateList = reference.startsWith('./') || reference.startsWith('../')
    ? [path.resolve(path.dirname(doc.absPath), reference)]
    : [path.resolve(configDir, referenceWithoutPrefix), path.resolve(path.dirname(doc.absPath), reference)];
  return candidateList.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

function attachmentInternalPathGet(absPath: string, sourceEntryList: SourceEntry[]): string {
  return sourceEntryList.find((entry) => path.resolve(entry.absPath) === path.resolve(absPath))?.internalPath ?? '';
}

const mimeTextByExtension: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.mdx': 'text/mdx; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
};

// the binary files the page carries by url: images and the other media a
// component may name
const mimeByExtension: Record<string, string> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.zip': 'application/zip',
};
