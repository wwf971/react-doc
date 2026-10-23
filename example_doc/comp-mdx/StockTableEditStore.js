import { makeAutoObservable } from 'mobx';
import { parseMarkdownTable } from './StockTableData.js';

// the draft of a StockTable being edited: title, header cells, body cells.
// the editor renders from this store and serializes it on save.
export class StockTableEditStore {
  title = '';
  headers = [];
  rows = [];

  constructor(data = {}) {
    makeAutoObservable(this);
    this.title = String(data.title ?? '');
    const table = parseMarkdownTable(String(data.raw ?? ''));
    this.headers = table.headers;
    this.rows = table.rows.map((cells) => table.headers.map((_, index) => cells[index] ?? ''));
  }

  titleSet(title) {
    this.title = title;
  }

  headerSet(indexCell, text) {
    this.headers[indexCell] = text;
  }

  cellSet(indexRow, indexCell, text) {
    this.rows[indexRow][indexCell] = text;
  }

  rowAdd(indexAfter = this.rows.length - 1) {
    this.rows.splice(indexAfter + 1, 0, this.headers.map(() => ''));
  }

  rowListAppend(rows) {
    this.rows.push(...rows.map((cells) => this.headers.map((_, index) => cells[index] ?? '')));
  }

  rowRemove(indexRow) {
    this.rows.splice(indexRow, 1);
  }

  columnAdd() {
    this.headers.push('Column');
    for (const cells of this.rows) cells.push('');
  }

  columnRemove(indexCell) {
    if (this.headers.length <= 1) return;
    this.headers.splice(indexCell, 1);
    for (const cells of this.rows) cells.splice(indexCell, 1);
  }
}
