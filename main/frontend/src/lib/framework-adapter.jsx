import { useSyncExternalStore } from 'react';
import { reaction } from 'mobx';

// fumadocs-ui is framework-agnostic through FrameworkProvider; here the
// "framework" is simply the DocStore: pathname is the current sidebar item
// route, and navigation goes through docStore.navigate().

export function makeFramework(docStore) {
  const subscribePath = (onChange) => reaction(() => docStore.routeCurrentPath, onChange);
  const paramsEmpty = {};
  const router = {
    push: (url) => docStore.navigate(fromBrowserHref(url)),
    refresh: () => {},
  };

  function usePathname() {
    return useSyncExternalStore(subscribePath, () => docStore.routeCurrentPath);
  }

  function LinkAdapter({ href = '', prefetch: _prefetch, children, onClick, ...props }) {
    const isDocHref = href.startsWith('/') || href.startsWith('?doc=');
    if (!isDocHref) {
      return (
        <a href={href} onClick={onClick} {...props}>
          {children}
        </a>
      );
    }
    const target = fromBrowserHref(href);
    return (
      <a
        href={docStore.toBrowserHref(target)}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented) return;
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          docStore.navigate(target);
        }}
        {...props}
      >
        {children}
      </a>
    );
  }

  return {
    usePathname,
    useParams: () => paramsEmpty,
    useRouter: () => router,
    Link: LinkAdapter,
  };
}

// accepts both internal paths '/rootId/a.md#hash' and browser hrefs '?doc=...'
function fromBrowserHref(url) {
  if (!url.startsWith('?') && !url.includes('?doc=')) return url;
  const indexQuery = url.indexOf('?');
  const indexHash = url.indexOf('#');
  const query = new URLSearchParams(
    url.slice(indexQuery, indexHash >= 0 ? indexHash : undefined),
  );
  const path = query.get('doc') ?? '';
  return path + (indexHash >= 0 ? url.slice(indexHash) : '');
}
