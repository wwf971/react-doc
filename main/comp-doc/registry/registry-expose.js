import {
  ChevronsDownUp,
  FoldersIcon,
  FolderTreeIcon,
  Hash,
  Languages,
  LayoutList,
  LinkIcon,
  ListOrdered,
  ListTree,
  MessageSquare,
  PanelTop,
  ScrollText,
  SlidersHorizontal,
  SquareCode,
  TagIcon,
  TagsIcon,
  TextQuote,
  Waypoints,
  Workflow,
} from '../../frontend/UICommon.js';

// What the components registered in registry.js expose about themselves
// (compDefine expose, doc_page_impl_mdx_comp.md#what-a-component-exposes),
// for those whose exposure is not kept beside the component (Image,
// ImageGrid, StockTable keep theirs in their folders). Each one names
// itself for the insert menu and its search, draws an icon, and creates
// the source of a new block for the document it goes to
// (sourceDefaultCreate(env), env = { compName, docPath, docFormat, compConfig }).
//
// a component of the package starts in the comment-block form, which every
// document accepts, md and mdx alike: <!--renderComp=Xxx--> and its fenced
// block. DO NOT CHANGE THIS: never write the marker as `{/* ... */}` or in
// any other comment syntax, and never return a different form for an .mdx
// document. the html comment marker is the authoring form of the project
// and works in both formats (see edit-template.js).
//
// the components a document only writes inside another one (Tab, Step,
// Accordion, File, Folder), that are markers of the next node (Anchor),
// inline (Tag, DocLinkInline) or not document content (SidePanelItem,
// TagLabel, the editors of the edit layer) start no block and expose no
// factory.

// a component the fumadocs theme provides is an MDX element only, with no
// comment-block form: an .md document has no block of it
function mdxOnlySourceCreate(textBuild) {
  return ({ compName, docFormat }) => (docFormat === 'mdx' ? { text: textBuild(compName) } : undefined);
}

// ---------- fumadocs theme components (MDX elements) ----------

export const calloutExpose = {
  meta: { label: 'Callout', description: 'A highlighted note, warning or tip (MDX).', isInsertCommon: true },
  icon: MessageSquare,
  sourceDefaultCreate: mdxOnlySourceCreate((compName) => `<${compName} type="info">Text of the callout.</${compName}>`),
};

export const tabsExpose = {
  meta: { label: 'Tabs', description: 'Content switched by tabs (MDX).', isInsertCommon: true },
  icon: PanelTop,
  sourceDefaultCreate: mdxOnlySourceCreate((compName) => [
    `<${compName} items={['First', 'Second']}>`,
    '  <Tab value="First">Content of the first tab.</Tab>',
    '  <Tab value="Second">Content of the second tab.</Tab>',
    `</${compName}>`,
  ].join('\n')),
};

export const accordionsExpose = {
  meta: { label: 'Accordions', description: 'Sections that open and close (MDX).' },
  icon: ChevronsDownUp,
  sourceDefaultCreate: mdxOnlySourceCreate((compName) => [
    `<${compName}>`,
    '  <Accordion title="Question">Answer.</Accordion>',
    `</${compName}>`,
  ].join('\n')),
};

export const stepsExpose = {
  meta: { label: 'Steps', description: 'Numbered steps of a procedure (MDX).' },
  icon: ListOrdered,
  sourceDefaultCreate: mdxOnlySourceCreate((compName) => [
    `<${compName}>`,
    '  <Step>First step.</Step>',
    '  <Step>Second step.</Step>',
    `</${compName}>`,
  ].join('\n')),
};

export const filesExpose = {
  meta: { label: 'Files', description: 'A file tree of the fumadocs theme (MDX).' },
  icon: FoldersIcon,
  sourceDefaultCreate: mdxOnlySourceCreate((compName) => [
    `<${compName}>`,
    '  <Folder name="folder" defaultOpen>',
    '    <File name="file.md" />',
    '  </Folder>',
    `</${compName}>`,
  ].join('\n')),
};

// ---------- components of comp-mdx/ ----------

export const fileTreeExpose = {
  meta: { label: 'File tree', description: 'Folders and files with descriptions and annotations.', isInsertCommon: true },
  icon: FolderTreeIcon,
  sourceDefaultCreate: () => ({ lang: 'yaml', raw: 'tree:\n  - name: folder/\n    defaultOpen: true\n    children:\n      - name: file.md\n' }),
};

// the item links to the document the index is written in, so the new
// index has a working link until the author points it elsewhere
export const indexExpose = {
  meta: { label: 'Index', description: 'Links to documents, grouped by subtopic.' },
  icon: ListTree,
  sourceDefaultCreate: ({ docPath }) => ({
    lang: 'yaml',
    raw: [
      'type: title-subtopics-items',
      'layout: horizontal-wrap',
      'title: Index',
      'subtopics:',
      '  - id: topic',
      '    title: Topic',
      '    items:',
      '      - id: item',
      '        title: This document',
      `        target: ${docPath}`,
    ].join('\n'),
  }),
};

export const multiLangExpose = {
  meta: { label: 'Multilingual paragraphs', description: 'Paragraphs in several languages, shown in the page language.', isInsertCommon: true },
  icon: Languages,
  sourceDefaultCreate: () => ({
    lang: 'markdown',
    raw: 'The paragraph in English.\n\n日本語の段落です。',
    props: { type: 'paragraphs', languages: '[en,jp]' },
  }),
};

export const diagramTextExpose = {
  meta: { label: 'Text diagram', description: 'A diagram drawn with text characters.', isInsertCommon: true },
  icon: SquareCode,
  sourceDefaultCreate: () => ({
    lang: 'text',
    raw: '┌───────┐     ┌───────┐\n│ start │ ──► │  end  │\n└───────┘     └───────┘',
  }),
};

export const diagramMermaidExpose = {
  meta: { label: 'Mermaid diagram', description: 'A flowchart, sequence or other diagram written in Mermaid.', isInsertCommon: true },
  icon: Workflow,
  sourceDefaultCreate: () => ({ lang: 'mermaid', raw: 'flowchart LR\n  A[Start] --> B[End]' }),
};

// two tables and one relationship between them: the smallest diagram that
// shows every part of the format (tables, columns, keys, a relationship)
export const diagramERExpose = {
  meta: { label: 'ER diagram', description: 'Tables, their columns and the relationships between them, drawn as an entity-relationship diagram.' },
  icon: Waypoints,
  sourceDefaultCreate: () => ({
    lang: 'yaml',
    raw: [
      'tables:',
      '  - id: customer',
      '    name: customer',
      '    nameLogical: Customer',
      '    columns:',
      '      - { id: id, name: id, type: uuid, key: PK }',
      '      - { id: name, name: name, type: text }',
      '  - id: order',
      '    name: order',
      '    nameLogical: Order',
      '    position: { x: 520, y: 0 }',
      '    columns:',
      '      - { id: id, name: id, type: uuid, key: PK }',
      '      - { id: customerId, name: customer_id, type: uuid, key: FK }',
      'relationships:',
      '  - id: orderCustomer',
      '    label: places',
      '    source: { tableId: customer, columnId: id }',
      '    target: { tableId: order, columnId: customerId }',
    ].join('\n'),
  }),
};

// BlockSimple marks the quote after it, not a fenced block
export const blockSimpleExpose = {
  meta: { label: 'Block', description: 'A titled box around a quote: info, warning, tip.', isInsertCommon: true },
  icon: TextQuote,
  sourceDefaultCreate: ({ compName }) => ({
    text: `<!--renderComp=${compName},type=info,title=Note-->\n> Text of the block.`,
  }),
};

export const blockMdxExpose = {
  meta: { label: 'Markdown block', description: 'A titled box whose content is Markdown, with components inside.' },
  icon: ScrollText,
  sourceDefaultCreate: () => ({
    lang: 'markdown',
    raw: '- [First link](./)\n- [Second link](./)',
    props: { title: 'Related' },
  }),
};

// Block picks BlockMdx for a markdown block and BlockSimple otherwise
export const blockExpose = {
  meta: { label: 'Block (by content)', description: 'BlockMdx for Markdown content, BlockSimple otherwise.' },
  icon: LayoutList,
  sourceDefaultCreate: () => ({
    lang: 'markdown',
    raw: 'Text of the block.',
    props: { title: 'Block' },
  }),
};

export const tagOverviewExpose = {
  meta: { label: 'Tag overview', description: 'The documents and assets carrying one tag.' },
  icon: TagsIcon,
  sourceDefaultCreate: () => ({ lang: 'text', raw: 'Overview of one tag; replaced by the TagOverview component.', props: { tagId: 'tag-id' } }),
};

// ---------- demonstration components (example_doc/comp-mdx/) ----------

export const demoCounterExpose = {
  meta: { label: 'Counter (demo)', description: 'A counter whose state lives in the component state store.' },
  icon: Hash,
  sourceDefaultCreate: mdxOnlySourceCreate((compName) => `<${compName} id="counter" label="clicks" />`),
};

// the link points to the document it is written in until the author changes it
export const sourceLinkExpose = {
  meta: { label: 'Source link', description: 'A link that shows a source file in a popup.' },
  icon: LinkIcon,
  sourceDefaultCreate: ({ docPath }) => ({ lang: 'text', raw: docPath }),
};

export const tagListAllDemoExpose = {
  meta: { isReadOnly: true, label: 'All tags (demo)', description: 'Every tag the page knows; read from the tag service, nothing to edit.' },
  icon: TagIcon,
  sourceDefaultCreate: () => ({
    lang: 'text',
    raw: 'Every tag of the page; replaced by the TagListAllDemo component.',
  }),
};

export const docConfigDemoExpose = {
  meta: { label: 'Document config (demo)', description: 'The resolved config of the document.' },
  icon: SlidersHorizontal,
  sourceDefaultCreate: () => ({
    lang: 'text',
    raw: 'Resolved config of this document; replaced by the DocConfigDemo component.',
  }),
};
