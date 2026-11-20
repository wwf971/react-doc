import { BlockRender } from './BlockRender.jsx';
import { ListItemEdit } from './ListItemEdit.jsx';

// One item of a list block, edited alone.
//
// ListItem is the registered component "ListItem" (common/ListItem), the
// default editor of the own text of a list item in edit mode
// (doc_page_impl_edit_structure.md#editing-an-item):
//   config.isEdit -> ListItemEdit (the text of the item edited in its place)
//   otherwise     -> the text rendered as a document renders it
export function ListItem({ data = {}, config = {}, onEvent }) {
  if (config.isEdit) return <ListItemEdit data={data} config={config} onEvent={onEvent} />;
  return (
    <BlockRender
      data={{ text: data.text }}
      config={{ format: config.edit?.format, sourcePath: config.sourcePath }}
    />
  );
}
