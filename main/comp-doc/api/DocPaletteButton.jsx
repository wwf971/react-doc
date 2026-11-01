import { observer } from 'mobx-react-lite';
import { SquareTerminal } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import '../settings/DocSettings.css';

// The button of the command palette in the side-panel header, beside the
// settings button and of the same shape (doc_page_impl_api_command_palette.md).
// its hover title names the key bound to the palette, so the reader learns
// it there.
export const DocPaletteButton = observer(function DocPaletteButton() {
  const { paletteStore, hotkeyStore } = useDocStores();
  const isOpen = paletteStore.isOpen;
  const keyLabel = hotkeyStore.labelGet('palette/toggle') || hotkeyStore.labelGet('palette/open');
  const title = keyLabel ? `Command palette (${keyLabel})` : 'Command palette';
  return (
    <button
      type="button"
      className="doc-settings-button"
      aria-pressed={isOpen}
      aria-haspopup="dialog"
      title={title}
      aria-label="Command palette"
      // a pointer down would blur the palette's field and close it before
      // the click: the button toggles on pointer down instead
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        paletteStore.toggle();
      }}
    >
      <SquareTerminal aria-hidden="true" size={16} strokeWidth={2} />
    </button>
  );
});
