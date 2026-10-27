---
title: Power Platform Design Diagrams
description: DiagramPowerAutomate and DiagramBusinessRule draw the design of a flow and of a business rule with the ER diagram's graph, cards and visual editing
language: en
---

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
`DiagramPowerAutomate` and `DiagramBusinessRule` are the [ER diagram](comp-diagram-er.md) with another starting block: the same `version: 1` graph of **nodes**, **handles** and **connections**, the same canvas, the same Visual and Source modes. What differs is the node renderer: a `power-automate` card is a step of a flow (trigger, action, condition, scope, loop, terminate), a `business-rule` card is a condition or an action of a Dataverse business rule. One diagram may mix them with Dataverse tables and choices. These are **design documents**: nothing here is executed or deployed, and the order of steps is what the labeled connections say, not where the cards are placed.

`DiagramPowerAutomate` と `DiagramBusinessRule` は、開始ブロックが異なるだけの [ER 図](comp-diagram-er.md)です。**ノード**、**ハンドル**、**接続線**からなる同じ `version: 1` のグラフ、同じキャンバス、同じ Visual / Source モードを使います。違うのはノードの描画で、`power-automate` カードはフローのステップ（トリガー、アクション、条件、スコープ、ループ、終了）、`business-rule` カードは Dataverse ビジネスルールの条件またはアクションです。一つの図に Dataverse のテーブルや選択肢と混在できます。これらは**設計書**であり、実行もデプロイもされません。ステップの順序はラベル付きの接続線が示すもので、カードの配置ではありません。
```

<!--renderComp=DiagramText-->
```text
node of a design diagram
├─ renderer: { type: power-automate | business-rule }
├─ data
│  ├─ name, kind                 the card's title and what the step is
│  ├─ connector, operation, …    the fields of the resource (below)
│  ├─ expression / description   multiline text
│  └─ properties                 rows of { id, name, value, description? }, all text
└─ handles                       on the anchors header, body, property/<id>
```

<!--renderComp=Anchor,id=powerplatform-flow-->
<!--renderComp=MultiLang-->
## {en: "A Power Automate Flow", jp: "Power Automate のフロー"}

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
A `power-automate` node has `name`, `kind` (`trigger`, `action`, `condition`, `scope`, `loop`, `terminate`), `connector`, `operation`, `expression`, `description` and its `properties`. A card shows the fields under its title and the properties as rows; a connection attaches to the card's header or to a property row. Branches are labeled on the connections (`Yes` / `No`), and a run-after condition is written the same way: as a label, not inferred from positions.

`power-automate` ノードは `name`、`kind`（`trigger`、`action`、`condition`、`scope`、`loop`、`terminate`）、`connector`、`operation`、`expression`、`description` と `properties` を持ちます。カードはタイトルの下にフィールドを、プロパティを行として表示します。接続線はカードのヘッダーまたはプロパティ行につながります。分岐は接続線のラベル（`Yes` / `No`）で表し、実行条件（run after）も同じくラベルとして書きます。配置から推測されることはありません。
```

<!--renderComp=MultiLang-->
### {en: "Syntax", jp: "構文"}

````markdown
<!--renderComp=DiagramPowerAutomate,title=Credit limit approval-->
```yaml
version: 1
viewport:
  size: { height: 520 }
nodes:
  - id: trigger
    renderer: { type: power-automate }
    data:
      name: Account updated
      kind: trigger
      connector: Microsoft Dataverse
      operation: When a row is added, modified or deleted
      properties:
        - { id: table, name: Table, value: account }
        - { id: filter, name: Filter columns, value: creditlimit }
    handles:
      - { id: out, direction: out, anchor: { target: header, side: right } }
  # ... condition, approval, finish
connections:
  - id: yes
    source: { nodeId: condition, handleId: out }
    target: { nodeId: approval, handleId: in }
    label: { text: "Yes" }
```
````

<!--renderComp=MultiLang-->
### {en: "Display example", jp: "表示例"}

<!--renderComp=DiagramPowerAutomate,title=Credit limit approval-->
```yaml
version: 1
viewport:
  size: { height: 560 }
nodes:
  - id: trigger
    renderer: { type: power-automate }
    data:
      name: Account updated
      kind: trigger
      connector: Microsoft Dataverse
      operation: When a row is added, modified or deleted
      properties:
        - { id: table, name: Table, value: account }
        - { id: filter, name: Filter columns, value: creditlimit }
    handles:
      - { id: in, direction: in, anchor: { target: header, side: left } }
      - { id: out, direction: out, anchor: { target: header, side: right } }
  - id: condition
    renderer: { type: power-automate }
    data:
      name: Approval required?
      kind: condition
      expression: "@greater(triggerOutputs()?['body/creditlimit'], 10000)"
      properties: []
    handles:
      - { id: in, direction: in, anchor: { target: header, side: left } }
      - { id: out, direction: out, anchor: { target: header, side: right } }
  - id: approval
    renderer: { type: power-automate }
    data:
      name: Request approval
      kind: action
      connector: Approvals
      operation: Start and wait for an approval
      properties:
        - { id: type, name: Approval type, value: Approve/Reject - First to respond }
        - { id: owner, name: Assigned to, value: "Environment variable: approver" }
    handles:
      - { id: in, direction: in, anchor: { target: header, side: left } }
      - { id: out, direction: out, anchor: { target: header, side: right } }
  - id: finish
    renderer: { type: power-automate }
    data:
      name: No approval needed
      kind: terminate
      operation: Terminate
      properties:
        - { id: status, name: Status, value: Succeeded }
    handles:
      - { id: in, direction: in, anchor: { target: header, side: left } }
      - { id: out, direction: out, anchor: { target: header, side: right } }
connections:
  - id: start
    source: { nodeId: trigger, handleId: out }
    target: { nodeId: condition, handleId: in }
    label: { text: Succeeded }
  - id: yes
    source: { nodeId: condition, handleId: out }
    target: { nodeId: approval, handleId: in }
    label: { text: "Yes" }
  - id: no
    source: { nodeId: condition, handleId: out }
    target: { nodeId: finish, handleId: in }
    label: { text: "No" }
```

<!--renderComp=Anchor,id=powerplatform-business-rule-->
<!--renderComp=MultiLang-->
## {en: "A Dataverse Business Rule", jp: "Dataverse のビジネスルール"}

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
A `business-rule` node has `name`, `kind` (`condition` or `action`), `table`, `scope` (`Entity`, `All Forms`, `Specific Form`), `action` (`setValue`, `setRequired`, `setVisibility`, `setEnabled`, `showError`, `recommendation`; empty for a condition), `expression`, `description` and `properties`. The condition's true and false branches are the labeled connections to its actions; what an action changes (the column, the value) is written in its properties.

`business-rule` ノードは `name`、`kind`（`condition` または `action`）、`table`、`scope`（`Entity`、`All Forms`、`Specific Form`）、`action`（`setValue`、`setRequired`、`setVisibility`、`setEnabled`、`showError`、`recommendation`。条件では空）、`expression`、`description` と `properties` を持ちます。条件の真偽の分岐は、アクションへのラベル付き接続線です。アクションが変えるもの（列、値）はプロパティに書きます。
```

<!--renderComp=DiagramBusinessRule,title=Telephone required for company accounts-->
```yaml
version: 1
viewport:
  size: { height: 420 }
nodes:
  - id: condition
    renderer: { type: business-rule }
    data:
      name: Company account?
      kind: condition
      table: account
      scope: All Forms
      expression: customertypecode = 1
      properties: []
    handles:
      - { id: in, direction: in, anchor: { target: header, side: left } }
      - { id: out, direction: out, anchor: { target: header, side: right } }
  - id: required
    renderer: { type: business-rule }
    data:
      name: Require telephone
      kind: action
      table: account
      scope: All Forms
      action: setRequired
      properties:
        - { id: column, name: Column, value: telephone1 }
        - { id: required, name: Required, value: Business Required }
    handles:
      - { id: in, direction: in, anchor: { target: header, side: left } }
      - { id: out, direction: out, anchor: { target: header, side: right } }
  - id: optional
    renderer: { type: business-rule }
    data:
      name: Telephone optional
      kind: action
      table: account
      scope: All Forms
      action: setRequired
      properties:
        - { id: column, name: Column, value: telephone1 }
        - { id: required, name: Required, value: Not Business Required }
    handles:
      - { id: in, direction: in, anchor: { target: header, side: left } }
      - { id: out, direction: out, anchor: { target: header, side: right } }
connections:
  - id: required
    source: { nodeId: condition, handleId: out }
    target: { nodeId: required, handleId: in }
    label: { text: "True" }
  - id: optional
    source: { nodeId: condition, handleId: out }
    target: { nodeId: optional, handleId: in }
    label: { text: "False" }
```

<!--renderComp=Anchor,id=powerplatform-edit-->
<!--renderComp=MultiLang-->
## {en: "Visual Editing", jp: "視覚的な編集"}

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
The **Visual** mode is the one of the ER diagram ([Visual Editing](comp-diagram-er.md#diagram-er-edit)): click a field or a property cell to type in it, a fixed-choice field (`kind`, `scope`, `action`) opens a menu, and selecting a card opens its settings beside it. The settings of a resource card add **Add property**, **Remove property** and **Remove node**; the floating bar adds **Add node** (a flow step or a business rule), **Add connection**, and a **Connections** menu that opens a connection's settings: its label and its two endpoints. A node or a property that a connection still uses cannot be removed. Custom handles, line styles and the other fields of the graph are edited in the **Source** mode. A block whose data is an asset object is edited the same way at the object's head ([Data in the asset service layer](comp-diagram-er.md#diagram-er-edit)).

**Visual** モードは ER 図のもの（[視覚的な編集](comp-diagram-er.md#diagram-er-edit)）と同じです。フィールドやプロパティのセルをクリックして入力し、固定の選択肢を持つフィールド（`kind`、`scope`、`action`）はメニューを開き、カードを選択するとその横に設定が開きます。リソースカードの設定には **Add property**、**Remove property**、**Remove node** が、フローティングバーには **Add node**（フローのステップまたはビジネスルール）、**Add connection**、そして接続線の設定（ラベルと両端）を開く **Connections** メニューが加わります。接続線が使っているノードやプロパティは削除できません。独自のハンドル、線のスタイル、グラフのその他のフィールドは **Source** モードで編集します。データがアセットオブジェクトのブロックも、オブジェクトの最新版に対して同じように編集できます（[アセットサービス層のデータ](comp-diagram-er.md#diagram-er-edit)）。
```

<!--renderComp=MultiLang,type=list,languages=[en,jp]-->
```markdown
- Every value is text: quote a value that looks like a number or a boolean (`"10000"`, `"true"`), so YAML keeps it as written.
- 値はすべてテキストです。数値や真偽値に見える値（`"10000"`、`"true"`）は引用符で囲み、YAML が書いたとおりに保つようにします。
- Unknown keys of a node's data are kept; an unsupported `kind`, `scope` or `action`, and a duplicate property id, are refused with the reason.
- ノードのデータにある未知のキーは保たれます。対応していない `kind`、`scope`、`action`、重複するプロパティ id は、理由とともに拒否されます。
- Start a new block from the insert menu: *Power Automate flow* and *Business rule* each start with a small complete example.
- 新しいブロックは挿入メニューから始められます。*Power Automate flow* と *Business rule* は、それぞれ小さな完全な例から始まります。
```
