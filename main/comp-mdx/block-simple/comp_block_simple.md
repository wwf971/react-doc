# Block / BlockSimple

`BlockSimple` は、Markdown の引用ブロックを強調表示する再利用可能な資料コンポーネントです。GitHub Markdown Alert の種別行は表示内容から除去します。

単純ブロックには表示種別を大文字にしたタイトルが付きます。`title` で変更でき、`isTitleHidden=true` を明示した場合だけ非表示になります。

`Block` は互換エントリです。引用ブロックでは `BlockSimple`、`markdown` または `mdx` fenced block では `BlockMdx` を自動選択します。`variant=simple` または `variant=mdx` で明示することもできます。著者は `BlockSimple` と `BlockMdx` を直接指定できます。

## 単純ブロック

```markdown
<!--renderComp=BlockSimple,type=warning-->
> [!CAUTION]
> この操作を実行する前に、変更内容を確認してください。
```

従来どおり `renderComp=Block` と書いた場合も、引用ブロックなので単純ブロックとして表示されます。

## 入力

| 値 | 既定値 | 説明 |
| --- | --- | --- |
| `type` / `tone` | `info` | `info`、`note`、`tip`、`important`、`success`、`warning`、`caution`、`error` の表示種別 |
| `title` | 表示種別の大文字表記 | タイトルを変更 |
| `isTitleHidden` | `false` | `true` の場合だけタイトルを非表示 |
| `isCopyEnabled` | `false` | `true` の場合だけ、タイトル行の右端に本文のコピーボタンを表示 |
| `variant` | 自動判定 | `Block` 使用時に `simple` または `mdx` を明示 |
| 引用ブロック | 空 | 表示する Markdown |

登録ホストは `config.MdxRenderer` を注入します。これにより、コンポーネント本体は特定アプリケーションの UI エントリへ依存しません。本文は共通の `MdxRenderer` で表示されるため、リンク、`inline-link`、数式は通常本文と同じく扱われます。

## コピー

```markdown
<!--renderComp=BlockSimple,type=tip,isCopyEnabled=true-->
> [!TIP]
> `pnpm install` を実行してから `pnpm build` を実行します。
```

コピーされる値は表示される本文の Markdown ソースです。引用記号と Alert の種別行を除き、前後の空白を取り除いた値で、表示用の HTML ではありません。

コピー操作はまず `onEvent('copyRequest', { text })` を送ります。ホストが `{ isHandled: true }` を返した場合はそれで終わり、そうでなければ `navigator.clipboard.writeText()` を使用します。ボタンの状態（成功、失敗）は `BlockSimpleStore` が持ち、短時間で元に戻ります。タイトルを非表示にした場合、コピーボタンも表示されません。
