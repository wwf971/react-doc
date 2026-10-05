import { createElement } from 'react';
import { defaultMdxComponents } from '../../frontend/UICommon.js';
import { BlockRender } from './BlockRender.jsx';
import { ListEdit } from './ListEdit.jsx';

// Lists of a document.
//
// listTagCreate(tag) is the "ul" / "ol" / "li" component of the document
// body: the Fumadocs default, kept in one place so list rendering has a home.
//
// List is the registered component "List" (common/List), the default editor
// of list blocks in edit mode:
//   config.isEdit -> ListEdit (the list edited in its place + list type control)
//   otherwise     -> the list rendered as in the document body
export function List({ data = {}, config = {}, onEvent }) {
  if (config.isEdit) return <ListEdit data={data} config={config} onEvent={onEvent} />;
  return (
    <BlockRender
      data={{ text: data.text }}
      config={{ format: config.edit?.format, sourcePath: config.sourcePath }}
    />
  );
}

export function listTagCreate(tag) {
  const ListDefault = defaultMdxComponents[tag] ?? tag;
  return function ListTag({ children, ...props }) {
    return createElement(ListDefault, props, children);
  };
}
