import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkMdx from 'remark-mdx';
import { compIdResolve } from '../../comp-doc/registry/comp-registry.js';
import { sourceDependencyCollectByCompId as collectByCompIdDefault } from '../../comp-doc/registry/registry-source-dependency.js';
import {
  inlineCodeIsDocTarget,
  inlineLinkDisplayModeGet,
  linkUrlIsLocal,
  wikiTextSplit,
} from '../src/lib/doc-link-classify.js';
import { remarkCommentComp } from '../src/lib/remark-comment-comp.js';

// statically authored local file references of one document, for source
// pruning (doc-source.ts pruneSourceToSidePanel) and for the link index of
// the workspace (doc-link-index.ts, doc_page_impl_nav_backlink.md). the
// document is parsed as a syntax tree with the same Markdown extensions and
// comment-component parsing as the runtime compile, and links are classified
// with the runtime rules (doc-link-classify.js):
//
//   [label](a.md)                        document
//   [label](/x/run.ps1 "inline-link")    source (also :source / :render)
//   ![alt](a.png)                        asset
//   `a.md`, [[a.md]]                     document
//   <!--renderComp=X--> + block          extractor of X's component id
//   <X attr="..." /> in .mdx             extractor of X's component id
//   dataRef="a.md#id" on any component   document
//
// external urls and fragment-only links are skipped by the classification.
// targets starting with "@" name side-panel items, which are retained as
// navigation roots anyway.
//
// every reference also says where it is written, for a list that points
// back at it (the backlinks of a document): its line, the root-level block
// holding it, the headings above it, and the text around it.

export type DocSourceDependencyContext = { before: string; label: string; after: string };

export type DocSourceDependency = {
  target: string;
  kind: 'document' | 'source' | 'asset';
  sourcePath: string; // the containing document, base of relative targets
  construct: string; // what declared it, for diagnostics and for a reader (link, image, Index, ...)
  // the line of the reference itself, counted without the frontmatter, when
  // it is written in the document's own Markdown; absent when it is written
  // in the data of a component (the data has lines of its own)
  sourceLine?: number;
  // the line of the root-level block holding it; for a component block the
  // line of its marker comment, the block identity of the page
  // (doc_page_impl_popup.md#block-identity)
  blockLine: number;
  // the titles of the headings above it, the outermost first
  headingTrail: string[];
  // the text around the reference and the reference's own text (the label
  // of a link, the alt of an image, the code of an inline target); absent
  // for a reference read from component data
  context?: DocSourceDependencyContext;
};

export type DocSourceDependencyCollectContext = {
  dependencyAdd: (target: string, kind: DocSourceDependency['kind']) => void;
  markdownCollect: (text: string) => void;
  componentCollect: (compName: string, data: Record<string, any>) => void;
  warn: (message: string) => void;
};

export type DocSourceDependencyCollect = (
  data: Record<string, any>,
  context: DocSourceDependencyCollectContext,
) => void;

// where a reference is written
type DependencyPlace = {
  sourceLine?: number;
  blockLine: number;
  headingTrail: string[];
  context?: DocSourceDependencyContext;
};

// the block a component's data belongs to
type BlockPlace = { blockLine: number; headingTrail: string[] };

const CONTEXT_BEFORE_MAX = 48;
const CONTEXT_AFTER_MAX = 72;

export function docSourceDependenciesCollect(
  sourceText: string,
  sourceEntry: { internalPath: string; ext: string },
  configDoc: any,
  collectByCompIdExtra: Record<string, DocSourceDependencyCollect> = {},
): { dependencyList: DocSourceDependency[]; warningList: string[] } {
  const sourcePath = sourceEntry.internalPath;
  const collectByCompId = { ...collectByCompIdDefault, ...collectByCompIdExtra };
  const dependencyList: DocSourceDependency[] = [];
  const warningList: string[] = [];

  const dependencyAdd = (targetValue: unknown, kind: DocSourceDependency['kind'], construct: string, place: DependencyPlace) => {
    const target = String(targetValue ?? '').trim();
    if (!linkUrlIsLocal(target)) return;
    if (kind === 'document' && target.startsWith('@')) return;
    const dependency: DocSourceDependency = {
      target,
      kind,
      sourcePath,
      construct,
      blockLine: place.blockLine,
      headingTrail: place.headingTrail,
    };
    if (place.sourceLine !== undefined) dependency.sourceLine = place.sourceLine;
    if (place.context) dependency.context = place.context;
    dependencyList.push(dependency);
  };

  // the references of a component's data are written at the component's
  // block: no line of their own, the component's name as their construct
  const componentCollect = (compName: string, data: Record<string, any>, block: BlockPlace) => {
    if (typeof data.dataRef === 'string') {
      const docPart = data.dataRef.trim().split('#', 1)[0];
      if (docPart) dependencyAdd(docPart, 'document', `dataRef of ${compName}`, block);
    }
    const collect = collectByCompId[compIdResolve(configDoc, compName)];
    if (!collect) return;
    collect(data, {
      dependencyAdd: (target, kind) => dependencyAdd(target, kind, compName, block),
      // nested Markdown is compiled without comment components (MdxRenderer)
      markdownCollect: (text) => markdownCollect(text, 'md', { block, construct: compName }),
      componentCollect: (compNameNested, dataNested) => componentCollect(compNameNested, dataNested, block),
      warn: (message) => warningList.push(`${sourcePath}: ${compName}: ${message}`),
    });
  };

  // options.block: the Markdown is the data of a component at that block
  // (nested): every reference found is written there, without a line of its
  // own. without it the text is the document itself: lines, headings and
  // the text around each reference are read from the tree.
  const markdownCollect = (text: string, format: 'md' | 'mdx', options: { block?: BlockPlace; construct?: string } = {}) => {
    const isTopLevel = options.block === undefined;
    const componentFoundList: { compName: string; props: Record<string, string>; raw: string; lang: string; sourceLine?: number }[] = [];
    const onComponent = isTopLevel
      ? (component: any) => componentFoundList.push(component)
      : undefined;
    let tree: any;
    try {
      tree = markdownTreeGet(text, format, onComponent);
    } catch (error) {
      if (format !== 'mdx') throw error;
      warningList.push(
        `${sourcePath}: MDX parsing failed (${error instanceof Error ? error.message : String(error)});`
        + ' dependencies were collected from a plain Markdown parse instead.',
      );
      markdownCollect(text, 'md', options);
      return;
    }

    const headingList = isTopLevel ? headingListCollect(tree) : [];
    // what declared a reference: the construct in the document's own
    // Markdown; the component whose data it is written in, nested
    const constructGet = (construct: string) => (isTopLevel ? construct : options.construct ?? construct);
    // where a node of this tree is written
    const placeGet = (node: any, ancestorList: any[], label: string): DependencyPlace => {
      const context = contextGet(node, ancestorList, label);
      if (!isTopLevel) return { ...options.block!, context };
      const line = node.position?.start?.line;
      const blockRoot = ancestorList[1] ?? node;
      return {
        sourceLine: line,
        blockLine: blockRoot.position?.start?.line ?? line ?? 0,
        headingTrail: headingTrailGet(headingList, line),
        context,
      };
    };
    const blockGet = (node: any, ancestorList: any[]): BlockPlace => {
      if (!isTopLevel) return options.block!;
      const blockRoot = ancestorList[1] ?? node;
      const line = blockRoot.position?.start?.line ?? 0;
      return { blockLine: line, headingTrail: headingTrailGet(headingList, line) };
    };

    treeWalk(tree, [], (node, ancestorList) => {
      if (node.type === 'link') {
        const isInlineLink = inlineLinkDisplayModeGet(node.title) !== '';
        dependencyAdd(
          node.url,
          isInlineLink ? 'source' : 'document',
          constructGet(isInlineLink ? `link "${node.title}"` : 'link'),
          placeGet(node, ancestorList, nodeTextGet(node)),
        );
      } else if (node.type === 'image') {
        dependencyAdd(node.url, 'asset', constructGet('image'), placeGet(node, ancestorList, String(node.alt ?? '') || String(node.url ?? '')));
      } else if (node.type === 'inlineCode') {
        if (inlineCodeIsDocTarget(node.value)) {
          dependencyAdd(node.value, 'document', constructGet('inline code'), placeGet(node, ancestorList, String(node.value)));
        }
      } else if (node.type === 'text') {
        for (const part of wikiTextSplit(node.value)) {
          if (part.target !== undefined) {
            dependencyAdd(part.target, 'document', constructGet('wiki link'), placeGet(node, ancestorList, `[[${part.target}]]`));
          }
        }
      } else if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
        if (node.name) mdxElementCollect(node, blockGet(node, ancestorList));
      }
    });

    for (const component of componentFoundList) {
      const line = component.sourceLine ?? 0;
      componentCollect(
        component.compName,
        { ...component.props, raw: component.raw, lang: component.lang },
        { blockLine: line, headingTrail: headingTrailGet(headingList, line) },
      );
    }
  };

  // children of an MDX element are part of the tree and visited as Markdown;
  // only static string attributes reach the extractor.
  const mdxElementCollect = (node: any, block: BlockPlace) => {
    const data: Record<string, any> = {};
    const attributeDynamicList: string[] = [];
    for (const attribute of node.attributes ?? []) {
      if (attribute.type !== 'mdxJsxAttribute') continue;
      if (typeof attribute.value === 'string') data[attribute.name] = attribute.value;
      else if (attribute.value !== null && attribute.value !== undefined) attributeDynamicList.push(attribute.name);
    }
    const isCollected = Boolean(collectByCompId[compIdResolve(configDoc, node.name)])
      || attributeDynamicList.includes('dataRef');
    if (isCollected && attributeDynamicList.length > 0) {
      warningList.push(
        `${sourcePath}: <${node.name}> attribute ${attributeDynamicList.join(', ')} is an expression;`
        + ' files it refers to are not discovered. Use a static string attribute, or list the file'
        + ' in another retained document.',
      );
    }
    componentCollect(node.name, data, block);
  };

  markdownCollect(frontmatterStrip(sourceText), sourceEntry.ext === 'mdx' ? 'mdx' : 'md');
  return { dependencyList, warningList };
}

// onComponent undefined: comment markers stay plain html, the marked block
// stays a code block, as in a compile without comment components.
function markdownTreeGet(text: string, format: 'md' | 'mdx', onComponent?: (component: any) => void): any {
  const processor = remark().use(remarkGfm).use(remarkMath);
  if (format === 'mdx') processor.use(remarkMdx);
  // isSearchIndex: marked blocks are dropped from the tree, so their raw
  // text is only read by the component extractor, as at runtime.
  if (onComponent) processor.use(remarkCommentComp, { isSearchIndex: true, onComponent });
  return processor.runSync(processor.parse(text), text);
}

function frontmatterStrip(text: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(text);
  return match ? text.slice(match[0].length) : text;
}

// every node in document order, with its ancestors (the root first)
function treeWalk(node: any, ancestorList: any[], visitor: (node: any, ancestorList: any[]) => void) {
  visitor(node, ancestorList);
  if (!Array.isArray(node.children)) return;
  const ancestorListNext = [...ancestorList, node];
  for (const child of node.children) treeWalk(child, ancestorListNext, visitor);
}

// ---------- where a reference is written ----------

type HeadingPlace = { line: number; depth: number; text: string };

// the root-level headings, in order
function headingListCollect(tree: any): HeadingPlace[] {
  const headingList: HeadingPlace[] = [];
  for (const node of tree.children ?? []) {
    if (node.type !== 'heading') continue;
    const line = node.position?.start?.line;
    if (line === undefined) continue;
    headingList.push({ line, depth: Number(node.depth) || 1, text: nodeTextGet(node) });
  }
  return headingList;
}

// the titles of the headings a line is under, the outermost first: the
// nearest heading before it, the nearest shallower one before that, and so
// on. a heading is under itself.
export function headingTrailGet(headingList: HeadingPlace[], line: number | undefined): string[] {
  if (line === undefined) return [];
  const trail: HeadingPlace[] = [];
  for (const heading of headingList) {
    if (heading.line > line) break;
    while (trail.length > 0 && trail[trail.length - 1].depth >= heading.depth) trail.pop();
    trail.push(heading);
  }
  return trail.map((heading) => heading.text);
}

// the plain text of a node: its text and inline code, the alt of an image,
// a line break as a space; html (a comment) is nothing
export function nodeTextGet(node: any): string {
  if (!node) return '';
  if (node.type === 'text' || node.type === 'inlineCode') return String(node.value ?? '');
  if (node.type === 'image') return String(node.alt ?? '');
  if (node.type === 'break') return ' ';
  if (node.type === 'html' || node.type === 'mdxFlowExpression' || node.type === 'mdxTextExpression') return '';
  if (node.type === 'code') return String(node.value ?? '');
  if (Array.isArray(node.children)) return node.children.map(nodeTextGet).join('');
  return '';
}

// the text around a reference: the text of the paragraph (heading, cell,
// list item) it is in, with the reference's own text as the label and the
// rest clipped around it
function contextGet(nodeTarget: any, ancestorList: any[], label: string): DocSourceDependencyContext {
  const container = [...ancestorList].reverse().find((ancestor) => CONTAINER_TYPE_SET.has(ancestor.type))
    ?? ancestorList[ancestorList.length - 1];
  if (!container) return { before: '', label, after: '' };
  const flat = { text: '', start: -1 };
  textFlatten(container, nodeTarget, label, flat);
  if (flat.start < 0) return { before: '', label, after: '' };
  return {
    before: textClipStart(flat.text.slice(0, flat.start), CONTEXT_BEFORE_MAX),
    label,
    after: textClipEnd(flat.text.slice(flat.start + label.length), CONTEXT_AFTER_MAX),
  };
}

const CONTAINER_TYPE_SET = new Set(['paragraph', 'heading', 'tableCell', 'listItem']);

// the text of a node with the target node written as its label and its
// position recorded
function textFlatten(node: any, nodeTarget: any, label: string, flat: { text: string; start: number }) {
  if (node === nodeTarget) {
    if (nodeTarget.type === 'text') {
      // a wiki link is a part of its text node
      const value = String(node.value ?? '');
      const indexLabel = value.indexOf(label);
      if (indexLabel >= 0) {
        flat.start = flat.text.length + indexLabel;
        flat.text += value;
      } else {
        flat.start = flat.text.length;
        flat.text += label;
      }
      return;
    }
    flat.start = flat.text.length;
    flat.text += label;
    return;
  }
  if (Array.isArray(node.children) && node.type !== 'link' && node.type !== 'image') {
    for (const child of node.children) textFlatten(child, nodeTarget, label, flat);
    return;
  }
  flat.text += nodeTextGet(node);
}

function textWhitespaceCollapse(text: string): string {
  return text.replace(/\s+/g, ' ');
}

// the end of a text, up to max characters, cut at a word
function textClipStart(text: string, max: number): string {
  const value = textWhitespaceCollapse(text);
  if (value.length <= max) return value;
  const clipped = value.slice(value.length - max);
  const indexSpace = clipped.indexOf(' ');
  return `…${indexSpace >= 0 && indexSpace < max / 2 ? clipped.slice(indexSpace + 1) : clipped}`;
}

// the start of a text, up to max characters, cut at a word
function textClipEnd(text: string, max: number): string {
  const value = textWhitespaceCollapse(text);
  if (value.length <= max) return value;
  const clipped = value.slice(0, max);
  const indexSpace = clipped.lastIndexOf(' ');
  return `${indexSpace > max / 2 ? clipped.slice(0, indexSpace) : clipped}…`;
}
