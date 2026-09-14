import { useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import {
  DocsPage,
  DocsBody,
  DocsTitle,
  DocsDescription,
  PageBreadcrumb,
  PageFooter,
  TOCPopover,
  TOCProvider,
} from '../UICommon.js';
import { useDocStores } from './store/context.js';
import { buildMdxComps } from './lib/mdx-comps.js';
import { useDocDestinationNavigation } from './lib/use-doc-destination-navigation.js';
import { DocPageToolbar } from './comp-doc/DocPageToolbar.jsx';
import { DocPageSkeleton } from './comp-doc/DocPageSkeleton.jsx';
import { DocPageToc } from './comp-doc/DocPageToc.jsx';
import { RegisteredComp } from './comp-doc/RegisteredComp.jsx';
import { DocLanguageProvider } from './comp-doc/MultiLangContext.jsx';
import './DocPageView.css';

// renders the current doc: loading / error / compiled body.
// fully driven by store state; the compile cache lives in DocSourceStore.

export const DocPageView = observer(function DocPageView() {
  const { compById, docStore, pageElementRef, sourceStore } = useDocStores();
  const item = docStore.itemCurrent;
  const path = docStore.docCurrentPath;
  const pathContent = item?.type === 'inline' ? item.route : path;
  const compiled = sourceStore.compiledByPath[pathContent];
  const navigationRequestVersion = docStore.navigationRequestVersion;
  const mdxComps = useMemo(
    () => buildMdxComps(sourceStore.configDoc, compById),
    [sourceStore, compById],
  );
  useDocDestinationNavigation({
    compiledStatus: compiled?.status,
    hash: docStore.docCurrentHash,
    navigationRequestVersion,
    pageElementRef,
    pathContent,
  });

  const warningNavigation = docStore.navigationError ? (
    <div className="doc-navigation-warning" role="alert">
      <span>{docStore.navigationError}</span>
      <button type="button" onClick={() => docStore.clearNavigationError()}>Dismiss</button>
    </div>
  ) : null;

  if (item?.type === 'component') {
    const componentId = sourceStore.configDoc.compRegistry?.[item.panelComponent]
      ?? item.panelComponent;
    const isComponentAvailable = Boolean(compById[componentId]);
    return (
      <DocsPage breadcrumb={{ includePage: true }} className="doc-page-with-toolbar" slots={docsPageSlots}>
        {warningNavigation}
        {isComponentAvailable ? (
          <RegisteredComp
            compId={componentId}
            configRuntime={{ instanceId: item.id, item, itemId: item.id }}
            input={{ data: item.panelData }}
            placement="sidePanelPanel"
          />
        ) : (
          <>
            <DocsTitle>Component not available</DocsTitle>
            <p className="text-fd-muted-foreground text-sm">
              {item.panelComponent || '(component name is empty)'}
            </p>
          </>
        )}
      </DocsPage>
    );
  }

  if (item?.type === 'missing-doc') {
    return (
      <DocsPage breadcrumb={{ includePage: true }} className="doc-page-with-toolbar" slots={docsPageSlots}>
        {warningNavigation}
        <DocsTitle>Document source not found</DocsTitle>
        <div className="doc-source-missing-error" role="alert">
          <strong>This side-panel item points to a document that was not collected.</strong>
          <span>Configured source: {item.sourceReference || '(empty path)'}</span>
          <span>Check the document path and the source rules in the document configuration.</span>
        </div>
      </DocsPage>
    );
  }

  if (!pathContent) return warningNavigation;

  if (!compiled || compiled.status === 'loading') {
    return (
      <DocsPage breadcrumb={{ includePage: true }} className="doc-page-with-toolbar" slots={docsPageSlots}>
        {warningNavigation}
        <DocPageSkeleton />
      </DocsPage>
    );
  }

  if (compiled.status === 'error') {
    return (
      <DocsPage breadcrumb={{ includePage: true }} className="doc-page-with-toolbar" slots={docsPageSlots}>
        {warningNavigation}
        <DocsTitle>Failed to render {pathContent}</DocsTitle>
        <pre className="mt-2 p-2 text-sm whitespace-pre-wrap select-text text-red-600 dark:text-red-400 border border-fd-border">
          {compiled.message}
        </pre>
      </DocsPage>
    );
  }

  const Body = compiled.Body;
  const candidates = item?.docCandidates ?? [];
  return (
    <DocLanguageProvider language={docStore.languageSelected || compiled.language}>
      <DocsPage
        breadcrumb={{ includePage: true }}
        toc={compiled.toc}
        className={`doc-page-with-toolbar${compiled.isSourceFile ? ' doc-page-source-file' : ''}`}
        slots={docsPageSlots}
      >
        {warningNavigation}
        {candidates.length > 1 ? (
          <div className="doc-source-ambiguity-warning" role="status">
            <strong>Multiple source files matched this side-panel item.</strong>
            <span>Displaying the first match in source order: {path}</span>
            <ul>
              {candidates.map((candidate) => (
                <li key={candidate.internalPath}>{candidate.internalPath}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {/* md files usually carry their own '# heading'; only frontmatter title gets the big page title */}
        {compiled.titleFrontmatter ? <DocsTitle className="doc-page-title">{compiled.titleFrontmatter}</DocsTitle> : null}
        {compiled.description ? (
          <DocsDescription className="doc-page-description">
            {compiled.description}
          </DocsDescription>
        ) : null}
        <DocsBody data-doc-content="">
          {compiled.isContentEmpty ? (
            <p className="doc-content-empty">This Markdown file is empty. Content can be added later.</p>
          ) : (
            <Body components={mdxComps} />
          )}
        </DocsBody>
      </DocsPage>
    </DocLanguageProvider>
  );
});

const docsPageSlots = {
  breadcrumb: DocPageBreadcrumb,
  footer: DocPageFooter,
  toc: {
    main: DocPageToc,
    popover: TOCPopover,
    provider: TOCProvider,
  },
};

function DocPageFooter({ className = '', ...props }) {
  return <PageFooter {...props} className={`doc-page-footer ${className}`.trim()} />;
}

function DocPageBreadcrumb(props) {
  return (
    <>
      <DocPageToolbar />
      <PageBreadcrumb {...props} />
    </>
  );
}
