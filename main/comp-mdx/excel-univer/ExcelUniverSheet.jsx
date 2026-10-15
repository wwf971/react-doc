import { useEffect, useRef, useState } from 'react';
import { excelUniverCommandIsDataChange } from './ExcelUniverData.js';

// the engine, loaded once per page through the host (config.univerLoad);
// a failed load is tried again by the next sheet
let enginePromise;

function excelUniverEngineGet(univerLoad) {
  if (!enginePromise) {
    if (typeof univerLoad !== 'function') {
      return Promise.reject(new Error('ExcelUniver requires config.univerLoad: the host loads the Univer engine.'));
    }
    enginePromise = univerLoad();
    enginePromise.catch(() => {
      enginePromise = undefined;
    });
  }
  return enginePromise;
}

// One Univer instance in a div of the given height, holding one workbook.
// The engine draws into the div itself (its own React root): React renders
// nothing inside it. A different workbookText or isEditable disposes the
// instance and mounts a new one.
//
//   workbookText  the workbook as JSON text (already checked by the caller)
//   isEditable    true: the toolbar, the formula bar, the sheet tabs and the
//                 context menu, and every change of the data is reported.
//                 false (view mode): none of them; the workbook is read-only
//                 and every command that would change the data is canceled,
//                 so cells can be selected and the sheet scrolled, nothing else
//   isReadOnlyWarningShown  view mode: the engine's dialog saying the sheet
//                 cannot be edited appears when the reader tries to (a double
//                 click on a cell); false: the attempt does nothing
//   height        px
//   univerLoad    config.univerLoad of the host
//   onReady({ univerAPI, workbook, engineVersion })   once the workbook is shown
//   onDataChange(workbookData)   edit mode: after a change of the data, the
//                 workbook as the engine saves it (one call per task, however
//                 many mutations the change was made of)
export function ExcelUniverSheet({ workbookText, isEditable, isReadOnlyWarningShown = false, height, univerLoad, onReady, onDataChange }) {
  const containerRef = useRef(null);
  const [message, messageSet] = useState('');
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onDataChangeRef = useRef(onDataChange);
  onDataChangeRef.current = onDataChange;

  useEffect(() => {
    const container = containerRef.current;
    let isDisposed = false;
    let univer;
    const disposableList = [];
    messageSet('');

    const mount = async () => {
      const engine = await excelUniverEngineGet(univerLoad);
      if (isDisposed || !container) return;
      const presetConfig = { container, disableAutoFocus: true };
      if (!isEditable) {
        presetConfig.header = false;
        presetConfig.toolbar = false;
        presetConfig.formulaBar = false;
        presetConfig.footer = false;
        presetConfig.contextMenu = false;
      }
      const created = engine.createUniver({
        locale: engine.univerLocaleDefault,
        locales: engine.univerLocales,
        presets: [engine.UniverSheetsCorePreset(presetConfig)],
      });
      univer = created.univer;
      const univerAPI = created.univerAPI;
      const workbook = univerAPI.createWorkbook(JSON.parse(workbookText));

      if (isEditable) {
        let isChangePending = false;
        disposableList.push(univerAPI.addEvent(univerAPI.Event.CommandExecuted, (event) => {
          if (!excelUniverCommandIsDataChange(event, engine.CommandType) || isChangePending) return;
          isChangePending = true;
          setTimeout(() => {
            isChangePending = false;
            if (!isDisposed) onDataChangeRef.current?.(workbook.save());
          }, 0);
        }));
      } else {
        // the permission makes the engine itself refuse edits (no cell
        // editor opens); the guard refuses what still gets through
        univerAPI.setPermissionDialogVisible(isReadOnlyWarningShown);
        try {
          await workbook.getWorkbookPermission().setReadOnly();
        } catch (error) {
          console.error(error);
        }
        if (isDisposed) return;
        disposableList.push(univerAPI.addEvent(univerAPI.Event.BeforeCommandExecute, (event) => {
          if (excelUniverCommandIsDataChange(event, engine.CommandType)) event.cancel = true;
        }));
      }
      onReadyRef.current?.({ univerAPI, workbook, engineVersion: engine.univerVersion });
    };

    mount().catch((error) => {
      if (!isDisposed) messageSet(String(error?.message ?? error));
    });
    return () => {
      isDisposed = true;
      for (const disposable of disposableList) disposable.dispose();
      univer?.dispose();
    };
  }, [workbookText, isEditable, isReadOnlyWarningShown, univerLoad]);

  return (
    <div className="doc-mdx-excel-univer-sheet" style={{ height }}>
      <div ref={containerRef} className="doc-mdx-excel-univer-engine" />
      {message ? <p className="doc-mdx-excel-univer-message" role="alert">{message}</p> : null}
    </div>
  );
}
