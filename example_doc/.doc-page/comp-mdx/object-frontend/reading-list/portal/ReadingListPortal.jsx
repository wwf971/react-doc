import { observer } from 'mobx-react-lite';
import { Book, BookOpen, Pencil } from '../../../../../../main/frontend/UICommon.js';
import { ObjectFrontendMode } from '../../../../../../main/comp-doc/object-frontend/ObjectFrontendMode.jsx';
import { PortalSwitcher } from '../../../../../../main/comp-doc/portal/PortalSwitcher.jsx';
import { compIconDefine } from '../../../../../../main/comp-doc/registry/comp-icon.jsx';
import './ReadingListPortal.css';

// The portal "Library" of a reading list (main/doc_page_impl_portal.md): the list as an app of
// its own, in the whole window, instead of blocks in a document. It is the demonstration of the
// smallest useful portal: it draws nothing of the list itself, it lays out two modes the type
// has already (.doc-page/type.yaml) and keeps what is shown in the address.
//
//   ┌ [▣ Library ⌃⌄]  Reading list                      [Edit] [Documents] ┐  its own bar: the
//   ├───────────────────────────────┬────────────────────────────────────┤  standard switcher
//   │ the mode "shelf" (or "find",  │ the mode "book" of the book chosen  │  at its top left
//   │ "add": the shelf switches)    │ (config.portal.at: /book/sci-fi/…)  │
//   └───────────────────────────────┴────────────────────────────────────┘
//
//   config.portal          the portal and the page around it: at / atSet (the book shown, kept in
//                          the address), isEditing / editSet (its own edit mode), docOpen
//   config.objectFrontend  the api of the reading list providing it
//
// A mode asks to switch its block (blockSet: the shelf opening a book). Here no block is there:
// ObjectFrontendMode hands the switch to the portal (onBlockChange), which makes of it what an
// app does: a book opened is the place of the right pane, any other mode the left pane's.
export const ReadingListPortal = observer(function ReadingListPortal({ data = {}, config = {} }) {
  const portal = config.portal;
  const service = config.objectFrontend;
  if (!portal || !service) return <p className="doc-error">ReadingListPortal is the component of a portal of a reading list.</p>;
  // the place: "{mode of the left pane}" + "#" + "{book}", either part left out
  const place = placeRead(portal.at);
  const leftSwitch = ({ mode, param }) => {
    if (mode === 'book') portal.atSet(placeWrite({ ...place, book: String(param?.book ?? '') }));
    else portal.atSet(placeWrite({ ...place, mode, status: String(param?.status ?? '') }));
  };
  const bookClose = () => portal.atSet(placeWrite({ ...place, book: '' }));
  return (
    <div className="reading-list-portal not-prose" data-device={portal.device}>
      <header className="reading-list-portal-bar">
        <PortalSwitcher />
        <span className="reading-list-portal-title">{service.object.name || 'Reading list'}</span>
        <span className="reading-list-portal-count">{service.assetList('book').length} books</span>
        <span className="reading-list-portal-space" />
        <button type="button" className="doc-button" aria-pressed={portal.isEditing} data-primary={portal.isEditing ? '' : undefined} disabled={!service.isWritable} title={service.isWritable ? 'Whether the list offers what changes it: a remark typed, a status moved on' : service.writeUnavailableReason} onClick={() => portal.editSet(!portal.isEditing)}>
          <Pencil size={12} aria-hidden="true" /><span>{portal.isEditing ? 'Done' : 'Edit'}</span>
        </button>
        <button type="button" className="doc-button" title="The documents of this doc page" onClick={() => portal.docOpen()}>
          <BookOpen size={12} aria-hidden="true" /><span>Documents</span>
        </button>
      </header>
      <div className="reading-list-portal-body">
        <section className="reading-list-portal-pane" aria-label="The list">
          <ObjectFrontendMode object={service.ref} mode={place.mode} param={place.status ? { status: place.status } : undefined} docState={portal.docState} instanceKey={`${portal.id}:left`} onBlockChange={leftSwitch} />
        </section>
        <section className="reading-list-portal-pane" aria-label="The book chosen">
          {place.book ? (
            <ObjectFrontendMode object={service.ref} mode="book" param={{ book: place.book }} docState={portal.docState} instanceKey={`${portal.id}:book`} onBlockChange={bookClose} />
          ) : (
            <p className="reading-list-portal-empty"><Book size={18} aria-hidden="true" /><span>Open a book of the list, and it is shown here.</span></p>
          )}
        </section>
      </div>
    </div>
  );
});

const MODE_LEFT_LIST = ['shelf', 'cards', 'add', 'find', 'stats'];

// the place of the portal as its address keeps it: "find?status=want#/book/sci-fi/dune"
function placeRead(at) {
  const [head = '', book = ''] = String(at ?? '').split('#');
  const [mode = '', query = ''] = head.split('?');
  return { mode: MODE_LEFT_LIST.includes(mode) ? mode : 'shelf', status: new URLSearchParams(query).get('status') ?? '', book };
}

function placeWrite({ mode, status, book }) {
  const head = `${mode && mode !== 'shelf' ? mode : ''}${status ? `?status=${status}` : ''}`;
  return `${head}${book ? `#${book}` : ''}`;
}

// its icon, where a declaration names none: books standing on a shelf, drawn at any size
const ReadingListPortalIcon = compIconDefine(
  <>
    <path d="M4 20h16" />
    <path d="M6 20V6h3v14" />
    <path d="M10.5 20V4h3v16" />
    <path d="m15.5 8 2.8-.8 3 11.6-2.8.8z" />
  </>,
);

// what makes it a component of a portal: expose.portal. it draws the switcher in its own bar
export const readingListPortalDefineOptions = {
  placementList: ['portal'],
  expose: {
    meta: { label: 'Reading list: the portal Library', description: 'A reading list as an app of its own: its shelf and the book chosen, side by side', isNotInDoc: true },
    icon: ReadingListPortalIcon,
    portal: { deviceList: ['browser', 'desktop'], switcherPlace: 'own' },
  },
};
