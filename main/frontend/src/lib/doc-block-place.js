// A place in a document where blocks go (design:
// doc_page_impl_copy_paste.md#choosing-where-the-blocks-go), said as the
// author sees it in a tree of the document: next to a node, or inside it.
//
//   { docPath, nodeId, position }
//
//   nodeId    'doc'          the document itself, the root of the tree
//             'block-{i}'    the root-level block i, a child of the root
//   position  'before' | 'after'             next to the node
//             'insideFirst' | 'insideLast'   inside the node, first or last
//
// the root holds the blocks, so inside it is the start or the end of the
// document. a block holds nothing yet: the place model is a tree so that
// the items of a list can become the children of their list block, and a
// place inside a list, later, is a place like the others.
//
// blockPlaceResolve is the one place that decides whether a place can take
// blocks and which border of the document it is: borderIndex b puts the
// blocks before block b (b === blockCount: after the last block), the
// index the line operations of the edit layer take (blockInsertOperationBuild).

export const BLOCK_PLACE_NODE_DOC = 'doc';

export const blockPlacePositionList = [
  { position: 'before', label: 'Before' },
  { position: 'after', label: 'After' },
  { position: 'insideFirst', label: 'Into, first' },
  { position: 'insideLast', label: 'Into, last' },
];

export function blockPlaceBuild({ docPath = '', nodeId = BLOCK_PLACE_NODE_DOC, position = 'insideLast' } = {}) {
  return { docPath: String(docPath ?? ''), nodeId: String(nodeId ?? BLOCK_PLACE_NODE_DOC), position };
}

// the place in front of border borderIndex of a document with blockCount
// blocks: before the block at the border, else at the end of the document
export function blockPlaceFromBorder(docPath, borderIndex, blockCount) {
  if (borderIndex < blockCount) return blockPlaceBuild({ docPath, nodeId: blockNodeIdGet(borderIndex), position: 'before' });
  return blockPlaceBuild({ docPath, nodeId: BLOCK_PLACE_NODE_DOC, position: 'insideLast' });
}

export function blockNodeIdGet(blockIndex) {
  return `block-${blockIndex}`;
}

// another node was chosen: the position stays when the node takes it, else
// it becomes the node's usual one (after a block, the end of the document)
export function blockPlaceNodeChange(place, nodeId) {
  const isInside = place.position === 'insideFirst' || place.position === 'insideLast';
  let position = place.position;
  if (nodeId === BLOCK_PLACE_NODE_DOC && !isInside) position = 'insideLast';
  if (nodeId !== BLOCK_PLACE_NODE_DOC && isInside) position = 'after';
  return { ...place, nodeId, position };
}

// -> { code: 0, data: { borderIndex } } or { code: -1, message }: why the
// place cannot take blocks
export function blockPlaceResolve(place, blockCount) {
  if (!place?.docPath) return { code: -1, message: 'choose a document' };
  if (place.nodeId === BLOCK_PLACE_NODE_DOC) {
    if (place.position === 'insideFirst') return { code: 0, data: { borderIndex: 0 }, message: '' };
    if (place.position === 'insideLast') return { code: 0, data: { borderIndex: blockCount }, message: '' };
    return { code: -1, message: 'the document has no place before or after itself: choose Into, first or Into, last' };
  }
  const blockIndex = blockIndexGet(place.nodeId);
  if (blockIndex < 0 || blockIndex >= blockCount) return { code: -1, message: 'the block is not in the document anymore' };
  if (place.position === 'before') return { code: 0, data: { borderIndex: blockIndex }, message: '' };
  if (place.position === 'after') return { code: 0, data: { borderIndex: blockIndex + 1 }, message: '' };
  return { code: -1, message: 'blocks go next to a block: putting them inside a block (as list items) is not supported yet' };
}

// the document as the nodes of a tree view (SourceTreeSelect): the
// document, with its blocks as children, each a badge naming its kind and
// the first words of the block
//   blockList        the block model's blocks of the document
//   labelGet(block)  the name of a block's kind ("Paragraph", "Image")
//   detailGet(block) optional: a note after a block ("chosen")
export function blockPlaceNodeListBuild({ docLabel, blockList, labelGet, detailGet }) {
  return [{
    id: BLOCK_PLACE_NODE_DOC,
    label: docLabel,
    detail: blockList.length === 0 ? 'empty' : '',
    kind: 'file',
    childList: blockList.map((block) => ({
      id: blockNodeIdGet(block.index),
      label: blockBriefGet(block.text),
      badge: labelGet(block),
      badgeKind: block.component ? 'component' : '',
      detail: detailGet?.(block) ?? '',
      kind: 'block',
    })),
  }];
}

// how a place reads for the author: "after “Third of three…”", "at the end of the document"
export function blockPlaceTextGet(place, blockList) {
  if (!place) return '';
  if (place.nodeId === BLOCK_PLACE_NODE_DOC) {
    if (place.position === 'insideFirst') return 'at the start of the document';
    if (place.position === 'insideLast') return 'at the end of the document';
    return '';
  }
  const block = blockList[blockIndexGet(place.nodeId)];
  if (!block) return '';
  const brief = blockBriefGet(block.text);
  const name = brief ? `“${brief}”` : `block ${block.index + 1}`;
  if (place.position === 'before') return `before ${name}`;
  if (place.position === 'after') return `after ${name}`;
  return '';
}

// the first line of a block that says what it is about, without the
// markdown around it (heading marks, list markers, a marker comment, fences)
export function blockBriefGet(text) {
  for (const lineRaw of String(text ?? '').split('\n')) {
    const line = lineRaw.trim()
      .replace(/^<!--.*?-->/, '')
      .replace(/^(#{1,6}\s+|>\s*|[-*+]\s+|\d{1,9}[.)]\s+)/, '')
      .trim();
    if (line === '' || /^(`{3,}|~{3,})/.test(line) || /^\|?[\s:|-]+$/.test(line)) continue;
    return line.length > 60 ? `${line.slice(0, 59)}…` : line;
  }
  return '';
}

function blockIndexGet(nodeId) {
  const match = /^block-(\d+)$/.exec(String(nodeId ?? ''));
  return match ? Number(match[1]) : -1;
}
