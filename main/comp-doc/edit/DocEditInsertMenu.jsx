import { useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { ClipboardPaste, LoaderCircle, Search } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { useDocEditDoc } from './DocEditDocContext.js';
import { editTemplateListBuild } from './edit-template.js';
import './DocEdit.css';

// The menu of an insert button: the starting texts of a new block
// (edit-template.js) for this document. It floats below the toolbar that
// opened it (DocEditBlockToolbar, or the empty-document notice) and adds
// nothing to the flow:
//
//   [🔍 search blocks and components          ]
//   Text        [¶ Paragraph] [H Heading] [≡ List] …
//   Components  [▣ FileTree] [▣ Image] …   +12 more: search
//   Services    [▦ Note DB · Notes] [▦ Note DB · Settings] …
//
// the rows list the basic blocks, the components marked isInsertCommon and
// the dashboards of the service templates the backend knows
// (doc_page_impl_service.md#creating-a-dashboard);
// the search finds every entry by tag name, label and description, and its
// results open in a dropdown floating over the rows, so the menu keeps its
// height while the author types. matched text is highlighted. ArrowDown /
// ArrowUp move in the results, Enter takes the highlighted one (the first
// when none is), Escape clears the search, and a second Escape closes the
// menu; a pointer going down outside the toolbar closes it too.
//
// choosing an entry writes its text to the document as the new block, at
// the border of the open menu (DocEditStore.insertMenu), and opens it in
// edit mode in its place (DocEditStore.blockCreate). an entry of an
// isAssetOnly component creates its asset object first and writes a
// reference block to it (DocEditStore.blockCreateAsAsset).
//
// Paste… at the end of the Text row opens the review of a paste
// (doc_page_impl_block_ops.md) for this border, with an empty text for the
// author to paste Markdown / MDX into. it is shown when the host supplies
// the panel component that frames the review.
export const DocEditInsertMenu = observer(function DocEditInsertMenu() {
  const { editStore } = useDocStores();
  const menu = editStore.insertMenu;
  if (!menu) return null;
  // a menu opened for another border starts with an empty search
  return <DocEditInsertMenuOpen key={`${menu.path}#${menu.blockIndexAnchor}#${menu.borderIndex}`} menu={menu} />;
});

const DocEditInsertMenuOpen = observer(function DocEditInsertMenuOpen({ menu }) {
  const { compById, compConfigHost, configStore, editStore, pasteStore, serviceStore, sourceStore } = useDocStores();
  const isPasteShown = Boolean(pasteStore && compConfigHost.panelComponent);
  const { path, format } = useDocEditDoc();
  const [query, querySet] = useState('');
  const [indexActive, indexActiveSet] = useState(-1);
  const serviceDashboardList = serviceStore.dashboardInsertList;
  const templateList = useMemo(
    () => editTemplateListBuild({
      configDoc: sourceStore.configDoc,
      compById,
      docPath: path,
      docFormat: format,
      compConfigGet: (compId) => configStore.compConfigGet(compId, path),
      serviceDashboardList,
    }),
    [compById, configStore, format, path, serviceDashboardList, sourceStore.configDoc],
  );
  const resultList = useMemo(() => templateSearch(templateList, query), [templateList, query]);
  const isSubmitting = menu.status === 'submitting';
  const isQuery = query.trim() !== '';
  const templateListText = templateList.filter((template) => template.group === 'text');
  const templateListCommon = templateList.filter((template) => template.group === 'component' && template.isCommon);
  const countComponentOther = templateList.filter((template) => template.group === 'component' && !template.isCommon).length;
  const templateListService = templateList.filter((template) => template.group === 'service');

  const choose = (template) => {
    if (isSubmitting) return;
    if (template.isAssetOnly) {
      void editStore.blockCreateAsAsset(path, template);
      return;
    }
    void editStore.blockCreate(path, template.text);
  };

  const queryChange = (text) => {
    querySet(text);
    indexActiveSet(-1);
  };

  const keyDownHandle = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (isQuery) queryChange('');
      else editStore.insertMenuClose();
    }
  };

  const searchKeyDownHandle = (event) => {
    if (event.nativeEvent?.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (resultList.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      indexActiveSet((indexActive + step + resultList.length) % resultList.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const result = resultList[indexActive] ?? resultList[0];
      if (result) choose(result.template);
    }
  };

  const buttonRender = (template) => (
    <button
      key={template.id}
      type="button"
      disabled={isSubmitting}
      title={template.description || undefined}
      onClick={() => choose(template)}
    >
      <template.icon size={12} aria-hidden="true" />
      <span>{template.group === 'component' ? template.compName : template.label}</span>
    </button>
  );

  return (
    <div
      className="doc-edit-insert-menu not-prose"
      role="menu"
      aria-label="Insert a block"
      onKeyDown={keyDownHandle}
    >
      <div className="doc-edit-insert-search">
        <Search className="doc-edit-insert-search-icon" size={12} aria-hidden="true" />
        <input
          type="text"
          className="doc-edit-insert-search-input"
          value={query}
          placeholder="Search blocks and components"
          aria-label="Search blocks and components"
          role="combobox"
          aria-expanded={isQuery}
          aria-autocomplete="list"
          autoFocus
          disabled={isSubmitting}
          spellCheck={false}
          onChange={(event) => queryChange(event.target.value)}
          onKeyDown={searchKeyDownHandle}
        />
        {isQuery ? (
          <div className="doc-edit-insert-result-list" role="listbox" aria-label="Search results">
            {resultList.length === 0 ? (
              <span className="doc-edit-insert-result-none">nothing matches “{query.trim()}”</span>
            ) : resultList.map((result, index) => (
              <div
                key={result.template.id}
                className="doc-edit-insert-result"
                role="option"
                aria-selected={index === indexActive}
                data-active={index === indexActive ? '' : undefined}
                title={result.template.description || undefined}
                // a pointer down would take the focus from the search field
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(result.template)}
              >
                <result.template.icon size={13} aria-hidden="true" />
                <span className="doc-edit-insert-result-name">{textHighlight(result.name, result.queryLower)}</span>
                {result.label !== '' ? (
                  <span className="doc-edit-insert-result-label">{textHighlight(result.label, result.queryLower)}</span>
                ) : null}
                {result.template.description ? (
                  <span className="doc-edit-insert-result-description">{textHighlight(result.template.description, result.queryLower)}</span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="doc-edit-insert-group" role="group" aria-label="Text">
        <span className="doc-edit-insert-group-label">Text</span>
        {templateListText.map(buttonRender)}
        {isPasteShown ? (
          <button
            type="button"
            disabled={isSubmitting}
            title="Paste Markdown or MDX, review its blocks, then insert them"
            onClick={() => void pasteStore.open({ borderIndex: menu.borderIndex })}
          >
            <ClipboardPaste size={12} aria-hidden="true" />
            <span>Paste…</span>
          </button>
        ) : null}
      </div>
      {templateListCommon.length > 0 || countComponentOther > 0 ? (
        <div className="doc-edit-insert-group" role="group" aria-label="Components">
          <span className="doc-edit-insert-group-label">Components</span>
          {templateListCommon.map(buttonRender)}
          {countComponentOther > 0 ? (
            <span className="doc-edit-insert-more">+{countComponentOther} more: search</span>
          ) : null}
        </div>
      ) : null}
      {templateListService.length > 0 ? (
        <div className="doc-edit-insert-group" role="group" aria-label="Services">
          <span className="doc-edit-insert-group-label">Services</span>
          {templateListService.map(buttonRender)}
        </div>
      ) : null}
      {isSubmitting ? (
        <span className="doc-edit-insert-status" role="status">
          <LoaderCircle aria-hidden="true" size={12} strokeWidth={2.2} className="doc-spin" />
          <span>Creating the block…</span>
        </span>
      ) : null}
      {menu.status === 'error' && menu.message ? (
        <span className="doc-error doc-edit-message" role="alert">{menu.message}</span>
      ) : null}
    </div>
  );
});

// the entries matching the query, case-insensitive, by where they match:
// the name (tag name of a component or a dashboard, label of a text block)
// first, then the label of a component, then the description
function templateSearch(templateList, query) {
  const queryLower = query.trim().toLowerCase();
  if (queryLower === '') return [];
  const resultList = [];
  for (const template of templateList) {
    const name = template.group === 'text' ? template.label : template.compName;
    const label = template.group !== 'text' && template.label !== template.compName ? template.label : '';
    let rank;
    if (name.toLowerCase().includes(queryLower)) rank = 0;
    else if (label.toLowerCase().includes(queryLower)) rank = 1;
    else if (template.description.toLowerCase().includes(queryLower)) rank = 2;
    else continue;
    resultList.push({ template, name, label, rank, queryLower });
  }
  resultList.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  return resultList;
}

// the text with every occurrence of the query marked
function textHighlight(text, queryLower) {
  const textLower = text.toLowerCase();
  const partList = [];
  let indexStart = 0;
  let indexMatch = textLower.indexOf(queryLower);
  while (indexMatch !== -1) {
    if (indexMatch > indexStart) partList.push(text.slice(indexStart, indexMatch));
    const indexEnd = indexMatch + queryLower.length;
    partList.push(<mark key={indexMatch} className="doc-edit-insert-match">{text.slice(indexMatch, indexEnd)}</mark>);
    indexStart = indexEnd;
    indexMatch = textLower.indexOf(queryLower, indexStart);
  }
  if (indexStart < text.length) partList.push(text.slice(indexStart));
  return partList;
}
