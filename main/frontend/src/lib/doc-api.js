// The unified api registry: what an api is and how the registry of the page
// is built from its layers (design: doc_page_impl_api.md).
//
// An api is a named, instant operation of the page: it is answered within
// the call (a short timeout guards it), never queued as a job. Everything
// that works the page programmatically goes through one: the command
// palette (doc_page_impl_api_command_palette.md), the hotkeys
// (doc_page_impl_api_hotkey.md), a remote caller through the development
// server, the host application, and another api.
//
//   apiDefine({
//     name          optional: the last part of the id when the registry key
//                   gives the id; required for the apis a component exposes
//                   (their id is {compId}/{name})
//     label         how the palette and the panels name it
//     description   one line under the label
//     category      the group the palette shows before the label
//                   ("Navigation: Back"); default: the first part of the id
//     icon          a component drawing its icon (optional)
//     paramList     [{ name, type, isRequired, description, valueDefault, valueList, pathSpec }]
//                   type: string | number | boolean | object | list | any
//                     | sourcePath: a string naming a document or folder of the
//                       source, with pathSpec { kind: 'file' | 'dir' | 'any', extList? }
//                       as a config key of that type (the palette completes it)
//                   valueList: the values allowed (the palette offers them)
//                   isRequired: a call without it is refused; otherwise
//                   valueDefault stands in, or the param is absent
//     run(context, params) -> result | Promise<result>
//                   result: { code, data, message }, or the data alone
//                   (code 0), or nothing (code 0); a thrown error is code -1
//     isAvailable(context) -> true | false | 'why not'   optional
//     palette       true | false | { keywordList }: whether the command
//                   palette lists it; default: listed (an api with
//                   parameters is asked for them in the palette); false for
//                   an api that is not for a reader (one that answers data)
//     timeoutMs     how long a call may take (default API_TIMEOUT_MS)
//   })
//
// the registry is apiById, { id: definition }, with ids {layer}/{name}
// such as nav/back; apiByIdBuild stacks the layers (the package's, the doc
// pages' declared apis, the host's), a later layer replacing an id of an
// earlier one, null removing it. a component's apis and a service's are
// added by providers at run time (DocApiStore), not by a layer.

export const API_CODE_OK = 0;
// the api ran and refused, or failed
export const API_CODE_FAILED = -1;
// no api of that id is registered now
export const API_CODE_UNKNOWN = -2;
// the api exists and cannot run now (isAvailable said why)
export const API_CODE_UNAVAILABLE = -3;
// the parameters are wrong (a required one missing, a wrong type, an unknown one)
export const API_CODE_PARAMS = -4;
// the call did not answer in time
export const API_CODE_TIMEOUT = -5;
// a remote call: no page is connected to the development server, or it did not answer
export const API_CODE_PAGE = -6;

export const API_TIMEOUT_MS = 10000;

export const API_PARAM_TYPE_LIST = ['string', 'number', 'boolean', 'object', 'list', 'any', 'sourcePath'];

const segmentRegex = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

// {layer}/{name}, two segments or more (a component's api: {compId}/{name})
export function apiIdIsValid(id) {
  const segmentList = String(id ?? '').split('/');
  return segmentList.length >= 2 && segmentList.every((segment) => segmentRegex.test(segment));
}

export function apiDefine(options = {}) {
  if (!options || typeof options !== 'object') throw new Error('apiDefine: options must be an object.');
  if (typeof options.run !== 'function') throw new Error(`apiDefine: ${options.name ?? options.label ?? 'an api'} needs run(context, params).`);
  const name = options.name === undefined ? '' : String(options.name);
  if (name !== '' && !segmentRegex.test(name)) throw new Error(`apiDefine: name must be one segment (letters, digits, "_", "-", "."): ${JSON.stringify(options.name)}`);
  const paramList = paramListNormalize(options.paramList, name || options.label);
  return Object.freeze({
    name,
    label: String(options.label ?? name),
    description: String(options.description ?? ''),
    category: options.category === undefined ? '' : String(options.category),
    icon: options.icon,
    paramList,
    run: options.run,
    isAvailable: typeof options.isAvailable === 'function' ? options.isAvailable : undefined,
    palette: paletteNormalize(options.palette),
    timeoutMs: Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? Number(options.timeoutMs) : API_TIMEOUT_MS,
  });
}

function paramListNormalize(paramList, place) {
  if (paramList === undefined) return Object.freeze([]);
  if (!Array.isArray(paramList)) throw new Error(`apiDefine: paramList of ${place} must be a list.`);
  const nameSet = new Set();
  return Object.freeze(paramList.map((param, index) => {
    if (!param || typeof param !== 'object' || typeof param.name !== 'string' || param.name === '') {
      throw new Error(`apiDefine: param ${index} of ${place} needs a name.`);
    }
    if (nameSet.has(param.name)) throw new Error(`apiDefine: param ${param.name} of ${place} is declared twice.`);
    nameSet.add(param.name);
    const type = param.type === undefined ? 'any' : String(param.type);
    if (!API_PARAM_TYPE_LIST.includes(type)) {
      throw new Error(`apiDefine: param ${param.name} of ${place}: type must be one of ${API_PARAM_TYPE_LIST.join(', ')}.`);
    }
    return Object.freeze({
      name: param.name,
      type,
      isRequired: param.isRequired === true,
      description: String(param.description ?? ''),
      valueDefault: param.valueDefault,
      valueList: Array.isArray(param.valueList) ? Object.freeze([...param.valueList]) : undefined,
      pathSpec: type === 'sourcePath' ? Object.freeze({ kind: 'any', ...(param.pathSpec && typeof param.pathSpec === 'object' ? param.pathSpec : {}) }) : undefined,
    });
  }));
}

function paletteNormalize(palette) {
  if (palette === false) return Object.freeze({ isListed: false, keywordList: [] });
  if (palette === true || palette === undefined) return Object.freeze({ isListed: true, keywordList: [] });
  if (palette && typeof palette === 'object') {
    return Object.freeze({
      isListed: palette.isListed !== false,
      keywordList: Array.isArray(palette.keywordList) ? palette.keywordList.map(String) : [],
    });
  }
  throw new Error('apiDefine: palette is true, false or { isListed, keywordList }.');
}

export function apiDefinitionIs(value) {
  return Boolean(value) && typeof value === 'object' && typeof value.run === 'function' && Array.isArray(value.paramList);
}

// the registry of the page, by id, from its layers in order: a later layer
// replaces an id of an earlier one; null removes it. what is not a
// definition, or has no valid id, is reported ([doc-api]) and left out,
// never the page. every definition gets its id (and its name, when it
// declared none, from the last segment; its category from the first)
export function apiByIdBuild(...layerList) {
  const apiById = {};
  for (const layer of layerList) {
    for (const [id, definition] of Object.entries(layer ?? {})) {
      if (definition === null) {
        delete apiById[id];
        continue;
      }
      if (!apiIdIsValid(id)) {
        console.warn(`[doc-api] ${id}: an api id is {layer}/{name}; left out`);
        continue;
      }
      if (!apiDefinitionIs(definition)) {
        console.warn(`[doc-api] ${id}: not an apiDefine() definition; left out`);
        continue;
      }
      apiById[id] = apiWithIdBuild(id, definition);
    }
  }
  return apiById;
}

// a definition under its id: the id, the name (the last segment unless
// declared) and the category (the first segment unless declared) filled
export function apiWithIdBuild(id, definition) {
  const segmentList = String(id).split('/');
  return Object.freeze({
    ...definition,
    id,
    name: definition.name || segmentList[segmentList.length - 1],
    category: definition.category || categoryDefaultGet(segmentList[0]),
  });
}

const categoryByLayer = {
  nav: 'Navigation',
  doc: 'Document',
  edit: 'Edit',
  page: 'Page',
  settings: 'Settings',
  search: 'Search',
  palette: 'Palette',
  hotkey: 'Hotkey',
  api: 'Api',
  language: 'Language',
  service: 'Service',
};

function categoryDefaultGet(layer) {
  return categoryByLayer[layer] ?? layer;
}

// the parameters of a call checked against the definition: every required
// one present, every one of its type, no unknown one; defaults filled.
// answers { params } or { message }
export function apiParamsCheck(definition, paramsGiven) {
  const given = paramsGiven === undefined || paramsGiven === null ? {} : paramsGiven;
  if (typeof given !== 'object' || Array.isArray(given)) return { message: 'params must be a mapping' };
  const params = {};
  const knownList = definition.paramList.map((param) => param.name);
  for (const key of Object.keys(given)) {
    if (!knownList.includes(key)) {
      return { message: `unknown param "${key}" (known: ${knownList.length ? knownList.join(', ') : 'none'})` };
    }
  }
  for (const param of definition.paramList) {
    let value = given[param.name];
    if (value === undefined) value = param.valueDefault;
    if (value === undefined) {
      if (param.isRequired) return { message: `param "${param.name}" is required (${param.type}${param.description ? `: ${param.description}` : ''})` };
      continue;
    }
    const message = paramTypeCheck(param, value);
    if (message) return { message };
    params[param.name] = value;
  }
  return { params };
}

function paramTypeCheck(param, value) {
  const place = `param "${param.name}"`;
  switch (param.type) {
    case 'string':
    case 'sourcePath':
      if (typeof value !== 'string') return `${place} must be a string`;
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${place} must be a number`;
      break;
    case 'boolean':
      if (typeof value !== 'boolean') return `${place} must be true or false`;
      break;
    case 'object':
      if (!value || typeof value !== 'object' || Array.isArray(value)) return `${place} must be a mapping`;
      break;
    case 'list':
      if (!Array.isArray(value)) return `${place} must be a list`;
      break;
    default:
      break;
  }
  if (param.valueList && !param.valueList.includes(value)) {
    return `${place} must be one of ${param.valueList.map((item) => JSON.stringify(item)).join(', ')}`;
  }
  return '';
}

// the parameters of a call from texts typed for them (the command palette
// asks for the parameters of an api as text, one field each): a text that
// is empty is no value (the default stands in, or the param is absent),
// the others are read by the type of the param. answers { params } or
// { message } naming the param that does not read; the types and the
// required ones are then checked by apiParamsCheck
export function apiParamsFromText(definition, textByName = {}) {
  const params = {};
  for (const param of definition.paramList) {
    const text = textByName[param.name];
    if (text === undefined || text === null || String(text).trim() === '') continue;
    const textTrim = String(text).trim();
    const place = `param "${param.name}"`;
    switch (param.type) {
      case 'number': {
        const number = Number(textTrim);
        if (!Number.isFinite(number)) return { message: `${place} must be a number` };
        params[param.name] = number;
        break;
      }
      case 'boolean':
        if (textTrim !== 'true' && textTrim !== 'false') return { message: `${place} must be true or false` };
        params[param.name] = textTrim === 'true';
        break;
      case 'object':
      case 'list': {
        const parsed = jsonParseOrUndefined(textTrim);
        if (parsed === undefined) return { message: `${place} must be written as JSON (${param.type === 'list' ? 'a list [...]' : 'a mapping {...}'})` };
        params[param.name] = parsed;
        break;
      }
      case 'any': {
        const parsed = /^[[{"]|^-?\d|^(true|false|null)$/.test(textTrim) ? jsonParseOrUndefined(textTrim) : undefined;
        params[param.name] = parsed === undefined ? String(text) : parsed;
        break;
      }
      default:
        params[param.name] = String(text);
        break;
    }
  }
  return { params };
}

function jsonParseOrUndefined(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// what run() answered, as { code, data, message }: a result with a numeric
// code as it is; nothing is code 0; anything else is the data of code 0
export function apiResultNormalize(value) {
  if (value === undefined || value === null) return { code: API_CODE_OK, data: undefined, message: '' };
  if (typeof value === 'object' && !Array.isArray(value) && typeof value.code === 'number') {
    return { code: value.code, data: value.data, message: String(value.message ?? '') };
  }
  return { code: API_CODE_OK, data: value, message: '' };
}

// whether an api can run now: isAvailable answers true, false, or why not
export function apiAvailabilityGet(definition, context) {
  if (!definition.isAvailable) return { isAvailable: true, reason: '' };
  let answer;
  try {
    answer = definition.isAvailable(context);
  } catch (error) {
    return { isAvailable: false, reason: `isAvailable failed: ${String(error?.message ?? error)}` };
  }
  if (answer === true || answer === undefined) return { isAvailable: true, reason: '' };
  if (answer === false) return { isAvailable: false, reason: 'not available now' };
  return { isAvailable: false, reason: String(answer) };
}

// the definition as a caller outside the page sees it (no functions)
export function apiInfoBuild(definition, availability) {
  return {
    id: definition.id,
    name: definition.name,
    label: definition.label,
    description: definition.description,
    category: definition.category,
    paramList: definition.paramList.map((param) => ({
      name: param.name,
      type: param.type,
      isRequired: param.isRequired,
      description: param.description,
      ...(param.valueDefault !== undefined ? { valueDefault: param.valueDefault } : {}),
      ...(param.valueList ? { valueList: [...param.valueList] } : {}),
      ...(param.pathSpec ? { pathSpec: { ...param.pathSpec } } : {}),
    })),
    isPaletteListed: definition.palette.isListed,
    ...(availability ? { isAvailable: availability.isAvailable, reason: availability.reason } : {}),
  };
}

// ---------- apis declared in a yaml file ----------
// a doc page declares apis in .doc-page/api.yaml (doc_page_impl_api.md#declared-apis):
// an alias of an api with fixed parameters, or a sequence of such calls, so
// that a doc page offers "Open the guide" to the palette and the hotkeys
// without code. the item, as the plugin read it:
//   { id, label, description, category, runList: [{ api, params }], palette }
// the definition calls each step through context.call, in order, and
// answers the last result; a step that fails ends the sequence. it is
// available while every api it calls is registered.
export function apiDeclaredDefine(item) {
  const runList = Array.isArray(item.runList) ? item.runList : [];
  return apiDefine({
    label: item.label,
    description: item.description,
    category: item.category,
    palette: item.palette === false ? false : true,
    isAvailable: (context) => {
      const missing = runList.find((step) => !context.apiExists(step.api));
      return missing ? `${missing.api} is not registered` : true;
    },
    run: async (context) => {
      let result = { code: API_CODE_OK, data: undefined, message: '' };
      for (const step of runList) {
        result = await context.call(step.api, step.params ?? {});
        if (result.code !== API_CODE_OK) return result;
      }
      return result;
    },
  });
}

// the declared apis of the doc pages as one registry layer; the problems
// of the files were reported by the plugin
export function apiDeclaredLayerBuild(apiDeclared) {
  const layer = {};
  for (const item of apiDeclared?.list ?? []) {
    if (!apiIdIsValid(item.id)) continue;
    layer[item.id] = apiDeclaredDefine(item);
  }
  return layer;
}
