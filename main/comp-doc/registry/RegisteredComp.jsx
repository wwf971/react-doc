import { useId } from 'react';
import { useDocStores } from '../../frontend/src/store/context.js';
import { compDefinitionNormalize, compIdResolve, compInputNormalize } from './comp-registry.js';
import { CompDataRefHost } from './CompDataRef.jsx';

// One runtime boundary for every component resolved through compRegistry.
// Registered render components always receive { data, config, onEvent }.
export function RegisteredComp({
  compDefinition,
  compId,
  compName,
  configRuntime = {},
  input = {},
  onEventRuntime,
  placement,
}) {
  const { compById, compConfigHost, docStore, onEvent: onEventPage, sourceStore, tagStore } = useDocStores();
  const idFallback = useId();
  const compIdResolved = compId ?? compIdResolve(sourceStore.configDoc, compName);
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

  if (definition.isLegacy && input.propsAuthored?.dataRef !== undefined) {
    return (
      <CompError
        compId={compIdResolved}
        compName={compName}
        message={`${compName ?? compIdResolved} does not accept dataRef.`}
        detail={`dataRef: ${String(input.propsAuthored.dataRef)}`}
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

  const { data, config: configBuilt } = compInputNormalize(definition, input);
  // components rendered inside another compiled document (e.g. the SourceLink
  // render popup) belong to that document, not the outer page.
  const sourcePath = configRuntime.sourcePath ?? docStore.docCurrentPath;
  const instanceId = configRuntime.instanceId
    ?? data.id
    ?? `${compIdResolved}:${sourcePath || 'page'}:${idFallback}`;
  // host settings (e.g. mermaidLoad, assetUrlGet) have the lowest priority
  const config = {
    ...compConfigHost,
    ...configBuilt,
    ...configRuntime,
    compId: compIdResolved,
    instanceId,
    placement,
    sourcePath,
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
    const resultRuntime = await onEventRuntime?.(eventType, eventDataForward);
    if (resultRuntime?.isHandled) return resultRuntime;
    if (eventType === 'navigateRequest' && eventData.target) {
      docStore.navigate(eventData.target);
      return { isHandled: true };
    }
    if (eventType === 'tagOverviewOpenRequest' && eventData.tagId && compConfigHost.panelComponent) {
      return { isHandled: tagStore.overviewOpen(eventData.tagId) };
    }
    return result;
  };

  const CompRender = definition.CompRender;
  if (data.dataRef === undefined) {
    return <CompRender data={data} config={config} onEvent={eventHandle} />;
  }
  return (
    <CompDataRefHost
      CompRender={CompRender}
      compLabel={compName ?? compIdResolved}
      config={config}
      data={data}
      definition={definition}
      onEvent={eventHandle}
    />
  );
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