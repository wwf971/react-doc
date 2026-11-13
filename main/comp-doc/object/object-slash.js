import { createElement } from 'react';
import { Box, ChevronRight, CircleDashed, FolderIcon } from '../../frontend/UICommon.js';
import { objectCompleteChoose, objectCompleteHintGet, objectCompleteItemListGet } from '../../frontend/src/lib/doc-object-complete.js';
import { slashEffect } from '../../frontend/src/lib/doc-slash.js';
import { slashActionDefine } from '../slash/slash-define.js';
import { objectIconComponentGet } from './object-icon.jsx';

// /object: a view of an object of the object registry, written while typing
// (doc_page_impl_obj.md#writing-a-reference, doc_page_impl_edit_slash.md).
// The object service layer offers it to the slash mode: of the default
// editors (a paragraph, a list: the page's registry), and of a cell
// (doc_page_impl_edit_cell.md), where it is the action of the token kind
// object/view. The author walks to the object the way the registry is
// organized, a step per choice:
//
//   /object ␣                         the types that have objects
//   /object example.reading-list/     the objects of the type
//   /object frontend:w5j7ozoijzl      the object itself, and the top of what is inside it
//   /object frontend:w5j7ozoijzl#/book/sci-    inside it: completed by its provider, which for a
//                                     frontend object asks the type of the object
//
// what is chosen at the end is a reference, and the text written for it is
// the surface's to say:
//   a document   <!--renderComp=ObjectView-->`frontend:w5j7ozoijzl#/book/sci-fi/dune`
//   a cell       {{@frontend:w5j7ozoijzl#/book/sci-fi/dune}}
//
// context.object is the object service layer (DocObjectStore), read at once
// from what it holds; the lists follow it, the menu being an observer.
//
//   textBuild(ref)   the text written for a reference; default: the inline
//                    form of a document
export function objectSlashActionBuild({ textBuild = objectInlineTextBuild } = {}) {
  return slashActionDefine({
    name: 'object',
    aliasList: ['obj', 'o'],
    label: 'Object',
    description: 'a view of an object: a type, an object, something inside it',
    icon: Box,
    param: {
      placeholder: 'a type, then an object of it, then what is inside it',
      emptyText: 'Nothing matches',
      itemListGet: (param, context) => (context.object ? objectCompleteItemListGet(param, context.object) : []),
      hintGet: (param, context) => (context.object ? objectCompleteHintGet(param, context.object) : ''),
      itemChoose: (item) => {
        const choice = objectCompleteChoose(item);
        if (!choice) return undefined;
        return choice.ref ? slashEffect.replace(textBuild(choice.ref)) : slashEffect.paramSet(choice.paramNext);
      },
      ItemRender: ObjectSlashItem,
    },
  });
}

// the inline form of an object view in a document: a marker comment and the
// reference as inline code, which a plain Markdown renderer shows as code
// (doc_page_impl_mdx_li.md#inline-components)
export function objectInlineTextBuild(ref) {
  return `<!--renderComp=ObjectView-->\`${String(ref).replace(/`/g, '')}\``;
}

// the action of the page's registry: what a paragraph or a list offers
export const objectSlashAction = objectSlashActionBuild();

// one item of the walk: a type and a folder go on (a chevron at the end), an
// object and a thing inside are written
function ObjectSlashItem({ item }) {
  const isGoingOn = item.kind === 'type' || item.kind === 'dir' || (item.kind === 'object' && item.isInner);
  const Icon = item.kind === 'note' ? CircleDashed : item.kind === 'dir' ? FolderIcon : item.kind === 'type' ? objectIconComponentGet(item.icon) : Box;
  return createElement(
    'span',
    { className: 'doc-edit-slash-row', 'data-kind': item.kind },
    createElement(Icon, { size: 13, className: 'doc-edit-slash-icon', 'aria-hidden': true }),
    createElement('span', { className: item.kind === 'note' ? 'doc-edit-slash-muted' : 'doc-edit-slash-label-main' }, item.label),
    item.detail ? createElement('span', { className: 'doc-edit-slash-muted doc-edit-slash-fill' }, item.detail) : null,
    isGoingOn ? createElement(ChevronRight, { size: 12, className: 'doc-edit-slash-icon doc-edit-slash-go', 'aria-hidden': true }) : null,
  );
}
