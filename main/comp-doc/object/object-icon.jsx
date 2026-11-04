import {
  Archive,
  ArrowRight,
  Book,
  Box,
  CircleDashed,
  Copy,
  Database,
  FileIcon,
  FileText,
  FolderIcon,
  FolderTreeIcon,
  Group,
  Hash,
  HeadingIcon,
  Layers,
  LinkIcon,
  ListTodo,
  Package,
  Plug,
  Server,
  Settings,
  Square,
  SquareCheck,
  StickyNote,
} from '../../frontend/UICommon.js';

// The icon of an object: the icon its type names (doc_page_impl_obj.md#types,
// the icon key of a type, a lucide name), the nearest ancestor's when its
// own names none, or the icon a descriptor carries (iconUrl: a service's).
const ICON_BY_NAME = {
  archive: Archive,
  'arrow-right': ArrowRight,
  book: Book,
  box: Box,
  copy: Copy,
  database: Database,
  file: FileIcon,
  'file-text': FileText,
  folder: FolderIcon,
  'folder-tree': FolderTreeIcon,
  group: Group,
  hash: Hash,
  heading: HeadingIcon,
  layers: Layers,
  link: LinkIcon,
  'list-todo': ListTodo,
  package: Package,
  plug: Plug,
  server: Server,
  settings: Settings,
  square: Square,
  'square-check': SquareCheck,
  'sticky-note': StickyNote,
};

export function objectIconComponentGet(name) {
  return ICON_BY_NAME[name] ?? Box;
}

// size: the side of the square, in px
export function ObjectIcon({ descriptor, objectStore, size = 14, className = '' }) {
  if (descriptor?.iconUrl) {
    return <img className={`doc-object-icon ${className}`} src={descriptor.iconUrl} alt="" width={size} height={size} />;
  }
  if (!descriptor || descriptor.typeList.length === 0) {
    return <CircleDashed className={`doc-object-icon ${className}`} size={size} aria-hidden />;
  }
  const Icon = objectIconComponentGet(objectStore.typeIconGet(descriptor.typeList));
  return <Icon className={`doc-object-icon ${className}`} size={size} aria-hidden />;
}
