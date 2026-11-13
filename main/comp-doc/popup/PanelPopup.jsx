import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { usePanelLayout } from './use-panel-layout.js';
import './DocBlockPopup.css';

// A dialog of the page for whatever a component wants shown apart from its
// place in the document: its pages as printed, a larger view, a form
// (doc_page_impl_popup.md#a-dialog-of-a-component). It is the host's panel
// component (doc_page_impl.md#the-panel-contract) with what every dialog of
// the page does already done: moved by its header, resized by its edges, its
// size remembered for the next opening, maximized and restored, closed by
// its button and by Escape.
//
//   <PanelPopup panelId="cvPages" title="The pages" isOpen={store.isPagesOpen}
//     onClose={store.pagesClose} headerRightContent={<Buttons />} className="my-dialog">
//     {content}
//   </PanelPopup>
//
//   panelId              the dialog, for the place and size the page keeps of it
//   isOpen, onClose      its state is the component's: the dialog only asks to close
//   title                its title; headerRightContent: controls in its header
//   className            the size it opens in (a class giving width and height)
//   bodyClassName        the class of its content box
//
// The block popup (BlockPopupSurface) is for a block shown larger with its own
// View / Edit; this one is for a second thing a component shows. Without a
// panel component of the host there is no dialog: the content is drawn in
// place, where the component put the popup, so nothing is lost.
const panelLayoutOption = { isMovable: true, isResizable: true, isSizeRemembered: true, isExpandable: true };

export const PanelPopup = observer(function PanelPopup({ panelId, title = '', isOpen = false, onClose, headerRightContent, className = '', bodyClassName = '', children }) {
  const { compConfigHost } = useDocStores();
  const Panel = compConfigHost?.panelComponent;
  const panelLayout = usePanelLayout(panelId, isOpen, panelLayoutOption);

  useEffect(() => {
    if (!isOpen || !Panel) return undefined;
    // a control that takes Escape itself prevents the default; the dialog stays open then
    const keyDownHandle = (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose?.();
    };
    window.addEventListener('keydown', keyDownHandle);
    return () => window.removeEventListener('keydown', keyDownHandle);
  }, [isOpen, Panel, onClose]);

  if (!isOpen) return null;
  if (!Panel) return <div className={bodyClassName}>{headerRightContent}{children}</div>;
  return (
    <Panel
      data={{ title }}
      config={{
        isPopup: true,
        isCloseVisible: true,
        className: `doc-panel-popup${className ? ` ${className}` : ''}`,
        bodyClassName: `doc-panel-popup-body${bodyClassName ? ` ${bodyClassName}` : ''}`,
        ...panelLayout.config,
      }}
      headerRightContent={headerRightContent}
      content={children}
      onEvent={(eventType, eventData) => {
        if (panelLayout.eventHandle(eventType, eventData)) return;
        if (eventType === 'closeRequest') onClose?.();
      }}
    />
  );
});
