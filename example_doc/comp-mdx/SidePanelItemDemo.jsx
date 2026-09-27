import { SidePanelItem } from '../../main/frontend/src/comp-doc/SidePanelItem.jsx';

// Demo side-panel item hook, registered in config.yaml under the built-in
// name SidePanelItem. It keeps the default rendering and only adds a
// display-only label with the file suffix to non-Markdown documents. The
// label is not a tag of the document: the tag service does not know about it.
export function SidePanelItemDemo({ data = {}, config = {}, onEvent }) {
  const fileExt = String(data.fileExt ?? '');
  const isSourceFile = fileExt !== '' && fileExt !== 'md' && fileExt !== 'mdx';
  if (!isSourceFile) return <SidePanelItem data={data} config={config} onEvent={onEvent} />;
  const tagListDisplay = [
    ...(data.tagList ?? []),
    { id: 'file-ext', compName: 'Tag', data: { text: `.${fileExt}` } },
  ];
  return <SidePanelItem data={{ ...data, tagList: tagListDisplay }} config={config} onEvent={onEvent} />;
}
