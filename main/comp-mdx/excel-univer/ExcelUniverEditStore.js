import { makeAutoObservable } from 'mobx';
import {
  excelUniverMetadataBuild,
  excelUniverRangeParse,
  excelUniverRangeTextBuild,
  excelUniverViewGet,
} from './ExcelUniverData.js';

// the draft of an ExcelUniver block being edited: the workbook text the
// engine last saved, and the view range set in the panel. both are saved
// together, the text as the asset's data and the view in the version's
// metadata (excelUniverMetadataBuild keeps the keys the metadata had).
export class ExcelUniverEditStore {
  // the text the engine was mounted with; the engine holds the draft itself
  // from then on, so it is not mounted again while the session lasts
  workbookTextInitial = '';
  rawDraft = '';
  view = { sheetId: '', range: '' };
  // what view mode shows when the session starts: the height of the editor
  // is at least the block's height in view mode
  viewInitial = { sheetId: '', range: '' };
  versionMetadataBase = {};
  engineVersion = '';
  message = '';

  constructor({ raw, versionMetadata }) {
    makeAutoObservable(this);
    this.workbookTextInitial = String(raw ?? '');
    this.rawDraft = this.workbookTextInitial;
    this.versionMetadataBase = { ...(versionMetadata ?? {}) };
    this.view = excelUniverViewGet(versionMetadata);
    this.viewInitial = { ...this.view };
  }

  get versionMetadata() {
    return excelUniverMetadataBuild(this.versionMetadataBase, { engineVersion: this.engineVersion, view: this.view });
  }

  engineVersionSet(engineVersion) {
    this.engineVersion = String(engineVersion ?? '');
  }

  rawSet(raw) {
    this.rawDraft = raw;
  }

  // a range typed in the panel or taken from the selection, on the sheet
  // sheetId; '' shows that sheet whole. false when the text is not a range
  // (the message says so, the view is unchanged)
  rangeSet(text, sheetId) {
    const textTrimmed = String(text ?? '').trim();
    if (textTrimmed === '') {
      this.sheetWholeSet(sheetId);
      return true;
    }
    const range = excelUniverRangeParse(textTrimmed);
    if (!range) {
      this.message = `"${textTrimmed}" is not a range in A1 notation (e.g. A1:D8)`;
      return false;
    }
    this.view = { sheetId: String(sheetId ?? ''), range: excelUniverRangeTextBuild(range) };
    this.message = '';
    return true;
  }

  // view mode shows the sheet sheetId, whole
  sheetWholeSet(sheetId) {
    this.view = { sheetId: String(sheetId ?? ''), range: '' };
    this.message = '';
  }

  messageSet(message) {
    this.message = message;
  }
}
