# TestCaseTable

`TestCaseTable` is a test specification table (a 試験仕様書): the test cases, grouped at any depth, with one confirmation column per tester. It is drawn by the view of [TableHierarchy](../hierarchy/table-hierarchy/comp_table_hierarchy.md) (`TableHierarchyView` with a `cellRender` for the confirmation cells), so grouping, collapsing, column widths, `density`, `heightMode` and registered cell components work as there. What it adds is the result of every cell: a **managed history**, recorded with an operator name on the asset object of the block, never typed into the text.

## Grammar

```yaml
type: test-case-table
version: 1
title: Login
rowHeader: Test case
groupDisplay: row
columns:                       # the authored columns, as TableHierarchy columns (may be empty)
  - { id: description, label: Description, width: 22rem }
  - { id: expected, label: Expected, width: 16rem }
testers:                       # one confirmation column each, after the authored ones
  - { id: ai, name: AI self-check }
  - { id: dev, name: Developer }
  - { id: pm, name: PM, width: 8rem }
rows:                          # TableHierarchy rows; every row has a stable id
  - id: form
    label: Login form
    children:
      - id: form-empty
        label: Empty submit
        cells:
          description: Submit the form with both fields empty.
          expected: Both fields are marked, nothing is sent.
results:                       # the managed history (see below); {} or absent in a new table
  form-empty:
    dev:
      - { id: 7c1b…, result: OK, operator: A. Tester, time: 1779200000000, timeTimezone: 540 }
```

- `type: test-case-table` and `version: 1` are required.
- `testers` is a non-empty list of `{ id, name, width? }`. Each tester becomes the column `confirmation:{id}`, labeled with the name, `9rem` wide unless `width` says otherwise. Authored column ids may not start with `confirmation:`.
- Every row needs an `id`, unique in the table, without surrounding spaces. A row with `children` is a group; a row with `cells` is a test case, whose cells name the authored columns only (the confirmation cells are made by the component).
- `results` maps a case id to a mapping of tester id to the **history** of that cell, oldest first. Its last entry is the current result. An entry has `id` (unique), `result` (`OK`, `NG`, or `null`), `operator`, `time` (epoch milliseconds), `timeTimezone` (minutes east of UTC, −840…840), and optionally `evidence`, the source path of a document.

Everything else of the mapping (`title`, `rowHeader`, `groupDisplay`, `isExpandedDefault`, `heightMode`, `height`, `density`, `cellBorders`, `rowHeaderWidth`, `headerRight`, `context`) is what `TableHierarchy` reads.

## The managed history

A result is never edited in place and never removed: recording appends an entry, clearing appends an entry with `result: null`, and the history of a cell stays complete. The record is made on the server, which writes the time and the id of the entry; the author gives the result, the operator (required) and the evidence (optional).

The data is therefore meant to be an **asset object** ([asset service layer](../../../main/doc_page_impl_asset.md)): the block holds a reference, and the asset api of the development server records a result on the head of the object through `POST /test-case/result/set`:

```text
{ store, objectId, hashBase, docPath, caseId, testerId, operator, result, timeTimezone?, evidence?, versionId? }
  -> { object, version }      the normal head update: hashBase against the head's hash (-2 when
                              somebody recorded meanwhile), the object's lock and save mode apply
  docPath     the document the block is in: evidence is resolved like a link written there, and
              must name exactly one md/mdx document of that doc page
  versionId   only 'head' (or absent): a pinned block cannot record
```

The generic head write (`POST /object/update`, what the asset panel and every other editor use) refuses a text of a test case table whose history differs from the head's; a structural edit (rows, columns, testers, titles) that keeps the history passes. The guard is of the api only: version operations of the panel (checkout, delete) and edits of the files are still possible, so the history is a record kept honestly, not an audit trail that cannot be forged. With the data written inline in the document the table is displayed, and its history read, but nothing can be recorded until the block is moved into the store (**to asset**).

The evidence of every entry is a source dependency of the version written (and of a build: the dependency collector names every evidence document of the history, so a document an old record refers to is kept), and the reference the author typed is replaced by the resolved source path.

## In the page

A confirmation cell shows the current result (`OK`, `NG`, `Cleared` when the last record cleared it, `Not tested` without a record) and, when there is one, the length of its history. Clicking it opens the history in the host's panel (`config.panelComponent`; without a panel the cells are not clickable), newest first: the result, the time, the operator, and the evidence as a `SourceLink` in render mode, which shows the document in a popup.

In edit mode the block is entered through its Edit button only (`isEditEnterButtonOnly`), in the edit mode **Results**. The popup of a cell then starts with the form of a record: **OK**, **NG**, **Clear**, the operator, the evidence (a document of the doc page, with completion), and **Save result**, which records at once through `assetTestCaseResultRequest` ([event layer](../../../main/doc_page_impl_event.md)). A success clears the operator and the evidence, so the next record is a deliberate one. **Cancel** closes the popup and discards what was typed, never a record. **Done** in the floating bar leaves the mode; the session itself writes nothing (the draft is reported clean), and the document is not written at all: the data belongs to the object.

The record is based on the hash the table read when the cell was opened and kept across the records of that popup (each one moves it to the version written). A record by somebody else meanwhile is a conflict: the page reads the object again, the table shows the latest history, and the message asks to close and reopen the cell before recording over it.

The time of an entry is shown as the page writes times (`20260520_23250530+09`: the instant in the zone of the record to 10 ms, then the zone in whole hours). An offset that is not whole hours is shown in UTC (`+00`), the offset in minutes in the tooltip. The stored `time` keeps its milliseconds.

## Build-time dependencies

`testCaseDependenciesCollect` (registered in `registry-source-dependency.js`) adds every evidence document of the history as a `source` dependency and hands the registered components of the cells (`cellComponent` of a column, `component` of a cell or a row label, `headerRight`) to their collectors. `testCaseAssetDependencyListGet` names the same evidence documents as the dependencies of an asset object made from the data (`compDefine` `assetDependencyListGet`).

## Files

```text
TestCaseTable.jsx          the component: the hierarchy view with the confirmation cells, the floating bar of the
                           mode results, the popup of a cell (the form and the history); testCaseTableExpose
TestCaseTableStore.js      the state while shown: the open cell with the hash a record is based on, the form
TestCaseTableData.js       parsing and checks, the hierarchy data with the confirmation columns, the append of
                           a result (the yaml written back with its comments), the time text, the default source,
                           the dependencies (pure; shared with the server and the vite plugin)
TestCaseTableApi.js        the server side: the record on the head of an object (evidence resolved against the
                           collected files), the guard of the generic head write (node only)
TestCaseTable.css          the confirmation cell and the popup
TestCaseTableData.test.js  the grammar, the append, the time text, the dependencies, the guard
```
