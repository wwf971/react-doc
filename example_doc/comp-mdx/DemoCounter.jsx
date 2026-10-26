import { observer } from 'mobx-react-lite';
import { Hash } from '../../main/frontend/UICommon.js';
import { useCompState } from '../../main/comp-doc/registry/use-comp-state.js';

// Demonstration component: a counter whose count lives in the component
// state service layer (doc_page_impl_mdx_comp_state.md), not in local
// component state. The count is kept while the block is not rendered
// (another document and back) and shared by every rendering of the same
// block. The key of the state is the block's: its id prop when it has one
// (`id=counter-a`, so the state follows the block through every edit), else
// its place in the document.
//
//   <!--renderComp=DemoCounter,id=counter-a,label=clicks-->
//   ```text
//   (what a plain Markdown viewer shows)
//   ```
//
//   data.label    the word shown before the count
//   config        stateKey (the key the page chose), instanceId
//
// the host application may take the change over (countChangeRequest with
// the next count, answered with code 0); otherwise the counter counts itself.
//
// mounted by comp.yaml of this folder (tag DemoCounter), with the options
// below (doc_page_impl_mdx_comp.md#components-of-a-doc-page)
export const DemoCounter = observer(function DemoCounter({ data = {}, config = {}, onEvent }) {
  const state = useCompState(config, { count: 0 });

  const countIncreaseRequest = async () => {
    const count = state.value.count + 1;
    const result = await onEvent?.('countChangeRequest', { count });
    if (result?.code !== 0) state.patch({ count });
  };

  return (
    <span
      className="not-prose inline-flex items-center gap-1.5 border border-fd-border rounded-sm px-1.5 py-0.5 text-sm align-middle"
      title={`state key: ${state.key}`}
    >
      <span>{data.label ?? 'count'}: {state.value.count}</span>
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

// what the component exposes (doc_page_impl_mdx_comp.md#what-a-component-exposes):
// its name and icon for the insert menu, the source of a new block
export const demoCounterDefineOptions = {
  expose: {
    meta: { label: 'Counter (demo)', description: 'A counter whose count lives in the component state service layer.' },
    icon: Hash,
    sourceDefaultCreate: () => ({
      lang: 'text',
      raw: 'A counter; a plain Markdown viewer shows this text in its place.',
      props: { id: 'counter', label: 'clicks' },
    }),
  },
};
