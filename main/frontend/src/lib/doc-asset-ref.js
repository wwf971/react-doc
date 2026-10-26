import { yamlParse } from './yaml.js';
import { anchorCompNameIs } from '../../../../built-in/comp-mdx/anchor/AnchorData.js';
import { commentMarkerParse } from './remark-comment-comp.js';
import { docPlaceBuild } from './doc-place.js';

// An asset reference: a component's fenced block written in the language
// "asset" instead of holding the data itself. The content is yaml that
// names the store, the object in it (by id, or by its name), and the
// version to read (design: doc_page_impl_asset.md):
//
//   <!--renderComp=Image-->
//   ```asset
//   store: local
//   objectId: m2x1k9q4z0a1b   # or:  name: hero image
//   versionId: head           # optional; a version id pins that version
//   ```
//
// store is required, and one of objectId and name: a reference says where
// the object is and which one it is, so that the page never has to guess
// (or create) an object that is not where it looks. a name is unique in its
// store, so it names one object as an id does; it is what a person writes,
// the id what the page writes. "local" is the one local store; further
// store ids are reserved for remote stores.
//
// the component never sees this block: the runtime boundary replaces raw
// and lang with the text and language of the referenced version before the
// component renders. the same expansion is done on the document text for
// the build-time scans (attachments, source pruning).

export const ASSET_REF_LANG = 'asset';

// the id of the local store
export const ASSET_STORE_ID_LOCAL = 'local';

export function assetRefLangIs(lang) {
  return String(lang ?? '').trim().toLowerCase() === ASSET_REF_LANG;
}

// { store, objectId, name, versionId ('head' or an id), message } ; message
// is '' when valid; one of objectId and name is '' (both when invalid)
export function assetRefParse(raw) {
  const reference = { store: '', objectId: '', name: '', versionId: 'head', message: '' };
  let content;
  try {
    content = yamlParse(String(raw ?? ''));
  } catch (error) {
    return { ...reference, message: `asset reference is not valid yaml: ${String(error?.message ?? error)}` };
  }
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return { ...reference, message: 'asset reference must be a mapping with store and objectId or name' };
  }
  reference.store = String(content.store ?? '').trim();
  reference.objectId = String(content.objectId ?? '').trim();
  reference.name = String(content.name ?? '').trim();
  const versionIdText = String(content.versionId ?? 'head').trim();
  reference.versionId = versionIdText === '' ? 'head' : versionIdText;
  if (!reference.store) return { ...reference, message: 'asset reference needs store (the id of a store of the asset service layer, e.g. local)' };
  if (!reference.objectId && !reference.name) return { ...reference, message: 'asset reference needs objectId or name' };
  if (reference.objectId && reference.name) return { ...reference, message: 'asset reference names the object by objectId or by name, not both' };
  return reference;
}

// the text of a reference block: store, the object by name when a name is
// given else by id, and versionId when it is not the head
export function assetRefTextBuild({ store, objectId = '', name = '', versionId = 'head' }) {
  const lineList = [`store: ${store}`, name ? `name: ${name}` : `objectId: ${objectId}`];
  if (versionId && versionId !== 'head') lineList.push(`versionId: ${versionId}`);
  return lineList.join('\n');
}

// a fenced block in the language asset, with its indentation (a block inside
// a list item is indented to the item's text column)
const REGEX_ASSET_FENCE = /^([ \t]*)(`{3,}|~{3,})asset[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\2[ \t]*$/gm;

// replaces every asset reference block of a document text with the fenced
// block it stands for, so scanners that read component data from the text
// see the data. textGet(reference) -> { lang, text } or undefined; a
// reference that cannot be read is left as written.
export function assetBlockTextExpand(text, textGet) {
  return String(text ?? '').replace(REGEX_ASSET_FENCE, (match, indent, fence, rawIndented) => {
    const raw = rawIndented.split(/\r?\n/).map((line) => line.slice(Math.min(indent.length, line.length - line.trimStart().length))).join('\n');
    const reference = assetRefParse(raw);
    if (reference.message) return match;
    const resolved = textGet(reference);
    if (!resolved) return match;
    const fenceOut = fenceRunGet(resolved.text, fence[0], fence.length);
    const lineList = resolved.text === '' ? [] : resolved.text.replace(/\n$/, '').split('\n');
    return [
      `${indent}${fenceOut}${resolved.lang}`,
      ...lineList.map((line) => `${indent}${line}`),
      `${indent}${fenceOut}`,
    ].join('\n');
  });
}

// ---------- the references a document makes (doc_page_impl_asset.md#usage) ----------

// the frontmatter at the start of a document. lines are counted in the
// content without it, as the compiled body counts them (splitFrontmatter of
// mdx-compile.js, the sourceLine of DocComp): the same regex.
const REGEX_FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/;
const REGEX_FENCE_OPEN = /^([ \t]*)(`{3,}|~{3,})(.*)$/;
// a marker comment standing alone on its line, or ending a line of text (a
// component inside a list item, doc_page_impl_mdx_li.md)
const REGEX_MARKER_AT_LINE_END = /(<!--[\s\S]*?-->)[ \t]*$/;

// every component block of a document text whose data is an asset
// reference, in document order:
//
//   { place: { docPath, sourceLine, fragment },   where the block is (doc_page_impl_nav.md#places-in-a-document)
//     compName,                                     the tag name of its marker
//     componentId,                                  the id prop of its marker ('' without)
//     reference: { store, objectId, name, versionId, message } }   as written (assetRefParse)
//
// sourceLine is the line of the marker comment; fragment is the id an
// Anchor marker right before it declares. a fence written in the language
// asset without a component marker before it is a code block, not a use,
// and fenced blocks inside other fenced blocks (an example in a ````markdown
// block) are not looked into.
export function assetUsageListScan(text, docPath) {
  const content = String(text ?? '').replace(REGEX_FRONTMATTER, '');
  const lineList = content.split(/\r?\n/);
  const usageList = [];
  let index = 0;
  while (index < lineList.length) {
    const fenceOpen = REGEX_FENCE_OPEN.exec(lineList[index]);
    if (!fenceOpen) {
      index += 1;
      continue;
    }
    const [, indent, fence, info] = fenceOpen;
    const indexClose = fenceCloseIndexFind(lineList, index + 1, fence);
    if (assetRefLangIs(info.trim().split(/\s+/)[0])) {
      const usage = usageBuild(lineList, index, indexClose, indent, docPath);
      if (usage) usageList.push(usage);
    }
    index = indexClose + 1;
  }
  return usageList;
}

// the line of the closing fence of an opening fence, or the last line when
// the block is not closed (it runs to the end of the document)
function fenceCloseIndexFind(lineList, indexStart, fence) {
  const regexClose = new RegExp(`^[ \\t]*${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`);
  for (let index = indexStart; index < lineList.length; index += 1) {
    if (regexClose.test(lineList[index])) return index;
  }
  return lineList.length - 1;
}

function usageBuild(lineList, indexFence, indexClose, indent, docPath) {
  const indexMarker = lineIndexPreviousFind(lineList, indexFence);
  if (indexMarker < 0) return undefined;
  const markerMatch = REGEX_MARKER_AT_LINE_END.exec(lineList[indexMarker]);
  const marker = markerMatch ? commentMarkerParse(markerMatch[1]) : undefined;
  if (!marker || anchorCompNameIs(marker.compName)) return undefined;
  const raw = lineList
    .slice(indexFence + 1, indexClose)
    .map((line) => line.slice(Math.min(indent.length, line.length - line.trimStart().length)))
    .join('\n');
  return {
    place: docPlaceBuild({ docPath, sourceLine: indexMarker + 1, fragment: anchorIdBeforeGet(lineList, indexMarker) }),
    compName: marker.compName,
    componentId: String(marker.props.id ?? ''),
    reference: assetRefParse(raw),
  };
}

// the id an Anchor marker on the line before the marker declares ('' when none)
function anchorIdBeforeGet(lineList, indexMarker) {
  if (lineList[indexMarker].trim().startsWith('<!--') === false) return '';
  const indexAnchor = lineIndexPreviousFind(lineList, indexMarker);
  if (indexAnchor < 0) return '';
  const marker = commentMarkerParse(lineList[indexAnchor].trim());
  if (!marker || !anchorCompNameIs(marker.compName)) return '';
  return String(marker.props.id ?? '').trim();
}

// the last line before index that is not blank, -1 when none
function lineIndexPreviousFind(lineList, index) {
  for (let indexLine = index - 1; indexLine >= 0; indexLine -= 1) {
    if (lineList[indexLine].trim() !== '') return indexLine;
  }
  return -1;
}

function fenceRunGet(text, fenceChar, lengthMin) {
  let lengthMax = lengthMin;
  for (const line of text.split('\n')) {
    const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (match && match[1][0] === fenceChar) lengthMax = Math.max(lengthMax, match[1].length + 1);
  }
  return fenceChar.repeat(lengthMax);
}
