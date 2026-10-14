---
title: Hierarchies
description: TableHierarchy and ListHierarchy group rows at any depth; SwitchView shows one dataset through both
language: en
---

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
`TableHierarchy` is a comparison table whose rows are grouped at any depth; every group expands and collapses. Its cells, row labels and header controls are registered components, so a document chooses them by name: `TableCapabilityCell` shows a support status, `TextInfoCell` adds an info tooltip to a label.

`TableHierarchy` は行を任意の深さでグループ化できる比較表で、各グループは開閉できます。セル、行ラベル、ヘッダーのコントロールは登録済みコンポーネントなので、資料側で名前を指定して選びます。`TableCapabilityCell` は対応状況を、`TextInfoCell` はラベルに情報ツールチップを表示します。
```

<!--renderComp=Anchor,id=table-hierarchy-->
<!--renderComp=MultiLang-->
## {en: "Hierarchy table", jp: "階層テーブル"}

````markdown
<!--renderComp=TableHierarchy-->
```yaml
title: API support
rowHeader: Operation
columns:
  - id: cli
    label: CLI
    cellComponent: TableCapabilityCell
  - id: api
    label: Web API
    cellComponent: TableCapabilityCell
rows:
  - label: Table rows
    children:
      - label: Write
        children:
          - label: Create
            cells:
              cli: partial
              api: yes
          - label: Update
            cells:
              cli: no
              api:
                status: yes
                note: Uses PATCH
      - label:
          component: TextInfoCell
          value: Delete
          data:
            tooltip: Removes the row and its relations.
        cells:
          cli: no
          api: yes
```
````

<!--renderComp=TableHierarchy-->
```yaml
title: API support
rowHeader: Operation
columns:
  - id: cli
    label: CLI
    cellComponent: TableCapabilityCell
  - id: api
    label: Web API
    cellComponent: TableCapabilityCell
rows:
  - label: Table rows
    children:
      - label: Write
        children:
          - label: Create
            cells:
              cli: partial
              api: yes
          - label: Update
            cells:
              cli: no
              api:
                status: yes
                note: Uses PATCH
      - label:
          component: TextInfoCell
          value: Delete
          data:
            tooltip: Removes the row and its relations.
        cells:
          cli: no
          api: yes
```

<!--renderComp=Anchor,id=list-hierarchy-->
<!--renderComp=MultiLang-->
## {en: "Hierarchy list", jp: "階層リスト"}

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
`ListHierarchy` groups rows the same way and renders every row with a registered row component. `ListSupportedToolsRow` reads the same columns and cells as the table and shows a badge per supported tool; `ListToolsControls` in the header chooses which tools are shown.

`ListHierarchy` も同じように行をグループ化し、各行を登録済みの行コンポーネントで描画します。`ListSupportedToolsRow` は表と同じ列とセルを読み、対応するツールごとにバッジを表示します。ヘッダーの `ListToolsControls` で表示するツールを選びます。
```

````markdown
<!--renderComp=ListHierarchy-->
```yaml
title: Supported tools
rowComponent: ListSupportedToolsRow
headerRight:
  component: ListToolsControls
columns:
  - id: cli
    label: CLI
  - id: api
    label: Web API
rows:
  - label: Table rows
    children:
      - label: Create
        cells:
          cli: partial
          api: yes
      - label: Delete
        cells:
          cli: no
          api: yes
```
````

<!--renderComp=ListHierarchy-->
```yaml
title: Supported tools
rowComponent: ListSupportedToolsRow
headerRight:
  component: ListToolsControls
columns:
  - id: cli
    label: CLI
  - id: api
    label: Web API
rows:
  - label: Table rows
    children:
      - label: Create
        cells:
          cli: partial
          api: yes
      - label: Delete
        cells:
          cli: no
          api: yes
```

<!--renderComp=Anchor,id=switch-view-->
<!--renderComp=MultiLang-->
## {en: "Switch view", jp: "表示切り替え"}

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
`SwitchView` shows one dataset through several block components, chosen by tabs. A yaml anchor shares the data between the views.

`SwitchView` は一つのデータを複数のブロックコンポーネントで表示し、タブで切り替えます。YAML アンカーでビュー間のデータを共有します。
```

````markdown
<!--renderComp=SwitchView-->
```yaml
label: Tool support views
views:
  - id: table
    label: Table
    icon: table
    component: TableHierarchy
    data: &support
      title: Supported tools
      rowComponent: ListSupportedToolsRow
      columns:
        - id: cli
          label: CLI
          cellComponent: TableCapabilityCell
        - id: api
          label: Web API
          cellComponent: TableCapabilityCell
      rows:
        - label: Create
          cells:
            cli: partial
            api: yes
        - label: Delete
          cells:
            cli: no
            api: yes
  - id: list
    label: List
    icon: list
    component: ListHierarchy
    data: *support
```
````

<!--renderComp=SwitchView-->
```yaml
label: Tool support views
views:
  - id: table
    label: Table
    icon: table
    component: TableHierarchy
    data: &support
      title: Supported tools
      rowComponent: ListSupportedToolsRow
      columns:
        - id: cli
          label: CLI
          cellComponent: TableCapabilityCell
        - id: api
          label: Web API
          cellComponent: TableCapabilityCell
      rows:
        - label: Create
          cells:
            cli: partial
            api: yes
        - label: Delete
          cells:
            cli: no
            api: yes
  - id: list
    label: List
    icon: list
    component: ListHierarchy
    data: *support
```
