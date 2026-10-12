import { compDefinitionNormalize, compIdBuiltinByName } from '../registry/comp-registry.js';
import { compExposeGet } from '../registry/comp-expose.js';
import { componentTemplateTextBuild } from '../../frontend/src/lib/doc-edit-block.js';

// The starting texts the insert menu offers for a new block: the basic
// markdown blocks (group 'text'), then one template per registered component
// that exposes editTemplate (compDefine expose.editTemplate, group
// 'component'), under the tag name authors use for it and with the icon the
// component exposes (expose.icon), when it does. The chosen text is written
// to the document as the new block and opened in edit mode right away.
const templateTextList = [
  { id: 'paragraph', label: 'Paragraph', text: 'New paragraph.' },
  { id: 'heading', label: 'Heading', text: '## New heading' },
  { id: 'list', label: 'List', text: '- first item\n- second item' },
  { id: 'quote', label: 'Quote', text: '> A quote.' },
  { id: 'code', label: 'Code', text: '```\ncode\n```' },
  { id: 'table', label: 'Table', text: '| Column | Column |\n| --- | --- |\n| cell | cell |' },
  { id: 'comment', label: 'Comment', text: '<!-- note to the authors -->' },
];

// [{ id, label, text, icon?, group: 'text' | 'component' }]
export function editTemplateListBuild(configDoc, compById) {
  const compIdByTag = { ...compIdBuiltinByName, ...(configDoc?.compRegistry ?? {}) };
  const templateComponentList = [];
  // compatibility tags map to the same component: one template per component
  const compIdDoneSet = new Set();
  for (const [tag, compId] of Object.entries(compIdByTag)) {
    const definition = compDefinitionNormalize(compById[compId]);
    const editTemplate = compExposeGet(definition, 'editTemplate');
    if (!editTemplate || compIdDoneSet.has(compId)) continue;
    compIdDoneSet.add(compId);
    templateComponentList.push({
      id: `component:${tag}`,
      label: tag,
      text: componentTemplateTextBuild(tag, editTemplate),
      icon: compExposeGet(definition, 'icon'),
      group: 'component',
    });
  }
  templateComponentList.sort((a, b) => a.label.localeCompare(b.label));
  return [
    ...templateTextList.map((template) => ({ ...template, group: 'text' })),
    ...templateComponentList,
  ];
}
