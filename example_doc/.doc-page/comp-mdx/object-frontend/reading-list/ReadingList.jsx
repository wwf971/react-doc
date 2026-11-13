import { observer } from 'mobx-react-lite';
import { Book, Plus, Search } from '../../../../../main/frontend/UICommon.js';
import { useCompState } from '../../../../../main/comp-doc/registry/use-comp-state.js';
import { EditValueInline } from '../../../../../main/comp-doc/edit/EditValueInline.jsx';
import { CellField } from '../../../../../main/comp-doc/cell/CellField.jsx';
import { useCell } from '../../../../../main/comp-doc/cell/use-cell.js';
import { cellTokenDefine } from '../../../../../main/comp-doc/cell/cell-define.js';
import { slashActionDefine } from '../../../../../main/comp-doc/slash/slash-define.js';
import { slashEffect } from '../../../../../main/frontend/src/lib/doc-slash.js';
import { ObjectFrontendAssetPathInput } from '../../../../../main/comp-doc/object-frontend/ObjectFrontendAssetPathInput.jsx';
import { ObjectFrontendAssetSearchPanel } from '../../../../../main/comp-doc/object-frontend/ObjectFrontendAssetSearchPanel.jsx';
import { objectFrontendAssetPathBuild, objectFrontendPartitionPlaceText } from '../../../../../main/frontend/src/lib/doc-object-frontend.js';
import './ReadingList.css';

// The modes of the frontend object type example.reading-list of the
// demonstration (declared in .doc-page/type.yaml; design:
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
// two texts of it are cells of the cell edit layer (main/doc_page_impl_edit_cell.md): the
// remark of a book (a cell of the shelf's table) and the text of a note. while the document is
// edited a click opens one in place, and its text may hold tokens beside words: a link
// (/link), a view of any object (/object), and the list's own kind, another book of this
// list ({{/book/sci-fi/dune}}, typed with /book or "{{"), which opens that book in the block.
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
  const cell = useReadingListCell(config);
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
          <thead><tr><th>title</th><th>author</th><th>genre</th><th>status</th><th>notes</th><th>remark</th></tr></thead>
          <tbody>
            {bookList.map((book) => (
              <tr key={book.key}>
                <td><button type="button" className="reading-list-link" onClick={() => bookOpen(service, book.asset)}>{book.data?.title ?? book.asset.name ?? book.key}</button></td>
                {book.status === 'error' ? <td colSpan={5} className="doc-error">{book.message}</td> : (
                  <>
                    <td>{book.data?.author ?? ''}</td>
                    <td className="doc-note">{book.data?.genre ?? ''}</td>
                    <td>
                      {/* a control that changes the book only while the document is edited
                          (main/doc_page_impl_obj_frontend.md#reading-and-editing) */}
                      {service.docState?.isEditing ? (
                        <button type="button" className="doc-badge-outline reading-list-status" disabled={!service.isEditable} title={service.isEditable ? 'the next status, written into the book asset' : service.editUnavailableReason} onClick={() => void bookStatusNext(service, book)}>
                          {STATUS_LABEL[book.data?.status] ?? book.data?.status ?? ''}
                        </button>
                      ) : <span className="doc-badge-outline reading-list-status">{STATUS_LABEL[book.data?.status] ?? book.data?.status ?? ''}</span>}
                    </td>
                    <td className="doc-note">{noteCountByBook[book.key] ?? 0}</td>
                    {/* a cell: words, links, views of objects, other books of the list; typed in
                        place while the document is edited (main/doc_page_impl_edit_cell.md) */}
                    <CellField
                      as="td"
                      className="reading-list-remark"
                      cell={cell}
                      fieldKey={`${config.instanceId}:remark:${book.key}`}
                      value={book.data?.remark ?? ''}
                      placeholder="(remark)"
                      isEditable={service.isEditable}
                      editUnavailableReason={service.docState?.isEditing ? service.editUnavailableReason : ''}
                      ariaLabel={`The remark on ${book.data?.title ?? book.key}`}
                      onCommit={(text) => bookRemarkSet(service, book, text)}
                    />
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
  const draft = useCompState(config, { title: '', author: '', genre: '', partition: '', message: '', isSubmitting: false });
  if (!service) return null;
  const value = draft.value;
  // the partition the book goes to, said beside the form: trying the page adds to the playground,
  // which git keeps out, so the books of the demonstration stay as they are (doc_page_impl_obj_frontend.md#partitions)
  const partitionList = service.partitionList ?? [];
  const partition = partitionList.find((one) => one.id === value.partition) ?? partitionList.find((one) => one.id === 'playground') ?? partitionList[0];
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
      ...(partition ? { partition: partition.id } : {}),
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
      {!service.isEditable ? <p className="doc-note">{service.editUnavailableReason}</p> : (
        <div className="reading-list-form">
          <span className="doc-note">title</span>
          <EditValueInline value={value.title} placeholder="(the title)" isLocked={value.isSubmitting} onCommit={(text) => draft.patch({ title: text })} />
          <span className="doc-note">author</span>
          <EditValueInline value={value.author} placeholder="(the author)" isLocked={value.isSubmitting} onCommit={(text) => draft.patch({ author: text })} />
          <span className="doc-note">genre</span>
          <EditValueInline value={value.genre} placeholder="(sci-fi, non-fiction, …)" isLocked={value.isSubmitting} onCommit={(text) => draft.patch({ genre: text })} />
          <span className="doc-note">paths</span>
          <span className="doc-note">{pathList.length > 0 ? pathList.join(' · ') : 'made from the title, the genre and the author'}</span>
          {partitionList.length > 0 ? (
            <>
              <span className="doc-note">partition</span>
              <span className="reading-list-form-actions">
                {/* one partition: nothing to choose, only where it goes */}
                {partitionList.length > 1 ? (
                  <select aria-label="The partition of the book" value={partition?.id ?? ''} disabled={value.isSubmitting} onChange={(event) => draft.patch({ partition: event.target.value })}>
                    {partitionList.map((one) => <option key={one.id} value={one.id}>{one.label}</option>)}
                  </select>
                ) : null}
                <span className="doc-note">goes to {objectFrontendPartitionPlaceText(partition, 'book')}</span>
              </span>
            </>
          ) : null}
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
  const cell = useReadingListCell(config);
  if (!service) return null;
  // the book: any asset reference (a path, a key, name:…)
  const bookRef = String(data.param?.book ?? '');
  const resolved = bookRef ? service.assetResolve(bookRef) : { status: 'unknown', message: 'param book names the book: a path (/book/…), a key, name:…' };
  const book = resolved.asset && resolved.status === 'found' ? service.assetDataGet(resolved.asset.key) : undefined;
  const key = resolved.asset?.key ?? '';
  const noteList = key
    ? service.assetList('note').map((asset) => ({ asset, ...service.assetDataGet(asset.key) })).filter((note) => note.data?.book === key)
    : [];
  const notePartition = (service.partitionList ?? []).find((one) => one.id === resolved.asset?.partition);
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
      // a note goes where its book is: what is made from an existing asset joins its partition
      ...(notePartition ? { partition: notePartition.id } : {}),
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
          {noteList.length === 0 ? <li className="doc-note">No note on this book yet.</li> : noteList.map((note) => (
            <li key={note.asset.key}>
              {note.status === 'error' ? note.message : (
                <CellField
                  as="div"
                  cell={cell}
                  fieldKey={`${config.instanceId}:note:${note.asset.key}`}
                  value={note.data?.text ?? ''}
                  isMultiline
                  isEditable={service.isEditable}
                  ariaLabel="The text of the note"
                  onCommit={(text) => service.assetWrite(note.asset.key, { ...note.data, text }, `a note on ${book?.data?.title ?? key}`)}
                />
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {service.isEditable && book?.status === 'done' ? (
        <div className="reading-list-form">
          <span className="doc-note">note</span>
          <span className="reading-list-form-actions">
            <CellField
              cell={cell}
              className="reading-list-note-new"
              fieldKey={`${config.instanceId}:note-new`}
              value={draft.value.text}
              placeholder="(a note on the book: /link, /object, /book)"
              isEditable
              ariaLabel="A new note"
              onCommit={(text) => draft.patch({ text })}
            />
            <button type="button" className="doc-button" onClick={() => void noteAdd()}>Add the note</button>
            <span className="doc-note">goes to {objectFrontendPartitionPlaceText(notePartition, 'note')}, beside its book</span>
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

// ---------- the cells of a reading list ----------

// /book: another book of this list, written into a cell as {{/book/sci-fi/dune}}. the list's
// own slash action, offered in its cells beside the page's (/link, /object): it walks the
// paths of the list's books through the api of the mode, a folder at a time
const readingListBookSlashAction = slashActionDefine({
  name: 'book',
  aliasList: ['b'],
  label: 'Book of this list',
  description: 'another book of the list, by its path',
  icon: Book,
  param: {
    placeholder: 'a path of the list: /book/…, /author/… (a folder goes on)',
    emptyText: 'No book of the list is at this path',
    itemListGet: (param, context) => (context.service?.assetComplete(param.trim() || '/', { kindList: ['book'] }) ?? []).map((one) => (one.kind === 'folder'
      ? { id: `dir:${one.path}`, kind: 'dir', label: `${one.segment}/`, detail: `${one.assetCount} book${one.assetCount === 1 ? '' : 's'}`, paramNext: `${one.path}/` }
      : { id: `book:${one.path}`, kind: 'file', label: one.asset.name || one.segment, detail: one.path, path: one.path })),
    itemChoose: (item) => (item.kind === 'dir' ? slashEffect.paramSet(item.paramNext) : slashEffect.replace(`{{${item.path}}}`)),
  },
});

// the list's own token kind: a brace token holding a path of the list ({{/book/sci-fi/dune}}),
// drawn as the title of the book, opening it in the block; a path nothing is at says so
const readingListBookToken = cellTokenDefine({
  name: 'book',
  label: 'Book of this list',
  description: 'another book of the list: {{/book/…}}',
  brace: { sigil: '' },
  read: (body) => (body.startsWith('/') ? { path: body } : undefined),
  textGet: (token, cell) => cell.context.service?.assetGet(token.data.path)?.name ?? token.data.path,
  Render: observer(function ReadingListBookMention({ token, cell }) {
    const service = cell.context.service;
    const resolved = service?.assetResolve(token.data.path) ?? { status: 'unknown', message: 'no list' };
    if (resolved.status !== 'found') return <span className="reading-list-mention is-missing" title={resolved.message}>{token.data.path}</span>;
    return (
      <button type="button" className="reading-list-link reading-list-mention" title={`${token.data.path}: open it in this block`} onClick={(event) => { event.stopPropagation(); bookOpen(service, resolved.asset); }}>
        {resolved.asset.name || resolved.asset.key}
      </button>
    );
  }),
  slashAction: readingListBookSlashAction,
});

// the cell of the list's texts: its own kind first, then the kinds of the page (a link, a
// view of an object). the kinds read the list through the context, kept current each render
function useReadingListCell(config) {
  return useCell({ tokenList: [readingListBookToken], context: { service: config.objectFrontend }, config });
}

function bookRemarkSet(service, book, text) {
  const { remark: _remark, ...rest } = book.data ?? {};
  return service.assetWrite(book.key, text.trim() ? { ...rest, remark: text } : rest, `${book.data?.title}: remark`);
}

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
