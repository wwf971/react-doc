// Kinds of atoms (doc_page_impl_edit_structure.md#atoms-of-a-kind): a thing a
// component writes inside a text (a formula of LaTeX: the built-in component
// math, built-in/comp-mdx/math) that the editor of the text types as one
// character, drawn as a chip, its value edited by the component in a field
// below the chip. The edit layer knows no kind by name: a kind says where its
// things are in a text, how one is written, how it is drawn and what edits it.
//
//   atomKindDefine({
//     name                     'math': what the atoms of the kind are called
//     label                    'formula': what a chip says it is
//     spanListGet(text)        where things of the kind are in a text (Markdown):
//                              [{ start, end, value, isRow }], in order; isRow: on
//                              lines of its own (a chip as wide as the text),
//                              else in the line
//     sourceBuild(value, isRow)  how one is written in the text
//     draw(element, value, isRow) -> message
//                              draws one into its chip; what is wrong with it ('')
//     Editor                   a React component editing a value below its chip:
//                              { anchorGet, value, isRow, message, onChange(value),
//                              onLeave('before' | 'after' | 'done' | 'cancel' |
//                              'remove' | 'blur') }
//                              before / after: the caret goes on there; done,
//                              cancel: typed (the caret after it); remove:
//                              taken out
//     elementSelector          optional: the element the rendered document draws
//                              one thing of the kind as ('.katex'), one per thing,
//                              in the order of the text: a right click on it in a
//                              block not being edited names which one it is, for
//                              the menu that deletes it
//   })
//
// an atom of a kind in the model of a text (lib/doc-edit-item-atom.js):
//   { char, kind: 'inline' | 'row', atomKind: name, value, source, start, end }
// its value changes in its field; its source (sourceBuild of the value) is
// what the text is written with. an empty value is written as nothing.

export function atomKindDefine(options = {}) {
  const name = String(options.name ?? '');
  if (!/^[a-z][a-zA-Z0-9]*$/.test(name)) throw new Error(`atomKindDefine: name must be one word (got ${JSON.stringify(options.name)}).`);
  for (const key of ['spanListGet', 'sourceBuild', 'draw']) {
    if (typeof options[key] !== 'function') throw new Error(`atomKindDefine: ${name} needs ${key}.`);
  }
  return Object.freeze({
    name,
    label: String(options.label ?? name),
    spanListGet: options.spanListGet,
    sourceBuild: options.sourceBuild,
    draw: options.draw,
    Editor: options.Editor,
    elementSelector: typeof options.elementSelector === 'string' ? options.elementSelector : '',
  });
}

// the registry of the page, by id ({layer}/{name}): the package's kinds, the
// host's over them (config.atomKindById; an id mapped to null removes one), as
// the slash action registry is built. -> { byId, byName }
export function atomKindRegistryBuild(...layerList) {
  const byId = {};
  for (const layer of layerList) {
    for (const [id, kind] of Object.entries(layer ?? {})) {
      if (kind === null) {
        delete byId[id];
        continue;
      }
      if (!kind || typeof kind.spanListGet !== 'function' || typeof kind.name !== 'string') {
        console.warn(`[doc-atom-kind] ${id}: not an atomKindDefine() definition; left out`);
        continue;
      }
      byId[id] = kind;
    }
  }
  const byName = {};
  for (const kind of Object.values(byId)) byName[kind.name] = kind;
  return { byId, byName };
}
