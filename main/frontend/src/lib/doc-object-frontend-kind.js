import { parse as yamlParse } from 'yaml';

// Kinds of data items (design: doc_page_impl_type.md#kinds-of-data-items). A kind is a type of
// the type registry, below frontend.item: what a data item of a frontend object is. A frontend
// object type says which kinds its objects hold (kindList); an entry there either declares a kind
// (its id in the registry: {type id}.{name}) or holds one another type declares (kind: its id).
//
//   kindList:
//     - id: info                         its name in the object: item lists, modes (kind: info)
//       label: Information               declared here: the kind cv.profile.info
//       content: { form: data, schema: { type: object } }       what an item of it is
//       groupPath: info                  how the object holds it (below)
//     - { id: logo, kind: example.media.image, groupPath: logo }   declared by another type
//     - { id: photo, content: bytes, isHeld: false }               declared, held by none of its objects
//     - { id: cache, content: data, isInternal: true }             not registered: this type's own
//
// A type decides what it registers: a kind it declares is a type of the registry unless it says
// isInternal, and then it is the type's own (and its descendants'): checked like any other, held
// by no other type, listed by no registry.
// What a kind is (its declaration, public): label, description, icon, extendList (other kinds),
// content. How an object holds it (the type's own): groupPath, pathPrefix, isIncomingRefused,
// isDoc, docPath, isHeld. The content of a kind:
//
//   form: data    yaml or json read as data (langList, default both), its shape a schema
//   form: text    a text in a language (langList: md, mdx, sql, js, …; absent: any)
//   form: bytes   a file (mediaTypeList: image/png, image/*; extList: png, jpg; sizeMax: 5MB)
//   form: any     anything (the default)
//   content: data | text | bytes | any       the short form
//
// The schema is a subset of JSON Schema written in yaml (OBJECT_FRONTEND_SCHEMA_KEY_LIST),
// checked on the way in (a write of the layer) and reported on the way out (a read).

export const OBJECT_FRONTEND_KIND_ROOT = 'frontend.item';
// the name of a kind in an object: a segment of a type id, since the kind's id is {type}.{name}
export const OBJECT_FRONTEND_KIND_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9-]*$/;
export const OBJECT_FRONTEND_KIND_FORM_LIST = ['data', 'text', 'bytes', 'any'];
export const OBJECT_FRONTEND_KIND_DATA_LANG_LIST = ['yaml', 'json'];
const KIND_DECLARE_KEY_LIST = ['label', 'description', 'icon', 'extendList', 'content', 'isInternal'];
const KIND_HOLD_KEY_LIST = ['groupPath', 'pathPrefix', 'isIncomingRefused', 'isDoc', 'docPath', 'isHeld'];
const KIND_ENTRY_KEY_LIST = ['id', 'kind', ...KIND_DECLARE_KEY_LIST, ...KIND_HOLD_KEY_LIST];
const CONTENT_KEY_LIST_BY_FORM = {
  data: ['form', 'langList', 'schema'],
  text: ['form', 'langList'],
  bytes: ['form', 'mediaTypeList', 'extList', 'sizeMax'],
  any: ['form'],
};
const MEDIA_TYPE_REGEX = /^[a-z0-9][a-z0-9.+-]*\/([a-z0-9][a-z0-9.+-]*|\*)$/i;
const SIZE_UNIT = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };

function mappingIs(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// ---------- the content of a kind ----------

// a content as written: the short form (data, text, bytes, any) or a mapping; { form: any } when
// absent. what cannot be read is reported and read as any, so a kind still holds its items
export function objectFrontendKindContentRead(value, place, problem) {
  if (value === undefined || value === null) return { form: 'any' };
  if (typeof value === 'string') {
    if (OBJECT_FRONTEND_KIND_FORM_LIST.includes(value)) return value === 'data' ? { form: 'data', langList: [...OBJECT_FRONTEND_KIND_DATA_LANG_LIST] } : { form: value };
    problem(`${place}: "content" is ${OBJECT_FRONTEND_KIND_FORM_LIST.join(', ')} or a mapping { form, … }; read as any`);
    return { form: 'any' };
  }
  if (!mappingIs(value)) {
    problem(`${place}: "content" is ${OBJECT_FRONTEND_KIND_FORM_LIST.join(', ')} or a mapping { form, … }; read as any`);
    return { form: 'any' };
  }
  // the form may be left out where the keys say it
  const form = value.form ?? (value.schema !== undefined ? 'data' : (value.mediaTypeList ?? value.extList ?? value.sizeMax) !== undefined ? 'bytes' : undefined);
  if (!OBJECT_FRONTEND_KIND_FORM_LIST.includes(form)) {
    problem(`${place}: "content.form" is ${OBJECT_FRONTEND_KIND_FORM_LIST.join(', ')}; read as any`);
    return { form: 'any' };
  }
  for (const key of Object.keys(value)) {
    if (!CONTENT_KEY_LIST_BY_FORM[form].includes(key)) problem(`${place}: "content.${key}" means nothing for the form ${form} (its keys: ${CONTENT_KEY_LIST_BY_FORM[form].join(', ')})`);
  }
  const content = { form };
  if (form === 'data' || form === 'text') {
    const langList = value.langList === undefined ? undefined : Array.isArray(value.langList) ? value.langList.map((one) => String(one).trim()).filter(Boolean) : undefined;
    if (value.langList !== undefined && !Array.isArray(value.langList)) problem(`${place}: "content.langList" is a list of languages`);
    if (form === 'data') {
      const langUnknown = (langList ?? []).filter((one) => !OBJECT_FRONTEND_KIND_DATA_LANG_LIST.includes(one));
      if (langUnknown.length > 0) problem(`${place}: data is read from ${OBJECT_FRONTEND_KIND_DATA_LANG_LIST.join(' or ')}, not ${langUnknown.join(', ')}`);
      const langData = (langList ?? []).filter((one) => OBJECT_FRONTEND_KIND_DATA_LANG_LIST.includes(one));
      content.langList = langData.length > 0 ? langData : [...OBJECT_FRONTEND_KIND_DATA_LANG_LIST];
      if (value.schema !== undefined) {
        const problemCount = { count: 0 };
        objectFrontendSchemaRead(value.schema, `${place}.content.schema`, (message) => {
          problemCount.count += 1;
          problem(message);
        });
        // a schema that cannot be read checks nothing: said, and left out
        if (problemCount.count === 0) content.schema = value.schema;
      }
    } else if (langList && langList.length > 0) content.langList = langList;
  }
  if (form === 'bytes') {
    if (value.mediaTypeList !== undefined) {
      const list = Array.isArray(value.mediaTypeList) ? value.mediaTypeList.map(String) : [];
      const bad = list.filter((one) => !MEDIA_TYPE_REGEX.test(one));
      if (!Array.isArray(value.mediaTypeList) || bad.length > 0) problem(`${place}: "content.mediaTypeList" is a list of media types (image/png, image/*)${bad.length ? `, not ${bad.join(', ')}` : ''}`);
      const good = list.filter((one) => MEDIA_TYPE_REGEX.test(one)).map((one) => one.toLowerCase());
      if (good.length > 0) content.mediaTypeList = good;
    }
    if (value.extList !== undefined) {
      const list = Array.isArray(value.extList) ? value.extList.map((one) => String(one).trim().replace(/^\./, '').toLowerCase()).filter(Boolean) : [];
      if (!Array.isArray(value.extList)) problem(`${place}: "content.extList" is a list of file extensions (png, jpg)`);
      if (list.length > 0) content.extList = list;
    }
    if (value.sizeMax !== undefined) {
      const size = objectFrontendSizeRead(value.sizeMax);
      if (size === undefined) problem(`${place}: "content.sizeMax" is a number of bytes, or a size such as 200KB or 5MB`);
      else content.sizeMax = size;
    }
  }
  return content;
}

// 5MB -> 5242880; a number is bytes; undefined when it is no size
export function objectFrontendSizeRead(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value);
  const match = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?\s*$/i.exec(String(value ?? ''));
  if (!match) return undefined;
  return Math.floor(Number(match[1]) * SIZE_UNIT[(match[2] ?? 'b').toLowerCase()]);
}

// a line saying what a content is: "data (yaml), with a schema", "bytes: image/*", "text: md, mdx"
export function objectFrontendKindContentText(content) {
  const one = content ?? { form: 'any' };
  if (one.form === 'data') return `data (${(one.langList ?? OBJECT_FRONTEND_KIND_DATA_LANG_LIST).join(', ')})${one.schema ? ', with a schema' : ''}`;
  if (one.form === 'text') return one.langList ? `text: ${one.langList.join(', ')}` : 'text';
  if (one.form === 'bytes') {
    const partList = [...(one.mediaTypeList ?? []), ...(one.extList ?? []).map((ext) => `.${ext}`)];
    return `bytes${partList.length ? `: ${partList.join(', ')}` : ''}${one.sizeMax ? `, at most ${objectFrontendSizeText(one.sizeMax)}` : ''}`;
  }
  return 'anything';
}

function objectFrontendSizeText(size) {
  if (size >= SIZE_UNIT.mb) return `${Math.round((size / SIZE_UNIT.mb) * 10) / 10}MB`;
  if (size >= SIZE_UNIT.kb) return `${Math.round((size / SIZE_UNIT.kb) * 10) / 10}KB`;
  return `${size}B`;
}

// whether an item fits the form of a kind: '' when it does, else why not. what the item is
// written as: lang (yaml, json, md, … ; '' for bytes), contentType, fileExt and size of bytes
export function objectFrontendKindContentCheck(content, { lang, contentType, fileExt, size } = {}) {
  const one = content ?? { form: 'any' };
  const langText = String(lang ?? '');
  if (one.form === 'any') return '';
  if (one.form === 'data') {
    const langList = one.langList ?? OBJECT_FRONTEND_KIND_DATA_LANG_LIST;
    return langList.includes(langText) ? '' : `it is data in ${langList.join(' or ')}, not ${langText || 'bytes'}`;
  }
  if (one.form === 'text') {
    if (!langText) return 'it is a text, not bytes';
    return !one.langList || one.langList.includes(langText) ? '' : `it is a text in ${one.langList.join(', ')}, not ${langText}`;
  }
  // bytes
  if (langText) return `it is a file (bytes), not a text in ${langText}`;
  const mediaType = String(contentType ?? '').toLowerCase().split(';')[0].trim();
  if (one.mediaTypeList && mediaType && !one.mediaTypeList.some((pattern) => (pattern.endsWith('/*') ? mediaType.startsWith(pattern.slice(0, -1)) : mediaType === pattern))) {
    return `it is a file of ${one.mediaTypeList.join(', ')}, not ${mediaType}`;
  }
  const ext = String(fileExt ?? '').replace(/^\./, '').toLowerCase();
  if (one.extList && ext && !one.extList.includes(ext)) return `it is a file ${one.extList.map((one2) => `.${one2}`).join(', ')}, not .${ext}`;
  if (one.sizeMax !== undefined && typeof size === 'number' && size > one.sizeMax) return `it is a file of at most ${objectFrontendSizeText(one.sizeMax)}, not ${objectFrontendSizeText(size)}`;
  return '';
}

// the data of a text in a language of data: { data, message } (message '' when it parses)
export function objectFrontendKindDataParse(lang, text) {
  try {
    return { data: lang === 'json' ? JSON.parse(String(text ?? '')) : yamlParse(String(text ?? '')), message: '' };
  } catch (error) {
    return { data: undefined, message: `it is not ${lang || 'yaml'}: ${String(error?.message ?? error).split('\n')[0]}` };
  }
}

// what of an item does not fit its kind, from its text: [{ path, message }]. its form first,
// then, for data with a schema, the data. '' text of data is no data (an item just made)
export function objectFrontendKindItemCheck(content, { lang, text, data, isDataGiven = false, contentType, fileExt, size } = {}) {
  const formMessage = objectFrontendKindContentCheck(content, { lang, contentType, fileExt, size });
  if (formMessage) return [{ path: '', message: formMessage }];
  if (content?.form !== 'data' || !content.schema) return [];
  let value = data;
  if (!isDataGiven) {
    const parsed = objectFrontendKindDataParse(lang, text);
    if (parsed.message) return [{ path: '', message: parsed.message }];
    value = parsed.data;
  }
  return objectFrontendSchemaCheck(content.schema, value);
}

// the problems of a check as one line: "/sectionList/1/type: … (and 2 more)"
export function objectFrontendKindProblemText(problemList) {
  if (!problemList || problemList.length === 0) return '';
  const [first] = problemList;
  const text = first.path ? `${first.path}: ${first.message}` : first.message;
  return problemList.length > 1 ? `${text} (and ${problemList.length - 1} more)` : text;
}

// ---------- the schema of data: a subset of JSON Schema ----------

export const OBJECT_FRONTEND_SCHEMA_KEY_LIST = [
  'type', 'enum', 'const',
  'properties', 'required', 'additionalProperties', 'patternProperties', 'propertyNames', 'minProperties', 'maxProperties',
  'items', 'minItems', 'maxItems', 'uniqueItems',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'minLength', 'maxLength', 'pattern', 'format',
  'anyOf', 'oneOf', 'allOf', 'not',
  '$ref', '$defs',
  'title', 'description', 'default', 'examples',
];
const SCHEMA_TYPE_LIST = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'];
const SCHEMA_NUMBER_KEY_LIST = ['minProperties', 'maxProperties', 'minItems', 'maxItems', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength'];
const SCHEMA_DEPTH_MAX = 64;
const SCHEMA_PROBLEM_LIMIT = 20;

// whether a schema can be read: every key known, every part of the right shape, every $ref found
// in $defs of the schema (#/$defs/name). problems are said with the place
export function objectFrontendSchemaRead(schemaRoot, place, problem) {
  const defs = mappingIs(schemaRoot) && mappingIs(schemaRoot.$defs) ? schemaRoot.$defs : {};
  const visit = (schema, at) => {
    if (schema === true || schema === false) return;
    if (!mappingIs(schema)) {
      problem(`${at}: a schema is a mapping (or true, false)`);
      return;
    }
    for (const key of Object.keys(schema)) {
      if (!OBJECT_FRONTEND_SCHEMA_KEY_LIST.includes(key)) problem(`${at}: unknown key "${key}" of a schema (known: ${OBJECT_FRONTEND_SCHEMA_KEY_LIST.join(', ')})`);
    }
    if (schema.type !== undefined) {
      const typeList = Array.isArray(schema.type) ? schema.type : [schema.type];
      const bad = typeList.filter((one) => !SCHEMA_TYPE_LIST.includes(one));
      if (bad.length > 0 || typeList.length === 0) problem(`${at}: "type" is one of ${SCHEMA_TYPE_LIST.join(', ')}, or a list of them${bad.length ? `, not ${bad.join(', ')}` : ''}`);
    }
    if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) problem(`${at}: "enum" is a list of the values allowed`);
    for (const key of SCHEMA_NUMBER_KEY_LIST) {
      if (schema[key] !== undefined && (typeof schema[key] !== 'number' || !Number.isFinite(schema[key]))) problem(`${at}: "${key}" is a number`);
    }
    if (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some((one) => typeof one !== 'string'))) problem(`${at}: "required" is a list of keys`);
    if (schema.pattern !== undefined) {
      try {
        new RegExp(String(schema.pattern), 'u');
      } catch {
        problem(`${at}: "pattern" is no regular expression: ${schema.pattern}`);
      }
    }
    if (schema.uniqueItems !== undefined && typeof schema.uniqueItems !== 'boolean') problem(`${at}: "uniqueItems" is true or false`);
    if (schema.format !== undefined && typeof schema.format !== 'string') problem(`${at}: "format" is a name (it is not checked: a note for readers)`);
    for (const key of ['properties', 'patternProperties', '$defs']) {
      if (schema[key] === undefined) continue;
      if (!mappingIs(schema[key])) {
        problem(`${at}: "${key}" is a mapping of schemas`);
        continue;
      }
      for (const [name, one] of Object.entries(schema[key])) {
        if (key === 'patternProperties') {
          try {
            new RegExp(name, 'u');
          } catch {
            problem(`${at}.patternProperties: "${name}" is no regular expression`);
          }
        }
        visit(one, `${at}.${key}.${name}`);
      }
    }
    for (const key of ['additionalProperties', 'items', 'not', 'propertyNames']) {
      if (schema[key] !== undefined) visit(schema[key], `${at}.${key}`);
    }
    for (const key of ['anyOf', 'oneOf', 'allOf']) {
      if (schema[key] === undefined) continue;
      if (!Array.isArray(schema[key]) || schema[key].length === 0) {
        problem(`${at}: "${key}" is a list of schemas`);
        continue;
      }
      schema[key].forEach((one, index) => visit(one, `${at}.${key}[${index}]`));
    }
    if (schema.$ref !== undefined) {
      const name = /^#\/\$defs\/([^/]+)$/.exec(String(schema.$ref))?.[1];
      if (!name) problem(`${at}: "$ref" names a schema of $defs: #/$defs/{name}`);
      else if (!mappingIs(defs) || !(name in defs)) problem(`${at}: "$ref" names #/$defs/${name}, which $defs does not hold`);
    }
  };
  visit(schemaRoot, place);
}

function valueText(value) {
  const text = JSON.stringify(value);
  if (text === undefined) return String(value);
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

function typeOfValue(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value === 'object' ? 'object' : typeof value;
}

function typeIs(value, type) {
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'object') return mappingIs(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'null') return value === null;
  return typeof value === type;
}

function equalIs(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// what of the data does not fit the schema: [{ path, message }], a path as /sectionList/1/type
// ('' the whole). at most limit problems; anyOf and oneOf are said as one problem
export function objectFrontendSchemaCheck(schemaRoot, value, { limit = SCHEMA_PROBLEM_LIMIT } = {}) {
  const defs = mappingIs(schemaRoot) && mappingIs(schemaRoot.$defs) ? schemaRoot.$defs : {};
  const problemList = [];
  const check = (schema, data, path, depth, out) => {
    if (out.length >= limit) return;
    if (schema === true || schema === undefined) return;
    const say = (message) => out.push({ path, message });
    if (schema === false) {
      say('nothing is allowed here');
      return;
    }
    if (depth > SCHEMA_DEPTH_MAX) {
      say('the data is nested too deep to be checked');
      return;
    }
    if (schema.$ref !== undefined) {
      const name = /^#\/\$defs\/([^/]+)$/.exec(String(schema.$ref))?.[1];
      if (name && name in defs) check(defs[name], data, path, depth + 1, out);
    }
    if (schema.type !== undefined) {
      const typeList = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!typeList.some((type) => typeIs(data, type))) {
        say(`${valueText(data)} is ${typeOfValue(data) === 'object' ? 'a mapping' : typeOfValue(data) === 'array' ? 'a list' : `a ${typeOfValue(data)}`}, not ${typeList.map((type) => (type === 'object' ? 'a mapping' : type === 'array' ? 'a list' : type)).join(' or ')}`);
        return;
      }
    }
    if (schema.const !== undefined && !equalIs(schema.const, data)) say(`${valueText(data)} is not ${valueText(schema.const)}`);
    if (Array.isArray(schema.enum) && !schema.enum.some((one) => equalIs(one, data))) say(`${valueText(data)} is none of ${schema.enum.map((one) => (typeof one === 'string' ? one : valueText(one))).join(', ')}`);
    if (typeof data === 'number') {
      if (schema.minimum !== undefined && data < schema.minimum) say(`${data} is below ${schema.minimum}`);
      if (schema.maximum !== undefined && data > schema.maximum) say(`${data} is above ${schema.maximum}`);
      if (schema.exclusiveMinimum !== undefined && data <= schema.exclusiveMinimum) say(`${data} is not above ${schema.exclusiveMinimum}`);
      if (schema.exclusiveMaximum !== undefined && data >= schema.exclusiveMaximum) say(`${data} is not below ${schema.exclusiveMaximum}`);
    }
    if (typeof data === 'string') {
      const length = [...data].length;
      if (schema.minLength !== undefined && length < schema.minLength) say(`${valueText(data)} is shorter than ${schema.minLength} characters`);
      if (schema.maxLength !== undefined && length > schema.maxLength) say(`${valueText(data)} is longer than ${schema.maxLength} characters`);
      if (schema.pattern !== undefined && !new RegExp(String(schema.pattern), 'u').test(data)) say(`${valueText(data)} does not match ${schema.pattern}`);
    }
    if (Array.isArray(data)) {
      if (schema.minItems !== undefined && data.length < schema.minItems) say(`a list of ${data.length}, not at least ${schema.minItems}`);
      if (schema.maxItems !== undefined && data.length > schema.maxItems) say(`a list of ${data.length}, not at most ${schema.maxItems}`);
      if (schema.uniqueItems === true && new Set(data.map((one) => JSON.stringify(one))).size !== data.length) say('a list whose items repeat');
      if (schema.items !== undefined) data.forEach((one, index) => check(schema.items, one, `${path}/${index}`, depth + 1, out));
    }
    if (mappingIs(data)) {
      const keyList = Object.keys(data);
      if (schema.minProperties !== undefined && keyList.length < schema.minProperties) say(`a mapping of ${keyList.length} keys, not at least ${schema.minProperties}`);
      if (schema.maxProperties !== undefined && keyList.length > schema.maxProperties) say(`a mapping of ${keyList.length} keys, not at most ${schema.maxProperties}`);
      for (const key of schema.required ?? []) if (!(key in data)) say(`the key ${key} is missing`);
      const propertyMap = mappingIs(schema.properties) ? schema.properties : {};
      const patternList = mappingIs(schema.patternProperties) ? Object.entries(schema.patternProperties).map(([pattern, one]) => [new RegExp(pattern, 'u'), one]) : [];
      for (const key of keyList) {
        const pathKey = `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
        if (schema.propertyNames !== undefined) check(schema.propertyNames, key, pathKey, depth + 1, out);
        let isMatched = false;
        if (key in propertyMap) {
          isMatched = true;
          check(propertyMap[key], data[key], pathKey, depth + 1, out);
        }
        for (const [regex, one] of patternList) {
          if (!regex.test(key)) continue;
          isMatched = true;
          check(one, data[key], pathKey, depth + 1, out);
        }
        if (!isMatched && schema.additionalProperties !== undefined) {
          if (schema.additionalProperties === false) out.push({ path: pathKey, message: `the key ${key} is not one of ${Object.keys(propertyMap).join(', ') || '(none)'}` });
          else check(schema.additionalProperties, data[key], pathKey, depth + 1, out);
        }
      }
    }
    if (Array.isArray(schema.allOf)) schema.allOf.forEach((one) => check(one, data, path, depth + 1, out));
    const branchProblemListGet = (one) => {
      const outOne = [];
      check(one, data, path, depth + 1, outOne);
      return outOne;
    };
    if (Array.isArray(schema.anyOf)) {
      const branchList = schema.anyOf.map(branchProblemListGet);
      if (!branchList.some((one) => one.length === 0)) {
        // the branch that came nearest says why: one that went into the data (its first problem
        // deeper than here) before one refusing it whole, then the one with fewer problems
        const rank = (one) => [one[0]?.path !== path ? 0 : 1, one.length];
        const nearest = branchList.reduce((best, one) => {
          const [a, b] = [rank(one), rank(best)];
          return a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? one : best;
        });
        say(`fits none of the ${schema.anyOf.length} forms it may take${nearest[0] ? ` (nearest: ${nearest[0].path === path ? '' : `${nearest[0].path}: `}${nearest[0].message})` : ''}`);
      }
    }
    if (Array.isArray(schema.oneOf)) {
      const fitCount = schema.oneOf.map(branchProblemListGet).filter((one) => one.length === 0).length;
      if (fitCount !== 1) say(fitCount === 0 ? `fits none of the ${schema.oneOf.length} forms it may take` : `fits ${fitCount} of the forms it may take, not one`);
    }
    if (schema.not !== undefined && branchProblemListGet(schema.not).length === 0) say(`${valueText(data)} is what is not allowed here`);
  };
  check(schemaRoot, value, '', 0, problemList);
  return problemList.slice(0, limit);
}

// ---------- the kinds of a type ----------

// a type's kindList as written: { holdList, kindDeclareList }. a kind declared isInternal is in
// kindDeclareList too (its type and descendants resolve it), marked, and not made a type of the registry.
//   holdList          what its objects hold, by name: [{ id, kindId, label?, isOwn, groupPath?, … }]
//                     (a kind declared elsewhere is resolved later: objectFrontendKindHoldResolve)
//   kindDeclareList   the kinds it declares, types of the registry: [{ id: {type}.{name}, name,
//                     label, description, icon, extendList, content?, declaredBy }]
// isHeld: false declares a kind without holding it
export function objectFrontendKindListRead(value, { typeId, place, problem }) {
  const holdList = [];
  const kindDeclareList = [];
  if (!Array.isArray(value)) {
    problem(`${place}: a list of kinds { id, label, content } (declared here) or { id, kind } (declared by another type)`);
    return { holdList, kindDeclareList };
  }
  value.forEach((item, index) => {
    const placeOne = `${place}[${index}]`;
    if (!mappingIs(item) || typeof item.id !== 'string' || !OBJECT_FRONTEND_KIND_NAME_REGEX.test(item.id)) {
      problem(`${placeOne}: a kind is a mapping whose "id" is its name in the object: letters, digits and "-", a letter first`);
      return;
    }
    for (const key of Object.keys(item)) {
      if (!KIND_ENTRY_KEY_LIST.includes(key)) problem(`${placeOne}: unknown key "${key}" (known: ${KIND_ENTRY_KEY_LIST.join(', ')})`);
    }
    if (holdList.some((one) => one.id === item.id) || kindDeclareList.some((one) => one.name === item.id)) {
      problem(`${placeOne}: the kind ${item.id} is named twice; this one is left out`);
      return;
    }
    const isRef = item.kind !== undefined;
    if (isRef) {
      if (typeof item.kind !== 'string' || !/^[a-z][a-z0-9-]*(\.[a-zA-Z][a-zA-Z0-9-]*)+$/.test(item.kind)) {
        problem(`${placeOne}: "kind" is the id of a kind another type declares ({type}.{name})`);
        return;
      }
      const keyDeclareList = ['description', 'icon', 'extendList', 'content', 'isInternal'].filter((key) => item[key] !== undefined);
      if (keyDeclareList.length > 0) problem(`${placeOne}: ${keyDeclareList.join(', ')} belong to the declaration of ${item.kind}, not to an object holding it; left out`);
      if (item.isHeld === false) problem(`${placeOne}: a kind of another type is named to be held; isHeld: false is left out`);
    }
    const kindId = isRef ? item.kind : `${typeId}.${item.id}`;
    const hold = { id: item.id, kindId, isOwn: !isRef };
    if (typeof item.label === 'string' && item.label) hold.label = item.label;
    if (typeof item.groupPath === 'string') hold.groupPath = item.groupPath;
    if (typeof item.pathPrefix === 'string') hold.pathPrefix = item.pathPrefix;
    if (item.isIncomingRefused === true) hold.isIncomingRefused = true;
    if (item.isDoc === true) hold.isDoc = true;
    if (typeof item.docPath === 'string' && item.docPath) hold.docPath = item.docPath;
    if (!isRef) {
      kindDeclareList.push({
        id: kindId,
        name: item.id,
        label: typeof item.label === 'string' && item.label ? item.label : item.id,
        description: typeof item.description === 'string' ? item.description : '',
        icon: typeof item.icon === 'string' ? item.icon : '',
        extendList: Array.isArray(item.extendList) ? item.extendList.map(String) : [OBJECT_FRONTEND_KIND_ROOT],
        ...(item.content === undefined ? {} : { content: objectFrontendKindContentRead(item.content, placeOne, problem) }),
        declaredBy: typeId,
        ...(item.isInternal === true ? { isInternal: true } : {}),
      });
      if (item.isInternal === true) hold.isInternal = true;
    }
    if (isRef || item.isHeld !== false) holdList.push(hold);
  });
  return { holdList, kindDeclareList };
}

// the former grammar, assetKindList: { id, label, langList, pathPrefix, groupPath, … } of a kind
// the type both declares and holds; its langList is a content (yaml, json: data; else text)
export function objectFrontendAssetKindListConvert(value) {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    if (!mappingIs(item)) return item;
    const { langList, ...rest } = item;
    const content = objectFrontendContentOfLangList(langList);
    return content ? { ...rest, content } : rest;
  });
}

// the content a former langList meant: undefined (anything) when it named none
export function objectFrontendContentOfLangList(langList) {
  if (!Array.isArray(langList) || langList.length === 0) return undefined;
  const list = langList.map(String);
  if (list.every((one) => OBJECT_FRONTEND_KIND_DATA_LANG_LIST.includes(one))) return { form: 'data', langList: list };
  return { form: 'text', langList: list };
}

// the content of a kind: its own, else the nearest of the kinds it extends; any when none says
export function objectFrontendKindContentResolve(kindId, kindById, seen = new Set()) {
  const kind = kindById.get(kindId);
  if (!kind || seen.has(kindId)) return { form: 'any' };
  seen.add(kindId);
  if (kind.content) return kind.content;
  for (const parentId of kind.extendList ?? []) {
    if (kindById.has(parentId)) return objectFrontendKindContentResolve(parentId, kindById, seen);
  }
  return { form: 'any' };
}

// a held kind with what its declaration says: { id, kindId, label, description, content,
// declaredBy, isOwn, isInternal?, … }. a kind nobody declares is held as anything, and said; so is a
// kind internal to another type (isHolderOfFamily(typeId): whether the holding type is that type or
// extends it, the only ones that may hold an internal kind)
export function objectFrontendKindHoldResolve(hold, kindById, problem, isHolderOfFamily = () => true) {
  const kind = kindById.get(hold.kindId);
  if (!kind) {
    problem(`the kind ${hold.kindId} (held as ${hold.id}) is declared by no type: it is held as anything`);
    return { ...hold, label: hold.label ?? hold.id, description: '', content: { form: 'any' }, declaredBy: '', isKindMissing: true };
  }
  if (kind.isInternal && !isHolderOfFamily(kind.declaredBy)) {
    problem(`the kind ${hold.kindId} (held as ${hold.id}) is internal to ${kind.declaredBy}, which does not register it: only it and the types extending it hold it; it is held as anything`);
    return { ...hold, label: hold.label ?? hold.id, description: '', content: { form: 'any' }, declaredBy: kind.declaredBy, isKindMissing: true };
  }
  const content = objectFrontendKindContentResolve(hold.kindId, kindById);
  const resolved = { ...hold, label: hold.label ?? kind.label, description: kind.description ?? '', content, declaredBy: kind.declaredBy ?? '', ...(kind.isInternal ? { isInternal: true } : {}) };
  if (hold.isDoc && !['text', 'any'].includes(content.form)) {
    problem(`the kind ${hold.kindId} (held as ${hold.id}) is ${objectFrontendKindContentText(content)}: its items cannot be documents; isDoc is left out`);
    delete resolved.isDoc;
    delete resolved.docPath;
  }
  return resolved;
}

// the kinds an object of a type holds: kindList of its declaration, or of the nearest ancestor
// that has one; undefined when none says, and then any asset is accepted
export function objectFrontendKindListResolve(typeId, typeList) {
  const typeById = new Map((typeList ?? []).map((type) => [type.id, type]));
  const visitedSet = new Set();
  const queue = [typeId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (visitedSet.has(id)) continue;
    visitedSet.add(id);
    const type = typeById.get(id);
    if (!type) continue;
    if (Array.isArray(type.kindList)) return type.kindList;
    queue.push(...(type.extendList ?? []));
  }
  return undefined;
}
