---
title: Test case table
description: TestCaseTable is a test specification with nested cases and a confirmation column per tester; results are recorded as a history on its asset object
language: en
---

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
`TestCaseTable` is a test specification table (試験仕様書): test cases grouped at any depth, drawn by the hierarchy table, with one confirmation column per tester after the authored columns. A confirmation cell shows the current result and how many records it has; clicking it opens the history. A result is never typed into the data: it is **recorded** with the name of who confirms it, the time of the server and an optional evidence document, on the asset object of the block.

`TestCaseTable` は試験仕様書の表です。階層テーブルで任意の深さにグループ化したテストケースに、記述列の後ろへ確認者ごとの確認列が並びます。確認セルには現在の結果と記録数が表示され、クリックすると履歴が開きます。結果はデータに直接書くものではなく、確認者の名前、サーバーの時刻、任意の証跡文書とともに、ブロックのアセットオブジェクトに**記録**します。
```

<!--renderComp=Anchor,id=test-case-table-grammar-->
## Syntax

````markdown
<!--renderComp=TestCaseTable-->
```yaml
type: test-case-table
version: 1
title: Login
rowHeader: Test case
groupDisplay: row
columns:
  - { id: description, label: Description, width: 20rem }
  - { id: expected, label: Expected, width: 16rem }
testers:
  - { id: ai, name: AI self-check }
  - { id: dev, name: Developer }
  - { id: pm, name: PM, width: 7rem }
rows:
  - id: form
    label: Login form
    children:
      - id: form-empty
        label: Empty submit
        cells:
          description: Submit the form with both fields empty.
          expected: Both fields are marked, nothing is sent.
results: {}
```
````

- `columns` are the authored columns and `rows` the test cases, as in [TableHierarchy](comp-hierarchy.md#table-hierarchy); every row needs a stable `id`. `testers` lists the confirmation columns: the typical set is a self-check by the AI that wrote the feature, a developer check and a PM check, but any list works.
- `results` is the history of every confirmed cell, written by the page: a case id, a tester id, and the records of that cell, oldest first. The last record is the current result (`OK`, `NG`, or `null` for a cleared one). Each record has an `id`, the `operator`, the `time` (epoch milliseconds), the `timeTimezone` (minutes east of UTC) and optionally the `evidence` document.

The grammar in full is in the component's own document (`built-in/comp-mdx/test-case-table/comp_test_case_table.md`).

<!--renderComp=Anchor,id=test-case-table-inline-->
## Inline data

With the data written in the document the table is displayed as any other, and its history read, but nothing can be recorded: the **Results** mode says so and offers to move the block into the store. The results below were authored by hand to show the display; a real table does not have them typed.

<!--renderComp=TestCaseTable-->
```yaml
type: test-case-table
version: 1
title: Password reset (inline data)
rowHeader: Test case
rowHeaderWidth: 8rem
groupDisplay: row
columns:
  - { id: description, label: Description, width: 18rem }
testers:
  - { id: ai, name: AI self-check, width: 7rem }
  - { id: dev, name: Developer, width: 7rem }
rows:
  - id: request
    label: Reset request
    children:
      - id: request-known
        label: Known address
        cells:
          description: A mail with a one-time link is sent to the address.
      - id: request-unknown
        label: Unknown address
        cells:
          description: The same confirmation is shown; no mail is sent.
  - id: link
    label: Reset link
    children:
      - id: link-expired
        label: Expired link
        cells:
          description: An expired link explains itself and offers a new request.
results:
  request-known:
    ai:
      - { id: demo-1, result: OK, operator: Authored example, time: 1779200000000, timeTimezone: 540 }
    dev:
      - { id: demo-2, result: NG, operator: Authored example, time: 1779203600000, timeTimezone: 540 }
      - { id: demo-3, result: OK, operator: Authored example, time: 1779290000000, timeTimezone: 540 }
  link-expired:
    ai:
      - { id: demo-4, result: OK, operator: Authored example, time: 1779200000000, timeTimezone: 330 }
```

<!--renderComp=Anchor,id=test-case-table-asset-->
## As an asset object

The table of this section reads the asset object `login test cases` of the [asset service layer](../asset-store.md); the block in the document is only the reference. Its records are **component checks of this demonstration**, recorded through the page while the component was checked, not the acceptance of any system.

<!--renderComp=TestCaseTable-->
```asset
store: local
name: login test cases
```

## Recording a result

1. Turn edit mode on and enter the block with its **Edit** button (or the **Results** mode of its mode menu): a click on the table never enters it, so the cells can be clicked in edit mode as in reading mode.
2. Click a confirmation cell. Its popup starts with the form of a record: **OK**, **NG** or **Clear**, the **operator** (required: the name of who confirms, or of the model that checked), the **evidence** (optional: a document of this doc page, typed with completion), and **Save result**.
3. **Save result** records at once: the page appends the record to the history of the object, with the time of the server, and the table shows the new result. The operator and the evidence are cleared, so a second record is a deliberate one. **Cancel** closes the popup and discards what was typed, never a record.
4. **Done** in the floating bar leaves the mode. Nothing waits for it: the session writes nothing, and the document is not written at all.

A record is based on the data the cell was opened with. When somebody else recorded on the same object meanwhile, the save is refused, the table shows the latest history, and the cell has to be closed and opened again before recording over it. The asset panel of the block (its **asset** button) shows the object and its versions as for any object; its text editor refuses a change of the history, and accepts a change of the cases, columns and testers.

## Evidence

An evidence document is any `md` / `mdx` document of the same doc page: a page of screenshots, a transcript, a note. The reference is typed as a link would be written in this document (`test-case-evidence.md`, `./test-case-evidence.md`, or the full `~example:example/mdx-usage/test-case-evidence.md`) and kept as the resolved source path. In the history it is a link that opens the document in a popup; every evidence document of the history is a dependency of the asset version and of a build, so it stays available while a record refers to it. The evidence of this demonstration is [a short note](test-case-evidence.md).

## Times

A record stores the time as epoch milliseconds and the zone as minutes east of UTC. The history shows `20260520_23250530+09`, the format the page uses for every time: the instant in the zone of the record to 10 ms, then the zone in whole hours. A zone that is not whole hours (the inline example's third record, +330 min) is shown in UTC (`+00`); the offset in minutes is in the tooltip of the time.
