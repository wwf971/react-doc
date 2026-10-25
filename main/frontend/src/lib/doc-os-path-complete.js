// Completion of a path of the file system of the computer the development
// server runs on (design: doc_page_impl_source.md#os-path-completion).
// Unlike a source path, the candidates cannot come from a manifest the page
// holds: the folder typed so far is listed by the server (source api
// GET os/list) while the text changes.
//
//   text "~/proj/react-d"  ->  folder "~/proj/" listed, the names starting
//                              with "react-d" offered as "~/proj/react-doc/"
//
// one listing per folder text, kept for ttlMs and shared by every field. the
// candidates are always computed from the text as it is now and the
// listings at hand, so the answer to a request made for an earlier text
// (another folder) is never shown for this one: it only fills the cache.
// several requests for one folder share one fetch.
//
// a candidate { path, name, kind: 'dir' | 'file', isDocPage } keeps the
// spelling of what was typed before its name ("~/", "./", an absolute
// path); a folder ends with "/", so choosing it continues into it.

export const OS_PATH_CACHE_TTL_MS = 15000;

// the folder part of a text (up to and including its last "/") and the
// part of the name typed after it
export function osPathTextSplit(text) {
  const textNormalized = String(text ?? '');
  const indexSlash = textNormalized.lastIndexOf('/');
  if (textNormalized === '~') return { dirText: '~/', namePrefix: '' };
  if (indexSlash < 0) return { dirText: '', namePrefix: textNormalized };
  return { dirText: textNormalized.slice(0, indexSlash + 1), namePrefix: textNormalized.slice(indexSlash + 1) };
}

// what a path specification allows of one entry of a listing
//   spec { kind: 'dir' | 'file' | 'any', extList? }
// a folder is always offered when files are asked for: it leads to them
export function osPathEntryIsOffered(entry, spec = { kind: 'any' }) {
  if (entry.kind === 'dir') return true;
  if (spec.kind === 'dir') return false;
  const extList = (spec.extList ?? []).map((ext) => String(ext).replace(/^\./, '').toLowerCase());
  if (extList.length === 0) return true;
  const indexDot = entry.name.lastIndexOf('.');
  return indexDot > 0 && extList.includes(entry.name.slice(indexDot + 1).toLowerCase());
}

export class OsPathCompleter {
  // fetchList(dirText) -> Promise<{ code, data: { dirPath, entryList, isTruncated }, message }>
  constructor({ fetchList, ttlMs = OS_PATH_CACHE_TTL_MS, now = () => Date.now() }) {
    this.fetchList = fetchList;
    this.ttlMs = ttlMs;
    this.now = now;
    // dirText -> { time, result }
    this.listingByDirText = new Map();
    // dirText -> Promise, while fetched
    this.requestByDirText = new Map();
    this.listenerSet = new Set();
  }

  subscribe(listener) {
    this.listenerSet.add(listener);
    return () => this.listenerSet.delete(listener);
  }

  listingGet(dirText) {
    const listing = this.listingByDirText.get(dirText);
    if (!listing) return undefined;
    if (this.now() - listing.time > this.ttlMs) {
      this.listingByDirText.delete(dirText);
      return undefined;
    }
    return listing.result;
  }

  // the listing of the text's folder, fetched unless cached or on its way
  request(text) {
    const { dirText } = osPathTextSplit(text);
    if (this.listingGet(dirText) || this.requestByDirText.has(dirText)) return;
    const request = Promise.resolve()
      .then(() => this.fetchList(dirText))
      .catch((error) => ({ code: -1, data: null, message: String(error?.message ?? error) }))
      .then((result) => {
        this.requestByDirText.delete(dirText);
        this.listingByDirText.set(dirText, { time: this.now(), result });
        for (const listener of this.listenerSet) listener(dirText);
      });
    this.requestByDirText.set(dirText, request);
  }

  // the candidates of the text as it is now:
  //   { status: 'ready' | 'loading' | 'error', candidateList, message, dirPath, isTruncated }
  // 'loading' while the folder of this text is not listed yet; never the
  // candidates of another folder
  completeGet(text, spec = { kind: 'any' }) {
    const { dirText, namePrefix } = osPathTextSplit(text);
    const result = this.listingGet(dirText);
    if (!result) return { status: 'loading', candidateList: [], message: '', dirPath: '', isTruncated: false };
    if (result.code !== 0) return { status: 'error', candidateList: [], message: result.message, dirPath: '', isTruncated: false };
    const prefixLower = namePrefix.toLowerCase();
    // hidden entries only when their dot is typed
    const isHiddenShown = namePrefix.startsWith('.');
    const candidateList = result.data.entryList
      .filter((entry) => (isHiddenShown || !entry.name.startsWith('.')) && entry.name.toLowerCase().startsWith(prefixLower))
      .filter((entry) => osPathEntryIsOffered(entry, spec))
      .map((entry) => ({
        path: `${dirText}${entry.name}${entry.kind === 'dir' ? '/' : ''}`,
        name: entry.name,
        kind: entry.kind,
        isDocPage: entry.isDocPage === true,
      }));
    return { status: 'ready', candidateList, message: '', dirPath: result.data.dirPath, isTruncated: result.data.isTruncated === true };
  }

  // every listing dropped, e.g. after files were created
  clear() {
    this.listingByDirText.clear();
  }
}
