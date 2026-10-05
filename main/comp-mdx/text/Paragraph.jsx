import { createElement } from 'react';
import { defaultMdxComponents } from '../../frontend/UICommon.js';
import { BlockRender } from './BlockRender.jsx';
import { ParagraphEdit } from './ParagraphEdit.jsx';

// Paragraphs of a document.
//
// ParagraphTag is the "p" component of the document body: the Fumadocs
// default paragraph, kept in one place so paragraph rendering has a home.
//
// Paragraph is the registered component "Paragraph" (common/Paragraph), the
// default editor of paragraph blocks in edit mode:
//   config.isEdit -> ParagraphEdit (the paragraph edited in its place)
//   otherwise     -> the paragraph rendered as in the document body
export function Paragraph({ data = {}, config = {}, onEvent }) {
  if (config.isEdit) return <ParagraphEdit data={data} config={config} onEvent={onEvent} />;
  return (
    <BlockRender
      data={{ text: data.text }}
      config={{ format: config.edit?.format, sourcePath: config.sourcePath }}
    />
  );
}

const ParagraphDefault = defaultMdxComponents.p ?? 'p';

export function ParagraphTag({ children, ...props }) {
  return createElement(ParagraphDefault, props, children);
}
