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
// The engine draws into a mount element of its own (its own React root),
// which this component creates inside its div: React renders nothing inside
// it. A different workbookText or isEditable retires the instance and mounts
// a new one in a new mount element.
//
// retiring an instance: its listeners are disposed and its mount element is
// taken out of the page at once, so the next instance never shares a
// container with it; the engine itself is disposed after React has finished
// the commit that retired it. Univer unmounts its own React root when it is
// disposed, and doing that inside a React commit (an effect cleanup) makes
// React warn about a synchronous unmount during rendering. each instance is
// disposed through its own closure, never through a shared ref, so rapid
// changes cannot dispose the instance that replaced it.
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
//   height        px, or any css height ('100%' fills a popup)
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
    if (!container) return undefined;
    const mountElement = document.createElement('div');
    mountElement.className = 'doc-mdx-excel-univer-engine';
    container.appendChild(mountElement);
    let isDisposed = false;
    let univer;
    const disposableList = [];
    messageSet('');

    const mount = async () => {
      const engine = await excelUniverEngineGet(univerLoad);
      if (isDisposed) return;
      const presetConfig = { container: mountElement, disableAutoFocus: true };
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
      mountElement.remove();
      // a mount still loading the engine creates nothing (isDisposed); an
      // instance created while its setup was awaited is disposed here too
      const univerRetired = univer;
      if (univerRetired) setTimeout(() => univerRetired.dispose(), 0);
    };
  }, [workbookText, isEditable, isReadOnlyWarningShown, univerLoad]);

  return (
    <div ref={containerRef} className="doc-mdx-excel-univer-sheet" style={{ height }}>
      {message ? <p className="doc-mdx-excel-univer-message" role="alert">{message}</p> : null}
    </div>
  );
}
