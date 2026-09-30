import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkMdx from 'remark-mdx';
import { visit } from 'unist-util-visit';
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
// pruning (doc-source.ts pruneSourceToSidePanel). the document is parsed as
// a syntax tree with the same Markdown extensions and comment-component
// parsing as the runtime compile, and links are classified with the runtime
// rules (doc-link-classify.js):
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

export type DocSourceDependency = {
  target: string;
  kind: 'document' | 'source' | 'asset';
  sourcePath: string; // the containing document, base of relative targets
  construct: string; // what declared it, for diagnostics
};

export type DocSourceDependencyContext = {
  dependencyAdd: (target: string, kind: DocSourceDependency['kind']) => void;
  markdownCollect: (text: string) => void;
  componentCollect: (compName: string, data: Record<string, any>) => void;
  warn: (message: string) => void;
};

export type DocSourceDependencyCollect = (
  data: Record<string, any>,
  context: DocSourceDependencyContext,
) => void;

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

  const dependencyAdd = (targetValue: unknown, kind: DocSourceDependency['kind'], construct: string) => {
    const target = String(targetValue ?? '').trim();
    if (!linkUrlIsLocal(target)) return;
    if (kind === 'document' && target.startsWith('@')) return;
    dependencyList.push({ target, kind, sourcePath, construct });
  };

  const componentCollect = (compName: string, data: Record<string, any>) => {
    if (typeof data.dataRef === 'string') {
      const docPart = data.dataRef.trim().split('#', 1)[0];
      if (docPart) dependencyAdd(docPart, 'document', `dataRef of ${compName}`);
    }
    const collect = collectByCompId[compIdResolve(configDoc, compName)];
    if (!collect) return;
    collect(data, {
      dependencyAdd: (target, kind) => dependencyAdd(target, kind, compName),
      // nested Markdown is compiled without comment components (MdxRenderer)
      markdownCollect: (text) => markdownCollect(text, 'md', false),
      componentCollect,
      warn: (message) => warningList.push(`${sourcePath}: ${compName}: ${message}`),
    });
  };

  const markdownCollect = (text: string, format: 'md' | 'mdx', isCommentComponentEnabled: boolean) => {
    const componentFoundList: { compName: string; props: Record<string, string>; raw: string; lang: string }[] = [];
    const onComponent = isCommentComponentEnabled
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
      markdownCollect(text, 'md', isCommentComponentEnabled);
      return;
    }

    visit(tree, (node: any) => {
      if (node.type === 'link') {
        const isInlineLink = inlineLinkDisplayModeGet(node.title) !== '';
        dependencyAdd(node.url, isInlineLink ? 'source' : 'document', isInlineLink ? `link "${node.title}"` : 'link');
      } else if (node.type === 'image') {
        dependencyAdd(node.url, 'asset', 'image');
      } else if (node.type === 'inlineCode') {
        if (inlineCodeIsDocTarget(node.value)) dependencyAdd(node.value, 'document', 'inline code');
      } else if (node.type === 'text') {
        for (const part of wikiTextSplit(node.value)) {
          if (part.target !== undefined) dependencyAdd(part.target, 'document', 'wiki link');
        }
      } else if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
        if (node.name) mdxElementCollect(node);
      }
    });

    for (const component of componentFoundList) {
      componentCollect(component.compName, { ...component.props, raw: component.raw, lang: component.lang });
    }
  };

  // children of an MDX element are part of the tree and visited as Markdown;
  // only static string attributes reach the extractor.
  const mdxElementCollect = (node: any) => {
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
    componentCollect(node.name, data);
  };

  markdownCollect(frontmatterStrip(sourceText), sourceEntry.ext === 'mdx' ? 'mdx' : 'md', true);
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
