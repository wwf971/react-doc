import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';

// Component data reference: a registered component authored with
// dataRef="{document target}#{component id}" receives the authored data of
// another, id-marked component. The host resolves and validates the reference;
// the component only decides how to combine referenced and local data.
//
//   <!--renderComp=FileTree,dataRef=comp-file-tree.md#example-project-tree-->

// Must be called inside an observer component. Returns the store query result:
//   { status: 'loading' | 'error' | 'done', message, warning,
//     docPath, componentId, compName, compId, componentType, data }
export function useCompDataRef(target, options = {}) {
  const { docStore } = useDocStores();
  const sourcePath = options.sourcePath ?? docStore.docCurrentPath;
  useEffect(() => {
    void docStore.compDataRefLoad(target, sourcePath);
  }, [docStore, sourcePath, target]);
  return docStore.compDataRefQuery(target, sourcePath);
}

export const CompDataRefHost = observer(function CompDataRefHost({
  CompRender,
  compLabel,
  config,
  data,
  definition,
  onEvent,
}) {
  const result = useCompDataRef(data.dataRef, { sourcePath: config.sourcePath });
  const typeAcceptedList = definition.dataRefTypeList;
  const targetText = typeof data.dataRef === 'string' ? data.dataRef : String(data.dataRef);

  if (!Array.isArray(typeAcceptedList) || typeAcceptedList.length === 0) {
    return (
      <CompDataRefMessage
        tone="error"
        message={`${compLabel} does not accept dataRef.`}
        target={targetText}
      />
    );
  }
  if (result.status === 'loading') {
    return <CompDataRefMessage tone="loading" message="Loading referenced component data…" target={targetText} />;
  }
  if (result.status === 'error') {
    return <CompDataRefMessage tone="error" message={result.message} target={targetText} />;
  }
  if (result.docPath === config.sourcePath && result.componentId === data.id) {
    return <CompDataRefMessage tone="error" message="A component cannot reference its own data." target={targetText} />;
  }
  if (!typeAcceptedList.includes(result.componentType)) {
    return (
      <CompDataRefMessage
        tone="error"
        message={
          `${compLabel} accepts data of component type ${typeAcceptedList.join(', ')}, `
          + `but ${result.component.compName} has type ${result.componentType || '(none)'}.`
        }
        target={targetText}
      />
    );
  }

  const dataResolved = {
    ...data,
    dataRefResolved: {
      compId: result.compId,
      compName: result.component.compName,
      componentId: result.componentId,
      componentType: result.componentType,
      data: result.data,
      docPath: result.docPath,
      target: data.dataRef,
    },
  };
  return (
    <>
      {result.warning ? <CompDataRefMessage tone="warning" message={result.warning} target={targetText} /> : null}
      <CompRender data={dataResolved} config={config} onEvent={onEvent} />
    </>
  );
});

const classNameByTone = {
  error: 'border-red-300 dark:border-red-700 text-red-600 dark:text-red-400',
  loading: 'border-fd-border text-fd-muted-foreground',
  warning: 'border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300',
};

function CompDataRefMessage({ message, target, tone }) {
  return (
    <div
      className={`not-prose my-2 rounded-sm border p-2 text-sm select-text ${classNameByTone[tone]}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <p className="font-medium">{message}</p>
      <p className="text-xs">dataRef: {target}</p>
    </div>
  );
}
