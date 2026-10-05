import { createElement } from 'react';
import { defaultMdxComponents } from '../../frontend/UICommon.js';
import { MultiLangHeadingText } from '../multi-lang/MultiLangEntry.jsx';
import { BlockRender } from './BlockRender.jsx';
import { HeadingEdit } from './HeadingEdit.jsx';

// Headings of a document.
//
// headingTagCreate(tag) is the h1..h6 component of the document body: the
// Fumadocs heading (anchor link, id, TOC participation), showing the variant
// of the selected language when the heading is multilingual.
//
// Heading is the registered component "Heading" (common/Heading), the default
// editor of heading blocks in edit mode:
//   config.isEdit -> HeadingEdit (the heading edited in its place + level control)
//   otherwise     -> the heading block rendered as in the document body
export function Heading({ data = {}, config = {}, onEvent }) {
  if (config.isEdit) return <HeadingEdit data={data} config={config} onEvent={onEvent} />;
  return (
    <BlockRender
      data={{ text: data.text }}
      config={{ format: config.edit?.format, sourcePath: config.sourcePath }}
    />
  );
}

export function headingTagCreate(tag) {
  const HeadingDefault = defaultMdxComponents[tag];
  return function HeadingTag({ children, ...props }) {
    const variantsJson = props['data-multi-lang-heading'];
    if (!variantsJson) return createElement(HeadingDefault, props, children);
    const propsHeading = { ...props };
    delete propsHeading['data-multi-lang-heading'];
    return createElement(HeadingDefault, propsHeading, createElement(MultiLangHeadingText, { variantsJson }));
  };
}
