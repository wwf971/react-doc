import { useEffect, useId, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { LinkDocRender } from './LinkDocRender.jsx';
import { LinkWarning } from './LinkWarning.jsx';

// renders one recognized doc link (from remark-doc-link).
// resolution against the doc index happens here, at render time:
//   0 candidates -> broken link (not clickable)
//   1 candidate  -> normal link
//   N candidates -> dropdown to pick the target
// tags of a single target are shown beside the link when the document
// containing the link resolves TagsDisplayAtLinkIsOn to true, or when the link
// says so inline (tagsDisplay: before | after | on | off, from remark-doc-link).
export const DocLink = observer(function DocLink({ target, from, kind, tagsDisplay = '', children }) {
  const { configStore, docStore, linkConfig, onEvent: onEventPage, tagStore } = useDocStores();
  const id = useId();
  const refWrap = useRef(null);
  const [warningText, setWarningText] = useState('');
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
  const targetFirst = targets[0];
  const isNavigationUnavailable = Boolean(targetFirst)
    && !docStore.isDocNavigable(targetFirst.internalPath);
  const pathFirst = targetFirst
    ? (targetFirst.navigationTarget ?? targetFirst.internalPath) + (hash ? `#${hash}` : '')
    : '';
  const tagsPosition = linkTagsPositionGet({
    configLinkDoc: configStore.configDocGet(from ?? ''),
    tagsDisplay,
  });
  const tagList = tagsPosition && !isBroken && !isMultiple && targetFirst.internalPath
    ? tagStore.tagDisplayListGet(tagStore.tagService.assetKeyGet('doc', targetFirst.internalPath))
    : [];
  const data = {
    displayContent: children ?? target,
    fromPath: from ?? '',
    hash,
    href: pathFirst && !isNavigationUnavailable
      ? docStore.toBrowserHref(pathFirst)
      : undefined,
    kind: kind ?? 'markdown',
    tagList,
    targetList: targets,
    targetRaw: target ?? '',
    titleText: isBroken
      ? `doc not found in source: ${target}`
      : isNavigationUnavailable && !isMultiple
        ? `doc exists but is not included in the side panel: ${targetFirst.internalPath}`
      : isMultiple
        ? `${targets.length} candidate docs`
        : targetFirst.internalPath,
  };
  const config = {
    isBroken,
    isClickable: !isBroken,
    isCurrent: !isMultiple
      && !isNavigationUnavailable
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

  const eventHandle = async (eventType, eventData = {}) => {
    const event = eventData.event;
    if (
      eventType === 'activateRequest'
      && !isMultiple
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
    if (resultLink?.isHandled || resultPage?.isHandled) return;

    if (eventType === 'activateRequest') {
      if (isBroken) {
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
    <span ref={refWrap} className="doc-link-controller">
      <CompRender data={data} config={config} onEvent={eventHandle} />
      <LinkWarning text={warningText} onDismiss={() => setWarningText('')} />
    </span>
  );
});

// '' (no tags), 'before' or 'after'. the inline value of the link wins over
// the document config of the page containing the link.
function linkTagsPositionGet({ configLinkDoc, tagsDisplay }) {
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
