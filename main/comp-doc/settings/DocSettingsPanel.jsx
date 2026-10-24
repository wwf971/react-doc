import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { LoaderCircle, Pencil, RotateCw, X } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { SETTINGS_RESULT_ID } from '../../frontend/src/store/DocConfigStore.ts';
import { AssetStoreSettings } from './AssetStoreSettings.jsx';
import { ServiceSettings } from './ServiceSettings.jsx';
import { SourcePathInput } from '../source/SourcePathInput.jsx';
import { EditValueInline } from '../edit/EditValueInline.jsx';
import './DocSettings.css';

// The settings panel, rendered by the application's ConfigPanel
// (config.components) with four tabs (subtab items):
//
//   Config       the page config keys
//   Component    the component-level keys
//                (doc_page_impl_config.md#component-level-config), one group
//                per component, named as the component is written in
//                documents. a key of type sourcePath is edited with
//                SourcePathInput, completed from the folders / files of the
//                source.
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
// (doc_page_impl_config.md#config-layers, DocConfigStore.layerList), then
// Result. The tab of a layer lists what the layer declares, not a full set
// of keys, beside each key where it is written:
//   Default    every key (the layer declares them all: config.yaml
//              configDefault over the built-in defaults), greyed out: it is
//              the package's, never written from the page
//   Doc page   the keys the doc page declares, merged, display only. "Edit"
//              switches to its edit mode (DeclarationGrid): every declaration
//              side by side, a column each in stack order, one row per key;
//              a value is edited in place in any declaration that holds it,
//              and the layer still takes the last one
//   Client     the keys kept in this browser, each removable, and a list to
//              add one; "Clear cache" drops them all with the storage entry
// Result lists every key with the value in effect and the level that
// decided it. The layer shown is DocConfigStore.settingsLayerId, shared by
// the two tabs; the edit view DocConfigStore.settingsIsDeclarationView.
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

  // the flat data of the panel holds every item of every tab; what a change
  // of an item writes is kept beside it, by item id
  const data = {};
  const writeByItemId = new Map();
  const context = { configStore, stores, data, writeByItemId };
  const layerTabListConfig = [];
  const layerTabListComp = [];
  for (const layer of configStore.layerList) {
    layerTabListConfig.push({ id: layer.id, type: 'subtab', name: layer.define.label, children: layerConfigItemListBuild(layer, context) });
    layerTabListComp.push({ id: layer.id, type: 'subtab', name: layer.define.label, children: layerCompItemListBuild(layer, context) });
  }
  layerTabListConfig.push({ id: SETTINGS_RESULT_ID, type: 'subtab', name: 'Result', children: resultConfigItemListBuild(context) });
  layerTabListComp.push({ id: SETTINGS_RESULT_ID, type: 'subtab', name: 'Result', children: resultCompItemListBuild(context) });

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
    const write = writeByItemId.get(eventData.valueId);
    if (!write) return { code: -1, message: `settings item ${eventData.valueId} is not written from the panel` };
    const request = write.valueSet(settingsValueFromItem(write.define, eventData.value));
    settingsEditRecord(eventData.valueId, write.define, eventData.value, request);
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

  // the header moves the panel. a button in the header (Clear cache, Close) is
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
  const isResultShown = isValueTab && configStore.settingsLayerId === SETTINGS_RESULT_ID;

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
            <span className="doc-settings-note">
              {isResultShown ? resultNote : tabNoteByTabId[configStore.settingsTabId] ?? ''}
            </span>
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

// ---------- the items of one layer ----------

// the page keys of a layer: what it declares, merged. a layer edited per
// declaration shows them for display only, and in its edit mode the grid of
// its declarations instead
function layerConfigItemListBuild(layer, context) {
  const { configStore } = context;
  if (layer.isDeclarationViewOffered && configStore.settingsIsDeclarationView) {
    return [{ id: `${layer.id}:grid`, type: 'custom', comp: DeclarationGrid, isFullWidth: true, compProps: { layerId: layer.id, isComp: false } }];
  }
  const itemList = configStore.layerItemListGet(layer.id).map((item) => (layer.isDeclarationViewOffered
    ? displayItemBuild(`${layer.id}:${item.key}`, item)
    : configItemBuild(
      `${layer.id}:${item.key}`,
      item,
      {
        layer,
        isOriginShown: true,
        valueSet: (value) => configStore.layerValueSet(layer.id, item.key, value),
        remove: layer.isKeyAddable ? () => configStore.layerValueRemove(layer.id, item.key) : undefined,
      },
      context,
    )));
  if (layer.isKeyAddable) {
    itemList.push({ id: `${layer.id}:keyAdd`, type: 'custom', comp: KeyAddItem, isFullWidth: true, compProps: { layerId: layer.id, isComp: false } });
  }
  return itemListOrNote(itemList, layer.id, 'this layer declares no page key');
}

// the component keys of a layer: one group per component; for a layer
// edited per declaration display only, and in its edit mode the grid
function layerCompItemListBuild(layer, context) {
  const { configStore } = context;
  if (layer.isDeclarationViewOffered && configStore.settingsIsDeclarationView) {
    return [{ id: `${layer.id}:compGrid`, type: 'custom', comp: DeclarationGrid, isFullWidth: true, compProps: { layerId: layer.id, isComp: true } }];
  }
  const groupList = configStore.layerCompGroupListGet(layer.id).map((group) => ({
    id: `${layer.id}:comp:${group.compKey}`,
    type: 'group',
    label: group.compName || group.compKey,
    children: group.itemList.map((item) => {
      const itemId = `${layer.id}:comp:${group.compKey}::${item.key}`;
      if (layer.isDeclarationViewOffered) return displayItemBuild(itemId, item);
      return configItemBuild(itemId, item, {
        layer,
        isOriginShown: true,
        valueSet: (value) => configStore.layerCompValueSet(layer.id, group.compId, item.key, value),
        remove: layer.isKeyAddable ? () => configStore.layerCompValueRemove(layer.id, group.compId, item.key) : undefined,
      }, context);
    }),
  }));
  if (layer.isKeyAddable) {
    groupList.push({ id: `${layer.id}:compKeyAdd`, type: 'custom', comp: KeyAddItem, isFullWidth: true, compProps: { layerId: layer.id, isComp: true } });
  }
  return itemListOrNote(groupList, layer.id, 'this layer declares no component key');
}

// one declared key shown, not edited: the merged view of a layer edited per
// declaration. the badge says which declaration the value comes from
function displayItemBuild(itemId, item) {
  return {
    id: itemId,
    type: 'custom',
    comp: ValueText,
    compProps: { valueText: valueTextGet(item.valueDeclared !== undefined ? item.valueDeclared : item.value) },
    label: (
      <ItemLabel
        keyText={item.key}
        badgeText={item.isValid ? item.origin : item.message}
        badgeTitle={item.isValid ? `written in ${item.origin}` : item.message}
        isBadgeError={!item.isValid}
      />
    ),
    description: item.define?.description ?? '',
  };
}

// the Result tab: every key with the value in effect at page level
function resultConfigItemListBuild({ configStore }) {
  return configStore.configDefineListUserSettable
    .filter((define) => define.type !== 'any')
    .map((define) => resultItemBuild(
      `${SETTINGS_RESULT_ID}:${define.key}`,
      define,
      configStore.configGlobal[define.key],
      configStore.configModel.levelGlobalByKey[define.key],
    ));
}

function resultCompItemListBuild({ configStore }) {
  const groupList = [];
  for (const compId of configStore.compIdListWithConfig) {
    const compName = configStore.compNameGet(compId);
    if (compName === '') continue;
    const resolved = configStore.configModel.compConfigGlobalByCompId.get(compId);
    const children = configStore.compConfigDefineListGet(compId)
      .filter((define) => define.isUserSettable !== false && define.type !== 'any')
      .map((define) => resultItemBuild(
        `${SETTINGS_RESULT_ID}:comp:${compId}::${define.key}`,
        define,
        resolved?.valueByKey[define.key],
        resolved?.levelByKey[define.key],
      ));
    if (children.length > 0) groupList.push({ id: `${SETTINGS_RESULT_ID}:comp:${compId}`, type: 'group', label: compName, children });
  }
  return itemListOrNote(groupList, SETTINGS_RESULT_ID, 'no registered component declares config keys');
}

function resultItemBuild(itemId, define, value, level) {
  return {
    id: itemId,
    type: 'custom',
    comp: ValueText,
    compProps: { valueText: valueTextGet(value) },
    label: <ItemLabel keyText={define.key} badgeText={level ?? ''} badgeTitle={`decided by the ${level} level`} />,
    description: define.description,
  };
}

// a list, or one note saying why it is empty
function itemListOrNote(itemList, idPrefix, noteText) {
  if (itemList.length > 0) return itemList;
  return [{ id: `${idPrefix}:none`, type: 'custom', comp: NoteItem, isFullWidth: true, compProps: { noteText } }];
}

// the ConfigPanel item of one declared key. write: { layer, isOriginShown,
// valueSet, remove? }. an enum is a dropdown; a source path is edited with
// completion. a key the layer cannot use (unknown, invalid) is shown as
// written, greyed out with the reason.
function configItemBuild(itemId, item, write, context) {
  const { stores, data, writeByItemId } = context;
  const { define } = item;
  const label = (
    <ItemLabel
      keyText={item.key}
      badgeText={item.isValid ? (write.isOriginShown ? item.origin : '') : item.message}
      badgeTitle={item.isValid ? `written in ${item.origin}` : item.message}
      isBadgeError={!item.isValid}
      onRemove={write.remove}
    />
  );
  if (!define || !item.isValid) {
    return {
      id: itemId,
      type: 'custom',
      comp: ValueText,
      compProps: { valueText: valueTextGet(item.valueDeclared) },
      label,
      description: define?.description ?? '',
      isDisabled: true,
      disabledReason: item.message,
    };
  }
  // the value as written: a variable stays ${name} in the field, so a change
  // does not replace it by what it stands for unless the reader types over it
  const valueShown = item.valueDeclared !== undefined ? item.valueDeclared : item.value;
  const panelItem = {
    id: itemId,
    label,
    description: define.description,
    defaultValue: settingsValueToItem(define, define.valueDefault),
  };
  if (define.type === 'boolean') panelItem.type = 'boolean';
  else if (define.type === 'enum') {
    panelItem.type = 'select';
    panelItem.options = define.valueList;
  } else if (define.type === 'number') panelItem.type = 'number';
  else if (define.type === 'string' || define.type === 'stringList') panelItem.type = 'string';
  else if (define.type === 'sourcePath') {
    panelItem.type = 'custom';
    panelItem.comp = SourcePathSettingsItem;
    panelItem.compProps = { pathSpec: define.pathSpec ?? { kind: 'dir' } };
  }
  // a key of type any has no control; it stays settable from YAML only
  else panelItem.isHidden = true;

  const disabledReason = write.layer.isWritable ? itemDisabledReasonGet(item.key, stores) : write.layer.disabledReason;
  if (disabledReason) {
    panelItem.isDisabled = true;
    panelItem.disabledReason = disabledReason;
  }
  data[itemId] = settingsValueToItem(define, valueShown);
  writeByItemId.set(itemId, { define, valueSet: write.valueSet });
  return panelItem;
}

// an item label: the key, a badge (where the value is written, or why the
// key is not used), and a remove button for a layer that takes keys
function ItemLabel({ keyText, badgeText, badgeTitle, isBadgeError = false, onRemove }) {
  return (
    <span className="doc-settings-item-label">
      <span>{keyText}</span>
      {badgeText ? (
        <span className={`doc-settings-level${isBadgeError ? ' is-error' : ''}`} title={badgeTitle}>{badgeText}</span>
      ) : null}
      {onRemove ? (
        <button
          type="button"
          className="doc-settings-item-remove"
          title={`Remove ${keyText} from this layer`}
          aria-label={`Remove ${keyText} from this layer`}
          onClick={() => void onRemove()}
        >
          <X aria-hidden="true" size={11} strokeWidth={2} />
        </button>
      ) : null}
    </span>
  );
}

function ValueText({ valueText }) {
  return <span className="doc-settings-value-text">{valueText}</span>;
}

function NoteItem({ noteText }) {
  return <span className="doc-settings-note">{noteText}</span>;
}

// adds one undeclared key to a layer that takes keys, with the value in
// effect; choosing an entry of the list adds it at once
const KeyAddItem = observer(function KeyAddItem({ layerId, isComp }) {
  const { configStore } = useDocStores();
  const optionList = isComp
    ? configStore.layerCompKeyAddableListGet(layerId).map(({ compId, compName, define }) => ({
        value: `${compId}::${define.key}`,
        label: `${compName}.${define.key}`,
      }))
    : configStore.layerKeyAddableListGet(layerId).map((define) => ({ value: define.key, label: define.key }));
  if (optionList.length === 0) return <span className="doc-settings-note">every key is declared in this layer</span>;
  const changeHandle = (event) => {
    const value = event.target.value;
    if (!value) return;
    if (!isComp) {
      void configStore.layerKeyAdd(layerId, value);
      return;
    }
    const indexSeparator = value.lastIndexOf('::');
    void configStore.layerCompKeyAdd(layerId, value.slice(0, indexSeparator), value.slice(indexSeparator + 2));
  };
  return (
    <span className="doc-settings-key-add">
      <select className="doc-settings-key-add-select" value="" aria-label="Add a key to this layer" onChange={changeHandle}>
        <option value="">Add a key…</option>
        {optionList.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </span>
  );
});

// ---------- the edit mode of a layer edited per declaration ----------

// every declaration of the layer side by side: a column each, left to right
// in stack order, and a row per key any of them declares (component keys
// grouped by component). a cell edits the value of that declaration in
// place; a declaration that does not declare the key shows a dash. the cell
// whose value the layer takes, the last valid one of its row, is marked.
// TODO: adding a key to a declaration, removing one, adding a declaration
const DeclarationGrid = observer(function DeclarationGrid({ layerId, isComp }) {
  const { configStore } = useDocStores();
  const layer = configStore.layerGet(layerId);
  const columnList = configStore.layerGridColumnListGet(layerId);
  if (!layer || columnList.length === 0) return <span className="doc-settings-note">this layer has no declaration</span>;
  const groupList = isComp
    ? configStore.layerGridCompGroupListGet(layerId)
    : [{ compId: '', compName: '', rowList: configStore.layerGridRowListGet(layerId) }];
  const rowCount = groupList.reduce((count, group) => count + group.rowList.length, 0);
  return (
    <div className="doc-settings-grid" style={{ '--doc-settings-grid-col-count': columnList.length }}>
      <span className="doc-settings-note">
        Applied left to right: where several declarations set a key, the layer takes the last one (marked).
        {layer.isWritable ? '' : ` ${layer.disabledReason}`}
      </span>
      <div className="doc-settings-grid-scroll">
        <div className="doc-settings-grid-row is-head">
          <div className="doc-settings-grid-key">key</div>
          {columnList.map((column, index) => (
            <div key={column.id} className="doc-settings-grid-cell" title={`${column.file} › ${column.path.join('.')}`}>
              <span className="doc-settings-grid-order">{index + 1}</span>
              <span className="doc-settings-grid-label">{column.label}</span>
            </div>
          ))}
        </div>
        {rowCount === 0 ? (
          <div className="doc-settings-grid-row"><div className="doc-settings-grid-key doc-settings-note">{isComp ? 'no component key is declared' : 'no page key is declared'}</div></div>
        ) : null}
        {groupList.map((group) => [
          isComp ? (
            <div key={`group:${group.compId}`} className="doc-settings-grid-row is-group">
              <div className="doc-settings-grid-key">{group.compName}</div>
            </div>
          ) : null,
          ...group.rowList.map((row) => (
            <div key={`${group.compId}:${row.key}`} className="doc-settings-grid-row">
              <div className="doc-settings-grid-key" title={row.define?.description ?? 'unknown key'}>{row.key}</div>
              {row.cellList.map((cell) => (
                <div
                  key={cell.declarationId}
                  className={`doc-settings-grid-cell${cell.declarationId === row.declarationIdDeciding ? ' is-deciding' : ''}`}
                  title={cell.declarationId === row.declarationIdDeciding ? 'the value the layer takes' : undefined}
                >
                  <GridCellEditor
                    layer={layer}
                    row={row}
                    cell={cell}
                    onCommit={(value) => (isComp
                      ? configStore.layerDeclarationCompValueSet(layerId, cell.declarationId, cell.compKey, row.key, value)
                      : configStore.layerDeclarationValueSet(layerId, cell.declarationId, row.key, value))}
                  />
                </div>
              ))}
            </div>
          )),
        ])}
      </div>
    </div>
  );
});

// the value of one declaration for one key: a dash when not declared, the
// text as written when it cannot be used or written, else a control for
// its type (on / off and enums segmented, text in place, a source path with
// completion)
const GridCellEditor = observer(function GridCellEditor({ layer, row, cell, onCommit }) {
  const { componentConfig } = useDocStores();
  const { item } = cell;
  const define = row.define;
  if (!item) return <span className="doc-settings-grid-empty" aria-label="not declared">—</span>;
  const valueText = valueTextGet(item.valueDeclared);
  if (!define || !item.isValid || !layer.isWritable) {
    return (
      <span
        className={`doc-settings-value-text${item.isValid ? '' : ' is-error'}`}
        title={item.isValid ? (layer.disabledReason || undefined) : item.message}
      >
        {valueText}
      </span>
    );
  }
  const isLocked = layer.request.status === 'submitting';
  const SegmentedControl = componentConfig.SegmentedControl;
  if ((define.type === 'boolean' || define.type === 'enum') && SegmentedControl) {
    const valueList = define.type === 'boolean' ? [true, false] : define.valueList ?? [];
    return (
      <SegmentedControl
        data={{ valueSelected: item.valueDeclared, segList: valueList.map((value) => ({ value, labelText: String(value) })) }}
        config={{ isDisabled: isLocked, widthModeSegment: 'auto' }}
        onEvent={(eventType, eventData) => {
          if (eventType === 'valueSelectedChange') void onCommit(eventData.valueSelected);
        }}
      />
    );
  }
  if (define.type === 'sourcePath') {
    return (
      <SourcePathInput
        value={item.valueDeclared ?? ''}
        spec={define.pathSpec ?? { kind: 'dir' }}
        placeholder="~rootId/dir"
        isDisabled={isLocked}
        onCommit={(text) => void onCommit(text)}
        isMissingWarned
      />
    );
  }
  return (
    <EditValueInline
      className="doc-settings-grid-value"
      value={settingsValueToItem(define, item.valueDeclared)}
      placeholder="empty"
      isLocked={isLocked}
      onCommit={(text) => void onCommit(settingsValueFromItem(define, text))}
    />
  );
});

// what the head says beside the title on a tab without config layers
const tabNoteByTabId = {
  assetStore: 'the folders are written into the store\'s config file',
  service: 'the instances live in the service backend, in its instance folders',
};

// what the head says on the Result tab
const resultNote = 'the values in effect at page level, and the level that decided each; a document may refine a document-level key';

// the head of a value tab: what the layer shown is, Clear cache for a layer
// that can be dropped at once, the switch to the edit view for a layer of
// several declarations, and the state of its last write
const LayerHead = observer(function LayerHead({ layer }) {
  const { configStore } = useDocStores();
  return (
    <>
      {layer.isClearable ? (
        <button
          type="button"
          className="doc-button doc-settings-head-button"
          disabled={!configStore.layerIsDeclaringAny(layer.id)}
          title={`Drop every value of the ${layer.define.label} layer and remove its browser storage`}
          aria-label={`Drop every value of the ${layer.define.label} layer and remove its browser storage`}
          onClick={() => void configStore.layerClear(layer.id)}
        >
          <RotateCw aria-hidden="true" size={13} strokeWidth={2} />
          <span>Clear cache</span>
        </button>
      ) : null}
      {layer.isDeclarationViewOffered ? (
        <button
          type="button"
          className="doc-button doc-settings-head-button"
          aria-pressed={configStore.settingsIsDeclarationView}
          title={configStore.settingsIsDeclarationView
            ? 'Leave the edit mode: show the values of the layer merged'
            : 'Show every declaration of the layer side by side, and edit any value in place'}
          onClick={() => configStore.settingsIsDeclarationViewSet(!configStore.settingsIsDeclarationView)}
        >
          <Pencil aria-hidden="true" size={12} strokeWidth={2} />
          <span>{layer.isWritable ? 'Edit' : 'Declarations'}</span>
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

// why a key cannot be set in the current environment; '' when it can
function itemDisabledReasonGet(key, { envStore }) {
  if (key === 'EditBlockEnterMode') return envStore.reasonGet('edit');
  return '';
}

// a value shown as text (the Result tab, a key the layer cannot use)
function valueTextGet(value) {
  if (value === undefined) return '';
  if (value === null) return 'not set';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
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
      isMissingWarned
    />
  );
});

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
