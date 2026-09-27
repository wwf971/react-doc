import { observer } from 'mobx-react-lite';
import { FileIcon, FolderIcon } from '#react-doc/frontend/UICommon.js';
import { useDocStores } from '#react-doc/frontend/src/store/context.js';
import { TagList } from './TagList.jsx';
import './TagOverview.css';

// Default overview of the assets carrying one tag. Registered as
// common/TagOverview under the built-in name TagOverview; mapping that name in
// compRegistry replaces it, also inside the tag overview popup.
//
//   data.tagId          tag to show
//   data.overview       optional, prepared by the popup host; otherwise read
//                       from the tag service. shape: lib/doc-tag-overview.js
//   data.itemCurrentId  optional, side-panel item to mark as current
//
// Events emitted:
//   navigateRequest { target }   an item of the overview was activated
//
// In a document: <!--renderComp=TagOverview,tagId=guide-->
export const TagOverview = observer(function TagOverview({ data = {}, onEvent }) {
  const { docStore, tagStore } = useDocStores();
  const overview = data.overview ?? tagStore.overviewGet(String(data.tagId ?? ''));
  const itemCurrentId = data.itemCurrentId ?? docStore.itemCurrentId;
  const isEmpty = overview.nodeList.length === 0 && overview.assetListOutside.length === 0;
  return (
    <div className="doc-tag-overview not-prose">
      <div className="doc-tag-overview-head">
        <TagList data={{ tagList: [overview.tag] }} config={{ instanceId: `tag-overview:${overview.tagId}` }} />
        <span className="doc-tag-overview-count">
          {overview.assetCount === 1 ? '1 asset' : `${overview.assetCount} assets`}
        </span>
      </div>
      {isEmpty ? <div className="doc-tag-overview-empty">No asset carries this tag.</div> : null}
      {overview.nodeList.length > 0 ? (
        <div className="doc-tag-overview-section">
          <div className="doc-tag-overview-section-title">In the side panel</div>
          <TagOverviewNodeList
            nodeList={overview.nodeList}
            depth={0}
            itemCurrentId={itemCurrentId}
            hrefGet={(route) => docStore.toBrowserHref(route)}
            onEvent={onEvent}
          />
        </div>
      ) : null}
      {overview.assetListOutside.length > 0 ? (
        <div className="doc-tag-overview-section is-outside">
          <div className="doc-tag-overview-section-title">Not in the side panel</div>
          {overview.assetListOutside.map((asset) => (
            <div key={asset.assetKey} className="doc-tag-overview-row is-muted" title={asset.assetKey}>
              <span className="doc-tag-overview-row-icon"><FileIcon width={13} height={13} /></span>
              <span className="doc-tag-overview-row-text">{asset.title}</span>
              <span className="doc-tag-overview-row-path">{asset.assetId}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
});

function TagOverviewNodeList({ nodeList, depth, itemCurrentId, hrefGet, onEvent }) {
  return nodeList.map((node) => {
    const isFolder = node.children.length > 0 || node.kind === 'folder';
    const Icon = isFolder ? FolderIcon : FileIcon;
    const className = `doc-tag-overview-row${node.isTagged ? '' : ' is-muted'}${node.itemId === itemCurrentId ? ' is-current' : ''}`;
    return (
      <div key={node.itemId}>
        <div className={className} style={{ paddingInlineStart: `${depth * 14}px` }}>
          <span className="doc-tag-overview-row-icon"><Icon width={13} height={13} /></span>
          {node.route ? (
            <a
              className="doc-tag-overview-row-text is-link"
              href={hrefGet(node.route)}
              onClick={(event) => {
                event.preventDefault();
                onEvent?.('navigateRequest', { target: node.route });
              }}
            >
              {node.text}
            </a>
          ) : (
            <span className="doc-tag-overview-row-text">{node.text}</span>
          )}
        </div>
        {node.children.length > 0 ? (
          <TagOverviewNodeList
            nodeList={node.children}
            depth={depth + 1}
            itemCurrentId={itemCurrentId}
            hrefGet={hrefGet}
            onEvent={onEvent}
          />
        ) : null}
      </div>
    );
  });
}
