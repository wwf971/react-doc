import { yamlParse } from './yaml.js';

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
  if (!reference.store) return { ...reference, message: 'asset reference needs store (the id of the asset store, e.g. local)' };
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

function fenceRunGet(text, fenceChar, lengthMin) {
  let lengthMax = lengthMin;
  for (const line of text.split('\n')) {
    const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (match && match[1][0] === fenceChar) lengthMax = Math.max(lengthMax, match[1].length + 1);
  }
  return fenceChar.repeat(lengthMax);
}
