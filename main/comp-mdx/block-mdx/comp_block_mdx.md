# BlockMdx

`BlockMdx` は、見出し付きパネルの中で Markdown をもう一度コンパイルして表示する再利用可能な資料コンポーネントです。関連資料の階層、説明付きリスト、表など、一つの隣接 AST ノードだけでは表せない内容をパネル化するために使用します。

## 記述形式

コメントマーカーの直後に、パネル内部で描画する Markdown を fenced code block として記述します。

````markdown
<!--renderComp=BlockMdx,title=関連資料-->
```markdown
### ページ A

- [UI エリア](./area.md)
  - [UI コンポーネント](./component.md)

### ページ B

| 分類 | 資料 |
| --- | --- |
| 詳細 | [詳細設計](./detail.md) |
```
````

通常の Markdown ビューアーでは fenced code block として表示され、専用のドキュメント画面ではコードブロックの内容がパネル内の Markdown として表示されます。

## 入力

| 値 | 既定値 | 説明 |
| --- | --- | --- |
| `title` | `関連資料` | パネル上部のタイトル。空文字ならタイトル行を表示しない |
| `tone` | `default` | `default`、`info`、`warning` の表示色 |
| `titleComponent` | なし | タイトルの前に表示する登録コンポーネント名 |
| `titleComponentProps` | `{}` | `titleComponent` へ渡す値。MDX ではオブジェクト、コメントマーカーではインライン YAML マッピング |
| `backgroundColorTitle` | 表示色の既定値 | タイトル行の背景色 |
| `backgroundColorContent` | 表示色の既定値 | 本文の背景色 |
| `isContentSanitized` | `false` | `true` の場合、本文中の手書き HTML と JSX を除去する |
| fenced block | 空 | 二次コンパイルする Markdown ソース |

```markdown
<!--renderComp=BlockMdx,title=よくある質問,titleComponent=FaqIcon,titleComponentProps={label: "Q&A", color: "#0f766e"},backgroundColorTitle=#e6f4f1-->
```

コメントマーカーの値は `[...]` と `{...}` の内側のカンマで区切られないため、リストとインラインマッピングをそのまま書けます。

`titleComponent` は `RegisteredComp` によって配置 `blockTitle` で描画され、`instanceId` と親資料の `sourcePath` を受け取ります。表示領域は 1.25rem 四方に制限されます。タイトル行用のコンポーネントは、定義の `placementList` に `blockTitle` を含めます。

色を指定しない場合は `tone` の色が使われます。指定値は CSS 変数 `--doc-block-title-background`、`--doc-block-content-background` としてパネルへ設定されます。

`BlockMdx` は comment-block 配置で使用します。互換エントリの `Block` を `markdown` fenced blockへ付けた場合も、自動的に `BlockMdx` が選択されます。`variant=mdx` でも明示できます。

## リンク処理

二次コンパイル時にも、通常の資料本文と同じ `DocLink` を使用します。次の記法は、親資料のパスを起点に解決されます。

- 通常の Markdown リンク: `[資料](./document.md)`
- 資料名を示すインラインコード: `` `document.md` ``
- Wiki 形式: `[[document.md]]`
- ソース表示リンク: `[設定](/root/setup.ps1 "inline-link")`、`"inline-link:source"`、`"inline-link:render"`

内部リンクは資料マニフェストとサイドパネルに対して解決されるため、通常本文と同じナビゲーション、候補選択、リンク切れ、サイドパネル外資料の警告、現在地判定を使用します。`inline-link` 系のリンクは本文と同じ `SourceLink` として表示され、ホストの `panelComponent` を受け取ります。外部 URL と `#fragment` だけのリンクは通常のアンカーとして残します。

この処理は `BlockMdx` 独自の変換ではなく、パッケージ共通の `MdxRenderer`（`lib/markdown-render.js`）が行います。本文と同じ `remarkDocLink` と、本文と同じコンポーネント対応表 `buildMdxComps()` を使用するため、リンク解決規則が二重化されません。数式（`$...$`、`$$...$$`）も本文と同じく表示されます。

## コンパイルと安全範囲

1. 外側の資料コンパイルがコメントマーカーと直後の fenced block を `BlockMdx` へ渡します。
2. `BlockMdx` が fenced block の raw 内容を `MdxRenderer` へ渡します。
3. `MdxRenderer` が共通のリンク変換と追加の remark プラグインを含めて内容を二次コンパイルします。
4. 生成された `DocLink` と `SourceLink` が親資料の `sourcePath` を使ってリンクを解決します。

JavaScript 式、import、export は無効です。通常の Markdown 構造と安全な静的 MDX 要素は使用できますが、資料コンポーネントの再帰的な埋め込みは対象外です。内側の `<!--renderComp=...-->` コメントは除去され、別の登録コンポーネントとして実行されません。`isContentSanitized=true` の場合は手書きの HTML と JSX も除去し、リンク変換が生成した要素だけを残します。

`pruneSourceToSidePanel` を使う配布ビルドでは、本文中のリンク先が自動的にマニフェストへ残ります（[Source pruning for deployment](../../doc_page_impl.md#source-pruning-for-deployment)）。

内側に fenced code block を含める場合は、外側の囲いを四つ以上のバッククォートにして、内側の囲いより長くしてください。

## 実装

- `comp-mdx/block-mdx/BlockMdx.jsx`: パネル、タイトル、タイトル用コンポーネント、二次 `MdxRenderer` の構成
- `comp-mdx/block-mdx/BlockMdxData.js`: タイトル用コンポーネントの値、背景色、サニタイズ指定の正規化
- `comp-mdx/block-mdx/BlockMdx.css`: パネルと内部 Markdown の表示
- `comp-mdx/block-simple/Block.jsx`: 単純ブロックと Markdown ブロックの互換エントリ
- 登録側の `compById`: `MdxRenderer` の注入
- `comp-doc/registry/registry-source-dependency.js`: 配布ビルド時に本文のリンク先を収集する抽出関数

## 保守上の注意

- 親資料から渡される `config.sourcePath` を失うと、相対リンクの解決元がなくなります。
- `remarkPlugins` は React の再描画ごとに新しい配列を作らず、`useMemo` で安定させます。配列が毎回変わると不要な再コンパイルが発生します。
- リンク認識は `lib/doc-link-classify.js` と `remarkDocLink` の一か所で変更します。`BlockMdx` 側に独自の認識を追加しません。
- 内部 Markdown の余白は本文より小さく、見出しは上の余白を下の余白より大きくして、続く内容に近づけます。
- 大きな本文を多数ネストするとブラウザー内コンパイルが増えるため、パネルは関連資料や短い補足など、まとまった小規模コンテンツに使用します。
