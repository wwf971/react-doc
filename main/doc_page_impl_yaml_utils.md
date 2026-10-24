# YAML Utilities: Editing a YAML File in Place

The page writes into yaml files it did not author: side-panel files, the config files of a doc page. This document is the reference for every such write: the principles, the utilities that implement them (`frontend/plugin/doc-yaml-edit.ts` on top of the line operations of `frontend/plugin/doc-edit-lines.ts`), and where they are used. A new write into a yaml file is built with these utilities, and a utility that is missing is added to `doc-yaml-edit.ts`, general, not inside the feature that needs it.

## Principles of a write

**A yaml file is never written by serializing its parsed object.** Parsing a file, changing the object and writing `stringify(object)` back looks simple, and it destroys what the author wrote around the value:

- *comments* are gone (a plain object has no place for them; even a `Document` of `yaml` keeps them only approximately, attached to neighbor nodes, and moves them when nodes move);
- *order and layout* are rewritten: blank lines between items disappear, keys and items are written in the order and the indentation of the serializer, not of the file (`tree:` followed by `- doc: a` at column 0 becomes `  - doc: a`, or the reverse);
- *styles* are normalized: quoting (`'a'`, `"a"`, `a`), line-break styles of strings (`|`, `>`, a plain scalar folded over two lines), flow versus block collections (`[a, b]` versus a list over lines), `~` versus `null`, anchors and aliases, number formats (`0x10`, `1e3`);
- *the diff* covers the whole file, so the author cannot see what the page changed, and a merge with their own change in the file conflicts everywhere.

The file belongs to its author; the page changes one value or moves one block of lines, and everything else must stay byte for byte as it was.

**Parse to find, edit lines and characters to write.** `parseDocument` of `yaml` keeps the character range of every node (`node.range`: start, end of the value, end of the node with its trailing comment and line break). A write therefore:

1. parses the current text, only to locate the nodes it concerns (a scalar, a key, a list item) and to check what is there;
2. turns the ranges into line numbers and columns of the source (`lineIndexOfOffset`, `nodeColumnGet`, …);
3. builds one or a few line operations (`replaceLines`, `insertLines`, `deleteLines`) whose new text is written as yaml on its own: a scalar quoted only when needed (`yamlScalarTextBuild`), inserted lines indented the way the file indents (`yamlSeqIndentOffsetGet`, the indentation of the neighbor keys), moved lines shifted to the column of their new list (`yamlLinesIndentShift`);
4. applies them to the text; what is not in an operation is not touched, including the line ending of the file and its trailing newline.

What precedes a value on its line (the key, the `- `) and what follows it (a trailing `# comment`) is kept: a line is rebuilt around the new text, never retyped. Comments that belong to a list item (the comment lines right above its `-`, the comment lines inside its body) move with the item.

**Refuse what cannot be edited by lines, and say why.** A value written in flow form (`{ a: 1 }`, `[a, b]` as a list to insert into or remove from) has no lines of its own; it is refused with a message asking to write it over several lines, rather than re-serialized. So is a file that does not parse, a key path through something that is not a mapping, a place that does not exist. Every builder answers `{ code, data, message }` (code 0 success, -1 refused with the reason).

**Check before, verify after, keep the previous file.**

- *the base*: a write names what it was built from. The browser sends the hash of the file it read (`textHashGet`, sha1) or the value it edited (`textBase`, `valueBase`); a file or value that changed meanwhile is refused with code -2 and nothing is written.
- *the result*: the new text is parsed again; a result that does not parse, or no longer has the shape the feature needs, is refused instead of written. After the write the configuration is loaded once; when it does not load, the files are written back.
- *the backup*: the server copies the current file to `{file}.bak` beside it before writing (`fileWriteWithBackup` in `doc-edit-server.ts`); backups are ignored by git and never read as configuration.

**Pure builders, one writer.** The utilities take text and return operations or text; they read no file and write none, so the server and tests use the same functions. Only `doc-edit-server.ts` reads and writes files.

## Line operations: `doc-edit-lines.ts`

The format every write ends in, shared with the edit of documents ([Edit api and line operations](doc_page_impl_edit.md#edit-api-and-line-operations)). Lines are 1-based and inclusive.

```ts
type LineOperation =
  | { action: 'replaceLines'; lineStart: number; lineEnd: number; text: string }
  | { action: 'insertLines'; lineAt: number; text: string }    // before line lineAt; lineCount + 1 appends
  | { action: 'deleteLines'; lineStart: number; lineEnd: number }
  | { action: 'replaceAll'; text: string };                    // documents only, never for yaml
```

The `text` of `replaceLines` / `insertLines` is lines separated by `"\n"`: `"a\n"` is the two lines `a` and an empty one, `""` is no line.

| function | does |
| --- | --- |
| `lineOperationApply(text, operation)` | applies one operation |
| `lineOperationListApply(text, operationList)` | applies several operations built against the same text |
| `operationLineListGet(text)` / `textLineListGet(text)` | the lines of an operation text / of a file (a trailing newline ends the last line) |
| `textHashGet(text)` | sha1 of a version of a file, the base a write is checked against |
| `lineOperationIsValid(value)` | checks an operation received over http |

`lineOperationListApply` is what makes several changes to one file simple: every operation is in the line numbers of the *original* text, so a builder never shifts the numbers of its second change for its first. Ranges must not overlap and an insertion point must not lie inside a range; insertions at the same line keep the order of the list. `replaceAll` is not accepted there.

```ts
// remove item 2 of a list and insert it at the end of another list of the same file:
// both operations are built from `source`, then applied together
const text = lineOperationListApply(source, [...removal.operationList, ...insertion.operationList]);
```

## Yaml operations: `doc-yaml-edit.ts`

All functions are pure. The ones that can refuse answer `{ code, data, message }` (`YamlValueSetResult`, `YamlEditResult<T>`); the others return a `LineOperation` or a value.

### Writing a value as yaml text

| function | does |
| --- | --- |
| `yamlScalarTextBuild(text)` | one string as a yaml scalar on one line: plain when yaml writes it plain, quoted otherwise (`a: b`, `- x`, `12`, a leading space); never folded |
| `yamlValueTextBuild(value)` | a config value as one line: null, boolean, number, string, or a list of strings as a flow list `[a, b]`; `undefined` for what cannot be written that way (an object, a nested list) |

### Positions in the source

| function | does |
| --- | --- |
| `lineIndexOfOffset(source, offset)` | 0-based line holding a character offset |
| `lineOffsetGet(source, lineIndex)` | offset of the start of a 0-based line |
| `nodeEndOffsetGet(source, node)` | offset right after the last character of a node's text (a block scalar or collection steps back onto its last line) |
| `nodeColumnGet(source, node)` | the column a node starts at |
| `lineAtAfterNodeGet(source, node)` | 1-based line right after a node: where lines that follow it are inserted |

### A value: one scalar or one key

| function | does |
| --- | --- |
| `nodeReplaceBuild(source, node, text)` | `replaceLines` over the lines of a node: what precedes it on its first line + `text` + what follows it on its last line (a trailing comment). a value over several lines becomes one line |
| `linesInsertBuild(lineAt, lineList)` | `insertLines` of ready lines (already indented) before line `lineAt` |
| `keyLineValueSetBuild(source, keyNode, valueText)` | the line of `key: value` with another value on it, or none (`''`), keeping the key and a trailing comment: `children:` gets `[]`, `children: []` loses it. a block value below the key is not touched |
| `yamlValueSetOperationBuild(source, keyPath, valueText)` | the one operation that gives `keyPath` the value: an existing scalar or list is rebuilt in place; a missing key is a new line at the end of its mapping, with the missing mappings on the way, indented like the file. a number in `keyPath` steps into an existing item of a block list (`['config', 1, 'Key']`); items are never added. refused: a file that does not parse or is not a block mapping, a path through a flow mapping, a flow list or a non-mapping, a missing list item, a key holding a mapping |
| `yamlValueGet(source, keyPath)` | the value at `keyPath` as plain data (`undefined` when absent or the file does not parse), for the base check |

```ts
// replace a label, keeping "text:" and a trailing comment
const scalar = document.getIn(['sidePanelById', 'main', 'tree', 2, 'text'], true);
const operation = nodeReplaceBuild(source, scalar, yamlScalarTextBuild('New name'));

// set a config value, adding the key (and its parent mappings) when missing
const valueText = yamlValueTextBuild(['a', 'b']);         // "[a, b]"
const result = yamlValueSetOperationBuild(source, ['compConfig', 'Image', 'sizeList'], valueText);
if (result.code !== 0) return result;                       // refused, with the reason
const textNext = lineOperationApply(source, result.data.operation);
```

### An item of a block list: moving a block of yaml

The lines of an item are those from its `-` to the end of its value, with the comment lines right above the `-` at its column and the comment lines right after the value indented deeper than the `-`. A blank line ends either run: it separates items and belongs to none.

```yaml
  # about a            <- lines of item a
  - doc: a.md          <-
    text: A            <-
    # inside a         <-

  - doc: b.md
```

| function | does |
| --- | --- |
| `yamlSeqItemLinesGet(source, seq, index)` | `{ lineStart, lineEnd, column }` (`YamlSeqItemLines`): the lines of item `index` and the column of its `-`; refused for a flow list |
| `yamlLinesIndentShift(lineList, delta)` | lines moved `delta` columns right (negative: left, by at most the spaces a line starts with); blank lines stay empty |
| `yamlSeqIndentOffsetGet(source, document)` | how far this file indents a `-` below its key: 0 for `tree:` / `- doc: a`, 2 for `  - doc: a`; 2 when no list tells |
| `yamlSeqItemRemoveBuild(source, document, seqPath, index)` | `data.operationList` removing the item (and one of the two blank lines around it, so the gap stays one line); a list that becomes empty is written `key: []`, so a folder stays a folder. also `data.itemLines` and `data.lineList`, the item's lines as they are in the file, for the caller that moves it |
| `yamlSeqItemInsertBuild(source, document, seqPath, index, lineList, columnItem)` | `data.operationList` inserting the lines of an item (its `-` at `columnItem`) before item `index` of the list (-1: at its end), shifted to the column of the list's items. the list need not exist: a missing key, `key:` alone or `key: []` of a block mapping gets the list, indented like the file's lists; `index` is then 0 or -1 |

`seqPath` is a path for `document.getIn`, e.g. `['sidePanelById', 'main', 'tree', 0, 'children']`.

### A list of strings

| function | does |
| --- | --- |
| `yamlStringListSetBuild(source, keyPath, valueList)` | `data.operationList` making a block list of strings hold `valueList`, entry by entry: a changed entry rewritten in place (its trailing comment kept), new entries appended as `- x` lines at the list's column, entries past the new end deleted with their comment lines; entries that stay keep their comments. a missing key or a flow list is written as one value (a flow list). refused: an empty list, a file that does not parse |

```ts
// move item 1 of tree to the end of the children of item 3, in one file
const document = parseDocument(source);
const removal = yamlSeqItemRemoveBuild(source, document, ['sidePanelById', 'main', 'tree'], 1);
if (removal.code !== 0) return removal;
const insertion = yamlSeqItemInsertBuild(
  source, document, ['sidePanelById', 'main', 'tree', 3, 'children'], -1,
  removal.data.lineList, removal.data.itemLines.column,
);
if (insertion.code !== 0) return insertion;
const textAfter = lineOperationListApply(source, [...removal.data.operationList, ...insertion.data.operationList]);
if (parseDocument(textAfter).errors.length > 0) { /* refuse, never write */ }
```

Both builders work on the same `source` and `document`; across two files, the removal is applied to one text and the insertion to the other.

## Where it is used

All yaml writes go through an api of the development server: the edit api (`plugin/doc-edit-server.ts`, [Edit api and line operations](doc_page_impl_edit.md#edit-api-and-line-operations), called through `lib/doc-edit-api.js`), and, for the asset folders, the asset api (`plugin/doc-asset-server.ts`).

| write | route | built by | utilities |
| --- | --- | --- | --- |
| the label of a side-panel item ([editing a label](doc_page_impl_side_panel.md#editing-a-label-in-place)) | `POST side-panel/text` | `sidePanelTextOperationBuild` (`plugin/doc-side-panel-text.ts`) | `nodeReplaceBuild` + `yamlScalarTextBuild` for an existing `text` / `separator`; `linesInsertBuild` at `lineAtAfterNodeGet`, indented at `nodeColumnGet`, for a document item labeled by its title |
| a side-panel item moved with its subtree ([moving an item](doc_page_impl_side_panel.md#moving-an-item)) | `POST side-panel/move` | `sidePanelMoveBuild` (`plugin/doc-side-panel-move.ts`) | `yamlSeqItemRemoveBuild`, `yamlSeqItemInsertBuild`, `lineOperationListApply`; for another file, the `include` paths of the item rebased with `nodeReplaceBuild` + `yamlScalarTextBuild` |
| the asset folders of one doc page ([which folders a doc page declares](doc_page_impl_asset.md#which-folders-a-doc-page-declares)) | `POST /__doc-asset/folder/set` | `assetConfigTextApply` (`plugin/doc-asset-store.ts`) | `yamlStringListSetBuild` for `folderList`, `yamlValueSetOperationBuild` + `yamlScalarTextBuild` for `folderDefault`, `lineOperationListApply`; a file that does not exist yet is created from a template (`assetConfigTextBuild`) |
| one value of a config declaration of the doc page ([the doc page layer](doc_page_impl_config.md#the-doc-page-layer)) | `POST config/value` | the route itself | `yamlValueTextBuild`, `yamlValueGet` (the key is declared, and the base check), `yamlValueSetOperationBuild`, `lineOperationApply` |

What each route checks:

- *side-panel/text*: the request names the node by its yaml path (`nodeSource`, annotated on the side-panel tree by `plugin/doc-entry.ts`) and the label it started from (`textBase`); a different label in the file is code -2; a `text` line is not added to a node in flow form; the language of a translated label must match how the file writes it (a string or a language mapping).
- *side-panel/move*: every file named must be a side-panel file the configuration loads (-3) with the hash the page built its side panel from (`hashBaseByFile`, from `fileHashByFile` of `doc-entry.ts`), else -2 for the whole move; every resulting text is parsed again before anything is written; after writing, the configuration is loaded once and the files are written back when it does not load.
- *config/value*: the file and key path must be a key of a declaration the configuration loads (-3), already declared (-3); `valueBase` against `yamlValueGet` of the file, -2 when different; after writing, the configuration is loaded once and the file is written back when it does not load.

Every route writes through `fileWriteWithBackup`. The written files are then reported to the source plugin (`onFileListWritten`, `configurationFileListWritten` in `plugin/doc-source.ts`), which recognizes the write as the server's own by its content hash, so the page does not reload: the new configuration reaches the page as a `doc-source-change` data event.
