import { yamlParse } from './yaml.js';

// An asset reference: a component's fenced block written in the language
// "asset" instead of holding the data itself. The content is yaml that
// names an object of the asset store and the version to read
// (design: doc_page_impl_asset.md):
//
//   <!--renderComp=Image-->
//   ```asset
//   objectId: m2x1k9q4z0a1b
//   versionId: head        # optional; a version id pins that version
//   ```
//
// a bare object id is the shortest form:
//
//   ```asset
//   m2x1k9q4z0a1b
//   ```
//
// the component never sees this block: the runtime boundary replaces raw
// and lang with the text and language of the referenced version before the
// component renders. the same expansion is done on the document text for
// the build-time scans (attachments, source pruning).

export const ASSET_REF_LANG = 'asset';

export function assetRefLangIs(lang) {
  return String(lang ?? '').trim().toLowerCase() === ASSET_REF_LANG;
}

// { objectId, versionId ('head' or an id), message } ; message is '' when valid
export function assetRefParse(raw) {
  let content;
  try {
    content = yamlParse(String(raw ?? ''));
  } catch (error) {
    return { objectId: '', versionId: 'head', message: `asset reference is not valid yaml: ${String(error?.message ?? error)}` };
  }
  if (typeof content === 'string') content = { objectId: content };
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    return { objectId: '', versionId: 'head', message: 'asset reference must be a mapping with objectId, or a bare object id' };
  }
  const objectId = String(content.objectId ?? '').trim();
  if (!objectId) return { objectId: '', versionId: 'head', message: 'asset reference needs objectId' };
  const versionIdText = String(content.versionId ?? 'head').trim();
  const versionId = versionIdText === '' ? 'head' : versionIdText;
  return { objectId, versionId, message: '' };
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
