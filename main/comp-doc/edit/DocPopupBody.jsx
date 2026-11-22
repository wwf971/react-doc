import { useEffect, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { buildMdxComps } from '../../frontend/src/lib/mdx-comps.js';
import { DocEditBody } from './DocEditBody.jsx';

// A document shown in a popup over the page: the document an inline link
// opens (SourceLinkRenderPopup), the document an MDX block holds (Mdx). In
// reading mode the popup shows what it is handed (children: the document
// rendered); in edit mode, when the page can write the document, it shows the
// edit body of the document instead, the same as the body of the page: its
// blocks entered by a click, its toolbars, its list items, its slash mode
// (doc_page_impl_mdx_embed.md#a-document-in-a-popup).
//
//   path          the internal path of the document (an embedded document:
//                 lib/doc-edit-embed.js)
//   isEditWanted  false: the document rendered even in edit mode (the View
//                 of the popup of an MDX block); default true
//   children      what reading mode shows
export const DocPopupBody = observer(function DocPopupBody({ path, isEditWanted = true, children }) {
  const { compById, editStore, sourceStore } = useDocStores();
  const isEditable = Boolean(isEditWanted && path && editStore?.isEditMode && editStore.docIsEditable(path));
  // read (again) when the popup shows it in edit mode: its host may have changed
  useEffect(() => {
    if (isEditable) void editStore.docEditEnsure(path);
  }, [editStore, isEditable, path]);
  const docEdit = isEditable ? editStore.docEditActiveGet(path) : undefined;
  const mdxComps = useMemo(
    () => buildMdxComps(sourceStore.configDoc, compById, { sourcePath: path }),
    [compById, path, sourceStore.configDoc],
  );
  if (!docEdit) return children;
  return <DocEditBody path={path} docEdit={docEdit} mdxComps={mdxComps} />;
});
