import { yamlParse } from '../../frontend/src/lib/yaml.js';

const contentTypeSet = new Set(['text', 'markdown']);

function blockQADataParse(data = {}) {
  const parsed = data.raw ? yamlParse(data.raw) : data;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('BlockQA data must be a mapping.');
  }
  if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
    throw new Error('BlockQA requires a non-empty items list.');
  }
  const titleValue = data.title ?? parsed.title;
  const title = titleValue === undefined || titleValue === null
    ? null
    : String(titleValue).trim() || null;
  const isCollapsible = booleanNormalize(
    data.isCollapsible ?? parsed.isCollapsible,
    false,
    'isCollapsible',
  );
  const isExpandedDefault = isCollapsible
    ? booleanNormalize(data.isExpandedDefault ?? parsed.isExpandedDefault, true, 'isExpandedDefault')
    : true;

  return {
    title,
    isCollapsible,
    isExpandedDefault,
    items: parsed.items.map((item, index) => itemNormalize(
      item,
      index,
      isCollapsible,
      isExpandedDefault,
    )),
  };
}

function itemNormalize(item, index, isCollapsible, isExpandedDefault) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error(`BlockQA items[${index}] must be a mapping.`);
  }
  return {
    question: contentNormalize(item.question, `items[${index}].question`),
    answer: contentNormalize(item.answer, `items[${index}].answer`),
    isExpanded: isCollapsible
      ? booleanNormalize(item.isExpanded, isExpandedDefault, `items[${index}].isExpanded`)
      : true,
  };
}

function booleanNormalize(value, valueDefault, path) {
  if (value === undefined || value === null) return valueDefault;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`BlockQA ${path} must be a boolean.`);
}

function contentNormalize(value, path) {
  if (value === undefined || value === null) throw new Error(`BlockQA ${path} is required.`);
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { type: 'text', content: String(value).trim() };
  }

  const type = String(value.type ?? 'text').trim();
  if (!contentTypeSet.has(type)) {
    throw new Error(`BlockQA ${path}.type must be text or markdown.`);
  }
  const content = String(value.content ?? '').trim();
  if (!content) throw new Error(`BlockQA ${path}.content is required.`);
  return { type, content };
}

export { blockQADataParse };
