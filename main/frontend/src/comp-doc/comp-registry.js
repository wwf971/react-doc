import { createElement } from 'react';

export function compDefine(CompRender, options = {}) {
  return {
    CompRender,
    componentType: options.componentType,
    dataBuild: options.dataBuild,
    dataRefTypeList: options.dataRefTypeList,
    placementList: options.placementList,
  };
}

export function compNativeDefine(CompNative, options = {}) {
  function CompRender({ data = {} }) {
    const { content, ...props } = data;
    return createElement(CompNative, props, content);
  }

  return compDefine(CompRender, options);
}

// converts one registry invocation input into the component's { data, config }.
// authored properties become data; authored "data"/"config" objects are
// merged in. runtime config is added later by RegisteredComp.
export function compInputNormalize(definition, input = {}) {
  const propsAuthored = input.propsAuthored ?? {};
  const { children, config: configAuthored, data: dataAuthored, onEvent: _onEventIgnored, ...dataProps } = propsAuthored;
  const inputNormalized = {
    ...input,
    content: input.content ?? children,
    data: {
      ...(input.data ?? {}),
      ...(dataAuthored && typeof dataAuthored === 'object' ? dataAuthored : {}),
      ...dataProps,
      ...(input.raw !== undefined ? { raw: input.raw } : {}),
      ...(input.lang !== undefined ? { lang: input.lang } : {}),
      ...(input.content !== undefined || children !== undefined
        ? { content: input.content ?? children }
        : {}),
    },
    config: {
      ...(configAuthored && typeof configAuthored === 'object' ? configAuthored : {}),
      ...(input.config ?? {}),
    },
  };
  const resultBuilt = definition.dataBuild?.(inputNormalized) ?? inputNormalized;
  return {
    data: resultBuilt.data ?? inputNormalized.data,
    config: resultBuilt.config,
  };
}

// names the page itself renders with even when config compRegistry does not
// mention them. mapping one of these names in compRegistry replaces the
// default, which is how an application provides its own side-panel item hook.
export const compIdBuiltinByName = {
  SidePanelItem: 'common/SidePanelItem',
  Tag: 'common/Tag',
  TagOverview: 'common/TagOverview',
};

// tag name -> component id: config compRegistry first, then built-in names,
// otherwise the name itself is treated as an id.
export function compIdResolve(configDoc, compName) {
  return configDoc?.compRegistry?.[compName]
    ?? compIdBuiltinByName[compName]
    ?? compName;
}

export function compDefinitionNormalize(value) {
  if (compTypeIsValid(value)) {
    return { CompRender: value, isLegacy: true };
  }
  if (value && compTypeIsValid(value.CompRender)) return value;
  return undefined;
}

function compTypeIsValid(value) {
  return typeof value === 'function'
    || Boolean(value && typeof value === 'object' && value.$$typeof);
}