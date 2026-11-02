import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const requireFrontend = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { build } = requireFrontend('esbuild');
const browser = process.env.DOC_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const folder = path.dirname(fileURLToPath(import.meta.url));

test('table overlays escape clipping, remain interactive, and preserve scrolling', {
  skip: !existsSync(browser) && 'Set DOC_TEST_BROWSER to a Chromium executable',
}, async () => {
  const folderTemp = mkdtempSync(path.join(tmpdir(), 'doc-popover-test-'));
  try {
    const bundle = await build({
      stdin: { contents: fixture, resolveDir: folder, loader: 'jsx' },
      bundle: true,
      write: false,
      outfile: path.join(folderTemp, 'fixture.js'),
      jsx: 'automatic',
      nodePaths: [path.resolve(folder, '../../frontend/node_modules')],
      plugins: [{ name: 'unused-tags', setup(builder) {
        builder.onResolve({ filter: /\/TagList\.jsx$/ }, () => ({ path: 'tags', namespace: 'unused-tags' }));
        builder.onLoad({ filter: /.*/, namespace: 'unused-tags' }, () => ({ contents: 'export const TagList = () => null;' }));
      } }],
    });
    for (const output of bundle.outputFiles) writeFileSync(output.path, output.contents);
    const file = path.join(folderTemp, 'fixture.html');
    writeFileSync(file, '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><pre id="result">PENDING</pre><script src="fixture.js"></script></body></html>');
    const results = [];
    for (const width of [1280, 390]) {
      const run = spawnSync(browser, [
        '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        `--user-data-dir=${path.join(folderTemp, `profile-${width}`)}`,
        `--window-size=${width},900`, '--force-device-scale-factor=1',
        '--virtual-time-budget=5000', '--dump-dom', pathToFileURL(file).href,
      ], { encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
      assert.ifError(run.error);
      assert.equal(run.status, 0, run.stderr);
      const result = run.stdout.match(/<pre id="result">([^<]*)<\/pre>/)?.[1];
      assert.ok(result?.startsWith('PASS '), result || run.stdout);
      results.push(result);
    }
    console.log(results.join('\n'));
  } finally {
    rmSync(folderTemp, { recursive: true, force: true });
  }
});

const fixture = String.raw`
import React, { StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { AnchoredPopover } from './AnchoredPopover.jsx';
import { LinkDocRender } from '../link/LinkDocRender.jsx';

const style = document.createElement('style');
style.textContent = ':root { --color-fd-border:#aaa; --color-fd-popover:white; } body {margin:24px;font:16px sans-serif} .clip {overflow:hidden;width:220px;height:70px;transform:translateX(0);border-radius:8px} .scroll {overflow:auto;width:220px;height:70px} table {width:700px;border-collapse:collapse} td {height:28px} .tooltip {display:block;width:260px;height:90px;background:white;border:1px solid black}';
document.head.append(style);
let selected = '';
function Demo({ kind = 'clip', isTooltip = false, isLong = false }) {
  const ref = useRef(null);
  const [isOpen, setIsOpen] = useState(true);
  return <div className={kind} id="table-wrap"><table><tbody><tr><td>Header</td></tr><tr><td>
    <span ref={ref} id="anchor" onMouseDown={() => {}}>
      {isTooltip ? <>Info{isOpen && <AnchoredPopover anchorRef={ref} className="tooltip" role="tooltip"><button onClick={() => { selected = 'tooltip'; setIsOpen(false); }}>Tooltip action</button></AnchoredPopover>}</> :
      <LinkDocRender data={{ displayContent:'docs.md', targetList:isLong ? Array.from({length:60}, (_, index) => ({internalPath:'~wiki:docs/' + 'long-path/'.repeat(12) + index + '.md'})) : [{internalPath:'first.md'},{internalPath:'last.md'}] }} config={{isMultiple:true,isDropdownOpen:isOpen}} onEvent={(type, data) => {if(type === 'candidateSelectRequest') {selected=data.target.internalPath;setIsOpen(false);}}} />}
    </span>
  </td></tr></tbody></table></div>;
}
const root = createRoot(document.getElementById('root'));
function check(condition, message) {if (!condition) throw new Error(message);}
function mount(props) {flushSync(() => root.render(<StrictMode><Demo key={JSON.stringify(props)} {...props}/></StrictMode>));}
function popupGet() {return document.querySelector(':popover-open');}
function hitCheck(element) {
  const rect = element.getBoundingClientRect();
  const x = rect.left + Math.min(40,rect.width / 2);
  const y = rect.top + rect.height / 2;
  check(element.contains(document.elementFromPoint(x,y)), 'overlay is clipped or covered');
  return {x,y};
}
setTimeout(() => {
  try {
    for (const kind of ['clip','scroll']) {
      mount({kind});
      const popup = popupGet();
      check(popup, 'popup missing');
      const wrap = document.getElementById('table-wrap');
      const option = popup.lastElementChild;
      const point = hitCheck(option);
      check(point.y > wrap.getBoundingClientRect().bottom, 'test option must extend below table');
      check(document.getElementById('anchor').contains(option), 'DOM ownership lost');
      const leftBefore = popup.getBoundingClientRect().left;
      if (kind === 'scroll') {
        check(wrap.scrollWidth > wrap.clientWidth, 'horizontal scrolling lost');
        wrap.scrollLeft = 10;
        wrap.dispatchEvent(new Event('scroll'));
        check(wrap.scrollLeft === 10, 'table cannot scroll');
        check(popup.getBoundingClientRect().left < leftBefore, 'popup did not follow table scroll');
      }
      flushSync(() => option.click());
      check(selected === 'last.md', 'candidate click failed');
      check(!popupGet(), 'popup not removed after selection');
    }
    mount({isTooltip:true});
    const tooltip = popupGet();
    const rect = tooltip.getBoundingClientRect();
    check(rect.bottom > document.getElementById('table-wrap').getBoundingClientRect().bottom, 'tooltip does not cross table boundary');
    hitCheck(tooltip);
    hitCheck(tooltip.firstElementChild);
    flushSync(() => tooltip.firstElementChild.click());
    check(selected === 'tooltip', 'generic tooltip action failed');
    mount({kind:'scroll'});
    const anchor = document.getElementById('anchor');
    anchor.style.position = 'fixed';
    anchor.style.left = (innerWidth - 35) + 'px';
    anchor.style.top = (innerHeight - 45) + 'px';
    window.dispatchEvent(new Event('resize'));
    const bounds = popupGet().getBoundingClientRect();
    check(bounds.left >= 8 && bounds.right <= document.documentElement.clientWidth - 8, 'horizontal clamp failed');
    check(bounds.top >= 8 && bounds.bottom <= innerHeight - 8, 'vertical clamp failed');
    check(bounds.bottom <= anchor.getBoundingClientRect().top, 'popup did not flip above');
    hitCheck(popupGet().lastElementChild);
    mount({kind:'scroll',isLong:true});
    const popupLong = popupGet();
    check(popupLong.scrollHeight > popupLong.clientHeight, 'long list must scroll vertically');
    check(popupLong.getBoundingClientRect().right <= document.documentElement.clientWidth - 8, 'long paths exceed viewport');
    popupLong.scrollTop = popupLong.scrollHeight;
    const optionLast = popupLong.lastElementChild;
    hitCheck(optionLast);
    flushSync(() => optionLast.click());
    check(selected.endsWith('/59.md'), 'last item of long list is unreachable');
    mount({kind:'clip'});
    flushSync(() => root.unmount());
    check(!popupGet(), 'top-layer content leaked after unmount');
    document.getElementById('result').textContent = 'PASS viewport=' + innerWidth + 'x' + innerHeight + ' clipping, clicks, scroll, tooltip, clamp, flip, long list, cleanup';
  } catch (error) {document.getElementById('result').textContent = 'FAIL ' + error.stack;}
}, 100);
`;