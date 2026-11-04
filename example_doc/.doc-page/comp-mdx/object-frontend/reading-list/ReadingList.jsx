import { observer } from 'mobx-react-lite';
import { Book, Plus } from '../../../../../main/frontend/UICommon.js';
import { useCompState } from '../../../../../main/comp-doc/registry/use-comp-state.js';
import { EditValueInline } from '../../../../../main/comp-doc/edit/EditValueInline.jsx';
import './ReadingList.css';

// The modes of the frontend object type example.reading-list of the
// demonstration (declared in .doc-page/object-frontend.yaml; design:
// main/doc_page_impl_obj_frontend.md). A reading list is a small system of
// its own: its data is assets of the object, of two kinds,
//
//   book   { title, author, status: want | reading | read }   one asset per book
//   note   { book: {key of a book}, text }                     one asset per note, naming its book
//
// and each mode is one way to work with it. A mode is a component rendered
// in the placement objectFrontend; it receives data.param (the mode's own
// parameters under the block's) and config.objectFrontend, the object and
// its api: assetList(kind), assetDataGet(key), assetCreate, assetWrite,
// modeSet / paramSet / blockSet (the block switched, written into its
// document unless { isSaved: false }).
//
//   ReadingList        modes shelf (param layout: table) and cards (layout: cards); param
//                      status filters the books, and the filter buttons write it into the block
//   ReadingListAdd     mode add: a form registering a new book
//   ReadingListBook    mode book: one book (param book) with its notes; a note is added here
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
  // opening a book switches the block for as long as the page is open: the
  // document keeps its shelf
  const bookOpen = (book) => void service.blockSet({ mode: 'book', param: { book: book.key, back: service.mode?.id } }, { isSaved: false });
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
      </div>
      {bookList.length === 0 ? <p className="doc-note">{statusFilter ? `No book ${STATUS_LABEL[statusFilter]}.` : 'No book yet.'}</p> : null}
      {param.layout === 'cards' ? (
        <div className="reading-list-card-grid">
          {bookList.map((book) => (
            <button key={book.key} type="button" className="reading-list-card" onClick={() => bookOpen(book)}>
              <span className="reading-list-card-title">{book.data?.title ?? (book.status === 'loading' ? '…' : book.key)}</span>
              <span className="doc-note">{book.data?.author ?? ''}</span>
              <span className="reading-list-card-foot">
                <span className="doc-badge-outline">{STATUS_LABEL[book.data?.status] ?? book.data?.status ?? ''}</span>
                {noteCountByBook[book.key] ? <span className="doc-note">{noteCountByBook[book.key]} note(s)</span> : null}
              </span>
            </button>
          ))}
        </div>
      ) : bookList.length > 0 ? (
        <table className="reading-list-table">
          <thead><tr><th>title</th><th>author</th><th>status</th><th>notes</th></tr></thead>
          <tbody>
            {bookList.map((book) => (
              <tr key={book.key}>
                <td><button type="button" className="reading-list-link" onClick={() => bookOpen(book)}>{book.data?.title ?? book.key}</button></td>
                <td>{book.data?.author ?? ''}</td>
                <td>
                  <button type="button" className="doc-badge-outline reading-list-status" disabled={!service.isWritable} title={service.isWritable ? 'the next status, written into the book asset' : service.writeUnavailableReason} onClick={() => void bookStatusNext(service, book)}>
                    {STATUS_LABEL[book.data?.status] ?? book.data?.status ?? ''}
                  </button>
                </td>
                <td className="doc-note">{noteCountByBook[book.key] ?? 0}</td>
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
  const draft = useCompState(config, { title: '', author: '', message: '', isSubmitting: false });
  if (!service) return null;
  const value = draft.value;
  const submit = async () => {
    if (!value.title.trim()) {
      draft.patch({ message: 'a book needs a title' });
      return;
    }
    draft.patch({ isSubmitting: true, message: '' });
    const result = await service.assetCreate({ kind: 'book', data: { title: value.title.trim(), author: value.author.trim(), status: 'want' } });
    draft.patch({ isSubmitting: false, ...(result.code === 0 ? { title: '', author: '', message: `added as ${result.data.key}` } : { message: result.message }) });
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
  const key = String(data.param?.book ?? '');
  const book = key ? service.assetDataGet(key) : { status: 'error', message: 'param book names the book (its key)' };
  const noteList = service.assetList('note')
    .map((asset) => ({ key: asset.key, ...service.assetDataGet(asset.key) }))
    .filter((note) => note.data?.book === key);
  const back = () => void service.blockSet({ mode: data.param?.back || 'shelf', param: {} }, { isSaved: false });
  const noteAdd = async () => {
    if (!draft.value.text.trim()) return;
    const result = await service.assetCreate({ kind: 'note', data: { book: key, text: draft.value.text.trim() } });
    draft.patch(result.code === 0 ? { text: '', message: '' } : { message: result.message });
  };
  return (
    <div className="reading-list not-prose">
      <div className="reading-list-head">
        <Book size={15} aria-hidden="true" />
        <span className="reading-list-title">{book.data?.title ?? key}</span>
        <span className="doc-note">{book.data?.author ?? ''}</span>
        {book.data?.status ? <span className="doc-badge-outline">{STATUS_LABEL[book.data.status] ?? book.data.status}</span> : null}
        <button type="button" className="doc-button" onClick={back}>Back</button>
      </div>
      {book.status === 'error' ? <p className="doc-error">{book.message}</p> : null}
      <ul className="reading-list-note-list">
        {noteList.length === 0 ? <li className="doc-note">No note on this book yet.</li> : noteList.map((note) => <li key={note.key}>{note.data?.text}</li>)}
      </ul>
      {service.isWritable && book.status === 'done' ? (
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

export const ReadingListStats = observer(function ReadingListStats({ config = {} }) {
  const service = config.objectFrontend;
  if (!service) return null;
  const bookList = bookListRead(service);
  const noteCount = service.assetList('note').length;
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
      </div>
    </div>
  );
});

// the books with their data (loading until their asset is read)
function bookListRead(service) {
  return service.assetList('book').map((asset) => ({ key: asset.key, ...service.assetDataGet(asset.key) }));
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
export const readingListStatsDefineOptions = modeDefine('Reading list: numbers');
