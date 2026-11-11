import { useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { DocsLayout, DocsLayoutContainer, FrameworkProvider, RootProvider, ThemeSwitch } from '../UICommon.js';
import { DocEnvStore } from './store/DocEnvStore.js';
import { DocSourceStore } from './store/DocSourceStore.js';
import { DocSourceFileStore, sourceEventTypeList } from './store/DocSourceFileStore.js';
import { DocStore } from './store/DocStore.js';
import { DocLinkStore } from './store/DocLinkStore.js';
import { DocConfigStore } from './store/DocConfigStore.js';
import { DocEditStore, editEventTypeList } from './store/DocEditStore.js';
import { DocAssetStore, assetEventTypeList } from './store/DocAssetStore.js';
import { DocServiceStore, serviceEventTypeList } from './store/DocServiceStore.js';
import { DocTagStore } from './store/DocTagStore.js';
import { DocBlockPopupStore } from './store/DocBlockPopupStore.js';
import { DocNavStore } from './store/DocNavStore.js';
import { DocSidePanelStore, sidePanelEventTypeList } from './store/DocSidePanelStore.js';
import { DocPasteStore } from './store/DocPasteStore.js';
import { DocBlockSelectStore } from './store/DocBlockSelectStore.js';
import { DocPanelLayoutStore } from './store/DocPanelLayoutStore.js';
import { DocWorkspaceStore } from './store/DocWorkspaceStore.js';
import { DocSlashStore } from './store/DocSlashStore.js';
import { DocApiStore } from './store/DocApiStore.js';
import { DocPaletteStore } from './store/DocPaletteStore.js';
import { DocFindStore } from './store/DocFindStore.js';
import { DocHotkeyStore } from './store/DocHotkeyStore.js';
import { DocObjectStore, objectEventTypeList } from './store/DocObjectStore.js';
import { objectProviderDocCreate } from './lib/doc-object-provider-doc.js';
import { objectProviderLinkCreate } from './lib/doc-object-provider-link.js';
import { objectProviderAssetCreate } from './lib/doc-object-provider-asset.js';
import { objectProviderBackendCreate } from './lib/doc-object-provider-backend.js';
import { objectProviderFrontendCreate } from './lib/doc-object-provider-frontend.js';
import { DocObjectFrontendStore } from './store/DocObjectFrontendStore.js';
import { DocEventRouter } from './lib/doc-event.js';
import { DocCompStateStore } from './store/DocCompStateStore.js';
import { StoreContext, useDocStores } from './store/context.js';
import { makeFramework } from './lib/framework-adapter.jsx';
import { DocPageView } from './DocPageView.jsx';
import { DocNavigationButtons } from '../../comp-doc/page/DocNavigationButtons.jsx';
import { DocSearchDialog } from '../../comp-doc/page/DocSearchDialog.jsx';
import { DocSidebarFolder } from '../../comp-doc/side-panel/DocSidebarFolder.jsx';
import { TagOverviewPopup } from '../../comp-doc/tag/TagOverviewPopup.jsx';
import { AssetPanelPopup } from '../../comp-doc/asset/AssetPanelPopup.jsx';
import { DocBlockPopup } from '../../comp-doc/popup/DocBlockPopup.jsx';
import { DocNavPopup } from '../../comp-doc/link/DocNavPopup.jsx';
import { SourceFilePrompt } from '../../comp-doc/source/SourceFilePrompt.jsx';
import { SidePanelMovePicker } from '../../comp-doc/side-panel/SidePanelMovePicker.jsx';
import { SidePanelItemDialog } from '../../comp-doc/side-panel/SidePanelItemDialog.jsx';
import { SidePanelDragOverlay } from '../../comp-doc/side-panel/SidePanelDragOverlay.jsx';
import { SidePanelItemContextMenu } from '../../comp-doc/side-panel/SidePanelItemContextMenu.jsx';
import { DocPastePopup } from '../../comp-doc/paste/DocPastePopup.jsx';
import { DocBlockSelectMenu } from '../../comp-doc/block-select/DocBlockSelectMenu.jsx';
import { DocBlockTransferPopup } from '../../comp-doc/block-select/DocBlockTransferPopup.jsx';
import { DocLanguageProvider, useDocLanguage } from '../../../built-in/comp-mdx/multi-lang/MultiLangContext.jsx';
import { MultiLangControl } from '../../../built-in/comp-mdx/multi-lang/MultiLangControl.jsx';
import { DocEditToggle } from '../../comp-doc/edit/DocEditToggle.jsx';
import { DocSettingsButton } from '../../comp-doc/settings/DocSettingsButton.jsx';
import { DocSettingsPanel } from '../../comp-doc/settings/DocSettingsPanel.jsx';
import { DocCommandPalette } from '../../comp-doc/api/DocCommandPalette.jsx';
import { DocApiNotice } from '../../comp-doc/api/DocApiNotice.jsx';
import { DocHotkeyListener } from '../../comp-doc/api/DocHotkeyListener.jsx';
import { DocPaletteButton } from '../../comp-doc/api/DocPaletteButton.jsx';
import { serviceApiProviderCreate } from '../../comp-doc/api/api-service.js';
import { compById as compByIdDefault } from '../../comp-doc/registry/registry.js';
import { compMountByIdBuild } from '../../comp-doc/registry/comp-mount.js';
import { slashActionById as slashActionByIdDefault } from '../../comp-doc/slash/slash-registry.js';
import { slashActionByIdBuild } from '../../comp-doc/slash/slash-define.js';
import { apiById as apiByIdDefault } from '../../comp-doc/api/api-registry.js';
import { apiByIdBuild, apiDeclaredLayerBuild } from './lib/doc-api.js';
import './DocPageMdx.css';

// Embeddable MD/MDX document page.
//
//   <DocPageMdx
//     data={{ configDoc, fileManifest, dirManifest, linkIndex, fileUrlByPath, assetSnapshot, compMountList }}
//     config={{ routeMode: 'memory', compById, slashActionById, apiById, hotkeyMapList, compConfigHost, configDefineList,
//               link: { CompRender }, source: { endpoint }, edit: { endpoint, pasteTransformList },
//               asset: { endpoint, subscribe }, service: { endpoint }, api: { endpoint, subscribe, send } }}
//     onEvent={(eventType, eventData) => { ... }}
//   />
//
// data usually comes from the virtual module generated by docSourcePlugin().
// data.linkIndex is the link index of the workspace (docLinkIndex): the
// references every document writes, from which the backlinks of a document
// are listed (doc_page_impl_nav_backlink.md); without it there is no
// backlinks panel.
// config contains application/runtime policy rather than semantic document data.
// config.env is the environment the page runs in, { kind } (the virtual
// module exports it as docEnv): 'viteDevServer' or 'staticBuild'. it decides,
// with the endpoints below, what the page allows (DocEnvStore: editing,
// creating files, the asset api, the service backend); without it the kind
// is inferred from the endpoints (doc_page_impl.md#the-environment).
// config.source.endpoint is the source api of the development server
// (docSourceEndpoint): the bytes of source files, and file creation
// (doc_page_impl_source.md); in a build data.fileUrlByPath answers the bytes.
// config.edit.endpoint is the edit api of the development server (the virtual
// module exports it as docEditEndpoint); without it the page has no edit mode.
// config.edit.pasteTransformList are the transforms a paste goes through
// before it is shown as blocks (doc_page_impl_block_ops.md#transforms).
// config.asset.endpoint is the asset api of the development server
// (docAssetEndpoint), config.asset.subscribe its change feed (subscribeDocAsset);
// a built site reads data.assetSnapshot instead (doc_page_impl_asset.md).
// config.service.endpoint is the service backend as the development server
// forwards it (docServiceEndpoint); without it the dashboards of service
// instances show that there is no backend (doc_page_impl_service.md).
// data.compMountList is the components of the doc pages as the plugin
// mounted them (docCompMountList, doc_page_impl_mdx_comp.md#components-of-a-doc-page):
// their definitions join the registry between the package's and the host's
// config.compById, and their tag names are in configDoc.compRegistry already.
// config.slashActionById are the host's slash actions over the package's
// (doc_page_impl_edit_slash.md#the-slash-action-registry); null removes one.
// config.apiById are the host's apis over the package's and the doc pages'
// declared ones (doc_page_impl_api.md#the-registry); null removes one.
// config.hotkeyMapList are the host's keyboard maps, stacked above the doc
// pages' (doc_page_impl_api_hotkey.md). config.api is the remote api of
// the development server (docApiEndpoint, subscribeDocApi, docApiSend): a
// caller outside the page reaches the apis through it; absent in a build.

export function DocPageMdx({ data, config = {}, onEvent }) {
  const languageAncestor = useDocLanguage();
  const languagePage = config.language || languageAncestor;
  const pageElementRef = useRef(null);
  const headingPointerRef = useRef(null);
  const [stores] = useState(() => {
    // the registries of the page, built from the package's definitions, the
    // doc pages' and the host's (see registry building at the end of this file)
    const compById = compByIdBuild(data.compMountList, config.compById);
    const slashActionById = slashActionByIdPageBuild(config.slashActionById);
    const apiById = apiByIdPageBuild(data.configDoc?.apiDeclared, config.apiById);
    // the environment of the page: how it is served, and so what it allows.
    // every store asks it, not an endpoint or a build flag of its own
    const envStore = new DocEnvStore({
      env: config.env,
      endpointByApi: {
        source: config.source?.endpoint,
        edit: config.edit?.endpoint,
        asset: config.asset?.endpoint,
        service: config.service?.endpoint,
        api: config.api?.endpoint,
      },
    });
    const sourceStore = new DocSourceStore(data, {
      compile: config.compile,
      linkResolve: config.link?.resolve,
      envStore,
      fileUrlByPath: data.fileUrlByPath,
    });
    // the file-creation service of the doc page source service layer (doc_page_impl_source.md)
    const sourceFileStore = new DocSourceFileStore(sourceStore);
    const docStore = new DocStore(sourceStore, {
      routeMode: config.routeMode ?? 'memory',
      compById,
      language: languagePage,
      onInvalidBrowserRoute: config.onInvalidBrowserRoute,
    });
    // the backlinks of the current document, from the link index that came
    // with the source data (doc_page_impl_nav_backlink.md)
    const linkStore = new DocLinkStore({ sourceStore, docStore });
    // the config layers (doc_page_impl_config.md#config-layers): the package
    // default (read only), the doc page's declarations (written where the
    // environment offers editing), this browser's storage
    const configStore = new DocConfigStore(sourceStore, docStore, {
      configDefineList: config.configDefineList,
      envStore,
    });
    const tagStore = new DocTagStore(sourceStore, docStore, configStore);
    // the component state service layer (doc_page_impl_mdx_comp_state.md):
    // what a component keeps between renders and across its unmount, keyed
    // by the block it stands for; the states of a document that leaves the
    // source are collected
    const compStateStore = new DocCompStateStore({ sourceStore });
    // the manifest tells the asset service layer which documents changed, so it
    // reads their asset references again (doc_page_impl_asset.md#usage)
    const assetStore = new DocAssetStore({
      endpoint: envStore.endpointGet('asset'),
      snapshot: data.assetSnapshot,
      subscribe: config.asset?.subscribe,
      manifestGet: () => sourceStore.fileManifest,
    });
    // the edit store creates asset items when a block's inline data is
    // moved into the asset service layer (doc_page_impl_asset.md)
    const editStore = new DocEditStore(sourceStore, docStore, configStore, { envStore, assetStore, compStateStore });
    // a component block shown in a popup, in View or in Edit (doc_page_impl_popup.md)
    const blockPopupStore = new DocBlockPopupStore({ docStore, editStore, sourceStore, assetStore });
    // the services of the service backend; a dashboard block keeps its
    // instance and its state in its asset item. the source store tells it
    // the doc pages loaded, synced into the kernel's registry
    // (doc_page_impl_service.md)
    const serviceStore = new DocServiceStore({ endpoint: envStore.endpointGet('service'), assetStore, sourceStore });
    // the side panel: folder open state, and moving items in edit mode
    // (doc_page_impl_side_panel.md#moving-an-item)
    const sidePanelStore = new DocSidePanelStore({ sourceStore, sourceFileStore, docStore, editStore });
    // blocks selected in block selection mode, then copied or moved, and
    // the blocks the author is at in any mode with blocks
    // (doc_page_impl_block_ops.md#selecting-blocks)
    const blockSelectStore = new DocBlockSelectStore({ editStore });
    // a pasted Markdown / MDX text reviewed as blocks, then inserted after
    // the blocks the author is at (doc_page_impl_block_ops.md)
    const pasteStore = new DocPasteStore({
      sourceStore, docStore, editStore, blockSelectStore, transformList: config.edit?.pasteTransformList,
    });
    // the place and size of the dialogs framed by the host's panel
    // component, moved and resized (doc_page_impl.md#the-panel-contract)
    const panelLayoutStore = new DocPanelLayoutStore();
    // the workspace and its doc pages as the Workspace tab of the settings
    // panel shows them (doc_page_impl_source.md#the-workspace-tab)
    const workspaceStore = new DocWorkspaceStore({ sourceStore });
    // the slash mode of the default editors: "/" in a paragraph or a list
    // opens the menu of the slash actions (doc_page_impl_edit_slash.md)
    const slashStore = new DocSlashStore({ slashActionById });
    // the unified api registry (doc_page_impl_api.md): every api of the
    // page, run by the palette, the hotkeys, a remote caller through the
    // development server, the host, and other apis; the command palette
    // (doc_page_impl_api_command_palette.md) and the keyboard maps
    // (doc_page_impl_api_hotkey.md) are its two callers of the page's own ui
    const apiStore = new DocApiStore({
      apiById,
      remote: { endpoint: envStore.endpointGet('api'), subscribe: config.api?.subscribe, send: config.api?.send },
    });
    apiStore.providerAdd(serviceApiProviderCreate(serviceStore));
    // the object registry (doc_page_impl_obj.md): the service layers of the
    // page provide their objects and relations from their own
    // representations (the doc page source, the links, the asset store),
    // the backend's registry provides those of its kernel and instances, and
    // with them the types and components of the services. like the api
    // registry, it knows the layers only through their providers
    const objectStore = new DocObjectStore({ docStore });
    objectStore.providerAdd(objectProviderDocCreate({ sourceStore, docStore }));
    objectStore.providerAdd(objectProviderLinkCreate({ linkStore }));
    objectStore.providerAdd(objectProviderAssetCreate({ assetStore }));
    objectStore.providerAdd(objectProviderBackendCreate({ serviceStore, configStore }));
    // the frontend object service layer (doc_page_impl_obj_frontend.md):
    // objects the page keeps itself, in assets, declared by the doc pages
    // with their types; a provider of the registry like the other layers
    // routing a navigation (doc_page_impl_nav.md#routing-a-navigation): a link followed is a
    // request, and the route taking it calls an api
    const navStore = new DocNavStore({ docStore, sourceStore });
    navStore.apiCall = (id, params) => apiStore.call(id, params);
    const objectFrontendStore = new DocObjectFrontendStore({ assetStore, objectStore, configStore, sourceStore, navStore });
    objectStore.providerAdd(objectProviderFrontendCreate({ objectFrontendStore }));
    const paletteStore = new DocPaletteStore({ apiStore });
    // find in a part of the page: the scopes components register (doc_page_impl_api.md#finding-in-a-part-of-the-page)
    const findStore = new DocFindStore();
    const hotkeyStore = new DocHotkeyStore({ apiStore, mapListHost: config.hotkeyMapList ?? [] });
    // the event layer (doc_page_impl_event.md): component reports are routed
    // to the domain that answers them; the stores never see onEvent callbacks
    const eventRouter = new DocEventRouter();
    eventRouter.routeAdd({
      name: 'navigation',
      typeList: ['navigateRequest'],
      handle: (event) => {
        if (!event.data.target) return { code: -1, message: 'navigateRequest without target' };
        const isNavigated = docStore.navigate(event.data.target);
        return isNavigated ? { code: 0 } : { code: -1, message: docStore.navigationError };
      },
    });
    eventRouter.routeAdd({
      name: 'tag',
      typeList: ['tagOverviewOpenRequest'],
      handle: (event) => {
        if (!event.data.tagId || !config.compConfigHost?.panelComponent) return undefined;
        return tagStore.overviewOpen(event.data.tagId) ? { code: 0 } : { code: -1, message: 'tag overview not available' };
      },
    });
    eventRouter.routeAdd({
      name: 'edit',
      typeList: editEventTypeList,
      handle: (event) => editStore.eventHandle(event),
    });
    eventRouter.routeAdd({
      name: 'source',
      typeList: sourceEventTypeList,
      handle: (event) => sourceFileStore.eventHandle(event),
    });
    eventRouter.routeAdd({
      name: 'asset',
      typeList: assetEventTypeList,
      handle: (event) => assetStore.eventHandle(event),
    });
    eventRouter.routeAdd({
      name: 'service',
      typeList: serviceEventTypeList,
      handle: (event) => serviceStore.eventHandle(event),
    });
    eventRouter.routeAdd({
      name: 'object',
      typeList: objectEventTypeList,
      handle: (event) => objectStore.eventHandle(event),
    });
    eventRouter.routeAdd({
      name: 'sidePanel',
      typeList: sidePanelEventTypeList,
      handle: (event) => sidePanelStore.eventHandle(event),
    });
    const stores = {
      envStore,
      sourceStore,
      sourceFileStore,
      workspaceStore,
      docStore,
      linkStore,
      configStore,
      tagStore,
      compStateStore,
      editStore,
      assetStore,
      blockPopupStore,
      serviceStore,
      objectStore,
      objectFrontendStore,
      navStore,
      sidePanelStore,
      pasteStore,
      blockSelectStore,
      panelLayoutStore,
      slashStore,
      apiStore,
      paletteStore,
      findStore,
      hotkeyStore,
      eventRouter,
      onEvent,
      compById,
    };
    // the apis run with every store of the page in their context
    apiStore.storesSet(stores);
    return stores;
  });
  const framework = useMemo(() => makeFramework(stores.docStore), [stores]);
  const contextValue = useMemo(() => ({
    ...stores,
    compConfigHost: config.compConfigHost ?? {},
    componentConfig: config.components ?? {},
    linkConfig: config.link ?? {},
    onEvent,
    pageElementRef,
    sidePanelConfig: config.sidePanel ?? {},
  }), [stores, config.compConfigHost, config.components, config.link, config.sidePanel, onEvent]);

  useEffect(() => {
    void stores.envStore.init();
    stores.docStore.init();
    stores.compStateStore.init();
    stores.editStore.init();
    stores.assetStore.init();
    stores.blockPopupStore.init();
    stores.serviceStore.init();
    stores.objectStore.init();
    stores.objectFrontendStore.init();
    stores.apiStore.init();
    return () => {
      stores.hotkeyStore.dispose();
      stores.apiStore.dispose();
      stores.objectFrontendStore.dispose();
      stores.objectStore.dispose();
      stores.serviceStore.dispose();
      stores.blockPopupStore.dispose();
      stores.assetStore.dispose();
      stores.editStore.dispose();
      stores.compStateStore.dispose();
      stores.docStore.dispose();
      stores.envStore.dispose();
    };
  }, [stores]);

  useEffect(() => {
    stores.docStore.replaceCompById(compByIdBuild(data.compMountList, config.compById));
  }, [data.compMountList, config.compById, stores]);

  useEffect(() => {
    stores.slashStore.replaceSlashActionById(slashActionByIdPageBuild(config.slashActionById));
  }, [config.slashActionById, stores]);

  useEffect(() => {
    stores.apiStore.replaceApiById(apiByIdPageBuild(data.configDoc?.apiDeclared, config.apiById));
  }, [data.configDoc?.apiDeclared, config.apiById, stores]);

  useEffect(() => {
    stores.hotkeyStore.replaceMapListHost(config.hotkeyMapList ?? []);
  }, [config.hotkeyMapList, stores]);

  useEffect(() => {
    stores.docStore.setLanguagePage(languagePage);
  }, [languagePage, stores]);

  useEffect(() => {
    if (typeof data.subscribe !== 'function') return undefined;
    return data.subscribe((sourceDataNext) => stores.docStore.replaceSourceData(sourceDataNext));
  }, [data, stores]);

  return (
    <div
      ref={pageElementRef}
      className="doc-page-mdx"
      onClickCapture={(event) => {
        const headingAnchor = headingAnchorGet(event.target);
        const pointer = headingPointerRef.current;
        const selection = typeof window === 'undefined' ? null : window.getSelection();
        const isTextSelected = Boolean(selection && !selection.isCollapsed && selection.toString());
        const isDragged = Boolean(
          headingAnchor
          && pointer?.headingAnchor === headingAnchor
          && Math.hypot(pointer.xEnd - pointer.xStart, pointer.yEnd - pointer.yStart) > 5
        );
        headingPointerRef.current = null;
        if (!headingAnchor || (!isTextSelected && !isDragged)) return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDownCapture={(event) => {
        if (event.button !== 0) return;
        const headingAnchor = headingAnchorGet(event.target);
        headingPointerRef.current = headingAnchor
          ? {
              headingAnchor,
              pointerId: event.pointerId,
              xEnd: event.clientX,
              xStart: event.clientX,
              yEnd: event.clientY,
              yStart: event.clientY,
            }
          : null;
      }}
      onPointerMoveCapture={(event) => {
        const pointer = headingPointerRef.current;
        if (!pointer || pointer.pointerId !== event.pointerId) return;
        pointer.xEnd = event.clientX;
        pointer.yEnd = event.clientY;
      }}
      onPointerUpCapture={(event) => {
        const pointer = headingPointerRef.current;
        if (!pointer || pointer.pointerId !== event.pointerId) return;
        pointer.xEnd = event.clientX;
        pointer.yEnd = event.clientY;
      }}
      onPointerCancelCapture={() => { headingPointerRef.current = null; }}
    >
      <DocLanguageProvider language={languagePage}>
        <StoreContext.Provider value={contextValue}>
          <FrameworkProvider {...framework}>
            <RootProvider search={{ SearchDialog: DocSearchDialog }}>
              <DocsShell />
              <TagOverviewPopup />
              <AssetPanelPopup />
              <DocBlockPopup />
              <DocNavPopup />
              <SourceFilePrompt />
              <SidePanelMovePicker />
              <SidePanelItemDialog />
              <SidePanelDragOverlay />
              <SidePanelItemContextMenu />
              <DocPastePopup />
              <DocBlockSelectMenu />
              <DocBlockTransferPopup />
              <DocSettingsPanel />
              <DocCommandPalette />
              <DocApiNotice />
              <DocHotkeyListener />
            </RootProvider>
          </FrameworkProvider>
        </StoreContext.Provider>
      </DocLanguageProvider>
    </div>
  );
}

function headingAnchorGet(target) {
  if (!(target instanceof Element)) return null;
  const anchor = target.closest('a[href^="#"]');
  if (!anchor || !/^H[1-6]$/.test(anchor.parentElement?.tagName ?? '')) return null;
  return anchor;
}

const DocsShell = observer(function DocsShell() {
  const { configStore, docStore, sidePanelConfig, sourceStore } = useDocStores();
  // the code font of the document shown (FontMonoFamily), on the root so that what
  // a document opens in the top layer or a popup has it too
  const docPathCurrent = docStore.itemCurrent?.docPath;
  const fontMonoFamily = docPathCurrent ? configStore.valueDocGet(docPathCurrent, 'FontMonoFamily') : null;
  useEffect(() => {
    if (!fontMonoFamily) return undefined;
    const { style } = document.documentElement;
    style.setProperty('--font-mono', fontMonoFamily);
    return () => style.removeProperty('--font-mono');
  }, [fontMonoFamily]);
  const sidePanelProps = useMemo(() => ({
    ...sidePanelConfig,
    components: {
      Folder: DocSidebarFolder,
      ...(sidePanelConfig.components ?? {}),
    },
  }), [sidePanelConfig]);
  return (
    <DocsLayout
      tree={docStore.treePage}
      nav={{ title: sourceStore.configDoc.siteTitle ?? 'Docs', children: <><DocPaletteButton /><DocSettingsButton /></> }}
      sidebar={sidePanelProps}
      slots={docsLayoutSlots}
      themeSwitch={themeSwitchSidebarDisabled}
    >
      <DocPageView />
    </DocsLayout>
  );
});

const docsLayoutSlots = { container: DocPageLayoutContainer };

// the sidebar-footer theme toggle can end up below the window's bottom edge
// when the side panel is tall; the floating toggle below replaces it.
const themeSwitchSidebarDisabled = { enabled: false };

function DocPageLayoutContainer({ children, ...props }) {
  return (
    <DocsLayoutContainer {...props}>
      {children}
      <div className="doc-theme-floating">
        <ThemeSwitch />
      </div>
      <nav className="doc-navigation-floating" aria-label="Document navigation and language">
        <DocNavigationButtons isCompact />
        <MultiLangControl />
        <DocEditToggle isCompact />
      </nav>
    </DocsLayoutContainer>
  );
}

// ---------- registry building ----------
//
// the page has three registries, built the same way when the page starts
// and again when what they are built from changes: the package's
// definitions, then those of the doc pages, then the host's, each layer
// over the one before (an id of a later layer replaces the same id of an
// earlier one).
//
//   registry            package            doc pages                      host
//   compById            registry.js        data.compMountList             config.compById
//   slashActionById     slash-registry.js  (none yet)                     config.slashActionById
//   apiById             api-registry.js    configDoc.apiDeclared (yaml)   config.apiById
//
// compById is held by DocStore (replaceCompById), slashActionById by
// DocSlashStore (replaceSlashActionById), apiById by DocApiStore
// (replaceApiById; the apis of components and services join it through
// providers at run time).

// the component registry (doc_page_impl.md#component-registry)
function compByIdBuild(compMountList, compByIdHost) {
  return { ...compByIdDefault, ...compMountByIdBuild(compMountList), ...(compByIdHost ?? {}) };
}

// the slash action registry (doc_page_impl_edit_slash.md#the-slash-action-registry)
function slashActionByIdPageBuild(slashActionByIdHost) {
  return slashActionByIdBuild(slashActionByIdDefault, slashActionByIdHost);
}

// the api registry (doc_page_impl_api.md#the-registry)
function apiByIdPageBuild(apiDeclared, apiByIdHost) {
  return apiByIdBuild(apiByIdDefault, apiDeclaredLayerBuild(apiDeclared), apiByIdHost);
}
