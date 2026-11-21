import { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import './DocPageToolbar.css';

// The head of the page: the document toolbar and the path bar below it
// (design: doc_page_impl_nav.md#history-and-navigation-controls). It stays at
// the top of the page while the document scrolls under it, sticking below the
// sticky rows of fumadocs (--fd-docs-row-3: the header and the toc popover of
// a narrow page):
//
//   [← Back] [Forward →] [↑ Up]  en jp  [✎ Edit] [☰ Select]   ◄ sticks here
//   example › MDX Components  [Part]
//   ─────────────────────────────────────── a hairline once it is stuck
//   … the document scrolls under it …
//
// its padding lies over negative margins, so at rest it takes the place the
// toolbar and the path bar took before, and when stuck it keeps a little
// room above the toolbar; its background hides what scrolls under it.
//
// the bottom of the head, measured from the top of the page, is
// --doc-page-head-inset on the page element (DocPageMdx): what is aligned at
// the top of the page goes below it, the floating controls of a block in edit
// mode (DocEdit.css), scrollIntoView (scroll-padding-top, DocPageMdx.css), the
// destination of a navigation and a reading place (pageStickyInsetGet). whether
// it is stuck is DocStore.pageHeadIsStuck.
export const DocPageHead = observer(function DocPageHead({ children }) {
  const { docStore, pageElementRef } = useDocStores();
  const headRef = useRef(null);
  useEffect(() => {
    const head = headRef.current;
    const pageElement = pageElementRef?.current;
    if (!head || !pageElement) return undefined;
    const measure = () => {
      const top = parseFloat(getComputedStyle(head).top) || 0;
      pageElement.style.setProperty('--doc-page-head-inset', `${top + head.offsetHeight}px`);
      const headTop = head.getBoundingClientRect().top - pageElement.getBoundingClientRect().top;
      docStore.pageHeadIsStuckSet(pageElement.scrollTop > 0 && headTop <= top + 0.5);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(head);
    pageElement.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      pageElement.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      pageElement.style.removeProperty('--doc-page-head-inset');
    };
  }, [docStore, pageElementRef]);
  return (
    <div ref={headRef} className="doc-page-head" data-stuck={docStore.pageHeadIsStuck ? '' : undefined}>
      {children}
    </div>
  );
});
