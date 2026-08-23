import { useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { FrameworkProvider } from 'fumadocs-core/framework';
import { RootProvider } from 'fumadocs-ui/provider/base';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { DocSourceStore } from './store/DocSourceStore.js';
import { DocStore } from './store/DocStore.js';
import { CompStateStore } from './store/CompStateStore.js';
import { StoreContext, useDocStores } from './store/context.js';
import { makeFramework } from './lib/framework-adapter.jsx';
import { DocPageView } from './DocPageView.jsx';
import { DocSearchDialog } from './comp-doc/DocSearchDialog.jsx';

// the embeddable doc page component.
//
//   <DocApp sourceData={{ configDoc, fileManifest }} />
//
// sourceData usually comes from `virtual:doc-source` (the vite plugin), but
// any consumer can hand-build it. routeMode 'query' syncs the current doc to
// `?doc=` in the page url; 'memory' keeps navigation fully internal (for
// embedding into another app's page).

export function DocApp({ sourceData, routeMode = 'query' }) {
  const [stores] = useState(() => {
    const sourceStore = new DocSourceStore(sourceData);
    const docStore = new DocStore(sourceStore, { routeMode });
    const compStateStore = new CompStateStore();
    return { sourceStore, docStore, compStateStore };
  });
  const framework = useMemo(() => makeFramework(stores.docStore), [stores]);

  useEffect(() => {
    stores.docStore.init();
    return () => stores.docStore.dispose();
  }, [stores]);

  return (
    <StoreContext.Provider value={stores}>
      <FrameworkProvider {...framework}>
        <RootProvider search={{ SearchDialog: DocSearchDialog }}>
          <DocsShell />
        </RootProvider>
      </FrameworkProvider>
    </StoreContext.Provider>
  );
}

const DocsShell = observer(function DocsShell() {
  const { docStore, sourceStore } = useDocStores();
  return (
    <DocsLayout
      tree={docStore.treePage}
      nav={{ title: sourceStore.configDoc.siteTitle ?? 'Docs' }}
    >
      <DocPageView />
    </DocsLayout>
  );
});
