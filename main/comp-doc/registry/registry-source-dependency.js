import { blockQADataParse } from '../../../built-in/comp-mdx/block/block-qa/BlockQAData.js';
import { indexDataParse } from '../../../built-in/comp-mdx/index/IndexData.js';
import { switchViewDependenciesCollect } from '../../../built-in/comp-mdx/switch-view/SwitchViewData.js';
import { diagramDependenciesCollect } from '../../../built-in/comp-mdx/diagram/diagram-er/DiagramERSource.js';
import { testCaseDependenciesCollect } from '../../../built-in/comp-mdx/test-case-table/TestCaseTableData.js';

// Build-time dependency extractors, keyed by component id (the values of
// config.yaml compRegistry). The doc-source plugin calls them while it prunes
// the source manifest (pruneSourceToSidePanel), so a file a component reads
// from its authored data stays in a deployed build without being listed again
// in side-panel YAML.
//
// this module is imported by the Vite plugin, so it must stay free of React
// components and browser APIs.
//
// an extractor receives the component data as the component sees it
// ({ ...authored props, raw, lang } for a comment-marked block) and a context:
//   context.dependencyAdd(target, kind)  kind: 'document' | 'source' | 'asset'
//     document  resolved like a document link (name, relative, suffix, exact)
//     source    exact internal path, as SourceLink and inline-link resolve it
//     asset     resolved like a document link; a miss is not reported
//   context.markdownCollect(text)        nested Markdown the component renders
//   context.componentCollect(compName, data)  a nested registered component
//   context.warn(message)
//
// a dataRef property is handled for every component by the collector itself.
// consumers add extractors for their own component ids through the plugin
// option sourceDependencyCollectByCompId.

function markdownRawCollect(data, context) {
  context.markdownCollect(String(data.raw ?? ''));
}

function sourceLinkCollect(data, context) {
  const target = String(data.target ?? '').trim()
    || String(data.raw ?? '').trim().split(/\r?\n/, 1)[0].trim();
  if (target) context.dependencyAdd(target, 'source');
}

function indexCollect(data, context) {
  let dataIndex;
  try {
    dataIndex = indexDataParse(data);
  } catch (error) {
    context.warn(`Index data is invalid, its targets are not discovered: ${String(error?.message ?? error)}`);
    return;
  }
  for (const subtopic of dataIndex.subtopics ?? []) {
    for (const item of subtopic.items ?? []) {
      context.dependencyAdd(item.target, item.kind === 'inline-link' ? 'source' : 'document');
    }
    if (subtopic.component) {
      context.componentCollect(subtopic.component.name, subtopic.component.data ?? {});
    }
  }
}

// the questions and answers written as Markdown
function blockQACollect(data, context) {
  let dataQA;
  try {
    dataQA = blockQADataParse(data);
  } catch (error) {
    context.warn(`BlockQA data is invalid, its links are not discovered: ${String(error?.message ?? error)}`);
    return;
  }
  for (const item of dataQA.items) {
    for (const content of [item.question, item.answer]) {
      if (content.type === 'markdown') context.markdownCollect(content.content);
    }
  }
}

export const sourceDependencyCollectByCompId = {
  'common/Block': markdownRawCollect,
  'common/BlockSimple': markdownRawCollect,
  'common/BlockMdx': markdownRawCollect,
  'common/MultiLang': markdownRawCollect,
  'common/DocMultiLang': markdownRawCollect,
  'common/Index': indexCollect,
  'common/DocIndex': indexCollect,
  'common/BlockQA': blockQACollect,
  // every view, including those not shown, through the collector of its component
  'common/SwitchView': switchViewDependenciesCollect,
  // the registered components drawing nodes and connections of a diagram;
  // the Power Platform design diagrams are DiagramER with another starter
  'common/DiagramER': diagramDependenciesCollect,
  'common/DiagramPowerAutomate': diagramDependenciesCollect,
  'common/DiagramBusinessRule': diagramDependenciesCollect,
  // the evidence documents of every recorded result, and its custom cells
  'common/TestCaseTable': testCaseDependenciesCollect,
  'specific/SourceLink': sourceLinkCollect,
};
