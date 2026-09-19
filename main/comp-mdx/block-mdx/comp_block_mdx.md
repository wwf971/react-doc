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
| fenced block | 空 | 二次コンパイルする Markdown ソース |

`BlockMdx` は comment-block 配置で使用します。互換エントリの `Block` を `markdown` fenced blockへ付けた場合も、自動的に `BlockMdx` が選択されます。`variant=mdx` でも明示できます。

## リンク処理

二次コンパイル時にも、通常の資料本文と同じ `DocLink` を使用します。次の記法は、親資料のパスを起点に解決されます。

- 通常の Markdown リンク: `[資料](./document.md)`
- 資料名を示すインラインコード: `` `document.md` ``
- Wiki 形式: `[[document.md]]`

内部リンクは資料マニフェストとサイドパネルに対して解決されるため、通常本文と同じナビゲーション、候補選択、リンク切れ、サイドパネル外資料の警告、現在地判定を使用します。外部 URL と `#fragment` だけのリンクは通常のアンカーとして残します。

この処理は `BlockMdx` 専用の remark 変換で MDX AST を `DocLink` 要素へ変換し、登録ホストから渡された `MdxRenderer` と `DocLink` を使用して実現します。単純なクリックハンドラーで URL を書き換えないため、リンク解決規則が二重化されません。

## コンパイルと安全範囲

1. 外側の資料コンパイルがコメントマーカーと直後の fenced block を `BlockMdx` へ渡します。
2. `BlockMdx` が fenced block の raw 内容を `MdxRenderer` へ渡します。
3. `MdxRenderer` が追加の remark プラグインを含めて内容を二次コンパイルします。
4. 生成された `DocLink` が親資料の `sourcePath` を使ってリンクを解決します。

JavaScript 式、import、export は無効です。通常の Markdown 構造と安全な静的 MDX 要素は使用できますが、資料コンポーネントの再帰的な埋め込みは対象外です。内側の `<!--renderComp=...-->` コメントは除去され、別の登録コンポーネントとして実行されません。

内側に fenced code block を含める場合は、外側の囲いを四つ以上のバッククォートにして、内側の囲いより長くしてください。

## 実装

- `comp-mdx/block-mdx/BlockMdx.jsx`: パネル、タイトル、二次 `MdxRenderer` の構成
- `comp-mdx/block-mdx/BlockMdx.css`: パネルと内部 Markdown の表示
- `comp-mdx/block-mdx/remarkBlockMdxDocLink.js`: 通常本文と同じ三種類の資料リンク認識
- `comp-mdx/block-simple/Block.jsx`: 単純ブロックと Markdown ブロックの互換エントリ
- 登録側の `compById`: `MdxRenderer` と `DocLink` の注入

## 保守上の注意

- 親資料から渡される `config.sourcePath` を失うと、相対リンクの解決元がなくなります。
- `remarkPlugins` は React の再描画ごとに新しい配列を作らず、`useMemo` で安定させます。配列が毎回変わると不要な再コンパイルが発生します。
- リンク認識を変更する場合は、通常本文側の認識規則との差を確認します。
- 大きな本文を多数ネストするとブラウザー内コンパイルが増えるため、パネルは関連資料や短い補足など、まとまった小規模コンテンツに使用します。
