import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../main/frontend/src/store/context.js';
import { TagList } from '../../main/comp-mdx/tag/TagList.jsx';

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
