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
// DO NOT CHANGE THE COMMENT STYLE. the comment block is `<!-- ... -->` and a
// component block is `<!--renderComp=Xxx-->` with its fenced block, in every
// document, .md and .mdx alike. this is the authoring form of the project
// (doc_page_impl.md#graceful-degradation-stipulation), it compiles and has
// been used on every machine the project runs on. never switch either one
// to `{/* ... */}` or any other comment syntax, never choose the form by the
// document format, and do not "fix" it because a tool or a reading of the
// MDX specification suggests that html comments are not MDX.
const templateTextList = [
  { id: 'paragraph', label: 'Paragraph', icon: Pilcrow, text: 'New paragraph.' },
  { id: 'heading', label: 'Heading', icon: HeadingIcon, text: '## New heading' },
  { id: 'list', label: 'List', icon: ListIcon, text: '- first item\n- second item' },
  { id: 'quote', label: 'Quote', icon: Quote, text: '> A quote.' },
  { id: 'code', label: 'Code', icon: CodeIcon, text: '```\ncode\n```' },
  { id: 'table', label: 'Table', icon: TableIcon, text: '| Column | Column |\n| --- | --- |\n| cell | cell |' },
  { id: 'comment', label: 'Comment', icon: MessageSquareDashed, text: '<!-- note to the authors -->' },
];

// A component declared isNotInDoc is never offered. One declared isAssetOnly
// is offered with isAssetOnly and its starting data (assetSource: { lang,
// raw, props }): choosing it creates an asset object with that data first
// and writes a reference block to it (DocEditStore blockCreateAsAsset); its
// text is the block as the data would be written inline, for the search.
//
// The dashboards of the service types the backend knows are offered too
// (group 'service', doc_page_impl_service_instance.md#creating-a-dashboard):
// one entry per dashboard, under its component id service/{typeId}/{dashboardId}.
// They are asset-only like any such component; the instance is chosen in
// the dashboard once it is placed.
//
// env: { configDoc, compById, docPath, docFormat: 'md' | 'mdx', compConfigGet(compId),
//        serviceDashboardList: [{ typeId, typeLabel, dashboardId, dashboardLabel, description }] }
// -> [{ id, compName, label, description, text, icon, group: 'text' | 'component' | 'service', isCommon,
//       isAssetOnly, assetSource? }]
export function editTemplateListBuild({ configDoc, compById, docPath, docFormat, compConfigGet, serviceDashboardList = [] }) {
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
    });
  }
  templateListComponent.sort((a, b) => a.compName.localeCompare(b.compName));

  const templateListService = [];
  for (const dashboard of serviceDashboardList) {
    const compName = serviceDashboardCompIdBuild(dashboard.typeId, dashboard.dashboardId);
    const definition = compDefinitionNormalize(compDefinitionGet(compById, compName));
    if (!definition) continue;
    const source = sourceDefaultSafeGet(definition, { compName, docPath, docFormat, compConfig: {} });
    if (!source) continue;
    templateListService.push({
      id: `service:${compName}`,
      compName,
      label: `${dashboard.typeLabel} · ${dashboard.dashboardLabel}`,
      description: dashboard.description,
      text: componentTemplateTextBuild(compName, source),
      icon: compIconGet(definition),
      group: 'service',
      isCommon: true,
      isAssetOnly: true,
      assetSource: source,
    });
  }
  return [...templateListText, ...templateListComponent, ...templateListService];
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
