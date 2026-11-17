import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { docTabTitleGet } from '../../frontend/src/lib/doc-tab-title.js';

// The title of the tab of the browser (design: doc_page_impl.md#the-tab-title): the site and the
// document shown, in the order of the environment (doc-env.js tabTitleOrder). The html served
// already holds the site (the transformIndexHtml of the plugin); this follows the navigation.
// Mounted by DocPageMdx when its host asks (config.isTabTitleSet): a host embedding the page
// in its own app keeps its own title. Renders nothing.
export const DocTabTitle = observer(function DocTabTitle() {
  const { docStore, envStore, sourceStore } = useDocStores();
  const { configDoc } = sourceStore;
  const siteTitle = docStore.textDisplayGet(configDoc.siteTitleShort ?? configDoc.siteTitle ?? '').text;
  // the label the reader clicked in the side panel, else the title of the document itself
  const documentTitle = docStore.itemTextGet(docStore.itemCurrent)
    || sourceStore.entryByInternalPath.get(docStore.docCurrentPath)?.title
    || '';
  const title = docTabTitleGet({ siteTitle, documentTitle, order: envStore.kindDefine.tabTitleOrder });
  useEffect(() => {
    document.title = title;
  }, [title]);
  return null;
});
