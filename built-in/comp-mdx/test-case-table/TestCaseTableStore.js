import { makeAutoObservable, runInAction } from 'mobx';

// The state of one TestCaseTable while it is shown (TestCaseTable.jsx): the
// confirmation cell whose popup is open, and the form of a new result in
// it. The data of the table is not here: it is the block's data, rendered
// again by the page after every record (the asset object changed).
//
//   cellOpen        { caseId, testerId, testerName, hashBase }: the cell
//                   whose history is shown. hashBase is the hash of the data
//                   the table read when the cell was opened; a record is
//                   based on it, and the hash of the version written moves
//                   it on (TestCaseTableApi.js: a record by somebody else
//                   meanwhile is a conflict the author has to look at)
//   result, operator, evidence   the form: the result chosen (OK, NG, null
//                   to clear), the name of who records, an optional
//                   evidence document
//   isBusy          a record is on its way; the popup does not close
//   message, isError   what the last record answered
export class TestCaseTableStore {
  cellOpen = undefined;
  result = null;
  operator = '';
  evidence = '';
  isBusy = false;
  message = '';
  isError = false;

  constructor() {
    makeAutoObservable(this);
  }

  get isPopupOpen() {
    return this.cellOpen !== undefined;
  }

  get isSubmittable() {
    return this.isPopupOpen && !this.isBusy && this.operator.trim() !== '';
  }

  // the popup of a cell, the form starting from the cell's current result
  popupOpen({ caseId, testerId, testerName, hashBase, result }) {
    this.cellOpen = { caseId, testerId, testerName, hashBase };
    this.result = result ?? null;
    this.operator = '';
    this.evidence = '';
    this.message = '';
    this.isError = false;
  }

  // closing discards what was typed and not recorded, never a record
  popupClose() {
    if (this.isBusy) return;
    this.cellOpen = undefined;
  }

  resultSet(result) {
    this.result = result;
  }

  operatorSet(text) {
    this.operator = String(text ?? '');
  }

  evidenceSet(text) {
    this.evidence = String(text ?? '');
  }

  // the result recorded through requestSend(data): the page's answer
  // { code, data: { version }, message }. a success clears the operator and
  // the evidence, so the next record of the cell is a deliberate one, and
  // bases it on the version written
  async submit(requestSend) {
    if (!this.isSubmittable) return;
    const cell = this.cellOpen;
    this.isBusy = true;
    this.message = '';
    this.isError = false;
    let response;
    try {
      response = await requestSend({
        caseId: cell.caseId,
        testerId: cell.testerId,
        result: this.result,
        operator: this.operator.trim(),
        evidence: this.evidence.trim(),
        timeTimezone: -new Date().getTimezoneOffset(),
        hashBase: cell.hashBase,
      });
    } catch (error) {
      response = { code: -1, message: String(error?.message ?? error) };
    }
    runInAction(() => {
      this.isBusy = false;
      if (response?.code !== 0) {
        this.isError = true;
        this.message = response?.code === -2
          ? `${response.message || 'The data changed meanwhile.'} Close the cell and open it again to see the latest result before recording.`
          : response?.message || 'The result was not recorded.';
        return;
      }
      const hashNext = response.data?.version?.hash;
      if (hashNext && this.cellOpen === cell) this.cellOpen = { ...cell, hashBase: hashNext };
      this.operator = '';
      this.evidence = '';
      this.message = 'Result recorded.';
    });
  }
}
