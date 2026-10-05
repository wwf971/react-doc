import { TextBlockEdit } from './TextBlockEdit.jsx';

// Edit mode of any block as plain source: the shared in-place editor with a
// monospace surface, no structural control.
export function BlockSourceEdit({ data = {}, config = {}, onEvent }) {
  return <TextBlockEdit data={data} config={config} onEvent={onEvent} />;
}
