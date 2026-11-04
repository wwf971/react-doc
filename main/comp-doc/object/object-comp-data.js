import { parse as yamlParse } from 'yaml';
import { OBJECT_VIEW_CONTEXT_LIST } from '../../frontend/src/lib/doc-object-ref.js';

// The data of the object components (ObjectView, ObjectList, ObjectGroup),
// however it was written: the yaml of a comment block, the props of an MDX
// element, the data of a node of a card diagram. { ...data, message } with
// the yaml read over the props; message says what could not be read.
export function objectCompDataRead(data = {}) {
  const { raw, lang, content: _content, ...props } = data;
  if (typeof raw !== 'string' || raw.trim() === '') return { ...props, message: '' };
  try {
    const parsed = yamlParse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return { ...props, ...parsed, message: '' };
    return { ...props, message: 'the block holds no mapping' };
  } catch (error) {
    return { ...props, message: `the yaml of the block is not valid: ${String(error?.message ?? error)}` };
  }
}

export function objectContextRead(value, contextDefault = 'card') {
  return OBJECT_VIEW_CONTEXT_LIST.includes(value) ? value : contextDefault;
}

// the types a list asks for: typeList, or type, as a list
export function objectTypeListRead(data) {
  if (Array.isArray(data.typeList)) return data.typeList.map(String);
  if (typeof data.typeList === 'string') return data.typeList.split(',').map((item) => item.trim()).filter(Boolean);
  if (typeof data.type === 'string' && data.type) return [data.type];
  return ['core.object'];
}
