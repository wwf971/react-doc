import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../frontend/src/store/context.js';
import { ChevronDown, ChevronsDownUp, ChevronsUpDown } from '../../frontend/UICommon.js';
import './SidePanelItem.css';

// One root doc page of a workspace of several (design:
// doc_page_impl_side_panel.md#a-workspace-of-several-doc-pages): the alias
// of the doc page as a muted heading, its side panel below at the depth of
// the tree's root, so its items look as they do when the doc page is
// served alone. the heading folds the section; the first section carries
// the toolbar of the sections above its heading.
//
//   WORKSPACE                 [⇕] [⇳]     ◄ DocSidePanelSectionToolbar
//   example                         ⌄     ◄ the heading, muted
//     Document Model
//     ...
//   second  temporary               ⌄
//     ...
//
// it renders no fumadocs folder: a folder would count as one level and
// indent its items. the open state is kept with the folders' (DocSidePanelStore
// folderOpenById), by the section's item id.
export const DocSidePanelSection = observer(function DocSidePanelSection({ item, children }) {
  const { sidePanelStore } = useDocStores();
  const section = item.docPageSection;
  const isOpen = sidePanelStore.folderOpenGet(item.$id, true);
  const contentId = `doc-side-panel-section-${item.$id}`;
  return (
    <div className="doc-side-panel-section" data-open={isOpen ? '' : undefined}>
      {section.isFirst ? <DocSidePanelSectionToolbar /> : null}
      <button
        type="button"
        className="doc-side-panel-section-head"
        aria-expanded={isOpen}
        aria-controls={contentId}
        title={`${section.title ? `${section.title} · ` : ''}doc page "${section.alias}"${section.isTemporary ? ', mounted for now' : ''}: ${isOpen ? 'fold' : 'unfold'} its side panel`}
        onClick={() => sidePanelStore.folderOpenSet(item.$id, !isOpen)}
      >
        <span className="doc-side-panel-section-alias">{section.alias}</span>
        {section.isTemporary ? <span className="doc-side-panel-section-badge">temporary</span> : null}
        <ChevronDown aria-hidden="true" className="doc-side-panel-section-chevron" />
      </button>
      {isOpen ? (
        <div id={contentId} className="doc-side-panel-section-content">{children}</div>
      ) : null}
    </div>
  );
});

// the buttons acting on every section at once; a row of icon buttons that
// further actions on the workspace join
const DocSidePanelSectionToolbar = observer(function DocSidePanelSectionToolbar() {
  const { sidePanelStore } = useDocStores();
  return (
    <div className="doc-side-panel-section-toolbar" role="toolbar" aria-label="Doc pages of the workspace">
      <span className="doc-side-panel-section-toolbar-label">Workspace</span>
      <button
        type="button"
        className="doc-side-panel-section-tool"
        title="Unfold the side panel of every doc page"
        aria-label="Unfold the side panel of every doc page"
        disabled={!sidePanelStore.sectionIsAnyClosed}
        onClick={() => sidePanelStore.sectionOpenAllSet(true)}
      >
        <ChevronsUpDown aria-hidden="true" />
      </button>
      <button
        type="button"
        className="doc-side-panel-section-tool"
        title="Fold the side panel of every doc page"
        aria-label="Fold the side panel of every doc page"
        disabled={!sidePanelStore.sectionIsAnyOpen}
        onClick={() => sidePanelStore.sectionOpenAllSet(false)}
      >
        <ChevronsDownUp aria-hidden="true" />
      </button>
    </div>
  );
});
