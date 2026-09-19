import { useRef } from 'react';
import {
  ChevronDown,
  Link,
  SidebarFolder,
  SidebarFolderContent,
  SidebarFolderTrigger,
  useAutoScroll,
  useFolder,
  useFolderDepth,
  usePathname,
  useSidebar,
  useTreePath,
} from '../../UICommon.js';

const classNameItem = 'relative flex flex-row items-center gap-2 rounded-lg p-2 text-start text-fd-muted-foreground wrap-anywhere [&_svg]:size-4 [&_svg]:shrink-0 transition-colors hover:bg-fd-accent/50 hover:text-fd-accent-foreground/80 hover:transition-none';
const classNameLink = `${classNameItem} data-[active=true]:bg-fd-primary/10 data-[active=true]:text-fd-primary data-[active=true]:hover:transition-colors`;

// Keeps navigation in the framework Link while owning only the folder gesture policy.
// An inactive index label navigates without changing open state. A following click
// sees the now-active label and toggles, so an ordinary double click still toggles.
export function DocSidebarFolder({ item, children }) {
  const path = useTreePath();
  const pathname = usePathname();
  const isActive = item.index?.url === pathname;
  const isDescendantActive = path.includes(item) && !isActive;

  return (
    <SidebarFolder
      collapsible={item.collapsible}
      active={isDescendantActive}
      defaultOpen={item.defaultOpen}
    >
      {item.index ? (
        <DocSidebarFolderLink item={item} isActive={isActive} />
      ) : (
        <DocSidebarFolderTrigger item={item} />
      )}
      <DocSidebarFolderContent>{children}</DocSidebarFolderContent>
    </SidebarFolder>
  );
}

function DocSidebarFolderLink({ item, isActive }) {
  const ref = useRef(null);
  const folder = useFolder();
  const { prefetch } = useSidebar();
  useAutoScroll(isActive, ref);

  return (
    <Link
      ref={ref}
      href={item.index.url}
      external={item.index.external}
      prefetch={prefetch}
      data-active={isActive}
      className={`${classNameLink} w-full${folder.depth > 1 ? ' data-[active=true]:before:content-[\'\'] data-[active=true]:before:bg-fd-primary data-[active=true]:before:absolute data-[active=true]:before:w-px data-[active=true]:before:inset-y-2.5 data-[active=true]:before:inset-s-2.5' : ''}`}
      style={{ paddingInlineStart: itemOffsetGet(folder.depth - 1) }}
      onClick={(event) => {
        if (!folder.collapsible) return;
        const isChevron = event.target instanceof Element
          && event.target.matches('[data-icon], [data-icon] *');
        if (isChevron) {
          folder.setOpen(!folder.open);
          event.preventDefault();
        } else if (isActive) {
          folder.setOpen(!folder.open);
        }
      }}
    >
      {item.icon}
      {item.name}
      {folder.collapsible && (
        <ChevronDown
          data-icon
          className={`ms-auto transition-transform${folder.open ? '' : ' -rotate-90 rtl:rotate-90'}`}
        />
      )}
    </Link>
  );
}

function DocSidebarFolderTrigger({ item }) {
  const folder = useFolder();
  return (
    <SidebarFolderTrigger
      className={`${classNameItem} w-full`}
      style={{ paddingInlineStart: itemOffsetGet(folder.depth - 1) }}
    >
      {item.icon}
      {item.name}
    </SidebarFolderTrigger>
  );
}

function DocSidebarFolderContent({ children }) {
  const depth = useFolderDepth();
  const classNameGuide = depth === 1
    ? " before:content-[''] before:absolute before:w-px before:inset-y-1 before:bg-fd-border before:inset-s-2.5"
    : '';
  return (
    <SidebarFolderContent className={`relative${classNameGuide}`}>
      <div className="flex flex-col gap-0.5 pt-0.5">{children}</div>
    </SidebarFolderContent>
  );
}

function itemOffsetGet(depth) {
  return `calc(${2 + 3 * depth} * var(--spacing))`;
}