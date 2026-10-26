import { observer } from 'mobx-react-lite';
import { TextBlockEdit } from './TextBlockEdit.jsx';
import { headingLevelGet, headingLevelSet } from './HeadingData.js';

// Edit mode of a heading block: the heading edited in its place, plus a
// level control in the floating bar that rewrites the "#" run of the heading
// line; the surface then changes to the element of the new level. Marker
// comments before the heading (Anchor, MultiLang) stay in the source as they are.
const levelList = [1, 2, 3, 4, 5, 6];

export const HeadingEdit = observer(function HeadingEdit({ data = {}, config = {}, onEvent }) {
  const session = config.edit?.session;
  const text = typeof session?.textDraft === 'string' ? session.textDraft : String(data.text ?? '');
  const isLocked = session?.status === 'submitting';
  const level = headingLevelGet(text);

  return (
    <TextBlockEdit data={data} config={config} onEvent={onEvent}>
      <span className="doc-edit-segment" role="group" aria-label="Heading level">
        {levelList.map((levelItem) => (
          <button
            key={levelItem}
            type="button"
            className={level === levelItem ? 'is-active' : ''}
            aria-pressed={level === levelItem}
            disabled={isLocked || level === 0}
            onClick={() => void onEvent?.('editTextSetRequest', { text: headingLevelSet(text, levelItem) })}
          >
            H{levelItem}
          </button>
        ))}
      </span>
    </TextBlockEdit>
  );
});
