import { useEffect, useId, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../store/context.js';

// renders one recognized doc link (from remark-doc-link).
// resolution against the doc index happens here, at render time:
//   0 candidates -> broken link (not clickable)
//   1 candidate  -> normal link
//   N candidates -> dropdown to pick the target
export const DocLink = observer(function DocLink({ target, from, kind, children }) {
  const { docStore, sourceStore } = useDocStores();
  const id = useId();
  const refWrap = useRef(null);
  const { targets, hash } = sourceStore.resolveLink(target ?? '', from ?? '');
  const isDropdownOpen = docStore.linkDropdownOpenId === id;

  useEffect(() => {
    if (!isDropdownOpen) return;
    const onDocMouseDown = (event) => {
      if (refWrap.current && !refWrap.current.contains(event.target)) {
        docStore.setLinkDropdownOpen('');
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [isDropdownOpen, docStore]);

  const text = children ?? target;

  if (targets.length === 0) {
    return (
      <span
        className="text-red-600 dark:text-red-400 underline decoration-dashed cursor-not-allowed"
        title={`doc not found in source: ${target}`}
      >
        {text}
      </span>
    );
  }

  if (targets.length === 1) {
    const pathFull = targets[0].internalPath + (hash ? `#${hash}` : '');
    return (
      <a
        href={docStore.toBrowserHref(pathFull)}
        title={targets[0].internalPath}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          docStore.navigate(pathFull);
        }}
      >
        {text}
      </a>
    );
  }

  // multiple docs share this name: let the reader pick
  return (
    <span ref={refWrap} className="relative inline-block">
      <a
        href={docStore.toBrowserHref(targets[0].internalPath)}
        title={`${targets.length} candidate docs`}
        className="decoration-dotted"
        onClick={(event) => {
          event.preventDefault();
          docStore.setLinkDropdownOpen(isDropdownOpen ? '' : id);
        }}
      >
        {text}
        <span className="text-fd-muted-foreground select-none"> ({targets.length})</span>
      </a>
      {isDropdownOpen ? (
        <span className="absolute left-0 top-full z-50 mt-0.5 min-w-max border border-fd-border bg-fd-popover shadow-md rounded-sm p-0.5 flex flex-col">
          {targets.map((t) => (
            <span
              key={t.internalPath}
              className="px-1.5 py-0.5 text-sm cursor-pointer rounded-sm hover:bg-fd-accent whitespace-nowrap"
              onClick={() => {
                docStore.setLinkDropdownOpen('');
                docStore.navigate(t.internalPath + (hash ? `#${hash}` : ''));
              }}
            >
              {t.internalPath}
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );
});
