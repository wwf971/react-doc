import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Plus, Trash2 } from '../../main/frontend/UICommon.js';
import { EditActions } from '../../main/comp-doc/edit/EditActions.jsx';
import { EditFloatingPanel } from '../../main/comp-doc/edit/EditFloatingPanel.jsx';
import { EditValueInline } from '../../main/comp-doc/edit/EditValueInline.jsx';
import { StockTableView } from './StockTable.jsx';
import { markdownTableBuild, stockTextList } from './StockTableData.js';
import { StockTableEditStore } from './StockTableEditStore.js';
import './StockTableEdit.css';

// Edit mode of StockTable, the component-specific editor demonstration. The
// table is edited where it is displayed: the same StockTableView as the
// document body, so it keeps its place and height when editing starts; its
// title and cells become editable values, a status cell cycles through the
// stock states, and each row gets insert / remove icons. Only "add row",
// "add column", and Save / Cancel float, in the bar above the table
// (doc_page_impl_edit.md#no-jitter-rule). Every change is reported to the
// edit layer as the new table source and marker property, so leaving the
// block saves it; the layer rewrites the block lines and reloads the document.
//
//   data.raw, data.title     the block as authored
//   config.edit.session      status / message of the pending change request
//
// events (handled by the edit layer):
//   editDraftChange { raw, props }
//   editSubmitRequest
//   editCancelRequest
export const StockTableEdit = observer(function StockTableEdit({ data = {}, config = {}, onEvent }) {
  const [store] = useState(() => new StockTableEditStore(data));
  const session = config.edit?.session ?? {};
  const isLocked = session.status === 'submitting';

  // a change of the draft: applied to the store, then reported as the block
  // would be saved
  const draftChange = (change) => {
    change();
    void onEvent?.('editDraftChange', {
      raw: markdownTableBuild({ headers: store.headers, rows: store.rows }),
      props: { title: store.title },
    });
  };
  const cancel = () => {
    if (isLocked) return;
    void onEvent?.('editCancelRequest');
  };
  const submit = () => {
    if (isLocked) return;
    void onEvent?.('editSubmitRequest');
  };

  const cellRender = (cell, indexRow, indexCell) => {
    const isStatusColumn = /status/i.test(store.headers[indexCell] ?? '');
    if (isStatusColumn) {
      return (
        <button
          type="button"
          className="stock-table-edit-status"
          disabled={isLocked}
          title="Click to cycle the stock status"
          onClick={() => draftChange(() => store.cellSet(indexRow, indexCell, stockTextNext(cell)))}
        >
          {cell || stockTextList[0]}
        </button>
      );
    }
    return (
      <EditValueInline
        value={cell}
        placeholder="…"
        isLocked={isLocked}
        onCommit={(value) => draftChange(() => store.cellSet(indexRow, indexCell, value))}
      />
    );
  };

  return (
    <>
      <StockTableView
        title={store.title}
        headers={store.headers}
        rows={store.rows}
        titleRender={(title) => (
          <EditValueInline
            value={title}
            placeholder="(title)"
            isLocked={isLocked}
            onCommit={(value) => draftChange(() => store.titleSet(value))}
          />
        )}
        headerRender={(header, indexCell) => (
          <span className="stock-table-edit-header">
            <EditValueInline
              value={header}
              placeholder="Column"
              isLocked={isLocked}
              onCommit={(value) => draftChange(() => store.headerSet(indexCell, value))}
            />
            <button
              type="button"
              className="stock-table-edit-icon"
              disabled={isLocked || store.headers.length <= 1}
              title="Remove column"
              aria-label="Remove column"
              onClick={() => draftChange(() => store.columnRemove(indexCell))}
            >
              <Trash2 size={12} />
            </button>
          </span>
        )}
        cellRender={cellRender}
        rowActionsRender={(indexRow) => (
          <span className="stock-table-edit-row-actions">
            <button
              type="button"
              className="stock-table-edit-icon"
              disabled={isLocked}
              title="Insert row below"
              aria-label="Insert row below"
              onClick={() => draftChange(() => store.rowAdd(indexRow))}
            >
              <Plus size={12} />
            </button>
            <button
              type="button"
              className="stock-table-edit-icon"
              disabled={isLocked}
              title="Remove row"
              aria-label="Remove row"
              onClick={() => draftChange(() => store.rowRemove(indexRow))}
            >
              <Trash2 size={12} />
            </button>
          </span>
        )}
      />
      <EditFloatingPanel
        label="StockTable"
        head={(
          <span className="doc-edit-segment" role="group" aria-label="Table actions">
            <button type="button" disabled={isLocked} onClick={() => draftChange(() => store.rowAdd())}>
              <Plus size={11} /> Row
            </button>
            <button type="button" disabled={isLocked} onClick={() => draftChange(() => store.columnAdd())}>
              <Plus size={11} /> Column
            </button>
          </span>
        )}
        actions={<EditActions status={session.status} message={session.message} onSubmit={submit} onCancel={cancel} />}
      />
    </>
  );
});

function stockTextNext(text) {
  const index = stockTextList.indexOf(text);
  return stockTextList[(index + 1) % stockTextList.length];
}
