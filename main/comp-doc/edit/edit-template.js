import {
  CodeIcon,
  HeadingIcon,
  ListIcon,
  MessageSquareDashed,
  Pilcrow,
  Quote,
  TableIcon,
} from '../../frontend/UICommon.js';
import { compDefinitionNormalize, compIdBuiltinByName } from '../registry/comp-registry.js';
import { compDefinitionGet } from '../registry/comp-definition.js';
import { serviceDashboardCompIdBuild } from '../service/service-dashboard-define.js';
import { compIconGet, compMetaGet, compSourceDefaultGet } from '../registry/comp-expose.js';
import { componentTemplateTextBuild } from '../../frontend/src/lib/doc-edit-block.js';
import { rankIsValid, rankOrderCompare } from '../../frontend/src/lib/doc-rank.js';

// The starting texts the insert menu offers for a new block of one document:
// the basic markdown blocks (group 'text'), then one entry per registered
// component whose factory (compDefine expose.sourceDefaultCreate) creates a
// block for this document (group 'component'), under the tag name authors
// use for it, with its label, description and icon (the default icon when it
// exposes none). Components that mark themselves isInsertCommon are listed
// in the menu directly; every entry is found by the menu's search. The
// chosen text is written to the document as the new block and opened in
// edit mode right away.
//
// Every entry is named by an id {group}:{name} (text:paragraph,
// component:Image, service:{component id}) and may have a rank
// (doc_page_impl_edit.md#the-order-of-the-insert-menu): the config key
// EditInsertRankByEntry of the document maps entry ids to ranks (doc-rank.js),
// the basic blocks ranked by the package (config.yaml configDefault). Within
// each group the ranked entries come first, in the order of their ranks, then
// the others in the group's own order (the text blocks as listed below, the
// components by tag name, the dashboards as the backend lists them); the
// search of the menu keeps ranked matches before unranked ones the same way.
//
// DO NOT CHANGE THE COMMENT STYLE. the comment block is `<!-- ... -->` and a
// component block is `<!--renderComp=Xxx-->` with its fenced block, in every
// document, .md and .mdx alike. this is the authoring form of the project
// (doc_page_impl.md#graceful-degradation-stipulation), it compiles and has
// been used on every machine the project runs on. never switch either one
// to `{/* ... */}` or any other comment syntax, never choose the form by the
// document format, and do not "fix" it because a tool or a reading of the
// MDX specification suggests that html comments are not MDX.
const templateTextList = [
  { id: 'text:paragraph', label: 'Paragraph', icon: Pilcrow, text: 'New paragraph.' },
  { id: 'text:heading', label: 'Heading', icon: HeadingIcon, text: '## New heading' },
  { id: 'text:list', label: 'List', icon: ListIcon, text: '- first item\n- second item' },
  { id: 'text:quote', label: 'Quote', icon: Quote, text: '> A quote.' },
  { id: 'text:code', label: 'Code', icon: CodeIcon, text: '```\ncode\n```' },
  { id: 'text:table', label: 'Table', icon: TableIcon, text: '| Column | Column |\n| --- | --- |\n| cell | cell |' },
  { id: 'text:comment', label: 'Comment', icon: MessageSquareDashed, text: '<!-- note to the authors -->' },
];

// A component declared isNotInDoc is never offered. One declared isAssetOnly
// is offered with isAssetOnly and its starting data (assetSource: { lang,
// raw, props }): choosing it creates an asset item with that data first
// and writes a reference block to it (DocEditStore blockCreateAsAsset); its
// text is the block as the data would be written inline, for the search.
//
// The dashboards of the service templates the backend knows are offered too
// (group 'service', doc_page_impl_service_dashboard.md#creating-a-dashboard):
// one entry per dashboard, under its component id service/{templateName}/{dashboardId}.
// They are asset-only like any such component; the instance is chosen in
// the dashboard once it is placed.
//
// env: { configDoc, compById, docPath, docFormat: 'md' | 'mdx', compConfigGet(compId),
//        serviceDashboardList: [{ templateName, label, dashboardId, dashboardLabel, description }],
//        rankByEntry: { [entry id]: rank } (the config key EditInsertRankByEntry) }
// -> [{ id, compName, label, description, text, icon, group: 'text' | 'component' | 'service', isCommon,
//       rank ('' when unranked), isAssetOnly, assetSource?, objectPick?, textForObjectGet?,
//       source?, isFlowCanvas?, slashNameList? }]
//   source: a component's start in the comment-block form ({ lang, raw, props }), for a place that
//   holds a block's data without writing its text (a card of a card diagram holding a component:
//   package/cloud-dev-vis/doc/card-diagram-impl.md#a-component-in-a-card); isFlowCanvas: it draws a
//   canvas of React Flow itself (a card holds it as a tile, drawn in a dialog); slashNameList: the words typed for it after "/" (meta.slashName, meta.slashAliasList)
//
// A component declaring meta.insertObjectPick ({ typeList, isCreateOffered })
// names an object of the object registry in its block: its entry carries the
// pick (objectPick), the menu asks for the object first (a search limited to
// those types) and writes textForObjectGet(ref), its factory called with
// env.objectRef (doc_page_impl_edit.md#creating-a-block-naming-an-object).
export function editTemplateListBuild({ configDoc, compById, docPath, docFormat, compConfigGet, serviceDashboardList = [], rankByEntry = {} }) {
  const templateListText = templateTextList.map((template) => ({
    id: template.id,
    compName: '',
    label: template.label,
    description: '',
    text: template.text,
    icon: template.icon,
    group: 'text',
    isCommon: true,
    isAssetOnly: false,
  }));

  const compIdByTag = { ...compIdBuiltinByName, ...(configDoc?.compRegistry ?? {}) };
  const templateListComponent = [];
  // compatibility tags map to the same component: one entry per component,
  // under the first tag that names it
  const compIdDoneSet = new Set();
  for (const [compName, compId] of Object.entries(compIdByTag)) {
    if (compIdDoneSet.has(compId)) continue;
    const definition = compDefinitionNormalize(compDefinitionGet(compById, compId));
    if (!definition) continue;
    const meta = compMetaGet(definition);
    if (meta.isNotInDoc) continue;
    const source = sourceDefaultSafeGet(definition, {
      compName,
      docPath,
      docFormat,
      compConfig: compConfigGet(compId),
    });
    if (!source) continue;
    compIdDoneSet.add(compId);
    templateListComponent.push({
      id: `component:${compName}`,
      compName,
      label: meta.label ?? compName,
      description: meta.description ?? '',
      text: source.text ?? componentTemplateTextBuild(compName, source),
      icon: compIconGet(definition),
      group: 'component',
      isCommon: meta.isInsertCommon,
      isAssetOnly: meta.isAssetOnly,
      ...(meta.isAssetOnly ? { assetSource: source } : {}),
      ...(source.text === undefined ? { source } : {}),
      isFlowCanvas: meta.isFlowCanvas,
      slashNameList: meta.slashName ? [meta.slashName, ...meta.slashAliasList] : [],
      ...(meta.insertObjectPick ? {
        objectPick: meta.insertObjectPick,
        textForObjectGet: (objectRef) => {
          const sourceForObject = sourceDefaultSafeGet(definition, { compName, docPath, docFormat, compConfig: compConfigGet(compId), objectRef });
          return sourceForObject ? sourceForObject.text ?? componentTemplateTextBuild(compName, sourceForObject) : '';
        },
      } : {}),
    });
  }
  templateListComponent.sort((a, b) => a.compName.localeCompare(b.compName));

  const templateListService = [];
  for (const dashboard of serviceDashboardList) {
    const compName = serviceDashboardCompIdBuild(dashboard.templateName, dashboard.dashboardId);
    const definition = compDefinitionNormalize(compDefinitionGet(compById, compName));
    if (!definition) continue;
    const source = sourceDefaultSafeGet(definition, { compName, docPath, docFormat, compConfig: {} });
    if (!source) continue;
    templateListService.push({
      id: `service:${compName}`,
      compName,
      label: `${dashboard.label} · ${dashboard.dashboardLabel}`,
      description: dashboard.description,
      text: componentTemplateTextBuild(compName, source),
      icon: compIconGet(definition),
      group: 'service',
      isCommon: true,
      isAssetOnly: true,
      assetSource: source,
    });
  }
  return [templateListText, templateListComponent, templateListService]
    .flatMap((templateList) => templateListRankOrder(templateList, rankByEntry));
}

// the entries of one group with their ranks, the ranked first in the order
// of their ranks, the others in the order given (the sort is stable)
function templateListRankOrder(templateList, rankByEntry) {
  return templateList
    .map((template) => {
      const rank = rankByEntry?.[template.id];
      return { ...template, rank: rankIsValid(rank) ? rank : '' };
    })
    .sort((a, b) => rankOrderCompare(a.rank, b.rank));
}

// the entries of the menu matching a query (DocEditInsertMenu),
// case-insensitive: the ranked ones first, in the order of their ranks (the
// basic blocks, so that "list" offers List before ListHierarchy), then the
// others by where they match: the name (tag name of a component or a
// dashboard, label of a text block) first, then the label of a component,
// then the description
// -> [{ template, name, label, description, matchOrder, queryLower }]
export function editTemplateSearch(templateList, query) {
  const queryLower = query.trim().toLowerCase();
  if (queryLower === '') return [];
  const resultList = [];
  for (const template of templateList) {
    const name = template.group === 'text' ? template.label : template.compName;
    const label = template.group !== 'text' && template.label !== template.compName ? template.label : '';
    let matchOrder;
    if (name.toLowerCase().includes(queryLower)) matchOrder = 0;
    else if (label.toLowerCase().includes(queryLower)) matchOrder = 1;
    else if (template.description.toLowerCase().includes(queryLower)) matchOrder = 2;
    else continue;
    resultList.push({ template, name, label, description: template.description, matchOrder, queryLower });
  }
  resultList.sort((a, b) => rankOrderCompare(a.template.rank, b.template.rank)
    || a.matchOrder - b.matchOrder
    || a.name.localeCompare(b.name));
  return resultList;
}

// a factory that throws or returns a wrong shape is a fault of that one
// component; the menu lists the others
function sourceDefaultSafeGet(definition, env) {
  try {
    return compSourceDefaultGet(definition, env);
  } catch (error) {
    console.error(error);
    return undefined;
  }
}
