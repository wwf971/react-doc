import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { pageSpecNormalize, paginationPlan, pieceListKeyed } from '../../frontend/src/lib/doc-pagination.js';
import { pageFlowPdfDownload, pageFlowPrint } from './page-flow-export.js';
import './PageFlow.css';

// The pagination environment (doc_page_impl_pagination.md): a flow of pieces laid out on
// pages of a fixed size, previewed as sheets, printed or downloaded as a PDF. A component
// that supports pagination (expose.pagination of its registry definition) gives the flow
// of its data and the types of its pieces; this component measures and places them.
//
//   pagination   the contract: { pieceTypeById, pageClassName?, pageSpec? }
//   pieceList    the flow: [{ type, data }] (pagination.pieceListGet(data, context))
//   pageSpec     the page in mm, over pagination.pageSpec (A4 by default)
//   title        the name of a printed or downloaded file
//   onStateChange({ status, pageCount, problemList })   status: measuring | done
// the ref: { print(), pdfDownload(options) }
//
// How it works, in rounds without timers: every piece not measured yet is rendered in a
// hidden box as wide as the page content, measured once it is laid out (fonts loaded,
// images decoded), and the plan (paginationPlan, pure) is made again from the measures; a
// split asks for its two parts to be measured, which is the next round. The sheets show
// the last finished plan meanwhile, so the preview does not blink.
export const PageFlow = forwardRef(function PageFlow({ pagination, pieceList, pageSpec, title = 'pages', className = '', onStateChange }, ref) {
  const spec = useMemo(() => pageSpecNormalize({ ...(pagination?.pageSpec ?? {}), ...(pageSpec ?? {}) }), [pagination, pageSpec]);
  const specKey = `${spec.width}x${spec.height}:${spec.margin.top},${spec.margin.right},${spec.margin.bottom},${spec.margin.left}`;
  const pieceTypeById = pagination?.pieceTypeById ?? {};
  const pageClassName = pagination?.pageClassName ?? '';
  const rootRef = useRef(null);
  const measureRef = useRef(null);
  const probeRef = useRef(null);
  // measures by piece key, kept while the page spec is the same
  const measuredRef = useRef({ specKey, byKey: new Map() });
  if (measuredRef.current.specKey !== specKey) measuredRef.current = { specKey, byKey: new Map() };
  const [version, setVersion] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const planDoneRef = useRef(undefined);

  const pieceListWithKey = useMemo(() => pieceListKeyed(pieceList), [pieceList]);
  const measuredGet = (key) => measuredRef.current.byKey.get(key);
  const typeGet = (type) => pieceTypeById[type];
  const plan = contentHeight > 0 ? paginationPlan({ pieceList: pieceListWithKey, measuredGet, typeGet, contentHeight }) : undefined;
  if (plan?.isDone) planDoneRef.current = plan;
  const planShown = planDoneRef.current;

  // what the next round measures: the flow's pieces not measured yet, and what the plan asks for
  const measureList = [];
  const measureKeySet = new Set();
  for (const piece of [...pieceListWithKey, ...(plan?.needList ?? [])]) {
    if (measuredGet(piece.key) || measureKeySet.has(piece.key)) continue;
    measureKeySet.add(piece.key);
    measureList.push(piece);
  }
  const measureKeyText = measureList.map((piece) => piece.key).join('|');

  useLayoutEffect(() => {
    let isCancelled = false;
    const probe = probeRef.current;
    if (probe) {
      const height = probe.getBoundingClientRect().height;
      if (Math.abs(height - contentHeight) > 0.01) setContentHeight(height);
    }
    const box = measureRef.current;
    if (!box || measureList.length === 0) return undefined;
    (async () => {
      await readyWait(box);
      if (isCancelled) return;
      for (const element of box.querySelectorAll(':scope > .doc-page-content > [data-piece-key]')) {
        measuredRef.current.byKey.set(element.dataset.pieceKey, pieceMeasure(element));
      }
      setVersion((one) => one + 1);
    })();
    return () => {
      isCancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureKeyText, specKey, version]);

  const status = !planShown || !plan?.isDone ? 'measuring' : 'done';
  const pageCount = planShown?.pageList.length ?? 0;
  const problemText = (plan?.problemList ?? planShown?.problemList ?? []).join('\n');
  useEffect(() => {
    onStateChange?.({ status, pageCount, problemList: problemText ? problemText.split('\n') : [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, pageCount, problemText]);

  useImperativeHandle(ref, () => ({
    print: () => pageFlowPrint(rootRef.current, { title, pageSpec: spec }),
    pdfDownload: (options = {}) => pageFlowPdfDownload(rootRef.current, { fileName: `${title}.pdf`, pageSpec: spec, ...options }),
  }), [title, spec]);

  const pieceRender = (piece, layout) => {
    const Render = pieceTypeById[piece.type]?.Render;
    if (!Render) return <p className="doc-error">No piece type {piece.type}</p>;
    return <Render data={piece.data} layout={layout} />;
  };
  const contentStyle = { width: `${spec.contentWidth}mm` };
  return (
    <div className={`doc-page-flow ${className}`} data-status={status}>
      <div ref={rootRef} className="doc-page-flow-sheet-list">
        {(planShown?.pageList ?? []).map((page, pageIndex) => (
          <div key={pageIndex} className="doc-page-sheet-box">
            <div
              className="doc-page-sheet"
              style={{
                width: `${spec.width}mm`,
                height: `${spec.height}mm`,
                padding: `${spec.margin.top}mm ${spec.margin.right}mm ${spec.margin.bottom}mm ${spec.margin.left}mm`,
              }}
            >
              <div className={`doc-page-content ${pageClassName}`}>
                {page.pieceList.map((piece) => (
                  <div key={piece.key} className="doc-page-piece">{pieceRender(piece, piece.layout)}</div>
                ))}
              </div>
            </div>
            <div className="doc-page-label">{pageIndex + 1} / {pageCount}</div>
          </div>
        ))}
      </div>
      {/* the measuring box: as wide as a page's content, out of sight, out of the flow */}
      <div ref={measureRef} className="doc-page-measure" aria-hidden="true">
        <div ref={probeRef} className="doc-page-probe" style={{ height: `${spec.contentHeight}mm` }} />
        <div className={`doc-page-content ${pageClassName}`} style={contentStyle}>
          {measureList.map((piece) => (
            <div key={piece.key} className="doc-page-piece" data-piece-key={piece.key}>
              {pieceRender(piece, { pageIndex: -1, isPageTop: false, fillHeight: 0, isMeasure: true })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

// fonts loaded and images decoded: what a measure must wait for, or it is off later
async function readyWait(box) {
  try {
    await document.fonts?.ready;
  } catch {
    // no font loading api: measure as it is
  }
  await Promise.all([...box.querySelectorAll('img')].map((image) => (image.complete ? Promise.resolve() : image.decode?.().catch(() => undefined))));
}

// what a piece measures: its height, its breaks, the lines of its texts (px from its top)
export function pieceMeasure(element) {
  const rect = element.getBoundingClientRect();
  const top = rect.top;
  const breakList = [...element.querySelectorAll('[data-page-break]')].map((one) => {
    const rectOne = one.getBoundingClientRect();
    return { key: one.dataset.pageBreak, top: rectOne.top - top, bottom: rectOne.bottom - top };
  });
  const textList = [...element.querySelectorAll('[data-page-text]')].map((one) => ({ key: one.dataset.pageText, lineList: textLineListGet(one, top) }));
  return { height: rect.height, breakList, textList };
}

// the lines of the text of an element: where each starts (an offset into its text) and its
// top and bottom, read from the boxes of its characters
function textLineListGet(element, top) {
  const lineList = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offsetBase = 0;
  let node = walker.nextNode();
  while (node) {
    const text = node.textContent ?? '';
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === '\n') continue;
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      const rect = [...range.getClientRects()].pop();
      if (!rect || rect.height === 0) continue;
      const lineLast = lineList[lineList.length - 1];
      // a character below the line so far starts the next one
      if (!lineLast || rect.top - top >= lineLast.bottom - 1) {
        lineList.push({ offset: offsetBase + index, top: rect.top - top, bottom: rect.bottom - top });
      } else {
        lineLast.bottom = Math.max(lineLast.bottom, rect.bottom - top);
      }
    }
    offsetBase += text.length;
    node = walker.nextNode();
  }
  return lineList;
}
