import { useEffect, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { DocsPage, DocsBody, DocsTitle, DocsDescription } from 'fumadocs-ui/layouts/docs/page';
import { useDocStores } from './store/context.js';
import { buildMdxComps } from './lib/mdx-comps.js';

// renders the current doc: loading / error / compiled body.
// fully driven by store state; the compile cache lives in DocSourceStore.

export const DocPageView = observer(function DocPageView() {
  const { docStore, sourceStore } = useDocStores();
  const path = docStore.docCurrentPath;
  const compiled = sourceStore.compiledByPath[path];
  const mdxComps = useMemo(() => buildMdxComps(sourceStore.configDoc), [sourceStore]);

  // after the body appears: jump to the heading anchor, or back to top
  useEffect(() => {
    if (compiled?.status !== 'done') return;
    requestAnimationFrame(() => {
      const el = docStore.docCurrentHash ? document.getElementById(docStore.docCurrentHash) : null;
      if (el) el.scrollIntoView();
      else window.scrollTo(0, 0);
    });
  }, [path, compiled?.status, docStore.docCurrentHash]);

  if (!path || !compiled) return null;

  if (compiled.status === 'loading') {
    return (
      <DocsPage>
        <p className="text-fd-muted-foreground text-sm">loading {path} ...</p>
      </DocsPage>
    );
  }

  if (compiled.status === 'error') {
    return (
      <DocsPage>
        <DocsTitle>Failed to render {path}</DocsTitle>
        <pre className="mt-2 p-2 text-sm whitespace-pre-wrap select-text text-red-600 dark:text-red-400 border border-fd-border">
          {compiled.message}
        </pre>
      </DocsPage>
    );
  }

  const Body = compiled.Body;
  return (
    <DocsPage toc={compiled.toc}>
      {/* md files usually carry their own '# heading'; only frontmatter title gets the big page title */}
      {compiled.titleFrontmatter ? <DocsTitle>{compiled.titleFrontmatter}</DocsTitle> : null}
      {compiled.description ? <DocsDescription>{compiled.description}</DocsDescription> : null}
      <DocsBody>
        <Body components={mdxComps} />
      </DocsBody>
    </DocsPage>
  );
});
