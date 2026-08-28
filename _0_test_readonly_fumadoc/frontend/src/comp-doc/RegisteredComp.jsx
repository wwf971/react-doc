import { useId } from 'react';
import { useDocStores } from '../store/context.js';
import { compDefinitionNormalize } from './comp-registry.js';

// One runtime boundary for every component resolved through compRegistry.
// Registered render components always receive { data, config, onEvent }.
export function RegisteredComp({ compDefinition, compId, compName, configRuntime = {}, input = {}, placement }) {
  const { compById, docStore, onEvent: onEventPage, sourceStore } = useDocStores();
  const idFallback = useId();
  const compIdResolved = compId ?? sourceStore.configDoc.compRegistry?.[compName] ?? compName;
  const definitionValue = compDefinition ?? compById[compIdResolved];
  const definition = compDefinitionNormalize(definitionValue);

  if (!definition) {
    return (
      <CompError
        compId={compIdResolved}
        compName={compName}
        detail={`resolved id: ${compIdResolved || '(empty)'}`}
        raw={input.raw}
      />
    );
  }

  if (definition.placementList && !definition.placementList.includes(placement)) {
    return (
      <CompError
        compId={compIdResolved}
        compName={compName}
        message={`component is not available for placement: ${placement}`}
        raw={input.raw}
      />
    );
  }

  if (definition.isLegacy) {
    const CompLegacy = definition.CompRender;
    if (placement === 'commentBlock') {
      return (
        <CompLegacy
          raw={input.raw}
          lang={input.lang}
          {...(input.propsAuthored ?? {})}
        />
      );
    }
    if (placement === 'sidePanelDisplay') {
      return <CompLegacy data={input.data ?? {}} text={input.data?.text ?? ''} />;
    }
    if (placement === 'sidePanelPanel') {
      return (
        <CompLegacy
          data={input.data ?? {}}
          item={configRuntime.item}
          onNavigate={(target) => docStore.navigate(target)}
          toHref={(target) => docStore.toBrowserHref(target)}
        />
      );
    }
    return <CompLegacy {...(input.propsAuthored ?? {})} />;
  }

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
  const data = resultBuilt.data ?? inputNormalized.data;
  const instanceId = configRuntime.instanceId
    ?? data.id
    ?? `${compIdResolved}:${docStore.docCurrentPath || 'page'}:${idFallback}`;
  const config = {
    ...resultBuilt.config,
    ...configRuntime,
    compId: compIdResolved,
    instanceId,
    placement,
    sourcePath: docStore.docCurrentPath,
  };

  const eventHandle = async (eventType, eventData = {}) => {
    const eventDataForward = {
      ...eventData,
      compId: compIdResolved,
      instanceId,
      itemId: config.itemId,
      placement,
      sourcePath: config.sourcePath,
    };
    const result = await onEventPage?.(`component:${eventType}`, eventDataForward);
    if (result?.isHandled) return result;
    if (eventType === 'navigateRequest' && eventData.target) {
      docStore.navigate(eventData.target);
      return { isHandled: true };
    }
    return result;
  };

  const CompRender = definition.CompRender;
  return <CompRender data={data} config={config} onEvent={eventHandle} />;
}

function CompError({ compId, compName, detail, message, raw }) {
  return (
    <div className="border border-red-300 dark:border-red-700 rounded-sm p-2 text-sm select-text">
      <p className="text-red-600 dark:text-red-400 font-medium">
        {message ?? `unknown doc component: ${compName ?? compId}`}
      </p>
      {detail ? <p className="text-red-600 dark:text-red-400 text-xs">{detail}</p> : null}
      {raw ? <pre className="whitespace-pre-wrap">{raw}</pre> : null}
    </div>
  );
}