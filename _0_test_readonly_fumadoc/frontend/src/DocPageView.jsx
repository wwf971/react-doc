import { useLayoutEffect, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import {
  DocsPage,
  DocsBody,
  DocsTitle,
  DocsDescription,
  PageBreadcrumb,
  PageFooter,
} from 'fumadocs-ui/layouts/docs/page';
import {
  TOCPopover,
  TOCProvider,
} from 'fumadocs-ui/layouts/docs/page/slots/toc';
import { useDocStores } from './store/context.js';
import { buildMdxComps } from './lib/mdx-comps.js';
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

  // Every navigation request starts from a known scroll position, including a
  // repeated request for the current document or current fragment. Keep the
  // request version dependency: path/hash alone cannot detect repeated index
  // clicks. Fragment navigation aligns its destination below after mounting.
  // Run before paint so the browser cannot preserve the previous document's
  // scroll anchor while React replaces the body.
  useLayoutEffect(() => {
    if (!pathContent) return;
    pageScrollTopReset(pageElementRef.current);
  }, [pathContent, navigationRequestVersion, pageElementRef]);

  // after the body appears: jump to the heading anchor, or back to top
  useLayoutEffect(() => {
    if (compiled?.status !== 'done') return;
    let elementHighlighted;
    let frameId;
    let attemptCount = 0;
    let imagePendingList = [];
    const destinationAlign = () => pageScrollDestinationAlign(
      pageElementRef.current,
      elementHighlighted,
    );
    const scrollToDestination = () => {
      const pageElement = pageElementRef.current;
      const idEscaped = typeof CSS !== 'undefined' && CSS.escape
        ? CSS.escape(docStore.docCurrentHash)
        : docStore.docCurrentHash;
      const el = docStore.docCurrentHash && pageElement
        ? pageElement.querySelector(`#${idEscaped}`)
        : null;
      if (el) {
        elementHighlighted = el;
        while (
          !elementHighlighted.textContent?.trim()
          && elementHighlighted.children.length === 0
          && elementHighlighted.nextElementSibling
        ) {
          elementHighlighted = elementHighlighted.nextElementSibling;
        }
        destinationAlign();
        elementHighlighted.classList.add('doc-navigation-target');
        imagePendingList = [...pageElement.querySelectorAll('img')].filter((image) => (
          !image.complete
          && Boolean(image.compareDocumentPosition(elementHighlighted) & Node.DOCUMENT_POSITION_FOLLOWING)
        ));
        for (const image of imagePendingList) {
          image.addEventListener('load', destinationAlign, { once: true });
          image.addEventListener('error', destinationAlign, { once: true });
        }
        // Reapply after the browser's own layout/scroll anchoring phase.
        frameId = requestAnimationFrame(destinationAlign);
        return;
      }
      if (!docStore.docCurrentHash) {
        pageScrollTopReset(pageElement);
        return;
      }
      attemptCount += 1;
      if (attemptCount < 12) frameId = requestAnimationFrame(scrollToDestination);
    };
    scrollToDestination();
    return () => {
      cancelAnimationFrame(frameId);
      for (const image of imagePendingList) {
        image.removeEventListener('load', destinationAlign);
        image.removeEventListener('error', destinationAlign);
      }
      elementHighlighted?.classList.remove('doc-navigation-target');
    };
  // Keep navigationRequestVersion here so selecting the current fragment again
  // removes and reapplies both destination alignment and highlighting.
  }, [pathContent, compiled?.status, docStore.docCurrentHash, navigationRequestVersion, pageElementRef]);

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
        <DocsBody>
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

function pageScrollTopReset(pageElement) {
  if (!pageElement) return;
  const documentElement = pageElement.ownerDocument?.documentElement;
  let elementCurrent = pageElement.querySelector('#nd-page') ?? pageElement;
  while (elementCurrent) {
    elementCurrent.scrollTop = 0;
    if (elementCurrent === documentElement) break;
    elementCurrent = elementCurrent.parentElement;
  }
  const scrollingElement = pageElement.ownerDocument?.scrollingElement;
  if (scrollingElement) scrollingElement.scrollTop = 0;
}

function pageScrollDestinationAlign(pageElement, targetElement) {
  if (!pageElement || !targetElement) return;
  const pageRect = pageElement.getBoundingClientRect();
  const targetRect = targetElement.getBoundingClientRect();
  pageElement.scrollTop = Math.max(
    0,
    pageElement.scrollTop + targetRect.top - pageRect.top - 8,
  );
}

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
