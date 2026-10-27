import { useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { Check, ClipboardCheck, History, Minus, X } from '../../../main/frontend/UICommon.js';
import { useDocStores } from '../../../main/frontend/src/store/context.js';
import { EditFloatingPanel } from '../../../main/comp-doc/edit/EditFloatingPanel.jsx';
import { EditValueInline } from '../../../main/comp-doc/edit/EditValueInline.jsx';
import { EDIT_POPUP_CLASS } from '../../../main/comp-doc/edit/use-edit-outside-pointer.js';
import { SourcePathInput } from '../../../main/comp-doc/source/SourcePathInput.jsx';
import { TableHierarchyView } from '../hierarchy/table-hierarchy/TableHierarchy.jsx';
import { SourceLink } from '../source-link/SourceLink.jsx';
import { TEST_CASE_COLUMN_PREFIX, testCaseCellGet, testCaseSourceDefaultCreate, testCaseTableParse, testCaseTimeFormat } from './TestCaseTableData.js';
import { TestCaseTableStore } from './TestCaseTableStore.js';
import './TestCaseTable.css';

// A test specification table (comp_test_case_table.md): the test cases as
// a hierarchy table (TableHierarchyView, with the grouping, the collapse
// and the registered cells of TableHierarchy), one confirmation column per
// tester after the authored columns, and in every confirmation cell the
// current result with the length of its history. A cell opens a popup
// (the host's panel) with the history, newest first, each record with its
// operator, its time and its evidence document (a SourceLink in render
// mode).
//
// the results are a managed history on the asset object of the block: in
// the edit mode `results` the popup also has the form of a new record (OK,
// NG, Clear, the operator, an optional evidence document), and Save result
// records it at once through assetTestCaseResultRequest (DocAssetStore):
// nothing waits for the session, so Done (editCancelRequest) only leaves
// the mode, and the session itself writes nothing (its draft is reported
// clean). with the data inline, or on a pinned or locked object, the mode
// says why nothing can be recorded.
//
//   config.assetInfo        where the data is (isAssetAware): the hash a
//                           record is based on, whether the head is read
//   config.panelComponent   the host's panel, framing the popup; without
//                           it the cells are not clickable
//   config.isEdit, config.edit.modeId   the mode `results`

export const testCaseTableExpose = {
  meta: {
    label: 'Test case table',
    description: 'A test specification: nested test cases, a confirmation column per tester, results recorded as a history with operator names and evidence.',
    isEditAssetAccepted: true,
    isEditEnterButtonOnly: true,
    assetSaveMode: 'inPlace',
  },
  icon: ClipboardCheck,
  editModeList: [
    { id: 'results', label: 'Results', description: 'Record a result of a test case, with the name of who confirms it.', icon: Check },
  ],
  sourceDefaultCreate: testCaseSourceDefaultCreate,
};

export function TestCaseTable({ data = {}, config = {}, onEvent }) {
  const raw = String(data.raw ?? '');
  const parsedOrError = useMemo(() => {
    try {
      return { parsed: testCaseTableParse(raw) };
    } catch (error) {
      return { error: String(error?.message ?? error) };
    }
  }, [raw]);
  if (parsedOrError.error !== undefined) {
    return <div className="table-hierarchy-error" role="alert">{parsedOrError.error}</div>;
  }
  return <TestCaseTableView parsed={parsedOrError.parsed} config={config} onEvent={onEvent} />;
}

const TestCaseTableView = observer(function TestCaseTableView({ parsed, config, onEvent }) {
  const { assetStore } = useDocStores();
  const [store] = useState(() => new TestCaseTableStore());
  const isModeResults = Boolean(config.isEdit && config.edit?.modeId === 'results');
  const asset = config.assetInfo;
  const Panel = config.panelComponent;
  const reasonUnrecordable = !asset?.isFromAsset
    ? 'The data is written inline: a result is recorded on an asset object. Move the block into the asset service layer ("to asset") first.'
    : asset.versionIdRef !== 'head'
      ? `The block reads version ${asset.versionIdRef} of its asset, not the head; a result is recorded at the head.`
      : asset.isLocked
        ? 'The asset object is locked.'
        : !assetStore.isWritable
          ? assetStore.writeUnavailableReason
          : '';
  const isRecordable = isModeResults && reasonUnrecordable === '';

  // the session writes nothing: every record is written at once
  useEffect(() => {
    if (isModeResults) void onEvent?.('editDraftChange', { raw: parsed.raw, isDirty: false });
  }, [isModeResults, onEvent, parsed.raw]);

  const cellRender = ({ cell, column }) => {
    if (!column.id.startsWith(TEST_CASE_COLUMN_PREFIX)) return undefined;
    const { caseId, testerId } = cell.data;
    const { history, result } = testCaseCellGet(parsed, caseId, testerId);
    // a cleared cell has a history; one never recorded has none
    const resultText = result ?? (history.length > 0 ? 'Cleared' : 'Not tested');
    return (
      <button
        type="button"
        className="test-case-confirm"
        data-result={result ?? 'none'}
        aria-haspopup="dialog"
        aria-label={`${caseId} / ${column.label}: ${resultText}, ${history.length} ${history.length === 1 ? 'record' : 'records'}`}
        title={Panel ? 'The result and its history' : 'The history needs the host panel (config.panelComponent).'}
        disabled={!Panel}
        onClick={() => store.popupOpen({ caseId, testerId, testerName: column.label, hashBase: asset?.hash ?? '', result })}
      >
        <span className="test-case-confirm-result">{resultText}</span>
        {history.length > 0 ? <span className="test-case-confirm-count"><History size={12} aria-hidden="true" />{history.length}</span> : null}
      </button>
    );
  };

  return (
    <div className="test-case-table">
      {isModeResults ? (
        <EditFloatingPanel
          label="Results"
          actions={(
            <button type="button" className="doc-button-dialog" onClick={() => onEvent?.('editCancelRequest')}>
              <Check size={13} aria-hidden="true" /> Done
            </button>
          )}
        >
          <p className={reasonUnrecordable ? 'doc-note' : 'doc-note'} data-error={reasonUnrecordable ? '' : undefined} role="status">
            {reasonUnrecordable || 'Click a confirmation cell to record its result. Every record is written at once; Done leaves the mode.'}
          </p>
        </EditFloatingPanel>
      ) : null}
      <TableHierarchyView value={parsed.hierarchy} config={config} onEvent={onEvent} cellRender={cellRender} />
      {store.isPopupOpen && Panel ? (
        <TestCaseResultPopup Panel={Panel} store={store} parsed={parsed} config={config} isRecordable={isRecordable} onEvent={onEvent} />
      ) : null}
    </div>
  );
});

// the popup of one cell: the form of a record in the mode results, and
// the history. it is part of the editor (the edit-popup marker), so a
// pointer in it does not leave the session. Escape closes it, before the
// editor sees the key (which would cancel the session): the listener runs
// in the capture phase and prevents the default
const TestCaseResultPopup = observer(function TestCaseResultPopup({ Panel, store, parsed, config, isRecordable, onEvent }) {
  const cell = store.cellOpen;
  const { history } = testCaseCellGet(parsed, cell.caseId, cell.testerId);
  const requestSend = (dataRecord) => onEvent?.('assetTestCaseResultRequest', dataRecord);
  useEffect(() => {
    const keyDownHandle = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // a completion list of the evidence field takes the first Escape
      if (document.querySelector('.doc-source-path-list')) return;
      event.preventDefault();
      store.popupClose();
    };
    window.addEventListener('keydown', keyDownHandle, true);
    return () => window.removeEventListener('keydown', keyDownHandle, true);
  }, [store]);
  return (
    <Panel
      data={{ title: `${cell.caseId} / ${cell.testerName}` }}
      config={{
        isPopup: true,
        isCloseVisible: !store.isBusy,
        className: `test-case-popup ${EDIT_POPUP_CLASS}`,
        bodyClassName: 'test-case-popup-body',
      }}
      onEvent={(type) => {
        if (type === 'closeRequest') store.popupClose();
      }}
      content={(
        <div className="test-case-popup-content not-prose">
          {isRecordable ? (
            <section className="test-case-form" aria-label="Record a result">
              <div className="test-case-form-row" role="group" aria-label="Result">
                {[['OK', Check], ['NG', X], [null, Minus]].map(([value, Icon]) => (
                  <button
                    key={value ?? 'clear'}
                    type="button"
                    className="doc-button-dialog test-case-form-choice"
                    aria-pressed={store.result === value}
                    disabled={store.isBusy}
                    onClick={() => store.resultSet(value)}
                  >
                    <Icon size={13} aria-hidden="true" />{value ?? 'Clear'}
                  </button>
                ))}
              </div>
              <label className="test-case-form-field">
                <span className="test-case-form-label">operator</span>
                <EditValueInline
                  value={store.operator}
                  placeholder="who confirms (required)"
                  isLocked={store.isBusy}
                  onInput={(text) => store.operatorSet(text)}
                  onCommit={(text) => store.operatorSet(text)}
                />
              </label>
              <div className="test-case-form-field">
                <span className="test-case-form-label">evidence</span>
                <SourcePathInput
                  value={store.evidence}
                  spec={{ kind: 'file', extList: ['md', 'mdx'] }}
                  placeholder="a document of this doc page (optional)"
                  isDisabled={store.isBusy}
                  onChange={(text) => store.evidenceSet(text)}
                  onCommit={(text) => store.evidenceSet(text)}
                />
              </div>
              <div className="test-case-form-row">
                <button type="button" className="doc-button-dialog" disabled={!store.isSubmittable} onClick={() => void store.submit(requestSend)}>
                  <Check size={13} aria-hidden="true" />{store.isBusy ? 'Recording…' : 'Save result'}
                </button>
                <button type="button" className="doc-button-dialog" disabled={store.isBusy} onClick={() => store.popupClose()}>Cancel</button>
                {store.message ? (
                  <span className="doc-note" data-error={store.isError ? '' : undefined} role={store.isError ? 'alert' : 'status'}>{store.message}</span>
                ) : null}
              </div>
            </section>
          ) : null}
          <section className="test-case-history" aria-label="History">
            {history.length === 0 ? <p className="doc-note">No result recorded.</p> : null}
            {[...history].reverse().map((entry) => (
              <article key={entry.id} className="test-case-history-card" data-result={entry.result ?? 'none'}>
                <header className="test-case-history-head">
                  <span className="doc-badge-outline" data-primary={entry.result === 'OK' ? '' : undefined} data-error={entry.result === 'NG' ? '' : undefined}>
                    {entry.result ?? 'Cleared'}
                  </span>
                  <time dateTime={new Date(entry.time).toISOString()} title={`UTC offset ${entry.timeTimezone} min`}>
                    {testCaseTimeFormat(entry.time, entry.timeTimezone)}
                  </time>
                </header>
                <span className="test-case-history-operator">{entry.operator}</span>
                {entry.evidence ? (
                  <SourceLink data={{ target: entry.evidence, label: 'Evidence', displayMode: 'render', tagsDisplay: 'off' }} config={config} />
                ) : null}
              </article>
            ))}
          </section>
        </div>
      )}
    />
  );
});
