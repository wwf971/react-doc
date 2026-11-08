import { useContext } from 'react';
import { StoreContext } from '../../frontend/src/store/context.js';

// What a component editing its own data hands its surface to offer the slash
// mode there (doc_page_impl_edit_slash.md#beyond-the-document-editors): a cell
// of a CV, a field of a mode of a frontend object, anything built on
// EditSourceSurface outside the block editors. The block editors get the same
// thing from the edit layer (config.edit.slash); a component asks for it here.
//
//   actionList            its own actions (slashActionDefine), usually built
//                         over its own data: /query of a CV cell lists the paths
//                         of the profile it reads
//   context               what its actions receive (anything it likes)
//   isPageActionIncluded  the page's registry too (/link ...); default false:
//                         a component's text is seldom a document's markdown
//
// answers the slash of EditSourceSurface, or undefined outside a page (no
// slash mode then: the surface is plain text). the switch of the page
// (EditSlashToggle) applies to it as to every surface
export function useEditSlashConfig({ actionList = [], context = {}, isPageActionIncluded = false } = {}) {
  const stores = useContext(StoreContext);
  const store = stores?.slashStore;
  if (!store) return undefined;
  return { store, context, actionList, isPageActionIncluded };
}
