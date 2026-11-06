import { useEffect, useId, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { eventResultIsAccepted, resultNormalize } from '../../frontend/src/lib/doc-event.js';
import { LinkDocRender } from './LinkDocRender.jsx';
import { LinkWarning } from './LinkWarning.jsx';
import { SourceLinkRenderPopup } from '../../../built-in/comp-mdx/source-link/SourceLinkRenderPopup.jsx';

// renders one recognized doc link (from remark-doc-link).
// resolution against the doc index happens here, at render time:
//   0 candidates -> broken link (not clickable)
//   1 candidate  -> normal link
//   N candidates -> dropdown to pick the target
// tags of a single target are shown beside the link when the document
// containing the link resolves TagsDisplayAtLinkIsOn to true, or when the link
// says so inline (tagsDisplay: before | after | on | off, from remark-doc-link).
// configDocOverride: document-level config values that replace the values of
// the containing document, e.g. part.index.config for a hosted part index.
// line: the line the link is written on in its document (remark-doc-link,
// the compile of a document only). the controller carries the target as
// written and the line, so a navigation to a backlink finds the link in the
// rendered body (doc_page_impl_nav_backlink.md#going-to-a-backlink).
export const DocLink = observer(function DocLink({
  target,
  from,
  kind,
  tagsDisplay = '',
  configDocOverride,
  line,
  children,
}) {
  const { configStore, docStore, sourceStore, compConfigHost, linkConfig, onEvent: onEventPage, tagStore } = useDocStores();
  const id = useId();
  const refWrap = useRef(null);
  const [warningText, setWarningText] = useState('');
  const [pathPopup, setPathPopup] = useState('');
  const Panel = compConfigHost?.panelComponent;
  const { targetList: targets, hash } = docStore.docTargetResolve(target ?? '', from ?? '');
  const isDropdownOpen = docStore.linkDropdownOpenId === id;
  const CompRender = linkConfig.CompRender ?? LinkDocRender;

  useEffect(() => {
    if (!isDropdownOpen && !warningText) return;
    const onDocMouseDown = (event) => {
      if (refWrap.current && !refWrap.current.contains(event.target)) {
        docStore.setLinkDropdownOpen('');
        setWarningText('');
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [isDropdownOpen, warningText, docStore]);

  useEffect(() => setWarningText(''), [target, from]);

  const isBroken = targets.length === 0;
  const isMultiple = targets.length > 1;
  // a link to a playground that does not exist in this checkout is broken, as it is, and
  // still leads somewhere: the error page of its item, which offers to create it
  // (doc_page_impl_test.md#what-each-place-shows)
  const playgroundMissing = isBroken ? sourceStore?.playgroundOfLinkTarget(target) : undefined;
  const itemPlaygroundMissing = playgroundMissing
    ? docStore.treeModel.items?.find((item) => item.type === 'missing-doc' && sourceStore.playgroundOfReference(item.sourceReference)?.id === playgroundMissing.id)
    : undefined;
  const targetFirst = targets[0];
  const isPopupTarget = (path) => {
    const entry = sourceStore?.entryByInternalPath.get(path);
    return Boolean(Panel && entry)
      && !docStore.isDocNavigable(path)
      && (['md', 'mdx'].includes(entry.ext)
        || Object.hasOwn(sourceStore.configDoc.fileDisplay ?? {}, entry.ext));
  };
  const isPopup = !isMultiple && Boolean(targetFirst) && isPopupTarget(targetFirst.internalPath);
  const isNavigationUnavailable = Boolean(targetFirst)
    && !isMultiple && !isPopup
    && !docStore.isDocNavigable(targetFirst.internalPath);
  const pathFirst = targetFirst
    ? (targetFirst.navigationTarget ?? targetFirst.internalPath) + (hash ? `#${hash}` : '')
    : '';
  const tagsPosition = linkTagsPositionGet({
    configLinkDoc: { ...configStore.configDocGet(from ?? ''), ...configDocOverride },
    tagsDisplay,
  });
  const tagList = tagsPosition && !isBroken && !isMultiple && targetFirst.internalPath
    ? tagStore.tagDisplayListGet(tagStore.tagService.assetKeyGet('doc', targetFirst.internalPath))
    : [];
  const data = {
    ariaHasPopup: isPopup ? 'dialog' : undefined,
    displayContent: children ?? target,
    fromPath: from ?? '',
    hash,
    href: itemPlaygroundMissing
      ? docStore.toBrowserHref(itemPlaygroundMissing.route)
      : pathFirst && !isNavigationUnavailable && !isPopup
        ? docStore.toBrowserHref(pathFirst)
        : undefined,
    kind: kind ?? 'markdown',
    tagList,
    targetList: targets,
    targetRaw: target ?? '',
    titleText: playgroundMissing
      ? `${playgroundMissing.title} does not exist in this checkout: open its page to create it`
      : isBroken
      ? `doc not found in source: ${target}`
      : isNavigationUnavailable && !isMultiple
        ? `doc exists but is not included in the side panel: ${targetFirst.internalPath}`
      : isMultiple
        ? `${targets.length} candidate docs`
        : targetFirst.internalPath,
  };
  const config = {
    activationElement: isPopup ? 'button' : 'anchor',
    isBroken,
    isClickable: !isBroken || Boolean(itemPlaygroundMissing),
    isCurrent: !isMultiple
      && !isNavigationUnavailable && !isPopup
      && Boolean(targetFirst?.internalPath)
      && targetFirst.internalPath === docStore.docCurrentPath
      && (hash || '') === (docStore.docCurrentHash || ''),
    isDropdownOpen,
    isMultiple,
    isNavigationUnavailable,
    Icon: linkConfig.Icon,
    instanceId: `doc-link:${id}`,
    tagsPosition,
  };

  const popupOpen = async (path) => {
    setWarningText('');
    try {
      await sourceStore.loadDoc(path);
      const compiled = sourceStore.compiledByPath[path];
      if (compiled?.status === 'done') setPathPopup(path);
      else setWarningText(compiled?.message || `Unable to open document: ${path}`);
    } catch (error) {
      setWarningText(error instanceof Error ? error.message : String(error));
    }
  };

  const eventHandle = async (eventType, eventData = {}) => {
    const event = eventData.event;
    if (eventType === 'activateRequest' && itemPlaygroundMissing) {
      docStore.navigate(itemPlaygroundMissing.route);
      return { code: 0, message: '' };
    }
    if (
      eventType === 'activateRequest'
      && !isMultiple
      && !isPopup
      && (event?.metaKey || event?.ctrlKey || event?.shiftKey || event?.altKey)
    ) return;
    event?.preventDefault();
    const eventForward = {
      ...eventData,
      fromPath: data.fromPath,
      hash,
      kind: data.kind,
      targetRaw: data.targetRaw,
    };
    const [resultLink, resultPage] = await Promise.all([
      linkConfig.onEvent?.(eventType, eventForward),
      onEventPage?.(`link:${eventType}`, eventForward),
    ]);
    // a host result with code 0 means the host took the activation over
    if (eventResultIsAccepted(resultNormalize(resultLink)) || eventResultIsAccepted(resultNormalize(resultPage))) return;

    if (eventType === 'activateRequest') {
      if (isBroken) {
        return;
      }
      if (isPopup) {
        await popupOpen(targetFirst.internalPath);
        return;
      }
      if (isNavigationUnavailable) {
        docStore.clearNavigationError();
        setWarningText(data.titleText);
        return;
      }
      if (isMultiple) {
        setWarningText('');
        docStore.setLinkDropdownOpen(isDropdownOpen ? '' : id);
        return;
      }
      const isNavigated = docStore.navigate(pathFirst);
      if (!isNavigated) {
        setWarningText(docStore.navigationError || data.titleText);
        docStore.clearNavigationError();
      } else {
        setWarningText('');
      }
      return;
    }
    if (eventType === 'candidateSelectRequest' && eventData.target) {
      docStore.setLinkDropdownOpen('');
      if (isPopupTarget(eventData.target.internalPath)) {
        await popupOpen(eventData.target.internalPath);
        return;
      }
      const isNavigated = docStore.navigate(eventData.target.internalPath + (hash ? `#${hash}` : ''));
      if (!isNavigated) {
        setWarningText(docStore.navigationError || data.titleText);
        docStore.clearNavigationError();
      } else {
        setWarningText('');
      }
    }
  };

  return (
    <span
      ref={refWrap}
      className="doc-link-controller"
      data-doc-link-target={target ?? ''}
      data-doc-link-line={line || undefined}
    >
      <CompRender data={data} config={config} onEvent={eventHandle} />
      <LinkWarning text={warningText} anchorRef={refWrap} onDismiss={() => setWarningText('')} />
      {pathPopup && Panel ? <SourceLinkRenderPopup Panel={Panel} store={{
        pathPopup,
        isPopupOpen: true,
        popupClose: () => setPathPopup(''),
      }} /> : null}
    </span>
  );
});

// '' (no tags), 'before' or 'after'. the inline value of the link wins over
// the document config of the page containing the link. shared by every link
// renderer (DocLink, SourceLink), so all links follow one tag policy.
export function linkTagsPositionGet({ configLinkDoc, tagsDisplay }) {
  if (tagsDisplay === 'off') return '';
  if (tagsDisplay === 'before' || tagsDisplay === 'after') return tagsDisplay;
  const isOn = tagsDisplay === 'on' || configLinkDoc.TagsDisplayAtLinkIsOn === true;
  return isOn ? configLinkDoc.TagsDisplayAtLinkPosition ?? 'after' : '';
}

// adapts the standard registered-component input { data, config } to DocLink,
// so a document link can be used wherever a registered component is expected
// (for example a FileTree description). Not specific to FileTree.
//   data.tagsDisplay   optional: before | after | on | off, as the link title marker
export function DocLinkInline({ data = {}, config = {} }) {
  return (
    <DocLink
      target={data.target ?? ''}
      from={config.sourcePath}
      kind="inline"
      tagsDisplay={data.tagsDisplay ?? ''}
    >
      {data.text ?? data.target ?? ''}
    </DocLink>
  );
}
