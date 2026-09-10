# Block / BlockSimple

`BlockSimple` は、Markdown の引用ブロックを強調表示する再利用可能な資料コンポーネントです。GitHub Markdown Alert の種別行は表示内容から除去します。

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
| `type` / `tone` | `info` | `info`、`warning`、`caution` などの表示種別 |
| `variant` | 自動判定 | `Block` 使用時に `simple` または `mdx` を明示 |
| 引用ブロック | 空 | 表示する Markdown |

登録ホストは `config.MdxRenderer` を注入します。これにより、コンポーネント本体は特定アプリケーションの UI エントリへ依存しません。
