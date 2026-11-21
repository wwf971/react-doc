import { FileCode, Pilcrow, SlidersHorizontal, SquareCode, TextQuote } from '../../frontend/UICommon.js';

// The views a code block can be given from edit mode, as the entries of a
// menu (doc_page_impl_mdx_code.md#changing-the-view-from-the-page): the mode
// menu of a root-level code block (DocEditBlockModeButton) and the list menu
// of a list item that is a code block (DocEditItemToolbar). Choosing one
// writes it into the block; "by config" removes the block's own view, so the
// config of the document decides by the place of the block.
//
//   viewConfig   the view the config gives the block where it stands
// -> [{ id: '' | 'card' | 'plain' | 'icon', label, description, icon }]
export function codeViewEntryListBuild(viewConfig) {
  return [
    { id: 'card', label: 'Card', description: 'A card set apart from the text: its own background, room around the lines', icon: SquareCode },
    { id: 'plain', label: 'Plain', description: 'Lines that stand where plain text would, in a thin frame', icon: TextQuote },
    { id: 'icon', label: 'Icon', description: 'A small chip with the title or the language; the lines open in a dialog when it is clicked', icon: FileCode },
    {
      id: '',
      label: `By config${viewConfig ? ` (${viewConfig})` : ''}`,
      description: 'No view of its own: the config of the document decides by where the block stands (CodeBlockView, CodeBlockViewAsListItem)',
      icon: SlidersHorizontal,
    },
  ];
}

// the entry turning a code block into text (doc_page_impl_mdx_code.md#the-lines-as-text):
// its lines joined into one line, the line breaks removed
export const codeTextEntry = {
  id: 'text',
  label: 'To text',
  description: 'The lines joined into one line of text, the line breaks removed: the block is text of the document from then on',
  icon: Pilcrow,
};
