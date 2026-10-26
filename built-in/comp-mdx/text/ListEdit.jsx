import { observer } from 'mobx-react-lite';
import { TextBlockEdit } from './TextBlockEdit.jsx';
import { listTypeGet, listTypeSet } from './ListData.js';

// Edit mode of a list block: the list edited in its place, plus a control in
// the floating bar that switches the top-level items between bullets and numbers.
const typeList = [
  { type: 'unordered', label: 'Bullets' },
  { type: 'ordered', label: 'Numbers' },
];

export const ListEdit = observer(function ListEdit({ data = {}, config = {}, onEvent }) {
  const session = config.edit?.session;
  const text = typeof session?.textDraft === 'string' ? session.textDraft : String(data.text ?? '');
  const isLocked = session?.status === 'submitting';
  const typeCurrent = listTypeGet(text);

  return (
    <TextBlockEdit data={data} config={config} onEvent={onEvent}>
      <span className="doc-edit-segment" role="group" aria-label="List type">
        {typeList.map((item) => (
          <button
            key={item.type}
            type="button"
            className={typeCurrent === item.type ? 'is-active' : ''}
            aria-pressed={typeCurrent === item.type}
            disabled={isLocked || typeCurrent === ''}
            onClick={() => void onEvent?.('editTextSetRequest', { text: listTypeSet(text, item.type) })}
          >
            {item.label}
          </button>
        ))}
      </span>
    </TextBlockEdit>
  );
});
