import { itemCodeBlockListGet } from '../../frontend/src/lib/doc-edit-item-atom.js';
import { listItemTextGet } from '../../frontend/src/lib/doc-edit-list.js';
import { itemCodeElementListGet } from '../edit-structure/struct-geometry.js';

// The thing drawn as one unit under a right click, inside the text of a block
// not being edited (doc_page_impl_edit_structure.md#deleting-a-thing): a code
// block or an MDX block of a list item (in any view), a formula of a list item
// or of a paragraph (an atom of a kind whose rendered element the kind names,
// elementSelector). A root-level block that is itself such a thing is not a
// part: its menu is the menu of the block.
//
//   target          the element right-clicked
//   blockElement    the wrapper of the block (DocEditBlock)
//   block           the block of the model (block.list for a list)
//   atomKindByName  the kinds of atoms of the page
// -> { itemPath?, kind: 'code' | 'atom', index, atomKind?, label } or undefined
//    index: among the code blocks of the text of the item, or among the things
//    of the kind in the text, as the rendered block draws them in order
export function blockPartAtGet(target, blockElement, block, atomKindByName = {}) {
  if (!target?.closest || !blockElement?.contains(target)) return undefined;
  if (block?.list) {
    const itemElement = target.closest('li[data-edit-item]');
    if (!itemElement || itemElement.closest('.doc-edit-block') !== blockElement) return undefined;
    const itemPath = String(itemElement.dataset.editItem);
    const codeElement = target.closest('[data-code-key]');
    if (codeElement && codeElement.closest('li') === itemElement) {
      const index = itemCodeElementListGet(itemElement).indexOf(codeElement);
      const codeBlock = index >= 0 ? itemCodeBlockListGet(listItemTextGet(block.list, itemPath))[index] : undefined;
      if (!codeBlock) return undefined;
      return { itemPath, kind: 'code', index, label: codeBlock.isEmbed ? 'MDX block' : 'code block' };
    }
    const atom = atomAtGet(target, itemElement, atomKindByName, (element) => element.closest('li') === itemElement);
    return atom ? { itemPath, ...atom } : undefined;
  }
  // a paragraph: the editor types its atoms of a kind as chips
  if (block?.kind !== 'paragraph') return undefined;
  return atomAtGet(target, blockElement, atomKindByName, () => true);
}

// the atom of a kind whose rendered element holds the target, by its place
// among the elements of its kind in the container: those of the text itself,
// not those in a code block or an embedded document, nor one inside another
function atomAtGet(target, container, atomKindByName, isOwn) {
  for (const atomKind of Object.values(atomKindByName)) {
    const selector = atomKind?.elementSelector;
    if (!selector) continue;
    const element = target.closest(selector);
    if (!element || !container.contains(element)) continue;
    const elementList = [...container.querySelectorAll(selector)].filter((one) => isOwn(one)
      && !one.closest('[data-code-key]')
      && !(one.parentElement?.closest(selector) && container.contains(one.parentElement.closest(selector))));
    const index = elementList.indexOf(element);
    if (index < 0) continue;
    return { kind: 'atom', atomKind: atomKind.name, index, label: atomKind.label };
  }
  return undefined;
}
