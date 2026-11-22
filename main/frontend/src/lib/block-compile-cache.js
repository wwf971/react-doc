import { compileDoc } from './mdx-compile.js';

// The compiled texts of single blocks (BlockRender), shared and kept a short
// while. A block just saved is drawn by its new text until the document is
// compiled again (DocEditStore.blockTextPending); the page starts the compile
// of that text as the write starts (DocEditStore option blockTextPrepare), so
// the block has it when the editor closes, and never shows its old rendering
// in between (a formula just deleted would come back for a moment).
// Design: doc_page_impl_edit.md#in-place-editing-and-the-no-jitter-rule (rule 8)
//
//   text, format ('md' | 'mdx'), internalPath   what is compiled, as BlockRender asks
//   compileConfig                               the compile configuration of the page:
//                                               a text compiled by another is compiled again

const ENTRY_COUNT_MAX = 16;
const entryByKey = new Map();

function keyGet({ text, format = 'md', internalPath = '' }) {
  return `${format}\u0000${internalPath}\u0000${String(text ?? '')}`;
}

function entryGet(request) {
  const key = keyGet(request);
  const entry = entryByKey.get(key);
  if (!entry || entry.compileConfig !== request.compileConfig) return { key, entry: undefined };
  // the last asked is the last to go
  entryByKey.delete(key);
  entryByKey.set(key, entry);
  return { key, entry };
}

// the compile of a text, started once: another ask gets the same promise
//   -> Promise<{ Body, ... }> (compileDoc)
export function blockCompileStart(request) {
  const { key, entry: entryFound } = entryGet(request);
  if (entryFound) return entryFound.promise;
  const entry = { compileConfig: request.compileConfig, compiled: undefined, promise: undefined };
  entry.promise = compileDoc({
    source: String(request.text ?? ''),
    internalPath: request.internalPath ?? '',
    format: request.format === 'mdx' ? 'mdx' : 'md',
    config: request.compileConfig ?? {},
  }).then(
    (compiled) => {
      entry.compiled = compiled;
      return compiled;
    },
    (error) => {
      // a failed compile is not kept: the next ask compiles again
      if (entryByKey.get(key) === entry) entryByKey.delete(key);
      throw error;
    },
  );
  entryByKey.set(key, entry);
  while (entryByKey.size > ENTRY_COUNT_MAX) entryByKey.delete(entryByKey.keys().next().value);
  return entry.promise;
}

// the compiled text when its compile is done, else undefined: what a block
// drawn for that text shows at once
export function blockCompileDoneGet(request) {
  return entryGet(request).entry?.compiled;
}

// a compile started ahead of a draw, whose result nobody waits for
export function blockCompilePrepare(request) {
  blockCompileStart(request).catch(() => {});
}
