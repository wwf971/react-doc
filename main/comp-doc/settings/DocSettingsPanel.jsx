import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { LoaderCircle, RotateCw, X } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { compIdBuiltinByName } from '../registry/comp-registry.js';
import { AssetStoreSettings } from './AssetStoreSettings.jsx';
import { ServiceSettings } from './ServiceSettings.jsx';
import { SourcePathInput } from '../source/SourcePathInput.jsx';
import './DocSettings.css';

// The settings panel, rendered by the application's ConfigPanel
// (config.components) with four tabs (subtab items):
//
//   Config       every config key that is user settable, one item per key
//   Component    the component-level keys
//                (doc_page_impl_config.md#component-level-config), one group
//                per component that declares keys, named as the component is
//                written in documents. a key of type sourcePath is edited
//                with SourcePathInput, completed from the folders / files of
//                the source.
//   Asset service
//                the folders of the local store of the asset service layer
//                (AssetStoreSettings), written into the store's config file
//                by the development server, so they are kept
//                (doc_page_impl_asset.md).
//   Services     the services of the page (ServiceSettings): system
//                services, then the instances of the service backend as
//                cards, the config dashboard of the one chosen, and the
//                creation of an instance (doc_page_impl_service.md).
//
// Config and Component carry a second tab line, one tab per config layer
// (doc_page_impl_config.md#config-layers, DocConfigStore.layerList): Global
// is config.yaml, Client is this browser. The tab of a layer shows the page
// values as they are with the layers up to that one applied, marks which
// level decided each (its own values stand out), and a change there is
// written into that layer: config.yaml through the development server (the
// previous file kept as a backup), the browser's storage for Client. "Reset"
// drops every value of a layer that can be cleared at once. The layer shown
// is DocConfigStore.settingsLayerId, shared by the two tabs.
//
// the tab shown is DocConfigStore.settingsTabId. the panel is rendered once
// at page level while DocConfigStore.isSettingsOpen: a popup centered in
// the browser window, at a fixed height. a tab taller than that scrolls
// inside the tab; the title and the tabs stay put. it closes only with the
// close button at the top right. the header, aside from its buttons, drags
// the panel.
export const DocSettingsPanel = observer(function DocSettingsPanel() {
  const stores = useDocStores();
  const { configStore } = stores;
  if (!configStore.isSettingsOpen) return null;
  return <DocSettingsPanelOpen />;
});

const panelPath = ['docSettings'];

const DocSettingsPanelOpen = observer(function DocSettingsPanelOpen() {
  const stores = useDocStores();
  const { componentConfig, configStore } = stores;
  const ConfigPanel = componentConfig.ConfigPanel;
  const panelRef = useRef(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const [dragOffset, dragOffsetSet] = useState(dragOffsetRef.current);
  const [isDragging, isDraggingSet] = useState(false);

  // the flat data of the panel holds every item of every layer: an item id
  // carries its layer, "layerId:key" or "layerId:compId::key"
  const data = {};
  const layerTabListConfig = [];
  const layerTabListComp = [];
  for (const layer of configStore.layerList) {
    const itemListConfig = [];
    for (const define of configStore.configDefineListUserSettable) {
      const itemId = itemIdBuild(layer.id, define.key);
      const level = configStore.layerIsDeclaring(layer.id, define.key) ? layer.id : levelOfLayerValueGet(configStore, layer.id, define.key);
      itemListConfig.push(settingsItemBuild(itemId, define, layer, level, stores));
      data[itemId] = settingsValueToItem(define, configStore.layerValueGet(layer.id, define.key));
    }
    layerTabListConfig.push({ id: layer.id, type: 'subtab', name: layer.define.label, children: itemListConfig });

    // component-level keys: one group per component that documents can name
    const itemListComp = [];
    for (const compId of configStore.compIdListWithConfig) {
      const compName = compNameGet(stores.sourceStore.configDoc, compId);
      if (compName === '') continue;
      const defineList = configStore.compConfigDefineListGet(compId).filter((define) => define.isUserSettable !== false);
      if (defineList.length === 0) continue;
      const children = [];
      for (const define of defineList) {
        const itemId = itemIdBuild(layer.id, compItemIdBuild(compId, define.key));
        const level = configStore.layerCompIsDeclaring(layer.id, compId, define.key) ? layer.id : levelOfLayerCompValueGet(configStore, layer.id, compId, define.key);
        children.push(settingsItemBuild(itemId, define, layer, level, stores));
        data[itemId] = settingsValueToItem(define, configStore.layerCompValueGet(layer.id, compId, define.key));
      }
      itemListComp.push({ id: `${layer.id}:comp:${compId}`, type: 'group', label: compName, children });
    }
    layerTabListComp.push({
      id: layer.id,
      type: 'subtab',
      name: layer.define.label,
      children: itemListComp.length > 0
        ? itemListComp
        : [{ id: `${layer.id}:compConfigNone`, type: 'custom', comp: CompConfigNoneNote, isFullWidth: true }],
    });
  }

  const itemList = [
    { id: 'config', type: 'subtab', name: 'Config', children: layerTabListConfig },
    { id: 'compConfig', type: 'subtab', name: 'Component', children: layerTabListComp },
    {
      id: 'assetStore',
      type: 'subtab',
      name: 'Asset service',
      children: [{ id: 'assetStoreFolders', type: 'custom', comp: AssetStoreSettings, isFullWidth: true }],
    },
    {
      id: 'service',
      type: 'subtab',
      name: 'Services',
      children: [{ id: 'serviceInstances', type: 'custom', comp: ServiceSettings, isFullWidth: true }],
    },
  ];
  // the layer line of both value tabs shows the same layer
  const operationStateByPath = {
    'docSettings.config': { activeSubtabId: configStore.settingsLayerId },
    'docSettings.compConfig': { activeSubtabId: configStore.settingsLayerId },
  };

  const eventHandle = (eventType, eventData) => {
    if (eventType === 'activeSubtabChange') {
      const isTabLine = (eventData.compPath ?? []).length === panelPath.length;
      if (isTabLine) configStore.settingsTabIdSet(eventData.subtabId);
      else configStore.settingsLayerIdSet(eventData.subtabId);
      return { code: 0 };
    }
    if (eventType !== 'valueChangeAttempt') return undefined;
    const item = itemIdParse(eventData.valueId);
    if (!item) return { code: -1, message: `unknown settings item ${eventData.valueId}` };
    const compItem = compItemIdParse(item.key);
    if (compItem) {
      const define = configStore.compConfigDefineListGet(compItem.compId).find((defineOne) => defineOne.key === compItem.key);
      if (!define) return { code: -1, message: `unknown component config key ${eventData.valueId}` };
      const request = configStore.layerCompValueSet(item.layerId, compItem.compId, define.key, settingsValueFromItem(define, eventData.value));
      settingsEditRecord(eventData.valueId, define, eventData.value, request);
      return { code: 0 };
    }
    const define = configStore.configDefineByKey.get(item.key);
    if (!define) return { code: -1, message: `unknown config key ${eventData.valueId}` };
    const request = configStore.layerValueSet(item.layerId, define.key, settingsValueFromItem(define, eventData.value));
    settingsEditRecord(eventData.valueId, define, eventData.value, request);
    return { code: 0 };
  };

  // a source path can be reverted from its item (SourcePathSettingsItem):
  // once the write succeeded, the value before it is remembered as the
  // item's original, unless an earlier edit already remembered one
  const settingsEditRecord = (itemId, define, valueAfter, request) => {
    if (define.type !== 'sourcePath') return;
    const valueBefore = data[itemId];
    void request.then((result) => {
      if (result.code === 0) configStore.settingsValueEditRecord(itemId, valueBefore, valueAfter);
    });
  };

  // the header moves the panel. a button in the header (Reset, Close) is
  // not a drag handle, so a click there stays a click.
  const headPointerDownHandle = (event) => {
    if (event.button !== 0 || event.target.closest('button')) return;
    const panel = panelRef.current;
    const head = event.currentTarget;
    if (!panel) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startRect = panel.getBoundingClientRect();
    const origin = dragOffsetRef.current;
    head.setPointerCapture(event.pointerId);
    isDraggingSet(true);
    const moveHandle = (moveEvent) => {
      const margin = 8;
      let left = startRect.left + moveEvent.clientX - startX;
      let top = startRect.top + moveEvent.clientY - startY;
      const maxLeft = Math.max(margin, window.innerWidth - startRect.width - margin);
      const maxTop = Math.max(margin, window.innerHeight - startRect.height - margin);
      left = Math.min(Math.max(margin, left), maxLeft);
      top = Math.min(Math.max(margin, top), maxTop);
      const next = {
        x: origin.x + (left - startRect.left),
        y: origin.y + (top - startRect.top),
      };
      dragOffsetRef.current = next;
      dragOffsetSet(next);
    };
    const upHandle = () => {
      head.removeEventListener('pointermove', moveHandle);
      head.removeEventListener('pointerup', upHandle);
      head.removeEventListener('pointercancel', upHandle);
      isDraggingSet(false);
    };
    head.addEventListener('pointermove', moveHandle);
    head.addEventListener('pointerup', upHandle);
    head.addEventListener('pointercancel', upHandle);
  };

  const isValueTab = configStore.settingsTabId === 'config' || configStore.settingsTabId === 'compConfig';
  const layerShown = isValueTab ? configStore.layerGet(configStore.settingsLayerId) : undefined;

  return createPortal(
    <div
      ref={panelRef}
      className="doc-settings-panel"
      role="dialog"
      aria-label="Settings"
      data-dragging={isDragging ? '' : undefined}
      style={{ transform: `translate(calc(-50% + ${dragOffset.x}px), calc(-50% + ${dragOffset.y}px))` }}
    >
      <div className="doc-settings-head" onPointerDown={headPointerDownHandle}>
        <div className="doc-settings-head-main">
          <span className="doc-settings-title">Settings</span>
          {layerShown ? <LayerHead layer={layerShown} /> : (
            <span className="doc-settings-note">{tabNoteByTabId[configStore.settingsTabId] ?? ''}</span>
          )}
        </div>
        <button
          type="button"
          className="doc-button doc-settings-head-button doc-settings-close"
          title="Close"
          aria-label="Close settings"
          onClick={() => configStore.settingsOpenSet(false)}
        >
          <X aria-hidden="true" size={13} strokeWidth={2} />
        </button>
      </div>
      <div className="doc-settings-body">
        <ConfigPanel
          data={data}
          config={{ compPath: panelPath, items: itemList, activeSubtabId: configStore.settingsTabId, operationStateByPath }}
          onEvent={eventHandle}
        />
      </div>
    </div>,
    document.body,
  );
});

// what the head says beside the title on a tab without config layers
const tabNoteByTabId = {
  assetStore: 'the folders are written into the store\'s config file',
  service: 'the instances live in the service backend, in its instance folders',
};

// the head of a value tab: what the layer shown is, Reset when it can be
// cleared, and the state of its last write
const LayerHead = observer(function LayerHead({ layer }) {
  const { configStore } = useDocStores();
  return (
    <>
      {layer.isClearable ? (
        <button
          type="button"
          className="doc-button doc-settings-head-button"
          disabled={!configStore.layerIsDeclaringAny(layer.id)}
          title={`Drop every value of the ${layer.define.label} layer`}
          aria-label={`Drop every value of the ${layer.define.label} layer`}
          onClick={() => void configStore.layerClear(layer.id)}
        >
          <RotateCw aria-hidden="true" size={13} strokeWidth={2} />
          <span>Reset</span>
        </button>
      ) : null}
      <span className="doc-settings-note">
        {layer.define.label}: {layer.isWritable ? layer.define.description : layer.disabledReason}
      </span>
      {layer.request.status === 'submitting' ? (
        <span className="doc-settings-note doc-settings-request" role="status">
          <LoaderCircle aria-hidden="true" size={11} strokeWidth={2} className="doc-spin" />
          <span>writing…</span>
        </span>
      ) : null}
      {layer.request.status === 'error' ? (
        <span className="doc-settings-note doc-settings-request is-error" role="alert">
          {layer.request.message}
          <button type="button" className="doc-settings-asset-link" onClick={() => layer.requestMessageClear()}>dismiss</button>
        </span>
      ) : null}
    </>
  );
});

// the ConfigPanel item of one config define on the tab of one layer. an enum
// is a dropdown; a source path is edited with completion. the label carries
// the level that decided the value shown: the layer itself, or one below it.
function settingsItemBuild(itemId, define, layer, level, stores) {
  const item = {
    id: itemId,
    label: (
      <span className="doc-settings-item-label">
        <span>{define.key}</span>
        <span className={`doc-settings-level${level === layer.id ? ' is-own' : ''}`} title={`decided by the ${level} level`}>{level}</span>
      </span>
    ),
    description: define.description,
    defaultValue: settingsValueToItem(define, define.valueDefault),
  };
  if (define.type === 'boolean') item.type = 'boolean';
  else if (define.type === 'enum') {
    item.type = 'select';
    item.options = define.valueList;
  } else if (define.type === 'number') item.type = 'number';
  else if (define.type === 'string' || define.type === 'stringList') item.type = 'string';
  else if (define.type === 'sourcePath') {
    item.type = 'custom';
    item.comp = SourcePathSettingsItem;
    item.compProps = { pathSpec: define.pathSpec ?? { kind: 'dir' } };
  }
  // a key of type any has no control; it stays settable from YAML only
  else item.isHidden = true;

  const disabledReason = layer.isWritable ? itemDisabledReasonGet(define.key, stores) : layer.disabledReason;
  if (disabledReason) {
    item.isDisabled = true;
    item.disabledReason = disabledReason;
  }
  return item;
}

// why a key cannot be set in the current environment; '' when it can
function itemDisabledReasonGet(key, { editStore }) {
  if (key === 'EditBlockEnterMode' && !editStore.isAvailable) {
    return 'In-place editing is answered by the development server only; this build has no edit mode.';
  }
  return '';
}

// the level that decided the value a layer's tab shows, when not the layer itself
function levelOfLayerValueGet(configStore, layerId, key) {
  return configStore.configModel.configByLayerId.get(layerId)?.levelByKey[key] ?? 'default';
}

function levelOfLayerCompValueGet(configStore, layerId, compId, key) {
  return configStore.configModel.compConfigByLayerId.get(layerId)?.get(compId)?.levelByKey[key] ?? 'default';
}

// a config value as the panel item shows it: a string list as its comma
// separated text
function settingsValueToItem(define, value) {
  if (define.type === 'stringList') return Array.isArray(value) ? value.join(', ') : '';
  if (define.type === 'string' || define.type === 'sourcePath') return value ?? '';
  return value;
}

// the panel item of a key of type sourcePath: the path with completion
// from the doc page source service layer; the value is committed on blur / Enter / choice.
// after an edit, the revert button before the path writes the value the
// item had before it was first edited (DocConfigStore.settingsValueOriginalByItemId)
const SourcePathSettingsItem = observer(function SourcePathSettingsItem({ item, value, isDisabled, onValueChange, pathSpec }) {
  const { configStore } = useDocStores();
  const valueOriginal = configStore.settingsValueOriginalGet(item.id);
  return (
    <SourcePathInput
      value={value}
      spec={pathSpec}
      placeholder={pathSpec?.kind === 'file' ? '~rootId/dir/file' : '~rootId/dir'}
      isDisabled={isDisabled}
      onCommit={(text) => onValueChange(text)}
      valueRevert={valueOriginal}
      onRevert={() => onValueChange(valueOriginal)}
    />
  );
});

function CompConfigNoneNote() {
  return <span className="doc-settings-note">no registered component declares config keys</span>;
}

// item ids: "layerId:key"; a component key is "compId::key"
const itemIdSeparator = ':';
const compItemIdSeparator = '::';

function itemIdBuild(layerId, key) {
  return `${layerId}${itemIdSeparator}${key}`;
}

function itemIdParse(itemId) {
  const indexSeparator = String(itemId ?? '').indexOf(itemIdSeparator);
  if (indexSeparator < 0) return undefined;
  return { layerId: itemId.slice(0, indexSeparator), key: itemId.slice(indexSeparator + itemIdSeparator.length) };
}

function compItemIdBuild(compId, key) {
  return `${compId}${compItemIdSeparator}${key}`;
}

function compItemIdParse(itemId) {
  const indexSeparator = String(itemId ?? '').lastIndexOf(compItemIdSeparator);
  if (indexSeparator < 0) return undefined;
  return { compId: itemId.slice(0, indexSeparator), key: itemId.slice(indexSeparator + compItemIdSeparator.length) };
}

// the name a component is written with in documents (config compRegistry
// maps names to ids, then the built-in names); '' for an id no name maps
// to, which no document can use and the panel does not list
function compNameGet(configDoc, compId) {
  for (const [compName, compIdMapped] of Object.entries(configDoc?.compRegistry ?? {})) {
    if (compIdMapped === compId) return compName;
  }
  for (const [compName, compIdMapped] of Object.entries(compIdBuiltinByName)) {
    if (compIdMapped === compId && configDoc?.compRegistry?.[compName] === undefined) return compName;
  }
  return '';
}

// the value a panel item reports, back in the form of the config key
function settingsValueFromItem(define, value) {
  if (define.type === 'stringList') {
    const list = String(value ?? '').split(',').map((text) => text.trim()).filter((text) => text !== '');
    return list.length > 0 ? list : null;
  }
  if (define.type === 'number') {
    const number = Number(value);
    return Number.isFinite(number) ? number : define.valueDefault;
  }
  return value;
}
