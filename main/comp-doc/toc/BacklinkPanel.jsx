import { useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { DocLink } from '../link/DocLink.jsx';
import { usePanelHeightAvailable } from './use-panel-height-available.js';
import './BacklinkPanel.css';

// The backlinks of the current document, in the right column
// (doc_page_impl_nav_backlink.md#the-backlinks-panel): the documents that
// reference it, in side-panel order, and under each the references as
// written, with the headings above each and the sentence around it. A
// reference opens its document at the link (DocLinkStore.backlinkOpen);
// one that points at a place of this document also offers that place.
export const BacklinkPanel = observer(function BacklinkPanel({ isVisible, labels }) {
  const { linkStore } = useDocStores();
  const refPanel = useRef(null);
  const groupList = linkStore.backlinkGroupListCurrent;
  const count = linkStore.backlinkCountCurrent;
  usePanelHeightAvailable(refPanel, { isVisible, dependencyList: [count, groupList.length] });

  return (
    <div
      ref={refPanel}
      className="doc-toc-panel doc-backlink-panel"
      hidden={!isVisible}
      role="region"
      aria-label={labels.backlinks}
    >
      <div className="doc-backlink-summary" role="status">
        {count === 0 ? labels.backlinkNone : labels.backlinkSummaryGet(count, groupList.length)}
      </div>
      {count === 0 ? (
        <p className="doc-note doc-backlink-hint">{labels.backlinkNoneHint}</p>
      ) : (
        <ul className="doc-backlink-group-list">
          {groupList.map((group) => (
            <BacklinkGroup key={group.docPath} group={group} labels={labels} />
          ))}
        </ul>
      )}
    </div>
  );
});

const BacklinkGroup = observer(function BacklinkGroup({ group, labels }) {
  const { docStore, linkStore } = useDocStores();
  const isNavigable = docStore.isDocNavigable(group.docPath);
  return (
    <li className="doc-backlink-group">
      <div className="doc-backlink-group-head">
        {/* the document link of the page: it navigates, views a document
            without a side-panel item, or says why it cannot */}
        <DocLink target={group.docPath} from={docStore.docCurrentPath} kind="backlink" tagsDisplay="off">
          {linkStore.docLabelGet(group.docPath)}
        </DocLink>
        <span className="doc-backlink-group-count" aria-label={`${group.backlinkList.length}`}>
          {group.backlinkList.length}
        </span>
      </div>
      <ul className="doc-backlink-item-list">
        {group.backlinkList.map((backlink) => (
          <BacklinkItem key={backlink.key} backlink={backlink} isNavigable={isNavigable} labels={labels} />
        ))}
      </ul>
    </li>
  );
});

const BacklinkItem = observer(function BacklinkItem({ backlink, isNavigable, labels }) {
  const { docStore, linkStore } = useDocStores();
  const { reference, fragment } = backlink;
  const language = docStore.languageDisplay;
  const trail = reference.headingTrail.map((text) => headingTextGet(text, language));
  const context = reference.context;
  const badge = constructBadgeGet(reference.construct);
  const isTargetCurrent = linkStore.backlinkTargetIsCurrent(backlink);
  return (
    <li className={`doc-backlink-item${isTargetCurrent ? ' is-target-current' : ''}`}>
      <button
        type="button"
        className="doc-backlink-item-main"
        title={isNavigable ? labels.backlinkOpen : labels.backlinkNotNavigable}
        disabled={!isNavigable}
        onClick={() => linkStore.backlinkOpen(backlink)}
      >
        {trail.length > 0 ? (
          <span className="doc-backlink-trail" title={trail.join(' › ')}>{trail.join(' › ')}</span>
        ) : null}
        <span className="doc-backlink-context">
          {badge ? (
            <span className="doc-badge doc-backlink-badge" data-kind={badge.kind}>{badge.text}</span>
          ) : null}
          {context ? (
            <>
              {context.before}
              <mark className="doc-backlink-label">{context.label}</mark>
              {context.after}
            </>
          ) : (
            <span className="doc-backlink-target">{reference.target}</span>
          )}
        </span>
      </button>
      {fragment ? (
        <button
          type="button"
          className="doc-backlink-fragment"
          title={labels.backlinkToPlace}
          aria-current={isTargetCurrent ? 'location' : undefined}
          onClick={() => linkStore.backlinkTargetOpen(backlink)}
        >
          {`#${fragmentDecode(fragment)}`}
        </button>
      ) : null}
    </li>
  );
});

// what declared the reference, when it is worth a badge: a plain link,
// inline code or wiki link is the ordinary case and gets none; an image,
// a component's data (Index, BlockQA, ...) or a dataRef says so
function constructBadgeGet(construct) {
  const value = String(construct ?? '');
  if (value === 'link' || value === 'inline code' || value === 'wiki link' || value === '') return undefined;
  if (value === 'image') return { kind: 'image', text: 'image' };
  if (value.startsWith('link "')) return { kind: 'source', text: 'inline link' };
  if (value.startsWith('dataRef of ')) return { kind: 'component', text: `${value.slice('dataRef of '.length)} · dataRef` };
  return { kind: 'component', text: value };
}

function fragmentDecode(fragment) {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

// a heading title as the index read it. a multilingual heading is written
// as a language mapping, {jp: "...", en: "..."}; the display language's
// translation is shown, else the first
function headingTextGet(text, language) {
  const value = String(text ?? '').trim();
  if (!value.startsWith('{') || !value.endsWith('}')) return value;
  const translationByLanguage = {};
  for (const match of value.slice(1, -1).matchAll(/([\w-]+)\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
    translationByLanguage[match[1]] = match[2].replace(/\\(.)/g, '$1');
  }
  const languageList = Object.keys(translationByLanguage);
  if (languageList.length === 0) return value;
  return translationByLanguage[language] ?? translationByLanguage[languageList[0]];
}
