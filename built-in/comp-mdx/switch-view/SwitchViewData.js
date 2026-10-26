import { yamlParse } from '../../../main/frontend/src/lib/yaml.js';

function switchViewDataParse(data = {}) {
  const value = data.raw ? yamlParse(data.raw) : data;
  if (!isMapping(value) || !Array.isArray(value.views) || !value.views.length) {
    throw new Error('SwitchView requires a non-empty views list.');
  }
  const ids = new Set();
  const views = value.views.map((view, index) => {
    if (!isMapping(view)) throw new Error(`SwitchView views[${index}] must be a mapping.`);
    const id = textRequired(view.id ?? `view-${index}`, `views[${index}].id`);
    if (ids.has(id)) throw new Error(`SwitchView view id must be unique: ${id}.`);
    ids.add(id);
    const props = view.props ?? {};
    if (!isMapping(props)) throw new Error(`SwitchView views[${index}].props must be a mapping.`);
    const dataView = typeof view.data === 'string' ? yamlParse(view.data) : view.data;
    if (!isMapping(dataView) && !Array.isArray(dataView)) {
      throw new Error(`SwitchView views[${index}].data must be a YAML mapping or list.`);
    }
    return {
      id,
      label: textRequired(view.label, `views[${index}].label`),
      component: textRequired(view.component, `views[${index}].component`),
      icon: view.icon,
      props,
      data: dataView,
      raw: JSON.stringify(dataView),
    };
  });
  const viewDefault = value.viewDefault ?? views[0].id;
  if (!ids.has(viewDefault)) throw new Error(`SwitchView unknown viewDefault: ${viewDefault}.`);
  return { label: value.label || 'Views', viewDefault, views };
}

function isMapping(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function textRequired(value, path) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`SwitchView ${path} is required.`);
  return value.trim();
}

function switchViewDependenciesCollect(data, context) {
  let value;
  try {
    value = switchViewDataParse(data);
  } catch (error) {
    context.warn(`SwitchView data is invalid: ${String(error.message ?? error)}`);
    return;
  }
  for (const view of value.views) {
    context.componentCollect(view.component, { ...view.data, ...view.props, raw: view.raw, lang: 'yaml' });
  }
}

export { switchViewDataParse, switchViewDependenciesCollect };