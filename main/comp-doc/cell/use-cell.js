import { useContext, useMemo, useRef } from 'react';
import { StoreContext } from '../../frontend/src/store/context.js';
import { cellTextParse, cellTextPlainGet, cellTokenListResolve } from '../../frontend/src/lib/doc-cell.js';

// The cell a component hands its values to (doc_page_impl_edit_cell.md#using-it-in-a-component):
// what CellValue draws a text with and CellEdit types one in. A component
// asks for one per sort of cell it draws (usually one), not per value:
//
//   const cell = useCell({
//     tokenList: [cvQueryToken],             // its own token kinds, over its own data
//     context: { info, dateNow },            // what its kinds read, as it is at this render
//     config,                                // the config of the component: the document it is
//                                            // drawn in (config.sourcePath) and, for a mode of a
//                                            // frontend object, the object (config.objectFrontend.ref)
//     tokenIdList: undefined,                // the kinds of the page it accepts, by id
//                                            // (nav/link, object/view); undefined: every one, []: none
//   });
//   <CellValue cell={cell} text={book.remark} />
//   <CellEdit cell={cell} text={draft} onTextChange={draftSet} ... />
//
// the context is kept current without building the cell again: the cell holds
// one context object for its life, and every render copies the values handed
// into it, so a kind drawing a token, and a slash action listing while the
// author types, read the component's data as it is now.
//
// outside a page (no stores: a test, a component drawn alone) it answers a
// cell that still parses and draws its own kinds, with no slash mode.
export function useCell({ tokenList = [], tokenIdList, context = {}, config, sourcePath, owner } = {}) {
  const stores = useContext(StoreContext);
  const cellStore = stores?.cellStore;
  const contextRef = useRef({});
  // the values of this render over the last ones: the object stays the same
  for (const key of Object.keys(contextRef.current)) if (!(key in context)) delete contextRef.current[key];
  Object.assign(contextRef.current, context);
  const sourcePathUsed = sourcePath ?? config?.sourcePath ?? '';
  const ownerUsed = owner ?? config?.objectFrontend?.ref ?? '';
  const tokenIdKey = tokenIdList === undefined ? '*' : tokenIdList.join(',');
  // the kinds are compared one by one: a component usually writes the list inline, a new
  // array of the same kinds every render
  const tokenListRef = useRef(tokenList);
  if (tokenListRef.current.length !== tokenList.length || tokenListRef.current.some((kind, index) => kind !== tokenList[index])) tokenListRef.current = tokenList;
  const tokenListKept = tokenListRef.current;
  const cellTokenById = cellStore?.cellTokenById;
  return useMemo(() => {
    const spec = { tokenList: tokenListKept, tokenIdList: tokenIdKey === '*' ? undefined : tokenIdKey.split(',').filter(Boolean), context: contextRef.current, sourcePath: sourcePathUsed, owner: ownerUsed };
    return cellStore ? cellStore.cellBuild(spec) : cellAloneBuild(spec);
  }, [cellStore, cellTokenById, sourcePathUsed, ownerUsed, tokenIdKey, tokenListKept]);
}

// a cell without a page: its own kinds only
function cellAloneBuild(spec) {
  const tokenList = cellTokenListResolve({ tokenOwnList: spec.tokenList, tokenById: {}, tokenIdList: [] });
  const cell = {
    tokenList,
    context: spec.context,
    sourcePath: spec.sourcePath,
    owner: spec.owner,
    source: undefined,
    object: undefined,
    slash: undefined,
    parse: (text) => cellTextParse(text, tokenList),
    textGet: (text) => cellTextPlainGet(cellTextParse(text, tokenList), (part) => part.kind.textGet?.(part, cell)),
  };
  return cell;
}
