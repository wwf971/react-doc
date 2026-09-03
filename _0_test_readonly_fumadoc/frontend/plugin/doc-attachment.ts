import fs from 'node:fs';
import path from 'node:path';

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

const commentComponentPattern = /<!--\s*renderComp=([\w/-]+)((?:\s*,\s*[\w-]+=[^,]*)*)\s*-->/g;
const mermaidMdxPattern = /<DocDiagramMermaid\b[^>]*\blaneIcons\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const imageMdxPattern = /<DocImage\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const imageGridCommentPattern = /<!--\s*renderComp=DocImageGrid(?:\s*,[^>]*)?-->\s*```(?:yaml|yml)\s*\r?\n([\s\S]*?)\r?\n```/g;

export const docAttachmentFinderDefaultList: DocAttachmentFinder[] = [
  attachmentMermaidLaneIconFind,
  attachmentImageFind,
  attachmentImageGridFind,
];

export function attachmentMermaidLaneIconFind(context: DocAttachmentFinderContext): string[] {
  const valueList: string[] = [];

  for (const match of context.text.matchAll(commentComponentPattern)) {
    if (match[1] !== 'DocDiagramMermaid') continue;
    const props = propsCommentParse(match[2]);
    if (props.laneIcons) valueList.push(props.laneIcons);
  }

  for (const match of context.text.matchAll(mermaidMdxPattern)) {
    valueList.push(match[1] ?? match[2] ?? '');
  }

  return valueList.flatMap(laneIconPathListParse);
}

export function attachmentImageFind(context: DocAttachmentFinderContext): string[] {
  const result: string[] = [];
  for (const match of context.text.matchAll(commentComponentPattern)) {
    if (match[1] !== 'DocImage') continue;
    const src = propsCommentParse(match[2]).src;
    if (src) result.push(src);
  }
  for (const match of context.text.matchAll(imageMdxPattern)) {
    const src = match[1] ?? match[2] ?? '';
    if (src) result.push(src);
  }
  return result;
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

export function docAttachmentsCollect(
  configDoc: any,
  docEntryList: SourceEntry[],
  sourceEntryList: SourceEntry[],
  configDir: string,
  finderList: DocAttachmentFinder[],
): DocAttachmentResolved[] {
  const attachmentByPath = new Map<string, { absPath: string; referenceSet: Set<string> }>();

  for (const doc of docEntryList) {
    const extension = path.extname(doc.absPath).toLowerCase();
    if (extension !== '.md' && extension !== '.mdx') continue;
    const text = fs.readFileSync(doc.absPath, 'utf-8');
    const context = { configDoc, doc, text };

    for (const finder of finderList) {
      for (const reference of finder(context)) {
        const referenceNormalized = attachmentReferenceNormalize(reference);
        if (!referenceNormalized || isExternalReference(referenceNormalized)) continue;
        const absPath = attachmentPathResolve(
          referenceNormalized,
          doc,
          sourceEntryList,
          configDir,
        );
        if (!absPath) {
          console.warn(
            `[doc-source] component attachment not found: ${referenceNormalized} ` +
            `(referenced by ${doc.internalPath})`,
          );
          continue;
        }
        const item = attachmentByPath.get(absPath) ?? {
          absPath,
          referenceSet: new Set<string>(),
        };
        item.referenceSet.add(referenceNormalized);
        item.referenceSet.add(attachmentInternalPathGet(absPath, sourceEntryList));
        attachmentByPath.set(absPath, item);
      }
    }
  }

  return [...attachmentByPath.values()].map((item) => ({
    absPath: item.absPath,
    referenceList: [...item.referenceSet].filter(Boolean),
  }));
}

export function attachmentDataUrlGet(filePath: string): string {
  const mime = mimeByExtension[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

function propsCommentParse(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of value.split(',')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (key) result[key] = part.slice(index + 1).trim();
  }
  return result;
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

function attachmentPathResolve(
  reference: string,
  doc: SourceEntry,
  sourceEntryList: SourceEntry[],
  configDir: string,
): string | undefined {
  const referenceWithoutPrefix = reference.replace(/^\.\//, '').replace(/^\//, '');
  const internalPath = `/${referenceWithoutPrefix}`;
  const sourceMatchList = sourceEntryList.filter((entry) => (
    entry.internalPath === internalPath || entry.internalPath.endsWith(internalPath)
  ));
  if (sourceMatchList.length === 1) return sourceMatchList[0].absPath;
  if (sourceMatchList.length > 1) {
    console.warn(
      `[doc-source] component attachment is ambiguous: ${reference}; using ${sourceMatchList[0].internalPath}`,
    );
    return sourceMatchList[0].absPath;
  }

  const candidateList = reference.startsWith('./') || reference.startsWith('../')
    ? [path.resolve(path.dirname(doc.absPath), reference)]
    : [path.resolve(configDir, referenceWithoutPrefix), path.resolve(path.dirname(doc.absPath), reference)];
  return candidateList.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

function attachmentInternalPathGet(absPath: string, sourceEntryList: SourceEntry[]): string {
  return sourceEntryList.find((entry) => path.resolve(entry.absPath) === path.resolve(absPath))
    ?.internalPath.replace(/^\//, '') ?? '';
}

const mimeByExtension: Record<string, string> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};
