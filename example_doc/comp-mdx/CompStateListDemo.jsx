import { observer } from 'mobx-react-lite';
import { History } from '../../main/frontend/UICommon.js';
import { useDocStores } from '../../main/frontend/src/store/context.js';
import { timeTextGet } from '../../main/frontend/src/lib/time-text.js';

// Demonstration component: every state object the component state service
// layer holds now (doc_page_impl_mdx_comp_state.md), read from
// DocCompStateStore, nothing to edit. One row per state: its key (how the
// page identified the block), how many mounted components hold it (0: idle,
// kept until the store collects it), when it was last held or released, and
// a short view of its value. The list is itself a state user: this block
// has a state object too, so it is in the list.
export const CompStateListDemo = observer(function CompStateListDemo() {
  const { compStateStore } = useDocStores();
  const stateList = compStateStore.stateList;
  return (
    <div className="not-prose my-2 text-sm">
      <div className="text-xs text-fd-muted-foreground pb-1">
        {stateList.length} state object{stateList.length === 1 ? '' : 's'}, {compStateStore.idleCount} idle
        (kept up to {compStateStore.idleMax})
      </div>
      {stateList.map((state) => (
        <div key={state.key} className="border-b border-fd-border py-1">
          <div className="flex flex-row flex-wrap items-baseline gap-2">
            <span className="font-mono text-xs select-text">{state.key}</span>
            <span className="doc-badge">{state.kind}</span>
            <span className="text-xs text-fd-muted-foreground">
              {state.holdCount === 0 ? 'idle' : `held by ${state.holdCount}`} · {timeTextGet(new Date(state.timeTouched))}
            </span>
          </div>
          <div className="font-mono text-xs text-fd-muted-foreground select-text whitespace-pre-wrap break-all">
            {valueTextGet(state.value)}
          </div>
        </div>
      ))}
    </div>
  );
});

// a short, one-level view of a state value: a mapping's keys with their
// primitive values, nested values by their kind (a draft store is shown by
// its class name, not its content)
function valueTextGet(value) {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.length} items]`;
  const entryList = Object.entries(value).map(([key, entry]) => `${key}: ${entryTextGet(entry)}`);
  return entryList.length === 0 ? '{}' : entryList.join(', ');
}

function entryTextGet(entry) {
  if (entry === null || entry === undefined) return String(entry);
  if (typeof entry !== 'object') return JSON.stringify(entry);
  if (Array.isArray(entry)) return `[${entry.length} items]`;
  const name = entry.constructor?.name;
  if (name && name !== 'Object') return `[${name}]`;
  return JSON.stringify(entry);
}

// a component with nothing to edit declares itself read-only: no edit
// mode, no Edit button (doc_page_impl_mdx_comp.md#what-a-component-exposes).
// mounted by comp.yaml of this folder (tag CompStateListDemo)
export const compStateListDemoDefineOptions = {
  expose: {
    meta: { isReadOnly: true, label: 'Component states (demo)', description: 'Every state object the component state service layer holds now.' },
    icon: History,
    sourceDefaultCreate: () => ({ lang: 'text', raw: 'The states of the components of the page; replaced by the CompStateListDemo component.' }),
  },
};
