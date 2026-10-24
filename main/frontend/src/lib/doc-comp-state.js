// The component state service layer, pure part (design:
// doc_page_impl_mdx_comp_state.md). A component keeps what it holds between
// renders and across unmounts in a state object of DocCompStateStore, found
// by a key. The key names the block the component stands for, by the most
// stable identity the page has for it:
//
//   asset:{store}/{objectId}     the data comes from the asset service layer
//                                (every block reading the object shares the state)
//   id:{docPath}#{id}            the block declares an id prop
//   place:{docPath}:{sourceLine} a comment block, by its marker line
//                                (doc_page_impl_nav.md#places-in-a-document)
//   instance:{instanceId}        anything else: the instance id of the mount
//
// the earlier form wins: an asset-backed block is keyed by its object even
// when it has an id. a line-keyed state follows the lines the edit layer
// moves itself (lineShiftListGet); a change made outside the page leaves it
// behind, idle, until the store collects it.

export const COMP_STATE_KIND_LIST = ['asset', 'id', 'place', 'instance'];

//   assetInfo   config.assetInfo of the component (isFromAsset, store, objectId)
//   docPath     the source path of the document the component is in
//   id          the id prop of the block, when it has one
//   sourceLine  the marker line of a comment block, when it is one
//   instanceId  the instance id of the mount (always there)
export function compStateKeyBuild({ assetInfo, docPath = '', id, sourceLine, instanceId = '' } = {}) {
  if (assetInfo?.isFromAsset && assetInfo.store && assetInfo.objectId) {
    return `asset:${assetInfo.store}/${assetInfo.objectId}`;
  }
  const idText = typeof id === 'string' ? id.trim() : '';
  if (docPath && idText !== '') return `id:${docPath}#${idText}`;
  if (docPath && Number.isFinite(sourceLine) && sourceLine > 0) return `place:${docPath}:${sourceLine}`;
  return `instance:${instanceId}`;
}

// { kind, store?, objectId?, docPath?, id?, sourceLine?, instanceId? } of a key;
// kind 'instance' with the whole text for a key of an unknown form
export function compStateKeyParse(key) {
  const text = String(key ?? '');
  if (text.startsWith('asset:')) {
    const rest = text.slice('asset:'.length);
    const indexSlash = rest.indexOf('/');
    return { kind: 'asset', store: rest.slice(0, indexSlash), objectId: rest.slice(indexSlash + 1) };
  }
  if (text.startsWith('id:')) {
    const rest = text.slice('id:'.length);
    const indexHash = rest.lastIndexOf('#');
    return { kind: 'id', docPath: rest.slice(0, indexHash), id: rest.slice(indexHash + 1) };
  }
  if (text.startsWith('place:')) {
    const rest = text.slice('place:'.length);
    const indexColon = rest.lastIndexOf(':');
    return { kind: 'place', docPath: rest.slice(0, indexColon), sourceLine: Number(rest.slice(indexColon + 1)) };
  }
  return { kind: 'instance', instanceId: text.startsWith('instance:') ? text.slice('instance:'.length) : text };
}

// the document a key belongs to, '' for an asset or instance key
export function compStateKeyDocPathGet(key) {
  const parsed = compStateKeyParse(key);
  return parsed.docPath ?? '';
}

// how the marker lines of a document move after the edit layer writes it,
// in the lines counted without the frontmatter (the numbering of
// sourceLine): [{ lineStart, lineEnd, delta, action }], one per operation,
// all against the lines before the write (the operations of one write are
// built on the same text, doc-edit-lines.ts).
//
//   replaceLines  lines lineStart..lineEnd rewritten: the block starting at
//                 lineStart is the same block (its marker stays on that
//                 line); a marker inside the range is gone; lines after it
//                 move by delta
//   deleteLines   every marker of the range is gone; lines after move by delta
//   insertLines   lineEnd = lineStart - 1 (an empty range at the insertion
//                 line); every line from lineStart on moves by delta
//   replaceAll    the whole file changed: nothing can be followed (no entry)
//
//   operationList       the line operations written, 1-based file lines
//   frontmatterLineEnd  the last file line of the frontmatter, 0 without one;
//                       an operation inside the frontmatter moves no content line
export function lineShiftListGet(operationList, frontmatterLineEnd = 0) {
  const list = Array.isArray(operationList) ? operationList : [operationList];
  const offset = Number(frontmatterLineEnd) || 0;
  const shiftList = [];
  for (const operation of list) {
    if (!operation || typeof operation !== 'object') continue;
    const lineCountText = operation.text === undefined || operation.text === '' ? 0 : String(operation.text).split('\n').length;
    if (operation.action === 'insertLines') {
      if (operation.lineAt <= offset) continue;
      const lineStart = operation.lineAt - offset;
      shiftList.push({ action: 'insertLines', lineStart, lineEnd: lineStart - 1, delta: lineCountText });
    } else if (operation.action === 'replaceLines' || operation.action === 'deleteLines') {
      if (operation.lineEnd <= offset) continue;
      const lineCountRemoved = operation.lineEnd - operation.lineStart + 1;
      const delta = (operation.action === 'deleteLines' ? 0 : lineCountText) - lineCountRemoved;
      shiftList.push({ action: operation.action, lineStart: operation.lineStart - offset, lineEnd: operation.lineEnd - offset, delta });
    }
  }
  return shiftList;
}

// the marker line a block had before the write is at this line after it;
// undefined when the block's lines were removed, or rewritten as part of
// another block
export function lineShiftApply(sourceLine, shiftList) {
  let delta = 0;
  for (const shift of shiftList) {
    if (sourceLine >= shift.lineStart && sourceLine <= shift.lineEnd) {
      if (shift.action === 'deleteLines' || sourceLine !== shift.lineStart) return undefined;
      continue;
    }
    if (sourceLine > shift.lineEnd) delta += shift.delta;
  }
  return sourceLine + delta;
}
