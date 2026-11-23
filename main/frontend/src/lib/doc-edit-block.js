import { createProcessor } from '@mdx-js/mdx';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { commentMarkerParse } from './remark-comment-comp.js';
import { splitFrontmatter } from './doc-frontmatter.js';
import { listAnnotate, listDescribe, listModelBuild } from './doc-edit-list.js';
import { anchorCompNameIs } from '../../../../built-in/comp-mdx/anchor/AnchorData.js';
import { multiLangCompNameIs } from '../../../../built-in/comp-mdx/multi-lang/MultiLangData.js';

// The block model of the edit layer (design: doc_page_impl_edit.md).
//
// a document is a list of root-level blocks: headings, paragraphs, lists,
// code blocks, components, ... each block owns a range of source lines, and
// editing happens at this granularity: one block is replaced, removed, or a
// new block is inserted between two blocks.
//
// a component written in the degradation-compatible style is one block:
//
//   <!--renderComp=Anchor,id=x-->      marker, binds to the next node
//   <!--renderComp=Image-->            marker, binds to the next node
//   ```yaml                            the marked node
//   src: dog.png
//   ```
//
// every marker comment belongs to the node after it, so the comment and its
// yaml block are never two things. the same holds for a marker that ends a
// paragraph line ("text<!--renderComp=X-->" followed by a block).
//
// a list block is more than its lines: its items are structure the author
// edits one by one (doc_page_impl_edit_structure.md). the block of a list
// carries the model of its items (block.list, lib/doc-edit-list.js), and the
// compiled list is marked so that every <li> names its item.
//
// two steps share this module:
//   remarkEditBlock      compile time: groups the root children, wraps every
//                        group in <DocEditBlock blockIndex/>, and reports the
//                        groups with their source positions
//   editDocModelBuild    maps those positions onto the complete file (the
//                        frontmatter is stripped before parsing) and cuts the
//                        text of every block
//
// editTextModelBuild gives the same model for a text that is not compiled as
// a document (a pasted text, doc_page_impl_block_ops.md): it is only parsed,
// the way compileDoc parses a document of that format.

export const BLOCK_WRAPPER_NAME = 'DocEditBlock';

// kind of a block, decided by its main node. the default editor of each kind
// is a registered component (comp-doc/edit/DocEditBlockEditor.jsx).
const blockKindByNodeType = {
  blockquote: 'blockquote',
  code: 'code',
  definition: 'definition',
  footnoteDefinition: 'footnoteDefinition',
  heading: 'heading',
  html: 'html',
  list: 'list',
  math: 'math',
  mdxFlowExpression: 'expression',
  mdxJsxFlowElement: 'jsx',
  mdxjsEsm: 'esm',
  paragraph: 'paragraph',
  table: 'table',
  thematicBreak: 'thematicBreak',
};

// ---------- compile time ----------

// options.onBlockList(blockList): the groups, positions relative to the
// parsed content
// options.docKey: what the document is besides its parsed content (a hash of
// its frontmatter), part of every block key
export function remarkEditBlock(options = {}) {
  return (tree, file) => {
    if (!Array.isArray(tree?.children)) return;
    const groupList = rootGroupListBuild(tree.children);
    const blockList = groupList.map((group, index) => blockDescribe(group, index));
    // the items of a list block are found in the rendered body by their path
    groupList.forEach((group, index) => {
      if (blockList[index].kind === 'list') listAnnotate(group.nodeList[group.nodeList.length - 1]);
    });
    const source = typeof file?.value === 'string' ? file.value : '';
    const keyList = source ? blockKeyListBuild(groupList, source, String(options.docKey ?? '')) : [];
    tree.children = groupList.map((group, index) => ({
      type: 'mdxJsxFlowElement',
      name: BLOCK_WRAPPER_NAME,
      attributes: [
        { type: 'mdxJsxAttribute', name: 'blockIndex', value: String(index) },
        ...(keyList[index] ? [{ type: 'mdxJsxAttribute', name: 'blockKey', value: keyList[index] }] : []),
        // the line the block starts on in this compile: what the lines its
        // drawing carries are counted from (DocEditLineShiftContext)
        ...(group.nodeList[0]?.position?.start?.line ? [{ type: 'mdxJsxAttribute', name: 'blockLine', value: String(group.nodeList[0].position.start.line) }] : []),
      ],
      children: group.nodeList,
    }));
    options.onBlockList?.(blockList);
  };
}

// ---------- the key of the drawing of a block ----------
// (doc_page_impl_edit.md#a-write-draws-only-what-changed) a write compiles the
// whole document again; a block whose index and key did not change is not
// drawn again (DocEditBlock). the key is everything its drawing comes from:
//
//   its text
//   not its line: the lines its drawing carries (a link, remarkDocLink; a code
//     block, rehypeCodeLine; a component, its sourceLine) are counted from the
//     line it starts on in the compile that made them (blockLine); a block
//     moved by lines added above it is not drawn again, its readers of lines
//     add how far it moved (DocEditLineShiftContext)
//   what of the document it is drawn from beyond its text: definitions of
//     links and footnotes, the order of footnote references, the headings (an
//     id follows the ids before it), the esm of an mdx file, the frontmatter
//     (docKey)
//   for a block with a component: the text of every block with one (the data
//     of a block can be reused by another, remarkCommentComp)
const BLOCK_COMPONENT_NODE_TYPE_LIST = ['html', 'mdxJsxFlowElement', 'mdxJsxTextElement'];

export function blockKeyListBuild(groupList, source, docKey = '') {
  const textOf = (nodeList) => {
    const start = nodeList[0]?.position?.start?.offset;
    const end = nodeList[nodeList.length - 1]?.position?.end?.offset;
    return Number.isInteger(start) && Number.isInteger(end) ? source.slice(start, end) : undefined;
  };
  const documentPartList = [docKey];
  const componentTextList = [];
  const typeSetByGroup = groupList.map((group) => {
    const typeSet = new Set();
    const walk = (node) => {
      typeSet.add(node.type);
      if (node.type === 'definition' || node.type === 'footnoteDefinition' || node.type === 'mdxjsEsm') documentPartList.push(textOf([node]) ?? '');
      if (node.type === 'footnoteReference') documentPartList.push(`^${node.identifier ?? ''}`);
      if (node.type === 'heading') documentPartList.push(`#${node.depth}:${textOf([node]) ?? ''}`);
      (node.children ?? []).forEach(walk);
    };
    group.nodeList.forEach(walk);
    return typeSet;
  });
  groupList.forEach((group, index) => {
    if (BLOCK_COMPONENT_NODE_TYPE_LIST.some((type) => typeSetByGroup[index].has(type))) componentTextList.push(textOf(group.nodeList) ?? '');
  });
  const documentHash = textHashShort(documentPartList.join('\u0000'));
  const componentHash = textHashShort(componentTextList.join('\u0000'));
  return groupList.map((group, index) => {
    const text = textOf(group.nodeList);
    if (text === undefined) return '';
    const hasComponent = BLOCK_COMPONENT_NODE_TYPE_LIST.some((type) => typeSetByGroup[index].has(type));
    return `${textHashShort(text)}.${documentHash}${hasComponent ? `.${componentHash}` : ''}`;
  });
}

// ---------- the content of a block made when the block is drawn ----------
// (doc_page_impl_edit.md#a-write-draws-only-what-changed) the compiled body is
// one function, run on every write: it would make the elements of every
// block, those of the blocks not drawn again (DocEditBlock skips them) too.
// after the JSX of the document is built into calls, the children of every
// block wrapper are given as a function instead (renderChildren), called by
// the wrapper when it is drawn:
//
//   _jsx(_components.DocEditBlock, { blockIndex: "3", blockKey: "…", children: X })
//   _jsx(_components.DocEditBlock, { blockIndex: "3", blockKey: "…", renderChildren: () => X })
//
// what X reads (the components, the props of the body, the exports of an mdx
// file) is in the scope of the arrow as it was in the call. the reading body
// is not compiled with it.
export function recmaEditBlockChildrenLazy() {
  return (tree) => {
    const walk = (node) => {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (!node || typeof node !== 'object' || typeof node.type !== 'string') return;
      if (node.type === 'CallExpression' && blockWrapperReferenceIs(node.arguments?.[0]) && node.arguments?.[1]?.type === 'ObjectExpression') {
        const propertyList = node.arguments[1].properties;
        const index = propertyList.findIndex((property) => property.type === 'Property' && !property.computed && propertyKeyNameGet(property) === 'children');
        if (index >= 0) {
          const property = propertyList[index];
          walk(property.value);
          propertyList[index] = {
            ...property,
            key: { type: 'Identifier', name: 'renderChildren' },
            shorthand: false,
            method: false,
            value: { type: 'ArrowFunctionExpression', params: [], body: property.value, expression: true, async: false, generator: false },
          };
          return;
        }
      }
      for (const key of Object.keys(node)) {
        if (key === 'position' || key === 'loc' || key === 'range' || key === 'data') continue;
        const value = node[key];
        if (value && typeof value === 'object') walk(value);
      }
    };
    walk(tree);
  };
}

function blockWrapperReferenceIs(node) {
  if (node?.type === 'Identifier') return node.name === BLOCK_WRAPPER_NAME;
  return node?.type === 'MemberExpression' && !node.computed && node.property?.type === 'Identifier' && node.property.name === BLOCK_WRAPPER_NAME;
}

function propertyKeyNameGet(property) {
  if (property.key?.type === 'Identifier') return property.key.name;
  if (property.key?.type === 'Literal') return String(property.key.value);
  return '';
}

// a short hash of a text (FNV-1a, 32 bits, base 36): a key, never a check
export function textHashShort(text) {
  let hash = 0x811c9dc5;
  const value = String(text ?? '');
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

// groups the root children: markers join the node after them; a paragraph
// ending with a marker joins the block after it; trailing markers form a
// group of their own.
export function rootGroupListBuild(childList) {
  const groupList = [];
  let markerPendingList = [];
  for (let index = 0; index < childList.length; index += 1) {
    const node = childList[index];
    if (nodeIsMarker(node)) {
      markerPendingList.push(node);
      continue;
    }
    const nodeList = [...markerPendingList, node];
    markerPendingList = [];
    const nodeNext = childList[index + 1];
    if (paragraphMarkerEndingGet(node) && nodeNext && !nodeIsMarker(nodeNext)) {
      nodeList.push(nodeNext);
      index += 1;
    }
    groupList.push({ nodeList });
  }
  if (markerPendingList.length > 0) groupList.push({ nodeList: markerPendingList });
  return groupList;
}

function blockDescribe(group, index) {
  const { nodeList } = group;
  const nodeFirst = nodeList[0];
  const nodeLast = nodeList[nodeList.length - 1];
  const isMarkerOnly = nodeList.every(nodeIsMarker);
  const nodeMain = isMarkerOnly ? undefined : nodeLast;
  const markerBinding = isMarkerOnly ? undefined : markerBindingGet(nodeList);
  const kind = blockKindGet(markerBinding, nodeMain);
  const block = {
    index,
    kind,
    nodeType: nodeMain?.type ?? 'marker',
    positionStart: positionPointGet(nodeFirst.position?.start),
    positionEnd: positionPointGet(nodeLast.position?.end),
  };
  // the prose rules of the page depend on the heading level of the block
  // before ("h2 + *"); the wrapper carries it so the edit body can follow them
  if (kind === 'heading') block.depth = nodeMain.depth;
  // the items of a list, by the positions the parser gives them
  if (kind === 'list') block.list = { lineStart: nodeMain.position?.start?.line ?? 1, described: listDescribe(nodeMain) };
  if (kind === 'component') {
    block.component = {
      compName: markerBinding.compName,
      props: markerBinding.props,
      nodeType: nodeMain.type,
      lang: typeof nodeMain.lang === 'string' ? nodeMain.lang : '',
      markerPositionStart: positionPointGet(markerBinding.node.position?.start),
      markerPositionEnd: positionPointGet(markerBinding.node.position?.end),
      nodePositionStart: positionPointGet(nodeMain.position?.start),
      nodePositionEnd: positionPointGet(nodeMain.position?.end),
    };
  }
  return block;
}

// the marker directly before the main node: the last marker node of the
// group, or the marker ending the paragraph before the main node
function markerBindingGet(nodeList) {
  const nodeMain = nodeList[nodeList.length - 1];
  const nodeBefore = nodeList[nodeList.length - 2];
  if (!nodeBefore) return undefined;
  if (nodeIsMarker(nodeBefore)) {
    return { ...commentMarkerParse(nodeBefore.value), node: nodeBefore };
  }
  const markerInline = paragraphMarkerEndingGet(nodeBefore);
  if (markerInline && nodeMain) {
    return { ...commentMarkerParse(markerInline.value), node: markerInline };
  }
  return undefined;
}

function blockKindGet(markerBinding, nodeMain) {
  if (!nodeMain) return 'marker';
  if (markerBinding && !anchorCompNameIs(markerBinding.compName)) {
    // "<!--renderComp=MultiLang-->" before a heading translates the heading
    // text; the block stays a heading
    const isHeadingTranslated = nodeMain.type === 'heading' && multiLangCompNameIs(markerBinding.compName);
    if (!isHeadingTranslated) return 'component';
  }
  return blockKindByNodeType[nodeMain.type] ?? 'other';
}

export function nodeIsMarker(node) {
  return node?.type === 'html' && commentMarkerParse(node.value) !== undefined;
}

// the marker html node ending a paragraph, undefined otherwise
function paragraphMarkerEndingGet(node) {
  if (node?.type !== 'paragraph' || !Array.isArray(node.children)) return undefined;
  let indexLast = node.children.length - 1;
  while (indexLast >= 0 && node.children[indexLast].type === 'text' && node.children[indexLast].value.trim() === '') {
    indexLast -= 1;
  }
  const nodeLast = node.children[indexLast];
  return nodeIsMarker(nodeLast) ? nodeLast : undefined;
}

function positionPointGet(point) {
  return { line: point?.line ?? 1, column: point?.column ?? 1, offset: point?.offset ?? 0 };
}

// ---------- model of one document ----------

// source: the complete file text with "\n" line endings
// blockListCompiled: what remarkEditBlock reported for this text
//
// result:
//   lineList, lineCount
//   frontmatter   { lineStart, lineEnd, text } or undefined
//   blockList     [{ index, kind, nodeType, lineStart, lineEnd, text, depth?, component?, list?, listMessage? }]
//     depth       heading level of a heading block
//     list        the item model of a list block (lib/doc-edit-list.js); when the
//                 list is written in a way the model does not take (tabs as
//                 indentation), listMessage says why and the block is edited
//                 as a whole only
//     component   { compName, props, nodeType, lang, markerLine, raw,
//                   textBefore, markerText, textBetween, nodeText }
//                 textBefore + markerText + textBetween + nodeText === text
//                 markerLine: the line of the marker comment in the content
//                 without frontmatter, as the reading view numbers it
//                 (DocComp sourceLine)
export function editDocModelBuild({ source, blockListCompiled, format = 'md' }) {
  const { content } = splitFrontmatter(source);
  const prefix = source.slice(0, source.length - content.length);
  const lineOffset = lineCountGet(prefix);
  const lineList = source.split('\n');
  const lineBoundaryList = lineBoundaryListBuild(content);
  const lineListContent = lineList.slice(lineOffset);

  const frontmatter = prefix === ''
    ? undefined
    : { lineStart: 1, lineEnd: lineOffset, text: lineList.slice(0, lineOffset).join('\n') };

  const blockList = blockListCompiled.map((blockCompiled) => {
    const lineStart = blockCompiled.positionStart.line;
    const lineEnd = blockCompiled.positionEnd.line;
    const offsetBlock = lineBoundaryList[lineStart - 1]?.start ?? 0;
    const text = content.slice(offsetBlock, lineBoundaryList[lineEnd - 1]?.end ?? content.length);
    const block = {
      index: blockCompiled.index,
      kind: blockCompiled.kind,
      nodeType: blockCompiled.nodeType,
      lineStart: lineStart + lineOffset,
      lineEnd: lineEnd + lineOffset,
      text,
    };
    if (blockCompiled.depth !== undefined) block.depth = blockCompiled.depth;
    if (blockCompiled.component) {
      block.component = componentDetailBuild(blockCompiled.component, text, offsetBlock);
    }
    if (blockCompiled.list) {
      const built = listModelBuild({
        listDescribed: blockCompiled.list.described,
        lineList: lineListContent,
        lineOffset,
        // the lines of the block before its list: an Anchor marker
        linePrefixList: lineListContent.slice(lineStart - 1, blockCompiled.list.lineStart - 1),
        format,
      });
      if (built.code === 0) block.list = built.data;
      else block.listMessage = built.message;
    }
    return block;
  });

  return { lineList, lineCount: lineList.length, frontmatter, blockList };
}

// text: any md / mdx text with "\n" line endings; format: 'md' | 'mdx'.
// throws when the text does not parse (invalid JSX in mdx).
export function editTextModelBuild({ text, format }) {
  const { content } = splitFrontmatter(text);
  const processor = createProcessor({
    format: format === 'mdx' ? 'mdx' : 'md',
    remarkPlugins: [remarkGfm, remarkMath],
  });
  const tree = processor.parse(content);
  const blockListCompiled = rootGroupListBuild(tree.children ?? []).map((group, index) => blockDescribe(group, index));
  return editDocModelBuild({ source: text, blockListCompiled, format });
}

function componentDetailBuild(componentCompiled, text, offsetBlock) {
  const markerStart = componentCompiled.markerPositionStart.offset - offsetBlock;
  const markerEnd = componentCompiled.markerPositionEnd.offset - offsetBlock;
  const nodeStart = componentCompiled.nodePositionStart.offset - offsetBlock;
  const nodeEnd = componentCompiled.nodePositionEnd.offset - offsetBlock;
  const nodeText = text.slice(nodeStart, nodeEnd);
  return {
    compName: componentCompiled.compName,
    props: componentCompiled.props,
    nodeType: componentCompiled.nodeType,
    lang: componentCompiled.lang,
    markerLine: componentCompiled.markerPositionStart.line,
    raw: componentCompiled.nodeType === 'code' ? fencedCodeValueGet(nodeText) : nodeText,
    textBefore: text.slice(0, markerStart),
    markerText: text.slice(markerStart, markerEnd),
    textBetween: text.slice(markerEnd, nodeStart),
    nodeText,
  };
}

// the text of a component block after its component changed `raw`, the
// marker props and/or the language of its fenced block (`lang`, a fenced
// block only: the info string is replaced). the marker and the fences stay
// as authored unless the new raw text would close the fence early.
export function componentBlockTextBuild(block, change = {}) {
  const component = block.component;
  if (!component) throw new Error('componentBlockTextBuild needs a component block');
  const markerText = change.props
    ? markerTextBuild(component.compName, change.props)
    : component.markerText;
  // raw is the content of the node without a final line break (as mdast
  // reports it); serializers such as yaml stringify end with one
  const raw = change.raw !== undefined ? String(change.raw).replace(/\n$/, '') : component.raw;
  const nodeText = component.nodeType === 'code'
    ? fencedCodeTextBuild(component.nodeText, raw, change.lang)
    : raw;
  return component.textBefore + markerText + component.textBetween + nodeText;
}

// a text as a value of a marker prop can hold it: on one line, no comma (the
// separator of the props) and no run of dashes (which could end the comment)
export function markerValueNormalize(text) {
  return String(text ?? '').replace(/\s+/g, ' ').replace(/,/g, ' ').replace(/-{2,}/g, '-').replace(/>/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

export function markerTextBuild(compName, props = {}) {
  const propsText = Object.entries(props)
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== '')
    .map(([key, value]) => `,${key}=${String(value)}`)
    .join('');
  return `<!--renderComp=${compName}${propsText}-->`;
}

// "<!--renderComp=Name-->\n```lang\nraw\n```" for a new component block
export function componentTemplateTextBuild(compName, template = {}) {
  const lang = typeof template.lang === 'string' ? template.lang : 'yaml';
  const raw = String(template.raw ?? '');
  const fence = fenceRunGet(raw, '`', 3);
  return `${markerTextBuild(compName, template.props ?? {})}\n${fence}${lang}\n${raw}\n${fence}`;
}

// ---------- fenced code ----------

const REGEX_FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;

// content between the fence lines of a fenced code block
function fencedCodeValueGet(nodeText) {
  const lineList = nodeText.split('\n');
  const match = REGEX_FENCE_OPEN.exec(lineList[0]);
  if (!match) return nodeText;
  const indent = match[1].length;
  const isClosed = lineList.length > 1 && fenceLineIsClosing(lineList[lineList.length - 1], match[2]);
  const lineListInner = lineList.slice(1, isClosed ? -1 : undefined);
  return lineListInner.map((line) => line.slice(Math.min(indent, line.length - line.trimStart().length))).join('\n');
}

// the fenced block with a new value. the fence character and the info string
// are kept (with `lang` given, the info string becomes that language); the
// fence grows when a line of the value could close it.
function fencedCodeTextBuild(nodeText, raw, lang) {
  const lineList = nodeText.split('\n');
  const match = REGEX_FENCE_OPEN.exec(lineList[0]);
  if (!match) return raw;
  const [, indent, fenceAuthored, infoAuthored] = match;
  const info = lang !== undefined ? String(lang) : infoAuthored;
  const fence = fenceRunGet(raw, fenceAuthored[0], fenceAuthored.length);
  const lineListRaw = raw === '' ? [] : raw.split('\n');
  return [
    `${indent}${fence}${info}`,
    ...lineListRaw.map((line) => `${indent}${line}`),
    `${indent}${fence}`,
  ].join('\n');
}

function fenceLineIsClosing(line, fenceOpen) {
  const match = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
  return Boolean(match) && match[1][0] === fenceOpen[0] && match[1].length >= fenceOpen.length;
}

function fenceRunGet(raw, fenceChar, lengthMin) {
  let lengthMax = lengthMin;
  for (const line of raw.split('\n')) {
    const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (match && match[1][0] === fenceChar) lengthMax = Math.max(lengthMax, match[1].length + 1);
  }
  return fenceChar.repeat(lengthMax);
}

// ---------- line operations of a model ----------
// operations are applied by the development server (plugin/doc-edit-lines.ts).
// blank lines keep blocks apart; an insertion adds the blank lines it needs,
// a deletion removes the blank lines that separated the block.

export function blockReplaceOperationBuild(block, text) {
  return { action: 'replaceLines', lineStart: block.lineStart, lineEnd: block.lineEnd, text };
}

export function frontmatterReplaceOperationBuild(model, text) {
  const frontmatter = model.frontmatter;
  if (!frontmatter) throw new Error('document has no frontmatter');
  return { action: 'replaceLines', lineStart: frontmatter.lineStart, lineEnd: frontmatter.lineEnd, text };
}

// indexBefore: the new block goes before blockList[indexBefore];
// indexBefore === blockList.length appends after the last block
export function blockInsertOperationBuild(model, indexBefore, text) {
  const { blockList, frontmatter } = model;
  const lineListText = text.split('\n');
  if (blockList.length === 0) {
    const lineAt = frontmatter ? frontmatter.lineEnd + 1 : 1;
    const lineList = frontmatter ? ['', ...lineListText] : lineListText;
    return { action: 'insertLines', lineAt, text: lineList.join('\n') };
  }
  if (indexBefore <= 0) {
    return { action: 'insertLines', lineAt: blockList[0].lineStart, text: [...lineListText, ''].join('\n') };
  }
  const blockPrevious = blockList[indexBefore - 1];
  if (indexBefore >= blockList.length) {
    return { action: 'insertLines', lineAt: blockPrevious.lineEnd + 1, text: ['', ...lineListText].join('\n') };
  }
  const blockNext = blockList[indexBefore];
  const isGapBlank = blockNext.lineStart > blockPrevious.lineEnd + 1;
  const lineList = ['', ...lineListText, ...(isGapBlank ? [] : [''])];
  return { action: 'insertLines', lineAt: blockPrevious.lineEnd + 1, text: lineList.join('\n') };
}

// swaps blockList[indexUpper] with the block after it: the lines from the
// first line of the upper block to the last line of the lower one are
// replaced by the lower block, the lines that separated the two (as they
// are), then the upper block. the line count does not change.
export function blockSwapOperationBuild(model, indexUpper) {
  const blockUpper = model.blockList[indexUpper];
  const blockLower = model.blockList[indexUpper + 1];
  if (!blockUpper || !blockLower) throw new Error(`no two blocks at index ${indexUpper}`);
  const lineListBetween = model.lineList.slice(blockUpper.lineEnd, blockLower.lineStart - 1);
  return {
    action: 'replaceLines',
    lineStart: blockUpper.lineStart,
    lineEnd: blockLower.lineEnd,
    text: [blockLower.text, ...lineListBetween, blockUpper.text].join('\n'),
  };
}

export function blockDeleteOperationBuild(model, index) {
  const { blockList, frontmatter } = model;
  const block = blockList[index];
  if (!block) throw new Error(`block index out of range: ${index}`);
  const blockNext = blockList[index + 1];
  if (blockNext) {
    // the blank lines after the block go with it
    return { action: 'deleteLines', lineStart: block.lineStart, lineEnd: blockNext.lineStart - 1 };
  }
  // last block: the blank lines before it go with it
  const lineEndBefore = blockList[index - 1]?.lineEnd ?? frontmatter?.lineEnd ?? 0;
  return { action: 'deleteLines', lineStart: lineEndBefore + 1, lineEnd: block.lineEnd };
}

// ---------- several blocks at once: copying and moving them ----------
// (doc_page_impl_block_ops.md#the-write-of-a-copy-or-a-move)

// the text of the blocks at indexList, in document order, one blank line
// between two of them: what a copy or a move inserts
export function blockListTextGet(model, indexList) {
  return indexListNormalize(model, indexList).map((index) => model.blockList[index].text).join('\n\n');
}

// the deleteLines operations that remove the blocks at indexList. adjacent
// blocks are removed as one run with the blank lines between them; a run
// takes the blank lines after it, or, when it reaches the end of the
// document, the blank lines before it (as blockDeleteOperationBuild for one
// block). the operations never overlap, so they are applied together.
export function blockListDeleteOperationListBuild(model, indexList) {
  return blockRunListGet(indexListNormalize(model, indexList)).map((run) => blockRunDeleteOperationBuild(model, run));
}

// the blocks at indexList moved to border borderIndex of the same document
// (border b: before block b; the number of blocks: after the last one), as
// operations applied together on the text they were built on: the runs
// removed, and the blocks inserted next to the nearest block that stays.
// the new order is: the blocks that stay before the border, the moved
// blocks, the blocks that stay after it; a border between two moved blocks
// is therefore a place like any other.
//   -> { operationList, isNoop }; isNoop: the blocks already are there
export function blockListMoveOperationListBuild(model, indexList, borderIndex) {
  const { blockList } = model;
  const indexListMoved = indexListNormalize(model, indexList);
  const indexSetMoved = new Set(indexListMoved);
  const indexListStay = blockList.map((block) => block.index).filter((index) => !indexSetMoved.has(index));
  const indexListBefore = indexListStay.filter((index) => index < borderIndex);
  const indexListAfter = indexListStay.filter((index) => index >= borderIndex);
  const orderNext = [...indexListBefore, ...indexListMoved, ...indexListAfter];
  const isNoop = indexListMoved.length === 0 || indexListStay.length === 0
    || orderNext.every((index, position) => index === position);
  if (isNoop) return { operationList: [], isNoop: true };

  const lineListText = blockListTextGet(model, indexListMoved).split('\n');
  const indexNext = indexListAfter[0];
  // before the first block that stays after the border, one blank line after
  // the moved blocks; else after the last block that stays, one blank line
  // before them. neither point lies inside a removed run.
  const operationInsert = indexNext !== undefined
    ? { action: 'insertLines', lineAt: blockList[indexNext].lineStart, text: [...lineListText, ''].join('\n') }
    : {
        action: 'insertLines',
        lineAt: blockList[indexListBefore[indexListBefore.length - 1]].lineEnd + 1,
        text: ['', ...lineListText].join('\n'),
      };
  return {
    operationList: [...blockListDeleteOperationListBuild(model, indexListMoved), operationInsert],
    isNoop: false,
  };
}

// the indices that name blocks of the model, sorted, without repetition
function indexListNormalize(model, indexList) {
  const blockCount = model.blockList.length;
  return [...new Set(indexList)]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < blockCount)
    .sort((a, b) => a - b);
}

// sorted indices as runs of adjacent blocks: [1, 2, 4] -> [[1, 2], [4]]
function blockRunListGet(indexListSorted) {
  const runList = [];
  for (const index of indexListSorted) {
    const runLast = runList[runList.length - 1];
    if (runLast && runLast[runLast.length - 1] === index - 1) runLast.push(index);
    else runList.push([index]);
  }
  return runList;
}

function blockRunDeleteOperationBuild(model, run) {
  const { blockList, frontmatter } = model;
  const blockFirst = blockList[run[0]];
  const blockLast = blockList[run[run.length - 1]];
  const blockNext = blockList[blockLast.index + 1];
  if (blockNext) {
    return { action: 'deleteLines', lineStart: blockFirst.lineStart, lineEnd: blockNext.lineStart - 1 };
  }
  const lineEndBefore = blockList[blockFirst.index - 1]?.lineEnd ?? frontmatter?.lineEnd ?? 0;
  return { action: 'deleteLines', lineStart: lineEndBefore + 1, lineEnd: blockLast.lineEnd };
}

// ---------- text helpers ----------

function lineCountGet(text) {
  let count = 0;
  for (const character of text) if (character === '\n') count += 1;
  return count;
}

// [{ start, end }] per line of text; end excludes the line break
function lineBoundaryListBuild(text) {
  const result = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') {
      result.push({ start, end: index });
      start = index + 1;
    }
  }
  result.push({ start, end: text.length });
  return result;
}
