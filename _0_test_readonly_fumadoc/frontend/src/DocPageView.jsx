import { useEffect, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { DocsPage, DocsBody, DocsTitle, DocsDescription } from 'fumadocs-ui/layouts/docs/page';
import { useDocStores } from './store/context.js';
import { buildMdxComps } from './lib/mdx-comps.js';
import { RegisteredComp } from './comp-doc/RegisteredComp.jsx';

// renders the current doc: loading / error / compiled body.
// fully driven by store state; the compile cache lives in DocSourceStore.

export const DocPageView = observer(function DocPageView() {
  const { compById, docStore, pageElementRef, sourceStore } = useDocStores();
  const item = docStore.itemCurrent;
  const path = docStore.docCurrentPath;
  const pathContent = item?.type === 'inline' ? item.route : path;
  const compiled = sourceStore.compiledByPath[pathContent];
  const mdxComps = useMemo(
    () => buildMdxComps(sourceStore.configDoc, compById),
    [sourceStore, compById],
  );

  // after the body appears: jump to the heading anchor, or back to top
  useEffect(() => {
    if (compiled?.status !== 'done') return;
    requestAnimationFrame(() => {
      const pageElement = pageElementRef.current;
      const idEscaped = typeof CSS !== 'undefined' && CSS.escape
        ? CSS.escape(docStore.docCurrentHash)
        : docStore.docCurrentHash;
      const el = docStore.docCurrentHash && pageElement
        ? pageElement.querySelector(`#${idEscaped}`)
        : null;
      if (el) el.scrollIntoView();
      else pageElement?.scrollTo(0, 0);
    });
  }, [pathContent, compiled?.status, docStore.docCurrentHash, pageElementRef]);

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
      <DocsPage breadcrumb={{ includePage: true }}>
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
      <DocsPage breadcrumb={{ includePage: true }}>
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

  if (!pathContent || !compiled) return warningNavigation;

  if (compiled.status === 'loading') {
    return (
      <DocsPage breadcrumb={{ includePage: true }}>
        {warningNavigation}
        <p className="text-fd-muted-foreground text-sm">loading {pathContent} ...</p>
      </DocsPage>
    );
  }

  if (compiled.status === 'error') {
    return (
      <DocsPage breadcrumb={{ includePage: true }}>
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
    <DocsPage
      breadcrumb={{ includePage: true }}
      toc={compiled.toc}
      className={compiled.isSourceFile ? 'doc-page-source-file' : undefined}
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
      {compiled.titleFrontmatter ? <DocsTitle>{compiled.titleFrontmatter}</DocsTitle> : null}
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
  );
});
