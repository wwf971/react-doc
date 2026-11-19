import assert from 'node:assert/strict';
import test from 'node:test';
import { DOC_PDF_BROWSER_ENV, docPdfBrowserArgListGet, docPdfBrowserCandidateListGet, docPdfBrowserFind } from './doc-pdf-server.ts';

// the browser printing pages to a PDF (doc_page_impl_pagination.md#downloading-a-pdf): where it
// is looked for, which one is taken, and what it is started with

test('a browser is looked for at the usual places of its platform', () => {
  const mac = docPdfBrowserCandidateListGet({ platform: 'darwin', homeDir: '/Users/a' });
  assert.equal(mac[0], '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  assert.ok(mac.includes('/Users/a/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'));
  const win = docPdfBrowserCandidateListGet({ platform: 'win32', env: { PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)' } });
  assert.equal(win[0], 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
  assert.ok(win.includes('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'));
  // elsewhere: its names along PATH
  const linux = docPdfBrowserCandidateListGet({ platform: 'linux', env: { PATH: '/usr/bin:/snap/bin' } });
  assert.deepEqual(linux.slice(0, 2), ['/usr/bin/google-chrome', '/snap/bin/google-chrome']);
  assert.ok(linux.includes('/snap/bin/chromium'));
});

test('the browser taken: the one the environment names when it is a file, else the first found, else none', () => {
  const edge = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
  const fileSet = new Set([edge, '/opt/my-browser']);
  const isFile = (file) => fileSet.has(file);
  assert.equal(docPdfBrowserFind({ platform: 'darwin', env: {}, homeDir: '/Users/a', isFile }), edge);
  assert.equal(docPdfBrowserFind({ platform: 'darwin', env: { [DOC_PDF_BROWSER_ENV]: '/opt/my-browser' }, homeDir: '/Users/a', isFile }), '/opt/my-browser');
  // a name that is no file is passed over, not trusted
  assert.equal(docPdfBrowserFind({ platform: 'darwin', env: { [DOC_PDF_BROWSER_ENV]: '/opt/gone' }, homeDir: '/Users/a', isFile }), edge);
  assert.equal(docPdfBrowserFind({ platform: 'linux', env: { PATH: '/usr/bin' }, isFile: () => false }), '');
});

test('the browser prints one url into one file, without a window, in a profile of its own', () => {
  const argList = docPdfBrowserArgListGet({ url: 'http://localhost:1/__doc-pdf/job/a', pdfFile: '/tmp/x/pages.pdf', profileDir: '/tmp/x/profile' });
  assert.equal(argList[argList.length - 1], 'http://localhost:1/__doc-pdf/job/a');
  assert.ok(argList.includes('--print-to-pdf=/tmp/x/pages.pdf'));
  assert.ok(argList.includes('--user-data-dir=/tmp/x/profile'));
  assert.ok(argList.some((arg) => arg.startsWith('--headless')));
  // nothing of the browser's own around the page
  assert.ok(argList.includes('--no-pdf-header-footer'));
});
