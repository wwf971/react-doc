import { observer } from 'mobx-react-lite';
import { Square, SquareCheck } from '../../frontend/UICommon.js';

// The switch of the slash mode, in the bar of an editor that offers it
// (doc_page_impl_edit_slash.md#on-and-off): on, typing "/" at the start of
// a word opens the menu of actions; off, "/" is a character like any other.
// One switch for the page, kept in the browser. Pressing it does not take
// the focus away from the surface (EditFloatingPanel keeps it).
//
// it is drawn as a checkbox with its label, "/ menu": a box with a check
// while the menu is on, an empty box while it is off. a filled button would
// say on by its tint alone, which in a grey theme reads as a button that is
// greyed out. the label is the same in both states, so the bar keeps its width.
//
//   slash   config.edit.slash of the editor; nothing is shown without it
export const EditSlashToggle = observer(function EditSlashToggle({ slash, isDisabled = false }) {
  const slashStore = slash?.store;
  if (!slashStore) return null;
  const isOn = slashStore.isOn;
  const Icon = isOn ? SquareCheck : Square;
  return (
    <button
      type="button"
      role="checkbox"
      className="doc-button doc-edit-slash-toggle"
      aria-checked={isOn}
      disabled={isDisabled}
      title={isOn
        ? 'The slash menu is on: typing / at the start of a word opens a menu of actions (/link writes a link to a document). Click to turn it off.'
        : 'The slash menu is off: / is typed as a character. Click to turn it on.'}
      onClick={() => slashStore.isOnSet(!isOn)}
    >
      <Icon aria-hidden="true" size={12} strokeWidth={2} />
      <span>/ menu</span>
    </button>
  );
});
