import { useEffect, useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { SourceLinkRenderPopup } from '../../../built-in/comp-mdx/source-link/SourceLinkRenderPopup.jsx';
import { DocNavArrivalContext } from './DocNavScope.js';

// The inline popup of the page (doc_page_impl_nav.md#routing-a-navigation): the document
// the api nav/popup opened, rendered by the popup of a source link. One per page, so
// whoever asks for a popup (a link, an agent, the owner of a registered document) gets the
// same one. What it renders is told where the reader was going, when the document stands
// for another one (DocNavArrivalContext).
export const DocNavPopup = observer(function DocNavPopup() {
  const { navStore, compConfigHost } = useDocStores();
  const Panel = compConfigHost?.panelComponent;
  useEffect(() => {
    navStore?.popupAvailableSet(Boolean(Panel));
    return () => navStore?.popupAvailableSet(false);
  }, [navStore, Panel]);
  const popup = navStore?.popup;
  const arrival = useMemo(() => (popup?.arrival ? { ...popup.arrival, version: popup.version } : null), [popup]);
  // the place asked for, once the body is there
  useEffect(() => {
    if (!popup?.path || !popup.hash) return undefined;
    let frameId = 0;
    let countTry = 0;
    const find = () => {
      const element = document.querySelector(`.doc-source-link-render-doc [id="${CSS.escape(popup.hash)}"]`);
      if (element) element.scrollIntoView({ block: 'start' });
      else if ((countTry += 1) < 30) frameId = requestAnimationFrame(find);
    };
    frameId = requestAnimationFrame(find);
    return () => cancelAnimationFrame(frameId);
  }, [popup]);
  if (!navStore || !Panel) return null;
  return (
    <DocNavArrivalContext.Provider value={arrival}>
      <SourceLinkRenderPopup Panel={Panel} store={navStore} />
    </DocNavArrivalContext.Provider>
  );
});
