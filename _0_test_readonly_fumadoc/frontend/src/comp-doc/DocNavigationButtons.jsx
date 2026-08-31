import { observer } from 'mobx-react-lite';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useDocStores } from '../store/context.js';

export const DocNavigationButtons = observer(function DocNavigationButtons({ isCompact = false }) {
  const { docStore } = useDocStores();
  const entryBack = docStore.navigationBackEntry;
  const entryForward = docStore.navigationForwardEntry;

  return (
    <div className="doc-navigation-buttons" role="group" aria-label="Document navigation history">
      <button
        type="button"
        disabled={!docStore.isNavigationBackAvailable}
        title={entryBack ? `Back to ${entryBack.text}` : 'No previous document'}
        aria-label={entryBack ? `Back to ${entryBack.text}` : 'No previous document'}
        onClick={() => docStore.navigationBack()}
      >
        <ArrowLeft aria-hidden="true" size={15} strokeWidth={2} />
        {isCompact ? null : <span>Back</span>}
      </button>
      <button
        type="button"
        disabled={!docStore.isNavigationForwardAvailable}
        title={entryForward ? `Forward to ${entryForward.text}` : 'No next document'}
        aria-label={entryForward ? `Forward to ${entryForward.text}` : 'No next document'}
        onClick={() => docStore.navigationForward()}
      >
        {isCompact ? null : <span>Forward</span>}
        <ArrowRight aria-hidden="true" size={15} strokeWidth={2} />
      </button>
    </div>
  );
});