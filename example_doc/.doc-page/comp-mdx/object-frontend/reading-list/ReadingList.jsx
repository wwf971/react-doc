import { observer } from 'mobx-react-lite';
import { Book, Plus, Search } from '../../../../../main/frontend/UICommon.js';
import { useCompState } from '../../../../../main/comp-doc/registry/use-comp-state.js';
import { EditValueInline } from '../../../../../main/comp-doc/edit/EditValueInline.jsx';
import { ObjectFrontendAssetPathInput } from '../../../../../main/comp-doc/object-frontend/ObjectFrontendAssetPathInput.jsx';
import { ObjectFrontendAssetSearchPanel } from '../../../../../main/comp-doc/object-frontend/ObjectFrontendAssetSearchPanel.jsx';
import { objectFrontendAssetPathBuild } from '../../../../../main/frontend/src/lib/doc-object-frontend.js';
import './ReadingList.css';

// The modes of the frontend object type example.reading-list of the
// demonstration (declared in .doc-page/object-frontend.yaml; design:
// main/doc_page_impl_obj_frontend.md). A reading list is a small system of
// its own: its data is assets of the object, of two kinds,
//
//   book   { title, author, genre, status: want | reading | read }   one asset per book
//   note   { book: {key of a book}, text }                            one asset per note, naming its book
//
// each named (a book by its title) and indexed by paths, the recommended
// pattern with the kind first: a book by its genre and by its author, a
// note by its book, so the assets can be browsed both ways
//
//   /book/sci-fi/dune   /author/frank-herbert/dune   /note/dune/1
//
// a note names its book by the key, which never changes, not by a path,
// which is an index the list may rearrange. each mode is one way to work
// with the list: a component rendered in the placement objectFrontend,
// given data.param and config.objectFrontend, the object and its api
// (assets by any asset reference: a path, a key, name:…; their search and
// path completion; modeSet / paramSet / blockSet switching the block).
//
//   ReadingList        modes shelf (param layout: table) and cards (layout: cards); param
//                      status filters the books, and the filter buttons write it into the block
//   ReadingListAdd     mode add: a form registering a new book, its paths built from it
//   ReadingListBook    mode book: one book (param book: any asset reference) with its notes
//   ReadingListFind    mode find: the assets searched by words, and browsed by their paths
//   ReadingListStats   mode stats: how many books of each status, how many notes

const STATUS_LIST = ['want', 'reading', 'read'];
const STATUS_LABEL = { want: 'to read', reading: 'reading', read: 'read' };

export const ReadingList = observer(function ReadingList({ data = {}, config = {} }) {
  const service = config.objectFrontend;
  if (!service) return <p className="doc-error">ReadingList is a mode of a reading list (ObjectFrontend).</p>;
  const param = data.param ?? {};
  const statusFilter = STATUS_LIST.includes(param.status) ? param.status : '';
  const bookList = bookListRead(service).filter((book) => !statusFilter || book.data?.status === statusFilter);
  const noteCountByBook = noteCountByBookGet(service);
  return (
    <div className="reading-list not-prose">
      <div className="reading-list-head">
        <Book size={15} aria-hidden="true" />
        <span className="reading-list-title">{service.object.name || 'Reading list'}</span>
        <span className="doc-button-group" role="group" aria-label="Status filter">
          {['', ...STATUS_LIST].map((status) => (
            <button key={status || 'all'} type="button" aria-pressed={status === statusFilter} title="kept in the block's param" onClick={() => void service.paramSet({ status: status || null })}>
              {status ? STATUS_LABEL[status] : 'all'}
            </button>
          ))}
        </span>
        <button type="button" className="doc-button" onClick={() => void service.modeSet('add', { isSaved: false })}>
          <Plus size={12} aria-hidden="true" />
          <span>Add a book</span>
        </button>
        <button type="button" className="doc-button" onClick={() => void service.modeSet('find', { isSaved: false })}>
          <Search size={12} aria-hidden="true" />
          <span>Find</span>
        </button>
      </div>
      {bookList.length === 0 ? <p className="doc-note">{statusFilter ? `No book ${STATUS_LABEL[statusFilter]}.` : 'No book yet.'}</p> : null}
      {param.layout === 'cards' ? (
        <div className="reading-list-card-grid">
          {bookList.map((book) => (
            <button key={book.key} type="button" className="reading-list-card" onClick={() => bookOpen(service, book.asset)}>
              <span className="reading-list-card-title">{book.data?.title ?? book.asset.name ?? book.key}</span>
              <span className="doc-note">{book.data?.author ?? book.message}</span>
              <span className="reading-list-card-foot">
                <span className="doc-badge-outline" data-error={book.status === 'error' ? '' : undefined}>{book.status === 'error' ? book.assetStatus ?? 'unreadable' : STATUS_LABEL[book.data?.status] ?? ''}</span>
                {noteCountByBook[book.key] ? <span className="doc-note">{noteCountByBook[book.key]} note(s)</span> : null}
              </span>
            </button>
          ))}
        </div>
      ) : bookList.length > 0 ? (
        <table className="reading-list-table">
          <thead><tr><th>title</th><th>author</th><th>genre</th><th>status</th><th>notes</th></tr></thead>
          <tbody>
            {bookList.map((book) => (
              <tr key={book.key}>
                <td><button type="button" className="reading-list-link" onClick={() => bookOpen(service, book.asset)}>{book.data?.title ?? book.asset.name ?? book.key}</button></td>
                {book.status === 'error' ? <td colSpan={4} className="doc-error">{book.message}</td> : (
                  <>
                    <td>{book.data?.author ?? ''}</td>
                    <td className="doc-note">{book.data?.genre ?? ''}</td>
                    <td>
                      <button type="button" className="doc-badge-outline reading-list-status" disabled={!service.isWritable} title={service.isWritable ? 'the next status, written into the book asset' : service.writeUnavailableReason} onClick={() => void bookStatusNext(service, book)}>
                        {STATUS_LABEL[book.data?.status] ?? book.data?.status ?? ''}
                      </button>
                    </td>
                    <td className="doc-note">{noteCountByBook[book.key] ?? 0}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
});

export const ReadingListAdd = observer(function ReadingListAdd({ config = {} }) {
  const service = config.objectFrontend;
  const draft = useCompState(config, { title: '', author: '', genre: '', message: '', isSubmitting: false });
  if (!service) return null;
  const value = draft.value;
  // the paths of the new book, the recommended pattern: kind first
  const pathList = value.title.trim()
    ? [objectFrontendAssetPathBuild('book', value.genre || 'unsorted', value.title), ...(value.author.trim() ? [objectFrontendAssetPathBuild('author', value.author, value.title)] : [])]
    : [];
  const submit = async () => {
    if (!value.title.trim()) {
      draft.patch({ message: 'a book needs a title' });
      return;
    }
    draft.patch({ isSubmitting: true, message: '' });
    const result = await service.assetCreate({
      kind: 'book',
      name: value.title.trim(),
      pathList,
      data: { title: value.title.trim(), author: value.author.trim(), genre: value.genre.trim(), status: 'want' },
    });
    draft.patch({ isSubmitting: false, ...(result.code === 0 ? { title: '', author: '', genre: '', message: `added as ${pathList[0]}` } : { message: result.message }) });
  };
  return (
    <div className="reading-list not-prose">
      <div className="reading-list-head">
        <Plus size={15} aria-hidden="true" />
        <span className="reading-list-title">Add a book to {service.object.name || 'the list'}</span>
      </div>
      {!service.isWritable ? <p className="doc-note">{service.writeUnavailableReason}</p> : (
        <div className="reading-list-form">
          <span className="doc-note">title</span>
          <EditValueInline value={value.title} placeholder="(the title)" isLocked={value.isSubmitting} onCommit={(text) => draft.patch({ title: text })} />
          <span className="doc-note">author</span>
          <EditValueInline value={value.author} placeholder="(the author)" isLocked={value.isSubmitting} onCommit={(text) => draft.patch({ author: text })} />
          <span className="doc-note">genre</span>
          <EditValueInline value={value.genre} placeholder="(sci-fi, non-fiction, …)" isLocked={value.isSubmitting} onCommit={(text) => draft.patch({ genre: text })} />
          <span className="doc-note">paths</span>
          <span className="doc-note">{pathList.length > 0 ? pathList.join(' · ') : 'made from the title, the genre and the author'}</span>
          <span />
          <span className="reading-list-form-actions">
            <button type="button" className="doc-button" data-primary="" disabled={value.isSubmitting} onClick={() => void submit()}>Add the book</button>
            <button type="button" className="doc-button" onClick={() => void service.modeSet('shelf', { isSaved: false })}>Back to the shelf</button>
            {value.message ? <span className="doc-note">{value.message}</span> : null}
          </span>
        </div>
      )}
    </div>
  );
});

export const ReadingListBook = observer(function ReadingListBook({ data = {}, config = {} }) {
  const service = config.objectFrontend;
  const draft = useCompState(config, { text: '', message: '' });
  if (!service) return null;
  // the book: any asset reference (a path, a key, name:…)
  const bookRef = String(data.param?.book ?? '');
  const resolved = bookRef ? service.assetResolve(bookRef) : { status: 'unknown', message: 'param book names the book: a path (/book/…), a key, name:…' };
  const book = resolved.asset && resolved.status === 'found' ? service.assetDataGet(resolved.asset.key) : undefined;
  const key = resolved.asset?.key ?? '';
  const noteList = key
    ? service.assetList('note').map((asset) => ({ asset, ...service.assetDataGet(asset.key) })).filter((note) => note.data?.book === key)
    : [];
  const back = () => void service.blockSet({ mode: data.param?.back || 'shelf', param: {} }, { isSaved: false });
  const noteAdd = async () => {
    const text = draft.value.text.trim();
    if (!text) return;
    const bookSegment = (resolved.asset?.pathList?.[0] ?? '').split('/').pop() || key;
    const result = await service.assetCreate({
      kind: 'note',
      name: text.split(/\s+/).slice(0, 5).join(' '),
      pathList: [objectFrontendAssetPathBuild('note', bookSegment, String(noteList.length + 1))],
      data: { book: key, text },
    });
    draft.patch(result.code === 0 ? { text: '', message: '' } : { message: result.message });
  };
  return (
    <div className="reading-list not-prose">
      <div className="reading-list-head">
        <Book size={15} aria-hidden="true" />
        <span className="reading-list-title">{book?.data?.title ?? resolved.asset?.name ?? bookRef}</span>
        <span className="doc-note">{book?.data?.author ?? ''}</span>
        {book?.data?.status ? <span className="doc-badge-outline">{STATUS_LABEL[book.data.status] ?? book.data.status}</span> : null}
        <button type="button" className="doc-button" onClick={back}>Back</button>
      </div>
      {resolved.status === 'loading' ? <p className="doc-note">reading the list…</p> : null}
      {resolved.status !== 'found' && resolved.status !== 'loading' ? <p className="doc-error">{resolved.message}</p> : null}
      {book?.status === 'error' ? <p className="doc-error">{book.message}</p> : null}
      {(resolved.asset?.pathList ?? []).length > 0 ? <p className="doc-note">{resolved.asset.pathList.join(' · ')}</p> : null}
      {resolved.status === 'found' ? (
        <ul className="reading-list-note-list">
          {noteList.length === 0 ? <li className="doc-note">No note on this book yet.</li> : noteList.map((note) => <li key={note.asset.key}>{note.data?.text ?? note.message}</li>)}
        </ul>
      ) : null}
      {service.isWritable && book?.status === 'done' ? (
        <div className="reading-list-form">
          <span className="doc-note">note</span>
          <span className="reading-list-form-actions">
            <EditValueInline value={draft.value.text} placeholder="(a note on the book)" onCommit={(text) => draft.patch({ text })} />
            <button type="button" className="doc-button" onClick={() => void noteAdd()}>Add the note</button>
            {draft.value.message ? <span className="doc-error">{draft.value.message}</span> : null}
          </span>
        </div>
      ) : null}
    </div>
  );
});

// the assets of the list found two ways, with the two ui pieces the frontend
// object service layer ships for modes: a search by words (names, paths,
// kinds) and a path typed with completion (the folders /book, /author,
// /note and below). choosing a book opens it, a note opens its book
export const ReadingListFind = observer(function ReadingListFind({ data = {}, config = {} }) {
  const service = config.objectFrontend;
  const state = useCompState(config, { path: '', message: '' });
  if (!service) return null;
  const open = (asset) => {
    if (!asset) return;
    if (asset.kind === 'note') {
      const bookKey = service.assetDataGet(asset.key).data?.book;
      if (!bookKey) {
        state.patch({ message: `the note ${asset.name || asset.key} names no book` });
        return;
      }
      void service.blockSet({ mode: 'book', param: { book: bookKey, back: 'find' } }, { isSaved: false });
      return;
    }
    void service.blockSet({ mode: 'book', param: { book: asset.pathList?.[0] ?? asset.key, back: 'find' } }, { isSaved: false });
  };
  return (
    <div className="reading-list not-prose">
      <div className="reading-list-head">
        <Search size={15} aria-hidden="true" />
        <span className="reading-list-title">Find in {service.object.name || 'the list'}</span>
        <button type="button" className="doc-button" onClick={() => void service.blockSet({ mode: 'shelf', param: {} }, { isSaved: false })}>Back to the shelf</button>
      </div>
      <ObjectFrontendAssetSearchPanel
        object={service.ref}
        sessionKey={`${config.instanceId}:search`}
        kindList={data.param?.kindList}
        placeholder="a title, an author, a genre, kind:note, path:/author/…"
        onChoose={(hit) => open(hit.asset)}
      />
      <div className="reading-list-form">
        <span className="doc-note">path</span>
        <ObjectFrontendAssetPathInput
          object={service.ref}
          value={state.value.path}
          isMissingWarned
          placeholder="/book/sci-fi/…  /author/…  /note/…"
          onChange={(text) => state.patch({ path: text, message: '' })}
          onCommit={(text) => state.patch({ path: text })}
          onChoose={(asset) => open(asset)}
        />
      </div>
      {state.value.message ? <p className="doc-error">{state.value.message}</p> : null}
    </div>
  );
});

export const ReadingListStats = observer(function ReadingListStats({ config = {} }) {
  const service = config.objectFrontend;
  if (!service) return null;
  const bookList = bookListRead(service);
  const noteCount = service.assetList('note').length;
  const missingCount = service.object.assetList.filter((asset) => asset.status !== 'found').length;
  return (
    <div className="reading-list not-prose">
      <div className="reading-list-stats">
        {STATUS_LIST.map((status) => (
          <span key={status} className="reading-list-stat">
            <span className="reading-list-stat-value">{bookList.filter((book) => book.data?.status === status).length}</span>
            <span className="doc-note">{STATUS_LABEL[status]}</span>
          </span>
        ))}
        <span className="reading-list-stat">
          <span className="reading-list-stat-value">{noteCount}</span>
          <span className="doc-note">notes</span>
        </span>
        {missingCount > 0 ? (
          <span className="reading-list-stat">
            <span className="reading-list-stat-value">{missingCount}</span>
            <span className="doc-error">missing from the store</span>
          </span>
        ) : null}
      </div>
    </div>
  );
});

// opening a book switches the block for as long as the page is open (the
// document keeps its shelf), naming the book by its first path
function bookOpen(service, asset) {
  void service.blockSet({ mode: 'book', param: { book: asset.pathList?.[0] ?? asset.key, back: service.mode?.id } }, { isSaved: false });
}

// the books with their data: loading until their asset is read; an asset
// the store lacks is an error saying so (assetStatus missing | deleted)
function bookListRead(service) {
  return service.assetList('book').map((asset) => ({ key: asset.key, asset, ...service.assetDataGet(asset.key) }));
}

function noteCountByBookGet(service) {
  const countByBook = {};
  for (const asset of service.assetList('note')) {
    const book = service.assetDataGet(asset.key).data?.book;
    if (book) countByBook[book] = (countByBook[book] ?? 0) + 1;
  }
  return countByBook;
}

// want -> reading -> read -> want, written into the book's asset
function bookStatusNext(service, book) {
  const status = STATUS_LIST[(STATUS_LIST.indexOf(book.data?.status) + 1) % STATUS_LIST.length];
  return service.assetWrite(book.key, { ...book.data, status }, `${book.data?.title}: ${status}`);
}

const modeDefine = (label) => ({
  placementList: ['objectFrontend'],
  expose: { meta: { label, isNotInDoc: true } },
});

export const readingListDefineOptions = modeDefine('Reading list: shelf');
export const readingListAddDefineOptions = modeDefine('Reading list: add a book');
export const readingListBookDefineOptions = modeDefine('Reading list: one book');
export const readingListFindDefineOptions = modeDefine('Reading list: find');
export const readingListStatsDefineOptions = modeDefine('Reading list: numbers');
