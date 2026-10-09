import { useId } from 'react';
import { useDocStores } from '../../frontend/src/store/context.js';
import { compDefinitionNormalize, compIdResolve, compInputNormalize } from './comp-registry.js';
import { CompDataRefHost } from './CompDataRef.jsx';
import { CompAssetHost, compInputIsAssetRef } from '../asset/CompAssetHost.jsx';

// One runtime boundary for every component resolved through compRegistry.
// Registered render components always receive { data, config, onEvent }.
export function RegisteredComp(props) {
  const {
    compDefinition,
    compId,
    compName,
    configRuntime = {},
    input = {},
    onEventRuntime,
    placement,
  } = props;
  const { compById, compConfigHost, docStore, eventRouter, onEvent: onEventPage, sourceStore } = useDocStores();
  const idFallback = useId();
  const compIdResolved = compId ?? compIdResolve(sourceStore.configDoc, compName);
  const definitionValue = compDefinition ?? compById[compIdResolved];
  const definition = compDefinitionNormalize(definitionValue);

  // a fenced block in the language "asset" is a reference into the asset
  // store, not the data: CompAssetHost reads the referenced version and
  // renders this boundary again with that text (doc_page_impl_asset.md)
  if (definition && placement === 'commentBlock' && compInputIsAssetRef(input)) {
    return <CompAssetHost input={input} registeredProps={{ ...props, compId: compIdResolved }} />;
  }

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

  // every report of the component becomes one event of the event layer
  // (doc_page_impl_event.md): the host application answers first, then the
  // place that rendered the component (onEventRuntime), then the domain
  // route of the event type. the third argument carries what the report
  // knows beyond its data: { point } where the pointer was (the pointer
  // event itself can be passed as point), so a handler can act where the
  // user pointed.
  const eventHandle = (eventType, eventData = {}, eventContext = {}) => {
    const event = eventRouter.eventBuild({
      type: eventType,
      data: eventData,
      source: {
        compId: compIdResolved,
        instanceId,
        itemId: config.itemId,
        placement,
        sourcePath: config.sourcePath,
        blockIndex: configRuntime.blockIndex,
      },
      point: eventContext.point,
    });
    return eventRouter.dispatch(event, { onEventHost: onEventPage, onEventLocal: onEventRuntime });
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