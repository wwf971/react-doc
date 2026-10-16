---
title: Spreadsheet
description: ExcelUniver shows an Excel-style spreadsheet drawn by Univer; its workbook lives in the asset store
language: en
---

`ExcelUniver` shows a spreadsheet in the document, drawn by the [Univer](https://univer.ai) engine: cells with values, formulas and styles, on one or more sheets. The workbook is kept in the [asset store](../asset-store.md) as JSON, and the block in the document only references it. The component is **asset-only**: its data is never written inline in the document.

## Syntax

````markdown
<!--renderComp=ExcelUniver-->
```asset
store: local
name: quarterly sales
```
````

The block is an asset reference, like any other component whose data is in the store. A new spreadsheet is created from the insert menu in edit mode (**Spreadsheet**): the page creates the asset object with a small starting workbook first, then writes the reference block, and opens it in the spreadsheet editor.

## Example

<!--renderComp=ExcelUniver-->
```asset
store: local
name: quarterly sales
```

In view mode the spreadsheet has no toolbar, formula bar or sheet tabs. Cells can be selected and the sheet scrolled, but values and styles cannot change; a double click on a cell does nothing. The block shows the range named in the metadata of the asset version (here `A1:F6` of the sheet `Sales`). The notes below row 6 and the second sheet `Notes` are part of the workbook, but view mode does not show them.

## Editing

- In edit mode, a click on the sheet selects cells as in view mode and does not open the editor, even when `EditBlockEnterMode` is `click`; the arrow keys of a neighboring block do not move into it either. Only the **Edit** button of the block's toolbar (or the `Sheet` mode in its mode menu) opens it.
- The editor is the full spreadsheet editor of Univer in the block's place: toolbar, formula bar, sheet tabs and context menu.
- The floating panel sets what view mode shows: type a range in A1 notation (`B2:D8`), take the selected cells with **Use selection**, or show the active sheet whole with **Whole sheet**.
- Leaving the block saves the workbook into the asset object, and the view range into the version's metadata. The document is not written. The object saves **in place**, which is the save mode `ExcelUniver` declares: the head version is rewritten, and its previous files are kept as `.bak` files.
- There is no source mode: the workbook JSON is edited only through the spreadsheet. Escape and Ctrl/⌘ + Enter go to the cell editor, so use **Save** / **Cancel** in the panel.

## Popup

The button at the top right of the sheet (it appears when the pointer is over the sheet) opens the spreadsheet in a popup, larger than its place in the page. The maximize button of the popup fills the window with it.

- The header of the popup switches the spreadsheet between **View** and **Edit**, in reading mode as well: **Edit** puts the page into edit mode when it is not, and opens the spreadsheet editor in the popup, with the view range controls and **Save** / **Cancel** in the header.
- **View** saves the spreadsheet first, including a cell still being typed in, and shows it in view mode again; **Save** does the same. **Cancel** drops the changes. All three keep the popup open; a save that fails keeps the editor, with the message in the header.
- Closing the popup puts the spreadsheet back in the page as it is: an editor that is open stays open there, with its changes not yet saved.
- The selection and changes not yet saved stay when the popup opens, is maximized, or closes. A built page offers only View, because its asset store is read-only.

## Version metadata

The metadata of the version is the file `{versionId}.metadata.yaml` beside the workbook file `{versionId}.json`. The asset panel (the asset button of the block's toolbar) shows it under the version table:

```yaml
engine: univer
engineVersion: 1.1.0
view:
  sheetId: sales
  range: A1:F6
```

- `engine` / `engineVersion`: the engine and its version that last wrote the workbook
- `view.sheetId`: the sheet view mode shows; without it, the first sheet
- `view.range`: the range of that sheet view mode shows; without it, the whole sheet
- `view.isReadOnlyWarningShown`: `true` makes view mode show Univer's dialog saying the sheet cannot be edited when a reader tries to (a double click on a cell); default `false`, the attempt does nothing. It is written in the file by hand; a save from the editor keeps it

## Asset-only and not-in-doc components

Two properties of a component's metadata limit where it can be used. Both default to false. An **asset-only** component (`isAssetOnly`) keeps its data in the asset store only. Written inline, it shows an error instead, and its edit modes stay disabled until **to asset** has moved the data into the store:

<!--renderComp=ExcelUniver-->
```json
{ "sheets": { "s1": { "id": "s1", "name": "Sheet1", "cellData": { "0": { "0": { "v": "inline" } } } } } }
```

A **not-in-doc** component (`isNotInDoc`) cannot be placed in a document at all, because it renders somewhere else. `SidePanelItem` draws the items of the side panel, so a block of it shows an error, and the insert menu does not offer it:

<!--renderComp=SidePanelItem-->
```yaml
text: an item
```
