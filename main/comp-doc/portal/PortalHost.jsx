import { useMemo, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { BookOpen, LoaderCircle, TriangleAlert } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { PORTAL_PLACEMENT } from '../../frontend/src/lib/doc-portal.js';
import { RegisteredComp } from '../registry/RegisteredComp.jsx';
import { objectFrontendServiceBuild } from '../object-frontend/object-frontend-service.js';
import { PortalSwitcher } from './PortalSwitcher.jsx';
import './Portal.css';

// The host of a portal of its own (doc_page_impl_portal.md#the-host): what the page draws in the
// place of the documents while one is shown. The whole window is the portal's; the host adds
// nothing but the standard switcher floating at the top left, for a component that draws none
// (expose.portal.switcherPlace 'floating'). The dialogs of the page (the settings panel, the
// command palette, a popup a component opens) stay the page's, over it.
//
// The component of the portal is rendered through the registry boundary in the placement
// "portal", with
//   data     { ref, portalId, param }: who provides it, which portal it is, its parameters
//   config   portal: the portal and the page around it (DocPortalStore.serviceGet)
//            objectFrontend: the api of the object providing it, as a mode has it (its
//            isEditable follows the portal's own editing: config.portal.editSet)
// A portal the registry does not know, or whose component the page has not, says so here, with
// the way back to the documents: the page is never left blank.
//
// A portal drawn stays drawn while its provider is read again: an object whose entry was just
// rewritten (a portal writing the metadata of its own object) is not known for a moment, and the
// registry then answers "not known yet" (isLoading). The host keeps the portal it drew last, and the
// type of its object, until the registry knows again, so an app is never taken down and mounted
// anew by its own write.
export const PortalHost = observer(function PortalHost() {
  const { objectFrontendStore, portalStore } = useDocStores();
  const id = portalStore.portalIdOpen;
  const heldRef = useRef({ portal: undefined, typeId: '' });
  const portalKnown = portalStore.portalGet(id);
  if (portalKnown) heldRef.current = { portal: portalKnown, typeId: heldRef.current.portal?.id === id ? heldRef.current.typeId : '' };
  else if (!portalStore.isLoading || heldRef.current.portal?.id !== id) heldRef.current = { portal: undefined, typeId: '' };
  const portal = portalKnown ?? heldRef.current.portal;
  const service = portalStore.serviceGet(id);
  const providerRef = portal?.providerKind === 'objectFrontend' ? portal.providerRef : '';
  const typeIdKnown = providerRef ? objectFrontendStore.objectGet(providerRef).typeId : '';
  if (typeIdKnown) heldRef.current.typeId = typeIdKnown;
  const typeId = typeIdKnown || heldRef.current.typeId;
  // the api of the providing object, without a block: its switches answer that there is none
  const objectService = useMemo(
    () => (providerRef ? objectFrontendServiceBuild({
      objectFrontendStore,
      ref: providerRef,
      modeList: typeId ? objectFrontendStore.modeListGet(typeId) : [],
      param: {},
      blockSwitch: () => Promise.resolve({ code: -1, message: 'a portal has no block to switch: it keeps its own place (config.portal.atSet)' }),
      docState: service.docState,
      blockKey: `portal:${id}`,
    }) : undefined),
    [objectFrontendStore, providerRef, typeId, service, id],
  );

  if (!portal) {
    return (
      <PortalHostNote portalStore={portalStore} isWaiting={portalStore.isLoading}>
        {portalStore.isLoading ? 'Opening the portal…' : <>No portal of this page is named <code>{id}</code>.</>}
      </PortalHostNote>
    );
  }
  const problem = portalStore.compProblemGet(portal);
  if (problem) return <PortalHostNote portalStore={portalStore}>The portal {portal.label} cannot be drawn: {problem}.</PortalHostNote>;
  const isSwitcherFloating = portalStore.isSwitcherOffered && portalStore.switcherPlaceGet(portal) === 'floating';
  return (
    <div className="doc-portal-host" data-portal-id={id} data-portal-name={portal.name} data-device={portalStore.device}>
      <RegisteredComp
        key={id}
        compName={portal.comp}
        placement={PORTAL_PLACEMENT}
        input={{ data: { ref: portal.providerRef, portalId: id, param: portal.param } }}
        configRuntime={{ portal: service, ...(objectService ? { objectFrontend: objectService } : {}), docState: service.docState, sourcePath: '', instanceId: `portal:${id}` }}
      />
      {isSwitcherFloating ? <div className="doc-portal-host-switcher"><PortalSwitcher variant="floating" /></div> : null}
    </div>
  );
});

// a line in the middle of the window, with the way back: the switcher when there are other
// portals, and the documents
const PortalHostNote = observer(function PortalHostNote({ portalStore, isWaiting = false, children }) {
  return (
    <div className="doc-portal-host doc-portal-host-note" data-waiting={isWaiting ? '' : undefined}>
      <div className="doc-portal-host-note-card" role={isWaiting ? 'status' : 'alert'}>
        {isWaiting ? <LoaderCircle size={16} className="doc-spin" aria-hidden="true" /> : <TriangleAlert size={16} aria-hidden="true" />}
        <p>{children}</p>
        {isWaiting ? null : (
          <button type="button" className="doc-button" onClick={() => portalStore.docOpen()}>
            <BookOpen size={13} aria-hidden="true" /><span>Open the documents</span>
          </button>
        )}
      </div>
      {portalStore.isSwitcherOffered ? <div className="doc-portal-host-switcher"><PortalSwitcher variant="floating" /></div> : null}
    </div>
  );
});
