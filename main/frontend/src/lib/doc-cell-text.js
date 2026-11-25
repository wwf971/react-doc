// The grammar of a cell text without the page: the pure modules of the cell editing kit
// (design: doc_page_impl_edit_cell.md), for a package's data modules and their node tests
// (import '@wwf971/react-doc/cell-text'; with the page, '@wwf971/react-doc' exports the same).
// what a text as kept holds, and how it is cut, joined and changed by the offsets of its bare text:
//   doc-cell.js         words and tokens: cellTextParse, cellTextStyledParse, cellTextRangeReplace,
//                       cellTextSlice, cellTextConcat, …
//   doc-cell-style.js   styled segments: cellStyleTextBareGet, cellStyleSegListRead, cellStyleTextWrite, …
export * from './doc-cell.js';
export * from './doc-cell-style.js';
