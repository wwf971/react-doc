import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { RegisteredComp } from '../registry/RegisteredComp.jsx';
import './TagOverviewPopup.css';

// Popup with the overview of one tag, opened by clicking a tag on a side-panel
// item or next to the path bar of the main panel. Open state lives in
// DocTagStore (overviewTagId). The popup frame is the host's text panel
// component (config.compConfigHost.panelComponent); its content is the
// registry component named TagOverview, placement "tagOverview".
export const TagOverviewPopup = observer(function TagOverviewPopup() {
  const { compConfigHost, docStore, tagStore } = useDocStores();
  const Panel = compConfigHost.panelComponent;
  const tagId = tagStore.overviewTagId;
  const isOpen = Boolean(Panel) && tagId !== '';

  useEffect(() => {
    if (!isOpen) return undefined;
    const keyDownHandle = (event) => {
      if (event.key === 'Escape') tagStore.overviewClose();
    };
    window.addEventListener('keydown', keyDownHandle);
    return () => window.removeEventListener('keydown', keyDownHandle);
  }, [isOpen, tagStore]);

  if (!isOpen) return null;
  const overview = tagStore.overviewGet(tagId);
  return (
    <Panel
      data={{ title: `Tag: ${overview.tag.data.text ?? tagId}` }}
      config={{
        isPopup: true,
        isCloseVisible: true,
        className: 'doc-tag-overview-popup',
        bodyClassName: 'doc-tag-overview-popup-body',
      }}
      content={(
        <RegisteredComp
          compName="TagOverview"
          configRuntime={{ instanceId: `tag-overview-popup:${tagId}`, tagService: tagStore.tagService }}
          input={{ data: { tagId, overview, itemCurrentId: docStore.itemCurrentId } }}
          onEventRuntime={(eventType, eventData) => {
            if (eventType !== 'navigateRequest' || !eventData.target) return undefined;
            const isNavigated = docStore.navigate(eventData.target);
            if (isNavigated) tagStore.overviewClose();
            return { isHandled: true };
          }}
          placement="tagOverview"
        />
      )}
      onEvent={(eventType) => {
        if (eventType === 'closeRequest') tagStore.overviewClose();
      }}
    />
  );
});

// tags are clickable only when the popup is switched on in globalConfig
// (TagsOverviewPopupIsOn) and the host supplies a panel component for it
export function useTagOverviewIsAvailable() {
  const { compConfigHost, tagStore } = useDocStores();
  return tagStore.isOverviewPopupOn && Boolean(compConfigHost.panelComponent);
}
