---
title: Data Diagrams
description: DiagramER draws nodes and connections on a canvas; DiagramDataverseEntity shows one Dataverse table card; both are edited visually in place
language: en
---

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
Two components share one data model and one card renderer. `DiagramER` draws **nodes** and the **connections** between their **handles** on a pannable, zoomable canvas. `DiagramDataverseEntity` shows a single Dataverse table card in the flow of the document, without a canvas. Both read YAML, and both can be edited visually in place: cells, keys, types, row handles, and node positions.

二つのコンポーネントが、同じデータモデルとカードの描画を共有します。`DiagramER` は、**ノード**と、ノードの**ハンドル**を結ぶ**接続線**を、移動・拡大縮小できるキャンバスに描きます。`DiagramDataverseEntity` は、Dataverse のテーブルカードを一枚、キャンバスなしで文書の流れの中に表示します。どちらも YAML を読み、セル、キー、型、行のハンドル、ノードの位置をその場で視覚的に編集できます。
```

<!--renderComp=DiagramText-->
```text
diagram
├─ nodes          what is drawn, and where
│  ├─ renderer    dataverse-table, dataverse-choice, operator, or a registered component
│  ├─ data        the content the renderer understands (columns, labels ...)
│  ├─ position    { x, y }, or auto for the grid layout
│  └─ handles     named connection points on an anchor (column/<id>, header, body)
├─ connections    lines from one handle to another: { nodeId, handleId } → { nodeId, handleId }
├─ defaults       the layout policy and shared line settings
└─ viewport       canvas size, camera, zoom limits, minimap
```

<!--renderComp=Anchor,id=diagram-er-dataverse-->
<!--renderComp=MultiLang-->
## {en: "Dataverse ER Diagram", jp: "Dataverse ER 図"}

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
A `dataverse-table` node lists its columns as Key, Column, Logical name, and Type. A `dataverse-choice` node draws a global choice with a dashed border and a purple header; a connection to it attaches to its header. A handle is declared on an anchor (`column/<columnId>`), so it stays on its row when rows are reordered or renamed. Hover a column name to read its description. `isPositionLocked` keeps a node in place: the *Order* table below cannot be dragged.

`dataverse-table` ノードは、列を Key、列、論理名、型の順に並べます。`dataverse-choice` ノードはグローバル選択肢を破線の枠と紫のヘッダーで描き、接続線はヘッダーにつながります。ハンドルはアンカー（`column/<columnId>`）に宣言するため、行の並び替えや名前の変更後も同じ行に付いたままです。列名にカーソルを合わせると説明が表示されます。`isPositionLocked` はノードを固定します。下の *Order* テーブルはドラッグできません。
```

<!--renderComp=MultiLang-->
### {en: "Syntax", jp: "構文"}

````markdown
<!--renderComp=DiagramER,title=Orders-->
```yaml
version: 1
viewport:
  size: { height: 520 }
nodes:
  - id: account
    renderer: { type: dataverse-table }
    position: { x: 0, y: 40 }
    data:
      name: Account
      nameLogical: account
      columns:
        - { id: accountid, name: Account, nameLogical: accountid, type: Unique identifier, key: PK, isRequired: true }
        - { id: name, name: Account Name, nameLogical: name, type: Text, isRequired: true }
        - { id: revenue, name: Annual Revenue, nameLogical: revenue, type: Currency }
    handles:
      - { id: accountid-out, direction: out, anchor: { target: column/accountid, side: right } }
  # ... salesorder (locked), salesorderdetail, product, and a dataverse-choice node
connections:
  - id: order-customer
    source: { nodeId: account, handleId: accountid-out }
    target: { nodeId: salesorder, handleId: customerid-in }
    label: { text: customer }
```
````

<!--renderComp=MultiLang-->
### {en: "Display example", jp: "表示例"}

<!--renderComp=DiagramER,title=Orders-->
```yaml
version: 1
viewport:
  size: { height: 520 }
nodes:
  - id: account
    renderer: { type: dataverse-table }
    position: { x: 0, y: 40 }
    data:
      name: Account
      nameLogical: account
      description: A company the organization does business with.
      columns:
        - { id: accountid, name: Account, nameLogical: accountid, type: Unique identifier, key: PK, isRequired: true }
        - { id: name, name: Account Name, nameLogical: name, type: Text, isRequired: true }
        - { id: revenue, name: Annual Revenue, nameLogical: revenue, type: Currency, description: Reported yearly revenue }
    handles:
      - { id: accountid-out, direction: out, anchor: { target: column/accountid, side: right } }
  - id: salesorder
    renderer: { type: dataverse-table }
    position: { x: 520, y: 0 }
    isPositionLocked: true
    data:
      name: Order
      nameLogical: salesorder
      columns:
        - { id: salesorderid, name: Order, nameLogical: salesorderid, type: Unique identifier, key: PK, isRequired: true }
        - { id: customerid, name: Customer, nameLogical: customerid, type: Customer, key: FK, isRequired: true }
        - { id: statuscode, name: Status Reason, nameLogical: statuscode, type: Choice }
        - { id: totalamount, name: Total Amount, nameLogical: totalamount, type: Currency }
    handles:
      - { id: customerid-in, direction: in, anchor: { target: column/customerid, side: left } }
      - { id: salesorderid-out, direction: out, anchor: { target: column/salesorderid, side: right } }
      - { id: statuscode-out, direction: out, anchor: { target: column/statuscode, side: left } }
  - id: salesorderdetail
    renderer: { type: dataverse-table }
    position: { x: 1040, y: 40 }
    data:
      name: Order Product
      nameLogical: salesorderdetail
      columns:
        - { id: salesorderdetailid, name: Order Product, nameLogical: salesorderdetailid, type: Unique identifier, key: PK, isRequired: true }
        - { id: salesorderid, name: Order, nameLogical: salesorderid, type: Lookup, key: FK, isRequired: true }
        - { id: productid, name: Existing Product, nameLogical: productid, type: Lookup, key: FK }
        - { id: quantity, name: Quantity, nameLogical: quantity, type: Decimal Number }
    handles:
      - { id: salesorderid-in, direction: in, anchor: { target: column/salesorderid, side: left } }
      - { id: productid-in, direction: in, anchor: { target: column/productid, side: left } }
  - id: product
    renderer: { type: dataverse-table }
    position: { x: 520, y: 330 }
    data:
      name: Product
      nameLogical: product
      columns:
        - { id: productid, name: Product, nameLogical: productid, type: Unique identifier, key: PK, isRequired: true }
        - { id: name, name: Name, nameLogical: name, type: Text, isRequired: true }
    handles:
      - { id: productid-out, direction: out, anchor: { target: column/productid, side: right } }
  - id: orderstatus
    renderer: { type: dataverse-choice }
    position: { x: 0, y: 330 }
    data:
      name: Order Status
      nameLogical: salesorder_statuscode
      columns:
        - { id: active, name: Active, nameLogical: "1", type: Option }
        - { id: fulfilled, name: Fulfilled, nameLogical: "100001", type: Option }
        - { id: invoiced, name: Invoiced, nameLogical: "100003", type: Option }
    handles:
      - { id: header-in, direction: in, anchor: { target: header, side: right } }
connections:
  - id: order-customer
    source: { nodeId: account, handleId: accountid-out }
    target: { nodeId: salesorder, handleId: customerid-in }
    label: { text: customer }
  - id: detail-order
    source: { nodeId: salesorder, handleId: salesorderid-out }
    target: { nodeId: salesorderdetail, handleId: salesorderid-in }
    label: { text: lines }
  - id: detail-product
    source: { nodeId: product, handleId: productid-out }
    target: { nodeId: salesorderdetail, handleId: productid-in }
  - id: order-status
    source: { nodeId: salesorder, handleId: statuscode-out }
    target: { nodeId: orderstatus, handleId: header-in }
    style: { strokeDasharray: "5 4" }
```

<!--renderComp=Anchor,id=diagram-er-flow-->
<!--renderComp=MultiLang-->
## {en: "Operators, Custom Nodes, and Line Styles", jp: "処理ノード、独自ノード、線のスタイル"}

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
A node is not necessarily a table. `operator` is a built-in step node; `renderer: { component: MigrationStep }` draws a node with a registered component that declares the `visualizationNode` placement and lists its anchors (`input`, `output`). Lines take a `renderer.type` (`smoothstep` by default, `bezier`, `straight`, `step`, or `polyline` with waypoints), and a `style`, `label`, markers, and `isAnimated`. `defaults.connection` sets these for every line; a line overrides them one property at a time.

ノードはテーブルとは限りません。`operator` は組み込みの処理ノードで、`renderer: { component: MigrationStep }` は、`visualizationNode` 配置を宣言し、アンカー（`input`、`output`）を列挙した登録済みコンポーネントでノードを描きます。線には `renderer.type`（既定は `smoothstep`、ほかに `bezier`、`straight`、`step`、経由点付きの `polyline`）、`style`、`label`、矢印、`isAnimated` を指定できます。`defaults.connection` はすべての線の既定値で、各線はプロパティ単位で上書きします。
```

<!--renderComp=DiagramER,title=Customer migration-->
```yaml
version: 1
defaults:
  connection:
    renderer: { type: bezier }
    style: { stroke: "#0f766e", strokeWidth: 1.5 }
viewport:
  size: { height: 440 }
nodes:
  - id: legacy
    renderer: { type: dataverse-table }
    position: { x: 0, y: 30 }
    size: { width: 360 }
    data:
      name: Legacy customer
      nameLogical: tbl_customer
      columns:
        - { id: mail, name: MAIL_ADDR, nameLogical: mail_addr, type: String }
        - { id: tel, name: TEL_NO, nameLogical: tel_no, type: String }
    handles:
      - { id: mail-out, direction: out, anchor: { target: column/mail, side: right } }
      - { id: tel-out, direction: out, anchor: { target: column/tel, side: right } }
  - id: normalize
    renderer: { component: MigrationStep }
    position: { x: 460, y: 0 }
    data:
      label: Normalize email
      operation: trim(lower(x))
      note: Empty strings become null.
    handles:
      - { id: in, direction: in, anchor: { target: input, side: left } }
      - { id: out, direction: out, anchor: { target: output, side: right } }
  - id: phone
    renderer: { type: operator }
    position: { x: 460, y: 190 }
    data:
      label: Format phone number
      description: E.164, country code from the account address.
    handles:
      - { id: in, direction: in, anchor: { side: left } }
      - { id: out, direction: out, anchor: { side: right } }
  - id: contact
    renderer: { type: dataverse-table }
    position: { x: 820, y: 30 }
    size: { width: 380 }
    data:
      name: Contact
      nameLogical: contact
      columns:
        - { id: email, name: Email, nameLogical: emailaddress1, type: Text }
        - { id: phone, name: Business Phone, nameLogical: telephone1, type: Text }
    handles:
      - { id: email-in, direction: in, anchor: { target: column/email, side: left } }
      - { id: phone-in, direction: in, anchor: { target: column/phone, side: left } }
connections:
  - id: mail-normalize
    source: { nodeId: legacy, handleId: mail-out }
    target: { nodeId: normalize, handleId: in }
  - id: normalize-email
    source: { nodeId: normalize, handleId: out }
    target: { nodeId: contact, handleId: email-in }
    label: { text: emailaddress1 }
    isAnimated: true
  - id: tel-phone
    source: { nodeId: legacy, handleId: tel-out }
    target: { nodeId: phone, handleId: in }
    renderer: { type: step }
    style: { stroke: "#b45309", strokeDasharray: "6 4" }
  - id: phone-contact
    source: { nodeId: phone, handleId: out }
    target: { nodeId: contact, handleId: phone-in }
    renderer: { type: smoothstep }
    style: { stroke: "#b45309" }
    markerStart: arrow
```

<!--renderComp=MultiLang,type=list,languages=[en,jp]-->
```markdown
- A registered node component receives `config.visualization` with `nodeId`, `size`, and `anchorRef(anchorId)`; it attaches each declared anchor, and the diagram draws the handles over them. It only draws: moving, connecting, and saving belong to the diagram.
- 登録済みのノードコンポーネントは、`nodeId`、`size`、`anchorRef(anchorId)` を含む `config.visualization` を受け取ります。宣言した各アンカーに ref を付けると、図がその上にハンドルを描きます。コンポーネントは描画のみを担い、移動、接続、保存は図が担います。
- An unknown node type, a component without the `visualizationNode` placement, or a handle on a missing anchor is reported with the node's ID, instead of silently drawing something else.
- 未知のノード型、`visualizationNode` 配置を持たないコンポーネント、存在しないアンカーへのハンドルは、何かを黙って描く代わりに、ノード ID 付きのエラーとして表示します。
```

<!--renderComp=Anchor,id=diagram-er-layout-->
<!--renderComp=MultiLang-->
## {en: "Automatic Layout and Viewport", jp: "自動配置とビューポート"}

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
A node without `position` is placed on a grid, in declaration order, around the nodes that have one. `defaults.layout` sets the number of columns and the gaps. `viewport` sets the canvas size, the zoom limits, and the minimap; `view: auto` fits the diagram after its nodes are measured. Panning, zooming, and dragging while reading never change the document.

`position` のないノードは、位置が指定されたノードを避けながら、宣言順にグリッドへ配置されます。`defaults.layout` で列数と間隔を指定します。`viewport` はキャンバスの大きさ、拡大率の範囲、ミニマップを指定し、`view: auto` はノードの計測後に図全体が収まるように表示します。閲覧中の移動、拡大縮小、ドラッグで文書が変わることはありません。
```

<!--renderComp=DiagramER,title=Automatic grid-->
```yaml
version: 1
defaults:
  layout: { type: grid, columns: 3, gap: { x: 60, y: 50 } }
viewport:
  size: { height: 420 }
  zoom: { min: 0.3, max: 1.6 }
  isMiniMapVisible: true
nodes:
  - id: team
    renderer: { type: dataverse-table }
    data:
      name: Team
      nameLogical: team
      columns:
        - { id: teamid, name: Team, type: Unique identifier, key: PK }
        - { id: name, name: Team Name, type: Text }
  - id: systemuser
    renderer: { type: dataverse-table }
    data:
      name: User
      nameLogical: systemuser
      columns:
        - { id: systemuserid, name: User, type: Unique identifier, key: PK }
        - { id: fullname, name: Full Name, type: Text }
  - id: businessunit
    renderer: { type: dataverse-table }
    data:
      name: Business Unit
      nameLogical: businessunit
      columns:
        - { id: businessunitid, name: Business Unit, type: Unique identifier, key: PK }
        - { id: name, name: Name, type: Text }
  - id: role
    renderer: { type: dataverse-table }
    data:
      name: Security Role
      nameLogical: role
      columns:
        - { id: roleid, name: Role, type: Unique identifier, key: PK }
        - { id: name, name: Name, type: Text }
```

<!--renderComp=Anchor,id=diagram-dataverse-entity-->
<!--renderComp=MultiLang-->
## {en: "Dataverse Table Card", jp: "Dataverse テーブルカード"}

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
`DiagramDataverseEntity` shows one `dataverse-table` node outside a canvas: the same card, without dragging, zooming, or connection lines. The text stays selectable. Handles declared on the node are kept, so the card can later be moved into a diagram unchanged.

`DiagramDataverseEntity` は、`dataverse-table` ノード一つをキャンバスの外に表示します。カードは同じで、ドラッグ、拡大縮小、接続線はありません。文字は選択できます。ノードに宣言したハンドルは保持されるため、後でそのまま図へ移せます。
```

<!--renderComp=MultiLang-->
### {en: "Syntax", jp: "構文"}

````markdown
<!--renderComp=DiagramDataverseEntity-->
```yaml
version: 1
node:
  id: lead
  renderer: { type: dataverse-table }
  data:
    name: Lead
    nameLogical: lead
    columns:
      - { id: leadid, name: Lead, nameLogical: leadid, type: Unique identifier, key: PK, isRequired: true }
      - { id: subject, name: Topic, nameLogical: subject, type: Text, isRequired: true }
```
````

<!--renderComp=MultiLang-->
### {en: "Display example", jp: "表示例"}

<!--renderComp=DiagramDataverseEntity-->
```yaml
version: 1
node:
  id: lead
  renderer: { type: dataverse-table }
  data:
    name: Lead
    nameLogical: lead
    description: A prospect that has not been qualified yet.
    columns:
      - { id: leadid, name: Lead, nameLogical: leadid, type: Unique identifier, key: PK, isRequired: true }
      - { id: subject, name: Topic, nameLogical: subject, type: Text, isRequired: true }
      - { id: companyname, name: Company Name, nameLogical: companyname, type: Text }
      - { id: parentaccountid, name: Parent Account, nameLogical: parentaccountid, type: Lookup, key: FK, description: The account the lead was qualified into }
      - { id: leadqualitycode, name: Rating, nameLogical: leadqualitycode, type: Choice }
```

<!--renderComp=Anchor,id=diagram-er-edit-->
<!--renderComp=MultiLang-->
## {en: "Visual Editing", jp: "視覚的な編集"}

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
In edit mode, both components open in the **Visual** mode from the block's Edit button (a click on the canvas pans or drags instead). The built-in **Source** mode stays available from the mode menu. Every change is a draft of the same YAML, with its comments kept; Save or a click outside the block writes it once, and Cancel discards it.

編集モードでは、どちらのコンポーネントもブロックの編集ボタンから **Visual** モードで開きます（キャンバスのクリックは移動やドラッグになります）。組み込みの **Source** モードもモードメニューから使えます。すべての変更はコメントを保った同じ YAML の下書きで、保存またはブロック外のクリックで一度だけ書き込まれ、キャンセルで破棄されます。
```

<!--renderComp=MultiLang,type=list,languages=[en,jp]-->
```markdown
- Click a cell to type in it; Enter or a click elsewhere ends the cell, and Escape restores it. Key and Type open a menu; Type has a search over the Dataverse column types.
- セルをクリックすると入力できます。Enter または別の場所のクリックで確定し、Escape で元に戻します。Key と Type はメニューを開き、Type では Dataverse の列の型を検索できます。
- Selecting a row or a table header opens its settings beside it: names, description, required, and the row's handles (none, left, right, or both). A handle that a connection uses cannot be removed, only moved to the other side; its ID and connections are kept.
- 行またはテーブルのヘッダーを選択すると、その横に設定が開きます。名前、説明、必須、行のハンドル（なし、左、右、両方）を変更できます。接続線が使っているハンドルは削除できず、反対側へ移すことだけができます。ID と接続線は保たれます。
- In a diagram, the table settings remember the node's current position, or lock it so it cannot be dragged in either mode. The camera is kept when the block saves.
- 図では、テーブルの設定で現在のノード位置を記憶したり、どちらのモードでもドラッグできないように固定したりできます。保存してもカメラの位置は保たれます。
- Escape steps out of a cell, then out of the selection; it never ends the session. Ctrl/⌘ + Enter saves.
- Escape はセルから、次に選択から一段ずつ抜けます。セッションを終了することはありません。Ctrl/⌘ + Enter で保存します。
```

<!--renderComp=MultiLang-->
### {en: "Data in the asset service layer", jp: "アセットサービス層のデータ"}

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
The examples above are inline: a save rewrites the block. The two blocks below are references into the [asset service layer](../asset-store.md). Their Visual mode edits the referenced object, at its head version and while it is not locked, and a save writes a version of the object without touching the document. **Save to → Inline YAML** writes the draft into the block in place of the reference instead, and leaves the object as it was.

ここまでの例はインラインで、保存するとブロックが書き換わります。下の二つのブロックは[アセットサービス層](../asset-store.md)への参照です。Visual モードは参照先のオブジェクトを、最新版でロックされていない場合に限り編集し、保存すると文書には触れずにオブジェクトのバージョンを書き込みます。**Save to → Inline YAML** を選ぶと、下書きを参照の代わりにブロックへ書き込み、オブジェクトはそのまま残ります。
```

<!--renderComp=DiagramER,title=Support cases-->
```asset
store: local
name: support case diagram
```

<!--renderComp=DiagramDataverseEntity-->
```asset
store: local
name: contact table
```

<!--renderComp=Anchor,id=diagram-er-legacy-->
<!--renderComp=MultiLang-->
## {en: "Earlier Grammar", jp: "以前の記法"}

<!--renderComp=MultiLang,type=paragraphs,languages=[en,jp]-->
```markdown
Diagrams written with `tables` and `relationships`, and cards written with `entity`, are still read: they are converted in memory, keeping table positions, choice cards (`kind: choice`), and relationship labels. Reading never rewrites the document; the first save from the Visual mode writes the `version: 1` form.

`tables` と `relationships` で書かれた図、`entity` で書かれたカードも引き続き読めます。テーブルの位置、選択肢カード（`kind: choice`）、リレーションのラベルを保ったまま、メモリー上で変換します。読み込みで文書が書き換わることはなく、Visual モードで最初に保存したときに `version: 1` の形式で書き込まれます。
```

<!--renderComp=DiagramER,title=Orders (earlier grammar),height=380-->
```yaml
tables:
  - id: customer
    name: customer
    nameLogical: Customer
    columns:
      - { id: id, name: id, type: uuid, key: PK }
      - { id: name, name: name, type: text }
  - id: order
    name: order
    nameLogical: Order
    columns:
      - { id: id, name: id, type: uuid, key: PK }
      - { id: customerId, name: customer_id, type: uuid, key: FK }
relationships:
  - id: orderCustomer
    label: places
    source: { tableId: customer, columnId: id }
    target: { tableId: order, columnId: customerId }
```
