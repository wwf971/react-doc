import { observer } from 'mobx-react-lite';
import { TagIcon } from '../../main/frontend/UICommon.js';
import { useDocStores } from '../../main/frontend/src/store/context.js';
import { TagList } from '../../built-in/comp-mdx/tag/TagList.jsx';

// Demo component: every tag known to the page, and the assets bound to it,
// read from the tag service (DocTagStore).
export const TagListAllDemo = observer(function TagListAllDemo() {
  const { tagStore } = useDocStores();
  return (
    <div className="not-prose my-2 text-sm">
      {tagStore.tagIdList.map((tagId) => {
        const define = tagStore.tagDefineGet(tagId);
        const assetList = tagStore.assetListGet(tagId);
        const tagDisplay = {
          id: tagId,
          compName: define.compName,
          data: { ...define.data, tagId, text: define.text },
        };
        return (
          <div key={tagId} className="border-b border-fd-border py-1">
            <div className="flex flex-row items-center gap-2">
              <TagList data={{ tagList: [tagDisplay] }} config={{ instanceId: `tag-list-all-demo:${tagId}` }} />
              <span className="font-mono text-xs text-fd-muted-foreground select-text">
                {tagId}{define.isDefined ? '' : ' (no definition in config)'}
              </span>
            </div>
            {assetList.length === 0 ? (
              <div className="text-xs text-fd-muted-foreground">no asset carries this tag</div>
            ) : assetList.map((asset) => (
              <div key={asset.assetKey} className="font-mono text-xs select-text">
                {asset.assetType} {asset.assetId}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
});

// read from the tag service, nothing to edit: read-only. mounted by
// comp.yaml of this folder (tag TagListAllDemo)
export const tagListAllDemoDefineOptions = {
  placementList: ['mdx', 'commentBlock'],
  expose: {
    meta: { isReadOnly: true, label: 'All tags (demo)', description: 'Every tag the page knows; read from the tag service, nothing to edit.' },
    icon: TagIcon,
    sourceDefaultCreate: () => ({
      lang: 'text',
      raw: 'Every tag of the page; replaced by the TagListAllDemo component.',
    }),
  },
};
