import { observer } from 'mobx-react-lite';
import { Hash } from '../../../main/frontend/UICommon.js';
import { useCompState } from '../../../main/comp-doc/registry/use-comp-state.js';
import { useDocEventSubscribe } from '../../../main/comp-doc/registry/use-doc-event.js';

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
// the count is not in the document, so the history of the document does not
// hold it: the counter keeps the counts it went through itself, beside the
// count, and answers the undo and the redo the page delivers to its block
// (historyUndo / historyRedo, doc_page_impl_edit_history.md#a-component-with-changes-of-its-own)
// while the author is at it; with nothing of its own to take back it answers
// nothing, and the document's history is asked. outside a document nothing is
// delivered, and the counter counts as before.
//
// mounted by comp.yaml of this folder (tag DemoCounter), with the options
// below (doc_page_impl_mdx_comp.md#components-of-a-doc-page)
export const DemoCounter = observer(function DemoCounter({ data = {}, config = {}, onEvent }) {
  const state = useCompState(config, { count: 0, countPastList: [], countFutureList: [] });

  const countIncreaseRequest = async () => {
    const count = state.value.count + 1;
    const result = await onEvent?.('countChangeRequest', { count });
    if (result?.code !== 0) {
      state.patch({ count, countPastList: [...(state.value.countPastList ?? []), state.value.count], countFutureList: [] });
    }
  };

  // a step of its own taken back (put again): { code: 0 }; nothing of its own: undefined
  useDocEventSubscribe(config, 'historyUndo', () => {
    const pastList = state.value.countPastList ?? [];
    if (pastList.length === 0) return undefined;
    state.patch({
      count: pastList[pastList.length - 1],
      countPastList: pastList.slice(0, -1),
      countFutureList: [...(state.value.countFutureList ?? []), state.value.count],
    });
    return { code: 0, message: `${data.label ?? 'count'}: back to ${pastList[pastList.length - 1]}` };
  });
  useDocEventSubscribe(config, 'historyRedo', () => {
    const futureList = state.value.countFutureList ?? [];
    if (futureList.length === 0) return undefined;
    state.patch({
      count: futureList[futureList.length - 1],
      countFutureList: futureList.slice(0, -1),
      countPastList: [...(state.value.countPastList ?? []), state.value.count],
    });
    return { code: 0, message: `${data.label ?? 'count'}: again ${futureList[futureList.length - 1]}` };
  });

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
