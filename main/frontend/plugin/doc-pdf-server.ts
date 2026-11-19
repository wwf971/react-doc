import { spawn } from 'node:child_process';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';

// Pages printed to a PDF by a browser of the machine the development server runs on (design:
// doc_page_impl_pagination.md#downloading-a-pdf). A page cannot print itself to a file: its
// browser only offers a print dialog. The development server can: it opens the document of the
// pages in a Chromium-family browser without a window and lets that browser print it, which is
// what "Save as PDF" of the print dialog does. The file therefore holds text as text and rules
// as lines, not a picture of them.
//
//   GET  {endpoint}/status     -> { code, data: { isAvailable, browser }, message }
//   POST {endpoint}/print      body { html, title? } -> the PDF (application/pdf),
//                              or { code, data, message } when it could not be made
//   GET  {endpoint}/job/{id}   -> the document of a print job: what the browser opens
//
// html is a whole document: the sheets, the stylesheets of the page and the print stylesheet
// (@page size, one sheet a page), built by the page (comp-doc/pagination/page-flow-export.js).
// It is served back from this server, so what it names by url (a stylesheet, a font, an image)
// is read as the page reads it.
//
// The browser: the first found of Chrome, Edge, Chromium and Brave at their usual places, or
// the one REACT_DOC_BROWSER names. One job runs at a time, in a profile of its own that is
// removed with the job, so the reader's browser and its profile are never touched.

export const DOC_PDF_ENDPOINT_NAME = '__doc-pdf';
export const DOC_PDF_BROWSER_ENV = 'REACT_DOC_BROWSER';
// how long a browser may take over one job, and how large a document may be
const PRINT_TIMEOUT_MS = 60000;
const BODY_SIZE_MAX = 96 * 1024 * 1024;
// how long the browser waits for the document to settle (fonts, images) before it prints
const PRINT_SETTLE_MS = 8000;

type Result = { code: number; data: any; message: string };
type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
type BrowserFindOptions = { platform?: string; env?: Record<string, string | undefined>; homeDir?: string; isFile?: (file: string) => boolean };

// where a Chromium-family browser usually is, by platform: [label, path]. on linux the names
// are looked for along PATH
export function docPdfBrowserCandidateListGet({ platform = process.platform, env = process.env, homeDir = os.homedir() }: BrowserFindOptions = {}): string[] {
  if (platform === 'darwin') {
    const appList = [
      'Google Chrome.app/Contents/MacOS/Google Chrome',
      'Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      'Chromium.app/Contents/MacOS/Chromium',
      'Brave Browser.app/Contents/MacOS/Brave Browser',
    ];
    return ['/Applications', path.join(homeDir, 'Applications')].flatMap((dir) => appList.map((app) => path.join(dir, app)));
  }
  if (platform === 'win32') {
    const dirList = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter((dir): dir is string => Boolean(dir));
    const appList = ['Google\\Chrome\\Application\\chrome.exe', 'Microsoft\\Edge\\Application\\msedge.exe', 'Chromium\\Application\\chrome.exe', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'];
    return appList.flatMap((app) => dirList.map((dir) => path.win32.join(dir, app)));
  }
  const nameList = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'brave-browser'];
  const dirList = String(env.PATH ?? '').split(':').filter(Boolean);
  return nameList.flatMap((name) => dirList.map((dir) => path.posix.join(dir, name)));
}

// the browser that prints: the one the environment names when it is a file, else the first
// candidate found; '' when the machine has none
export function docPdfBrowserFind(options: BrowserFindOptions = {}): string {
  const env = options.env ?? process.env;
  const isFile = options.isFile ?? ((file: string) => {
    try {
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  });
  const named = String(env[DOC_PDF_BROWSER_ENV] ?? '').trim();
  if (named !== '' && isFile(named)) return named;
  return docPdfBrowserCandidateListGet(options).find(isFile) ?? '';
}

// what the browser is started with to print one url into one file
export function docPdfBrowserArgListGet({ url, pdfFile, profileDir }: { url: string; pdfFile: string; profileDir: string }): string[] {
  return [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--hide-scrollbars',
    // the development server may serve https with a certificate of its own making
    '--ignore-certificate-errors',
    `--user-data-dir=${profileDir}`,
    // no date, title, url or page number of the browser's around the page: both spellings,
    // the newer browsers' and the older ones'
    '--no-pdf-header-footer',
    '--print-to-pdf-no-header',
    `--virtual-time-budget=${PRINT_SETTLE_MS}`,
    `--print-to-pdf=${pdfFile}`,
    url,
  ];
}

export function docPdfServerCreate({ endpoint }: { endpoint: string }) {
  const htmlByJob = new Map<string, string>();
  let jobCount = 0;
  // jobs run one after another: a browser started per job, never several at once
  let queue: Promise<unknown> = Promise.resolve();

  const statusGet = (): Result => {
    const browser = docPdfBrowserFind();
    return {
      code: 0,
      data: { isAvailable: browser !== '', browser },
      message: browser !== '' ? '' : browserMissingMessage(),
    };
  };

  const print = async (html: string, origin: string): Promise<{ pdf?: Buffer; message: string }> => {
    const browser = docPdfBrowserFind();
    if (browser === '') return { message: browserMissingMessage() };
    jobCount += 1;
    const jobId = `${Date.now().toString(36)}${jobCount.toString(36)}`;
    const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'react-doc-pdf-'));
    const pdfFile = path.join(jobDir, 'pages.pdf');
    htmlByJob.set(jobId, html);
    try {
      const run = await browserRun(browser, docPdfBrowserArgListGet({ url: `${origin}${endpoint}/job/${jobId}`, pdfFile, profileDir: path.join(jobDir, 'profile') }));
      if (!fs.existsSync(pdfFile)) return { message: `${path.basename(browser)} made no file${run.message ? `: ${run.message}` : ''}` };
      const pdf = fs.readFileSync(pdfFile);
      if (pdf.length < 5 || pdf.subarray(0, 5).toString('latin1') !== '%PDF-') return { message: `${path.basename(browser)} wrote a file that is no PDF` };
      return { pdf, message: '' };
    } finally {
      htmlByJob.delete(jobId);
      fs.rm(jobDir, { recursive: true, force: true }, () => undefined);
    }
  };

  const routeHandle = async (req: IncomingMessage, res: ServerResponse, route: string) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET' && route === '/status') {
      jsonSend(res, 200, statusGet());
      return;
    }
    if (req.method === 'GET' && route.startsWith('/job/')) {
      const html = htmlByJob.get(route.slice('/job/'.length));
      if (html === undefined) {
        jsonSend(res, 404, { code: -1, data: null, message: 'no such print job (a job is gone once it is printed)' });
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(html);
      return;
    }
    if (req.method === 'POST' && route === '/print') {
      const body = await bodyJsonRead(req);
      if (!body || typeof body.html !== 'string' || body.html.trim() === '') {
        jsonSend(res, 400, { code: -4, data: null, message: body === undefined ? `the body is not json, or larger than ${BODY_SIZE_MAX} bytes` : 'the body names "html", the document to print, with "title" optional' });
        return;
      }
      const origin = `${(req.socket as any)?.encrypted ? 'https' : 'http'}://${req.headers.host ?? 'localhost'}`;
      const job = queue.then(() => print(body.html, origin));
      queue = job.catch(() => undefined);
      const { pdf, message } = await job;
      if (!pdf) {
        jsonSend(res, 200, { code: -1, data: null, message });
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Length', String(pdf.length));
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${String(body.title ?? 'pages')}.pdf`)}`);
      res.end(pdf);
      return;
    }
    jsonSend(res, 404, { code: -2, data: null, message: `no route ${req.method} ${endpoint}${route}: GET /status, POST /print` });
  };

  const middleware: Middleware = (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== endpoint && !url.pathname.startsWith(`${endpoint}/`)) {
      next();
      return;
    }
    void routeHandle(req, res, url.pathname.slice(endpoint.length)).catch((error) => {
      if (!res.headersSent) jsonSend(res, 500, { code: -1, data: null, message: String(error?.message ?? error) });
      else res.end();
    });
  };

  return { middleware, statusGet };
}

function browserMissingMessage(): string {
  return `no Chrome, Edge, Chromium or Brave was found on the machine of the development server (${DOC_PDF_BROWSER_ENV} names another one)`;
}

// the browser run to its end: { message } what it said when it ended badly, '' otherwise
function browserRun(browser: string, argList: string[]): Promise<{ message: string }> {
  return new Promise((resolve) => {
    let errorText = '';
    let isDone = false;
    const finish = (message: string) => {
      if (isDone) return;
      isDone = true;
      clearTimeout(timer);
      resolve({ message });
    };
    const child = spawn(browser, argList, { stdio: ['ignore', 'ignore', 'pipe'] });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(`it did not finish within ${PRINT_TIMEOUT_MS / 1000} s`);
    }, PRINT_TIMEOUT_MS);
    child.stderr?.on('data', (chunk) => {
      if (errorText.length < 4000) errorText += String(chunk);
    });
    child.on('error', (error) => finish(String(error?.message ?? error)));
    // a browser prints its own notes on stderr also when all went well: they are told only
    // when it ended with a code
    child.on('exit', (code) => finish(code === 0 || code === null ? '' : `exit code ${code}: ${errorText.trim().split('\n').slice(-2).join(' ')}`));
  });
}

async function bodyJsonRead(req: IncomingMessage): Promise<any> {
  const chunkList: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    size += buffer.length;
    if (size > BODY_SIZE_MAX) return undefined;
    chunkList.push(buffer);
  }
  const text = Buffer.concat(chunkList).toString('utf-8');
  if (text.trim() === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function jsonSend(res: ServerResponse, statusCode: number, payload: Result) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}
