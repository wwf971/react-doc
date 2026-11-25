import {
  AppWindow,
  Archive,
  ArrowRight,
  Book,
  BookOpen,
  Box,
  Boxes,
  CircleDashed,
  Copy,
  Database,
  FileBox,
  FileIcon,
  FileText,
  FolderIcon,
  FolderTreeIcon,
  Group,
  Hash,
  HeadingIcon,
  Globe,
  Layers,
  LayoutDashboard,
  Library,
  LinkIcon,
  ListTodo,
  Package,
  Plug,
  Server,
  Settings,
  Shapes,
  Square,
  SquareCheck,
  StickyNote,
  UserRound,
  Users,
} from '../../frontend/UICommon.js';

// The icon of an object: the icon its type names (doc_page_impl_type.md,
// the icon key of a type, a lucide name), the nearest ancestor's when its
// own names none, or the icon a descriptor carries (iconUrl: a service's).
const ICON_BY_NAME = {
  'app-window': AppWindow,
  archive: Archive,
  'arrow-right': ArrowRight,
  book: Book,
  'book-open': BookOpen,
  box: Box,
  boxes: Boxes,
  copy: Copy,
  database: Database,
  file: FileIcon,
  'file-box': FileBox,
  'file-text': FileText,
  folder: FolderIcon,
  'folder-tree': FolderTreeIcon,
  group: Group,
  hash: Hash,
  heading: HeadingIcon,
  globe: Globe,
  layers: Layers,
  'layout-dashboard': LayoutDashboard,
  library: Library,
  link: LinkIcon,
  'list-todo': ListTodo,
  package: Package,
  plug: Plug,
  server: Server,
  settings: Settings,
  shapes: Shapes,
  square: Square,
  'square-check': SquareCheck,
  'sticky-note': StickyNote,
  user: UserRound,
  users: Users,
};

export function objectIconComponentGet(name) {
  return ICON_BY_NAME[name] ?? Box;
}

// the icon of a name, undefined when the set has none of it: for who has an icon of its own to
// fall back on (a portal: its component's)
export function objectIconByNameGet(name) {
  return ICON_BY_NAME[name];
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
