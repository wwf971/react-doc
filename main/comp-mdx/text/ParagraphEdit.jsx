import { TextBlockEdit } from './TextBlockEdit.jsx';

// Edit mode of a paragraph block: the paragraph edited in its place by the
// shared editor. A paragraph has no structural control of its own.
export function ParagraphEdit({ data = {}, config = {}, onEvent }) {
  return <TextBlockEdit data={data} config={config} onEvent={onEvent} />;
}
