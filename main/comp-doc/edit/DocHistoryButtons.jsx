import { observer } from 'mobx-react-lite';
import { LoaderCircle, Undo2 } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import './DocEdit.css';

// Undo and Redo of one document (doc_page_impl_edit_history.md): in the toolbar
// of the page for the document of the page, in the header of a popup for the
// document it shows (a linked document, an MDX block). Each reports its request
// through the event layer with the document named, so it is that document's
// history whatever the author is at; the title says what would be taken back,
// and the answer goes to the notice of the page as the answer to a key does
// (why a step was refused: the lines it would write changed since).
//
//   path      the document (an embedded document: the entries made in it)
//   variant   'toolbar' (the buttons of the document controls) | 'header' (the
//             small buttons of a popup header)
export const DocHistoryButtons = observer(function DocHistoryButtons({ path, variant = 'toolbar' }) {
  const { apiStore, editStore, eventRouter, historyStore, hotkeyStore, onEvent: onEventPage } = useDocStores();
  if (!historyStore || !eventRouter || !path || !editStore?.isAvailable) return null;
  const scope = historyStore.scopeStateGet(path);
  const stepState = historyStore.stepState?.path === path ? historyStore.stepState : undefined;
  const isBusy = historyStore.isSubmitting || editStore.isSubmitting;
  const keyText = (apiId) => {
    const label = hotkeyStore?.labelGet?.(apiId) ?? '';
    return label ? ` (${label})` : '';
  };
  const titleUndo = scope.undo ? `Undo: ${historyStore.entryLabelGet(path, scope.undo)}${keyText('history/undo')}` : 'Nothing to undo';
  const titleRedo = scope.redo ? `Redo: ${historyStore.entryLabelGet(path, scope.redo)}${keyText('history/redo')}` : 'Nothing to redo';

  const stepRequest = async (direction, event) => {
    const eventDoc = eventRouter.eventBuild({
      type: direction === 'undo' ? 'historyUndoRequest' : 'historyRedoRequest',
      data: { path },
      source: { sourcePath: path, placement: variant === 'toolbar' ? 'editToolbar' : 'popupHeader' },
      point: event,
    });
    const result = await eventRouter.dispatch(eventDoc, { onEventHost: onEventPage });
    apiStore?.resultNotice?.(result);
  };

  const className = variant === 'header' ? 'doc-button doc-history-button' : 'doc-history-button';
  const iconSize = variant === 'header' ? 12 : 13;
  const isUndoPending = stepState?.direction === 'undo';
  const isRedoPending = stepState?.direction === 'redo';

  return (
    <span className="doc-history-buttons" data-variant={variant} role="group" aria-label="History">
      <button
        type="button"
        className={className}
        disabled={isBusy || !scope.undo}
        title={titleUndo}
        aria-label="Undo"
        onClick={(event) => void stepRequest('undo', event)}
      >
        {isUndoPending
          ? <LoaderCircle aria-hidden="true" size={iconSize} strokeWidth={2.2} className="doc-spin" />
          : <Undo2 aria-hidden="true" size={iconSize} strokeWidth={2} />}
      </button>
      <button
        type="button"
        className={`${className} is-mirrored`}
        disabled={isBusy || !scope.redo}
        title={titleRedo}
        aria-label="Redo"
        onClick={(event) => void stepRequest('redo', event)}
      >
        {isRedoPending
          ? <LoaderCircle aria-hidden="true" size={iconSize} strokeWidth={2.2} className="doc-spin" />
          : <Undo2 aria-hidden="true" size={iconSize} strokeWidth={2} />}
      </button>
    </span>
  );
});
