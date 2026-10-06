import { observer } from 'mobx-react-lite';
import { Settings } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import './DocSettings.css';

// The settings button of the page, in the side-panel header left of the
// collapse button (the layout renders the header slot once more in its
// narrow-screen header, so the button may exist twice; the panel is
// rendered once, by DocSettingsPanel at page level, under the button that
// opened it). It opens the settings panel, where the reader overrides
// config keys for the page session (doc_page_impl_config.md#user-level).
// The panel needs the ConfigPanel the application injects through
// config.components; without it there is no button.
export const DocSettingsButton = observer(function DocSettingsButton() {
  const { componentConfig, configStore } = useDocStores();
  if (!componentConfig.ConfigPanel) return null;
  const isOpen = configStore.isSettingsOpen;

  return (
    <button
      type="button"
      className="doc-settings-button"
      aria-pressed={isOpen}
      aria-haspopup="dialog"
      title="Settings"
      aria-label="Settings"
      onClick={(event) => configStore.settingsOpenSet(!isOpen, event.currentTarget)}
    >
      <Settings aria-hidden="true" size={16} strokeWidth={2} />
    </button>
  );
});
