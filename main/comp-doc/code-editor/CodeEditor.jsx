import { useEffect, useRef, useState } from 'react';
import './CodeEditor.css';

// A text shown and edited as in a code editor: line numbers, folding of
// what can be folded, the line of the caret marked, the words colored by
// their language (doc_page_impl_mdx_code.md#editing-the-lines). It is
// CodeMirror 6, loaded when the first editor is shown (its modules are a
// chunk of their own, not part of the page's first load), with the language
// found by name among those CodeMirror knows (@codemirror/language-data,
// each loaded when first asked for); a language it does not know, and text,
// are shown plain, still with their line numbers.
//
//   <CodeEditor value lang isReadOnly onChange onSave onCancel label />
//     value        the text; a value handed again that differs from what the
//                  editor holds replaces it (another text shown, a draft reset)
//     lang         the language of its words; another language reconfigures the
//                  editor in place (the text, the caret and the history stay)
//     isReadOnly   view: the text can be selected and copied, not changed
//     onChange     every change typed (the draft)
//     onSave       Ctrl/⌘ + S and Ctrl/⌘ + Enter
//     onCancel     Escape, while the editor has the keyboard
//
// Tab indents the lines of the selection (the line of the caret) by one unit,
// Shift + Tab takes one away (indentWithTab), as in a code editor: the
// keyboard stays in the lines. a read-only editor leaves Tab to the page, so
// the focus moves on.
//
// until CodeMirror is there, the text is shown in a plain box of the same
// type, so the dialog does not open empty.

let moduleListPromise;
function moduleListLoad() {
  moduleListPromise ??= Promise.all([
    import('codemirror'),
    import('@codemirror/state'),
    import('@codemirror/view'),
    import('@codemirror/language'),
    import('@codemirror/language-data'),
    import('@lezer/highlight'),
    import('@codemirror/commands'),
  ]).then(([codemirror, state, view, language, languageData, highlight, commands]) => ({ codemirror, state, view, language, languageData, highlight, commands }));
  return moduleListPromise;
}

const LANG_TEXT_LIST = ['', 'text', 'txt', 'plaintext', 'plain'];

export function CodeEditor({ value = '', lang = '', isReadOnly = true, onChange, onSave, onCancel, label = 'Code' }) {
  const hostRef = useRef(null);
  const viewRef = useRef(null);
  const moduleRef = useRef(null);
  const compartmentRef = useRef(null);
  const propRef = useRef({ onChange, onSave, onCancel });
  propRef.current = { onChange, onSave, onCancel };
  const [isLoaded, isLoadedSet] = useState(false);
  const isText = LANG_TEXT_LIST.includes(String(lang).toLowerCase());

  useEffect(() => {
    let isCanceled = false;
    let view;
    void moduleListLoad().then((module) => {
      if (isCanceled || !hostRef.current) return;
      moduleRef.current = module;
      const { codemirror, state, view: viewModule, language, highlight, commands } = module;
      const compartment = { readOnly: new state.Compartment(), language: new state.Compartment(), wrap: new state.Compartment() };
      compartmentRef.current = compartment;
      // a change the page made to the text is not reported back as one typed
      const isExternal = state.Annotation.define();
      view = new viewModule.EditorView({
        parent: hostRef.current,
        state: state.EditorState.create({
          doc: value,
          extensions: [
            codemirror.basicSetup,
            language.syntaxHighlighting(highlight.classHighlighter),
            compartment.language.of([]),
            compartment.readOnly.of(readOnlyExtensionBuild(module, isReadOnly)),
            compartment.wrap.of([]),
            // before the editor's own keys, which give Mod-Enter a new line
            state.Prec.highest(viewModule.keymap.of([
              { key: 'Mod-s', run: () => { propRef.current.onSave?.(); return true; } },
              { key: 'Mod-Enter', run: () => { propRef.current.onSave?.(); return Boolean(propRef.current.onSave); } },
              { key: 'Escape', run: () => { propRef.current.onCancel?.(); return Boolean(propRef.current.onCancel); } },
            ])),
            // Tab and Shift + Tab indent and outdent (they do nothing, and the
            // focus moves on, while the editor is read-only)
            viewModule.keymap.of([commands.indentWithTab]),
            viewModule.EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false' }),
            viewModule.EditorView.updateListener.of((update) => {
              if (update.docChanged && !update.transactions.some((one) => one.annotation(isExternal))) {
                propRef.current.onChange?.(update.state.doc.toString());
              }
            }),
          ],
        }),
      });
      view.isExternal = isExternal;
      viewRef.current = view;
      isLoadedSet(true);
    });
    return () => {
      isCanceled = true;
      view?.destroy();
      viewRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // the language, and long lines wrapped for a text: reconfigured in place
  useEffect(() => {
    const view = viewRef.current;
    const module = moduleRef.current;
    if (!view || !module) return;
    const compartment = compartmentRef.current;
    view.dispatch({ effects: compartment.wrap.reconfigure(isText ? module.view.EditorView.lineWrapping : []) });
    void languageApply(module, view, compartment, isText ? '' : lang);
  }, [lang, isText, isLoaded]);

  // the text of the page, when it is not what the editor holds
  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value }, annotations: view.isExternal.of(true) });
  }, [value, isLoaded]);

  useEffect(() => {
    const view = viewRef.current;
    const module = moduleRef.current;
    if (!view || !module) return;
    view.dispatch({ effects: compartmentRef.current.readOnly.reconfigure(readOnlyExtensionBuild(module, isReadOnly)) });
    if (!isReadOnly) view.focus();
  }, [isReadOnly, isLoaded]);

  return (
    <div className="doc-code-editor not-prose" data-read-only={isReadOnly ? '' : undefined}>
      <div ref={hostRef} className="doc-code-editor-host" />
      {isLoaded ? null : <pre className="doc-code-editor-fallback">{value}</pre>}
    </div>
  );
}

function readOnlyExtensionBuild({ state, view }, isReadOnly) {
  return [state.EditorState.readOnly.of(isReadOnly), view.EditorView.editable.of(!isReadOnly)];
}

// the language of the editor, found by name or alias among those CodeMirror
// knows (py, sh, ts are names of a language too), loaded when asked for
// a language not known, or none, leaves the words plain. the language asked
// for last wins: a load answered after another language was asked for is dropped
async function languageApply({ language, languageData }, view, compartment, lang) {
  view.languageAsked = lang;
  const description = lang ? language.LanguageDescription.matchLanguageName(languageData.languages, String(lang), true) : null;
  if (!description) {
    view.dispatch({ effects: compartment.language.reconfigure([]) });
    return;
  }
  try {
    const support = await description.load();
    if (viewIsAlive(view) && view.languageAsked === lang) view.dispatch({ effects: compartment.language.reconfigure(support) });
  } catch (error) {
    console.warn(`[CodeEditor] the language ${lang} was not loaded:`, error);
  }
}

function viewIsAlive(view) {
  return Boolean(view?.dom?.isConnected);
}
