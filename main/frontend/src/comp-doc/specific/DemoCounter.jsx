import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../store/context.js';

// project-specific demo component: interactive counter whose state lives in
// CompStateStore (data-driven, not hidden in local component state).
// doc authors can pass a stable id, so the count survives doc re-render:
//   <DemoCounter id="counter-a" label="clicks" />
export const DemoCounter = observer(function DemoCounter({ data = {}, config = {}, onEvent }) {
  const { compStateStore } = useDocStores();
  const idState = config.instanceId;
  const state = compStateStore.getState(idState, { count: 0 });

  const countIncreaseRequest = async () => {
    const count = state.count + 1;
    const result = await onEvent?.('countChangeRequest', { count });
    if (!result?.isHandled) compStateStore.patchState(idState, { count });
  };

  return (
    <span className="not-prose inline-flex items-center gap-1.5 border border-fd-border rounded-sm px-1.5 py-0.5 text-sm align-middle">
      <span>{data.label ?? 'count'}: {state.count}</span>
      <span
        role="button"
        className="cursor-pointer select-none px-1.5 rounded-sm bg-fd-primary text-fd-primary-foreground hover:opacity-80"
        onClick={countIncreaseRequest}
      >
        +1
      </span>
    </span>
  );
});
