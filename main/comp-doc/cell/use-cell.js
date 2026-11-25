import { useContext, useLayoutEffect, useMemo, useRef } from 'react';
import { StoreContext } from '../../frontend/src/store/context.js';
import { cellContextVersionBuild, cellStyleCssCachedBuild, cellTokenTextBareGet } from '../../frontend/src/store/DocCellStore.ts';
import { cellContextAssign, cellTextParse, cellTextPlainGet, cellTextStyledParse, cellTokenListResolve } from '../../frontend/src/lib/doc-cell.js';
import { cellStyleTextBareGet } from '../../frontend/src/lib/doc-cell-style.js';
import { cellStyleListResolve } from './cell-style-define.js';
import { cellStyleById } from './cell-style-registry.js';

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
//     isStyled: true,                        // its words may be drawn in styles (bold, a color: the
//                                            // default); false for a value that is no prose
//     styleList: [noteStyle],                // its own style kinds (cellStyleDefine: a look it names)
//     styleIdList: undefined,                // the style kinds of the page it accepts, by id
//                                            // (text/b, text/color); undefined: every one, []: none
//   });
//   <CellValue cell={cell} text={book.remark} />
//   <CellEdit cell={cell} text={draft} onTextChange={draftSet} ... />
//
// the context is kept current without building the cell again: the cell holds
// one context object for its life, and every render copies the values handed
// into it, so a kind drawing a token, and a slash action listing while the
// author types, read the component's data as it is now. a token drawn already
// is drawn again when a value of the context is another one than at the last
// render (cell.contextTouch, after the render and before the paint): a badge
// whose caption was written shows the new one, whatever is kept by memo between
// the component and the token. so hand the same object for what did not change
// where drawing the tokens is costly.
//
// outside a page (no stores: a test, a component drawn alone) it answers a
// cell that still parses and draws its own kinds, with no slash mode.
export function useCell({ tokenList = [], tokenIdList, context = {}, config, sourcePath, owner, isStyled = true, styleList = [], styleIdList } = {}) {
  const stores = useContext(StoreContext);
  const cellStore = stores?.cellStore;
  const contextRef = useRef(null);
  // a change of the context waiting to be told: kept over a render that is thrown away
  const isContextChangedRef = useRef(false);
  // the values of this render over the last ones: the object stays the same. the first
  // values are no change: the tokens are drawn with them in this very render
  if (contextRef.current === null) contextRef.current = { ...context };
  else if (cellContextAssign(contextRef.current, context)) isContextChangedRef.current = true;
  const sourcePathUsed = sourcePath ?? config?.sourcePath ?? '';
  const ownerUsed = owner ?? config?.objectFrontend?.ref ?? '';
  const tokenIdKey = tokenIdList === undefined ? '*' : tokenIdList.join(',');
  // the kinds are compared one by one: a component usually writes the list inline, a new
  // array of the same kinds every render
  const tokenListRef = useRef(tokenList);
  if (tokenListRef.current.length !== tokenList.length || tokenListRef.current.some((kind, index) => kind !== tokenList[index])) tokenListRef.current = tokenList;
  const tokenListKept = tokenListRef.current;
  const styleIdKey = styleIdList === undefined ? '*' : styleIdList.join(',');
  const styleListRef = useRef(styleList);
  if (styleListRef.current.length !== styleList.length || styleListRef.current.some((kind, index) => kind !== styleList[index])) styleListRef.current = styleList;
  const styleListKept = styleListRef.current;
  const cellTokenById = cellStore?.cellTokenById;
  const cellStyleByIdPage = cellStore?.cellStyleById;
  const cell = useMemo(() => {
    const spec = {
      tokenList: tokenListKept, tokenIdList: tokenIdKey === '*' ? undefined : tokenIdKey.split(',').filter(Boolean), context: contextRef.current, sourcePath: sourcePathUsed, owner: ownerUsed,
      isStyled, styleList: styleListKept, styleIdList: styleIdKey === '*' ? undefined : styleIdKey.split(',').filter(Boolean),
    };
    return cellStore ? cellStore.cellBuild(spec) : cellAloneBuild(spec);
  }, [cellStore, cellTokenById, cellStyleByIdPage, sourcePathUsed, ownerUsed, tokenIdKey, tokenListKept, isStyled, styleIdKey, styleListKept]);
  // told after the render (an observable is not changed while components render), before the
  // paint: the tokens are never seen with the values of the last render
  useLayoutEffect(() => {
    if (!isContextChangedRef.current) return;
    isContextChangedRef.current = false;
    cell.contextTouch();
  });
  return cell;
}

// a cell without a page: its own kinds only
function cellAloneBuild(spec) {
  const tokenList = cellTokenListResolve({ tokenOwnList: spec.tokenList, tokenById: {}, tokenIdList: [] });
  const contextVersion = cellContextVersionBuild();
  const isStyled = spec.isStyled !== false;
  // the package's style kinds: words are drawn in their styles without a page too
  const styleList = isStyled ? cellStyleListResolve({ styleOwnList: spec.styleList ?? [], styleById: cellStyleById, styleIdList: spec.styleIdList }) : [];
  const parse = (text) => (isStyled ? cellTextStyledParse(text, tokenList) : cellTextParse(text, tokenList));
  const cell = {
    tokenList,
    isStyled,
    styleList,
    styleCssGet: cellStyleCssCachedBuild(styleList),
    context: spec.context,
    contextVersionGet: contextVersion.get,
    contextTouch: contextVersion.touch,
    sourcePath: spec.sourcePath,
    owner: spec.owner,
    source: undefined,
    object: undefined,
    slash: undefined,
    parse,
    tokenParse: (text) => cellTextParse(text, tokenList),
    bareGet: (text) => (isStyled ? cellStyleTextBareGet(text) : String(text ?? '')),
    textGet: (text) => cellTextPlainGet(parse(text), (part) => cellTokenTextBareGet(part.kind.textGet?.(part, cell), isStyled)),
  };
  return cell;
}
