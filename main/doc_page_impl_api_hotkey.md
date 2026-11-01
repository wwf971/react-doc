<!-- Design of the keyboard maps. Parent document: doc_page_impl_api.md, the unified api registry whose apis the keys run. -->

# Keyboard Maps: Design

A hotkey binds a key to an api of the [unified api registry](doc_page_impl_api.md). The bindings are written in **keyboard maps**, yaml files of one grammar that include one another and are **stacked** the way the config layers are ([Config layers](doc_page_impl_config.md#config-layers)): the package's default map at the bottom (the default keys of the built-in apis, named by `config.yaml`), the map of every loaded doc page over it (kept in the `hotkey/` folder of its metadata folder), the workspace's map over those (named by the workspace file: the deployment decides), the host's on top. When a key is pressed, the stack is read from the top and the first binding that applies answers. The grammar follows VS Code's keybindings (`ctrl+shift+p`, chords, a `when` condition); the files follow the side panels of the page (resources that include one another, one active by convention).

```text
.doc-page/hotkey/base.yaml   ─ include ─►  .doc-page/hotkey/main.yaml   (the active map of the doc page)
                                                     │
package map (config.yaml)  <  included doc pages' maps  <  main doc page's map  <  workspace map  <  host maps
                                                     │                                      the stack, lowest first
                                                     ▼
                     hotkeyTableBuild: every key, its bindings top first          (DocHotkeyStore.table)
                                                     ▼
keydown ──► stroke ──► hotkeyResolve(key): the topmost binding whose "when" holds and whose api is registered now
                                                     ▼
                       DocApiStore.call(api, params, { principal: hotkey })
```

## The grammar

A key is modifiers and one key, joined by `+`; a chord is two such strokes separated by a space:

| part | written as |
| --- | --- |
| modifiers | `ctrl`, `shift`, `alt`, `meta` (also `cmd`, `command`, `win`; `option` is `alt`, `control` is `ctrl`), in any order |
| `mod` | `meta` on macOS, `ctrl` elsewhere: the modifier a reader expects for a command on their system |
| keys | letters and digits; `f1`..`f24`; `enter`, `escape` (`esc`), `space`, `tab`, `backspace`, `delete`, `insert`; `up`, `down`, `left`, `right`, `home`, `end`, `pageup`, `pagedown`; the punctuation keys as themselves (`,` `.` `/` `;` `'` `[` `]` `\` `-` `=` `` ` ``) and `+` written as `++` |
| a chord | `ctrl+k ctrl+s`: the second stroke within two seconds of the first |

Keys are written as the physical key: `ctrl+shift+p` is the P key, whatever a shifted or non-latin layout would type. The key is shown to the reader as the system writes it: `Ctrl+Shift+P`, or `⇧⌘P` on macOS (`hotkeyFormat`, `lib/doc-hotkey.js`).

A map file:

```yaml
# .doc-page/hotkey/main.yaml
hotkeyMap:
  id: main                        # optional: the file name without .yaml
  description: the keys of the demonstration
  include:                        # optional: maps stacked below this one, the first lowest;
    - ./base.yaml                 #   paths relative to this file
  bindingList:
    - key: mod+alt+g
      api: example/openGuide      # the api it runs
      description: the document model
    - key: ctrl+k ctrl+s          # a chord
      api: settings/open
      params: { tab: api }        # optional: the params of the call
    - key: alt+s
      api: edit/sessionLeave
      when: sessionOpen           # optional: only while the condition holds
    - key: alt+home
      api: null                   # unbinds the key from the maps below
```

`when` is one or more **context names** joined by `&&`, each negatable with `!`: `editMode`, `viewMode`, `editAvailable`, `sessionOpen`, `blockSelectMode`, `paletteOpen`, `settingsOpen`, `blockPopupOpen`, `devServer` (`hotkeyContextKeyList`, read from the stores at the moment of the key). A name the page does not keep is false.

## Where the maps are

The maps are configuration, kept where the config of their level is kept, and every one of them is a map file of the same grammar; the plugin reads them when the configuration loads (`plugin/doc-hotkey.ts`), expands the includes (a map included twice is read once; a cycle is a problem naming the chain), and hands the page flat maps with the file and place of every binding (`configDoc.hotkey`); every problem of a file is reported as `[doc-hotkey]` with the file and skips the binding or the map, never the page. A change in any of them reloads the page.

- **The package's default map** is the package config layer of the keys: the default keys of the built-in apis are not in code but in a map file `config.yaml` names (`hotkey: { file: ./hotkey/default.yaml }`, [the default layer](doc_page_impl_config.md#the-default-layer) of the config keys is `configDefault` of the same file), so a deployment overrides them in `config.0.yaml` like any entry, and a package without the section binds no key. `main/hotkey/default.yaml`: the palette on `mod+shift+p` and `f1`, Back / Forward / Up / Home on `alt` with the arrows, edit mode on `mod+shift+e`, block selection on `mod+shift+b`, the settings on `mod+,`.
- **A doc page's maps** live in `.doc-page/hotkey/` by convention ([The doc page folder](doc_page_impl_dir.md#keyboard-maps-and-declared-apis)), one file per map, and **`main.yaml` is the map it activates**; the other files are resources, included by the active map or chosen by the reader. The entry may name another file as the active map (`hotkey: { file: ./hotkey/vim.yaml }`) or say the doc page has none (`hotkey: false`). Unlike a doc page's config, which applies only for the main doc page ([the doc page layers](doc_page_impl_config.md#the-doc-page-layers)), the maps of **every** loaded doc page apply: a key is bound to an api, and the apis a doc page declares and the components it brings come along with it wherever it is included, so its keys for them do too; what an included doc page binds is seen in the table of the API tab under its alias, and the doc page that includes it, the workspace and the reader rebind it.
- **The workspace's map** is named by the workspace file (`hotkey: { file: ./workspace-hotkey.yaml }`, [the workspace file](doc_page_impl_source.md#the-workspace-file)), one map file like the package's: the keys of the deployment, over every doc page's.

The **stack** (`DocHotkeyStore.mapListStack`), lowest first, follows the rule of the config layers, the container deciding over what it contains:

1. the package's default map (`configDoc.hotkey.mapPackage`, id `package`);
2. the active map of every loaded doc page, the included doc pages below the one that includes them and the main doc page last (`configDoc.hotkey.docPageList`, ids `{alias}:{map}`);
3. the workspace's map (`configDoc.hotkey.mapWorkspace`, id `workspace`);
4. the host's maps (`DocPageMdx` `config.hotkeyMapList`).

Within a map, the bindings of its includes come first (lowest), then its own, and a later binding of the same key wins over an earlier one. The reader may pick **another map of a doc page** for this browser in the API tab of the settings panel (`mapIdActiveSet`, kept in `localStorage`), which is how a doc page offers alternative sets of keys (`minimal.yaml` of the demonstration) without changing its default. The demonstration stacks all four levels on one key: the package binds `alt+home` to Home, the doc page `example` unbinds it (`base.yaml`), and the workspace binds it again (`workspace-hotkey.yaml`), which is what the reader gets.

## Resolution

The table (`hotkeyTableBuild`) keeps, for every key, its bindings with the one that would win first. A key is resolved when it is pressed, never in advance, because what wins depends on the moment:

```text
hotkeyResolve(key)   the bindings of the key, top down
  "when" does not hold now        -> passed over
  api: null                       -> the key is unbound: stop
  the api is not registered now   -> passed over  (a service instance away, a component not mounted:
                                     the binding is hidden, not broken, and the next one shows through)
  else                            -> this binding answers
no binding left                   -> the key is not a hotkey; the browser keeps it
```

A binding whose api exists but **cannot run now** (`isAvailable` says no: Back with no history) is different from a missing one: the key is taken, the api answers -3, and the reason shows in the notice. The distinction keeps a key from doing something else than what the reader sees bound to it, while a binding to something that is not there at all gives way. The demonstration shows both: `mod+alt+t` is bound in `main.yaml` to `service/todo-list/todoList` and in `base.yaml` to opening a document; while the instance runs the first wins, while it does not the key opens the document.

The resolved table is what `hotkey/listGet` answers and what the API tab shows: every key, the binding that answers it, and the bindings it passes over, each with why (`hotkeyTableEffectiveGet`). The key beside an api in the palette is the first key whose effective binding is that api (`hotkeyLabelByApiBuild`).

## The listener

`DocHotkeyListener` offers every keydown of the window to `DocHotkeyStore.keyDownHandle`, in the bubbling phase, after the handlers of the place the key happened in, so a key an editor or a dialog took (`defaultPrevented`) is never a hotkey, and a key during IME composition is left alone. A stroke **without ctrl, alt or meta** (`f1`, `escape`, a letter) is left to the text while something editable has the focus or a block is being edited; a stroke with one of them is matched everywhere, which is why the keys of the palette work inside its own field. A key that resolves is taken (`preventDefault`, `stopPropagation`) and its api called with the principal `hotkey` and the key as its id; the result goes to the notice of the api layer. A stroke that starts a chord is taken and remembered for two seconds; the second stroke completes the chord, and a second stroke that matches nothing is reported ("… is not bound").

## Cooperation with the other layers

- **The api registry** is the only thing a binding names; the maps never know what an api does, and an api never knows it has a key. A doc page binds its own declared apis ([Declared apis](doc_page_impl_api.md#declared-apis)), a component's apis and a service's apis the same way.
- **The palette** shows the key of every api it lists, from the same table.
- **The config system**: the maps are stacked by the rule of the config layers and kept beside the config of each level: `config.yaml` names the package's, the workspace file the workspace's, the metadata folder of a doc page its own ([Config layers](doc_page_impl_config.md#config-layers)).
- **The settings panel** shows the maps, the choice of a doc page's map, the resolved table and the problems ([The API tab](doc_page_impl_api.md#the-api-tab)).
- **The editors** keep the keys they own (Escape cancels a session, Ctrl/⌘ + Enter leaves it, the arrows shift the focus; [In-place editing](doc_page_impl_edit.md#floating-controls)): they handle them first and prevent the default, so no map can take them away from an open editor; a map may bind them with `when: !sessionOpen` for the rest of the page.

## Files

```text
frontend/src/lib/doc-hotkey.js            the grammar: strokes, chords, formatting, the stroke of an event; "when";
                                          the table, the resolution, the effective table, the key of an api
frontend/src/store/DocHotkeyStore.ts      the stack (package, doc pages, workspace, host), the reader's choice of a doc
                                          page's map, the table and the context names, keyDownHandle, chords
main/hotkey/default.yaml, config.yaml     the package's default map and the "hotkey" entry naming it
comp-doc/api/DocHotkeyListener.jsx        the keydown of the window; the search dialog handed to the api layer
frontend/plugin/doc-hotkey.ts             the package's and the workspace's map file, .doc-page/hotkey/ of every doc
                                          page: the maps, includes expanded, problems (configDoc.hotkey)
frontend/src/lib/doc-hotkey.test.js, frontend/plugin/doc-hotkey.test.js   the grammar and resolution; the files
example_doc/.doc-page/hotkey/             main.yaml (active), base.yaml (included), minimal.yaml (a choice)
workspace.yaml, workspace-hotkey.yaml     the workspace's map of the demonstration
```

Editing the keys from the page (a client map written in the browser, as the client config layer is) is in [TODO](doc_page_impl_TODO.md#api-hotkey-client-map).
