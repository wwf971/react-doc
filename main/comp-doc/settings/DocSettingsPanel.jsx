import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { RotateCw, X } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import './DocSettings.css';

// The settings panel: every config key that is user settable, one item per
// key, rendered by the application's ConfigPanel (config.components). A
// change sets the user level of that key (DocConfigStore.valueUserSet), the
// override that comes after every declared level and lives for the page
// session only; "Reset" drops every override.
//
// the panel is rendered once at page level while DocConfigStore.isSettingsOpen,
// and floats under the settings button that opened it; a pointer going down
// outside it, or Escape, closes it.
export const DocSettingsPanel = observer(function DocSettingsPanel() {
  const stores = useDocStores();
  const { configStore } = stores;
  if (!configStore.isSettingsOpen) return null;
  return <DocSettingsPanelOpen anchorElement={configStore.settingsAnchorElement} />;
});

const DocSettingsPanelOpen = observer(function DocSettingsPanelOpen({ anchorElement }) {
  const stores = useDocStores();
  const { componentConfig, configStore } = stores;
  const panelRef = useRef(null);
  const [position, positionSet] = useState(null);
  const ConfigPanel = componentConfig.ConfigPanel;

  useLayoutEffect(() => {
    const rect = anchorElement?.getBoundingClientRect();
    if (!rect) return;
    positionSet({ top: rect.bottom + 4, left: rect.left });
  }, [anchorElement]);

  useEffect(() => {
    const pointerDownHandle = (event) => {
      if (event.button !== 0) return;
      const panel = panelRef.current;
      if (!panel || panel.contains(event.target) || anchorElement?.contains(event.target)) return;
      configStore.settingsOpenSet(false);
    };
    const keyDownHandle = (event) => {
      if (event.key === 'Escape') configStore.settingsOpenSet(false);
    };
    document.addEventListener('pointerdown', pointerDownHandle, true);
    document.addEventListener('keydown', keyDownHandle, true);
    return () => {
      document.removeEventListener('pointerdown', pointerDownHandle, true);
      document.removeEventListener('keydown', keyDownHandle, true);
    };
  }, [anchorElement, configStore]);

  const itemList = configStore.configDefineListUserSettable.map((define) => settingsItemBuild(define, stores));
  const data = {};
  for (const define of configStore.configDefineListUserSettable) {
    data[define.key] = settingsValueToItem(define, configStore.valueGlobalGet(define.key));
  }
  const isOverrideAny = Object.keys(configStore.configUserByKey).length > 0;

  const eventHandle = (eventType, eventData) => {
    if (eventType !== 'valueChangeAttempt') return undefined;
    const define = configStore.configDefineByKey.get(eventData.valueId);
    if (!define) return { code: -1, message: `unknown config key ${eventData.valueId}` };
    configStore.valueUserSet(define.key, settingsValueFromItem(define, eventData.value));
    return { code: 0 };
  };

  return createPortal(
    <div
      ref={panelRef}
      className="doc-settings-panel"
      role="dialog"
      aria-label="Settings"
      style={position ? { top: position.top, left: position.left } : { visibility: 'hidden' }}
    >
      <div className="doc-settings-head">
        <span className="doc-settings-title">Settings</span>
        <button
          type="button"
          className="doc-settings-head-button"
          disabled={!isOverrideAny}
          title="Reset every setting to the configured value"
          aria-label="Reset every setting to the configured value"
          onClick={() => configStore.configUserClear()}
        >
          <RotateCw aria-hidden="true" size={13} strokeWidth={2} />
          <span>Reset</span>
        </button>
        <span className="doc-settings-note">for this page session; the document config is not changed</span>
        <button
          type="button"
          className="doc-settings-head-button doc-settings-close"
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
          config={{ compPath: ['docSettings'], items: itemList }}
          onEvent={eventHandle}
        />
      </div>
    </div>,
    document.body,
  );
});

// the ConfigPanel item of one config define. an enum is a dropdown.
function settingsItemBuild(define, stores) {
  const item = {
    id: define.key,
    label: define.key,
    description: define.description,
    defaultValue: settingsValueToItem(define, define.valueDefault),
  };
  if (define.type === 'boolean') item.type = 'boolean';
  else if (define.type === 'enum') {
    item.type = 'select';
    item.options = define.valueList;
  } else if (define.type === 'number') item.type = 'number';
  else if (define.type === 'string' || define.type === 'stringList') item.type = 'string';
  // a key of type any has no control; it stays settable from YAML only
  else item.isHidden = true;

  const disabledReason = itemDisabledReasonGet(define.key, stores);
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

// a config value as the panel item shows it: a string list as its comma
// separated text
function settingsValueToItem(define, value) {
  if (define.type === 'stringList') return Array.isArray(value) ? value.join(', ') : '';
  if (define.type === 'string') return value ?? '';
  return value;
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
