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

// env: { configDoc, compById, docPath, docFormat: 'md' | 'mdx', compConfigGet(compId) }
// -> [{ id, compName, label, description, text, icon, group: 'text' | 'component', isCommon }]
export function editTemplateListBuild({ configDoc, compById, docPath, docFormat, compConfigGet }) {
  const templateListText = templateTextList.map((template) => ({
    id: template.id,
    compName: '',
    label: template.label,
    description: '',
    text: template.text,
    icon: template.icon,
    group: 'text',
    isCommon: true,
  }));

  const compIdByTag = { ...compIdBuiltinByName, ...(configDoc?.compRegistry ?? {}) };
  const templateListComponent = [];
  // compatibility tags map to the same component: one entry per component,
  // under the first tag that names it
  const compIdDoneSet = new Set();
  for (const [compName, compId] of Object.entries(compIdByTag)) {
    if (compIdDoneSet.has(compId)) continue;
    const definition = compDefinitionNormalize(compById[compId]);
    if (!definition) continue;
    const source = sourceDefaultSafeGet(definition, {
      compName,
      docPath,
      docFormat,
      compConfig: compConfigGet(compId),
    });
    if (!source) continue;
    compIdDoneSet.add(compId);
    const meta = compMetaGet(definition);
    templateListComponent.push({
      id: `component:${compName}`,
      compName,
      label: meta.label ?? compName,
      description: meta.description ?? '',
      text: source.text ?? componentTemplateTextBuild(compName, source),
      icon: compIconGet(definition),
      group: 'component',
      isCommon: meta.isInsertCommon,
    });
  }
  templateListComponent.sort((a, b) => a.compName.localeCompare(b.compName));
  return [...templateListText, ...templateListComponent];
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
