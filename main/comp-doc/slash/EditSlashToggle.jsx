import { observer } from 'mobx-react-lite';
import { SquareSlash } from '../../frontend/UICommon.js';

// The switch of the slash mode, in the bar of an editor that offers it
// (doc_page_impl_edit_slash.md#on-and-off): on, typing "/" at the start of
// a word opens the menu of actions; off, the surface is plain text. One
// switch for the page, kept in the browser. Pressing it does not take the
// focus away from the surface (EditFloatingPanel keeps it).
//
//   slash   config.edit.slash of the editor; nothing is shown without it
export const EditSlashToggle = observer(function EditSlashToggle({ slash, isDisabled = false }) {
  const slashStore = slash?.store;
  if (!slashStore) return null;
  const isOn = slashStore.isOn;
  return (
    <span className="doc-edit-segment" role="group" aria-label="Slash commands">
      <button
        type="button"
        className={isOn ? 'is-active' : ''}
        aria-pressed={isOn}
        disabled={isDisabled}
        title={isOn
          ? 'Slash commands are on: type / at the start of a word for actions (/link ...). Click to type plain text.'
          : 'Slash commands are off: / is plain text. Click to turn them on.'}
        onClick={() => slashStore.isOnSet(!isOn)}
      >
        {/* one label in both states, so the bar keeps its width; the state is the active look */}
        <SquareSlash size={12} />
        Slash
      </button>
    </span>
  );
});
