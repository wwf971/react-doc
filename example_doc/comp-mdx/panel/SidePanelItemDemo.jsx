import { SidePanelItem } from '../../../main/comp-doc/side-panel/SidePanelItem.jsx';
import { FileCode } from '../../../main/frontend/UICommon.js';
import './SidePanelItemDemo.css';

// Demo side-panel item hook, mounted by comp.yaml of this folder under the
// built-in name SidePanelItem (a doc page's tag name replaces the default,
// as a compRegistry entry does). It keeps the default rendering and, for non-Markdown
// documents, decorates the label: a file icon before the name (as
// data.textDisplay; data.text stays the plain name, the text the label is
// edited as in edit mode) and a display-only label with the file suffix.
// The suffix label is not a tag of the document: the tag service does not
// know about it.
export function SidePanelItemDemo({ data = {}, config = {}, onEvent }) {
  const fileExt = String(data.fileExt ?? '');
  const isSourceFile = fileExt !== '' && fileExt !== 'md' && fileExt !== 'mdx';
  if (!isSourceFile) return <SidePanelItem data={data} config={config} onEvent={onEvent} />;
  const tagListDisplay = [
    ...(data.tagList ?? []),
    { id: 'file-ext', compName: 'TagLabel', data: { text: `.${fileExt}` } },
  ];
  const textDisplay = (
    <>
      <FileCode aria-hidden="true" className="doc-side-panel-item-demo-icon" size={12} strokeWidth={2} />
      {data.text}
    </>
  );
  return <SidePanelItem data={{ ...data, tagList: tagListDisplay, textDisplay }} config={config} onEvent={onEvent} />;
}

// a side-panel item renderer is not document content (isNotInDoc): the
// insert menu never lists it
export const sidePanelItemDemoDefineOptions = {
  placementList: ['sidePanelDisplay'],
  expose: { meta: { label: 'Side panel item demo', isNotInDoc: true } },
};
