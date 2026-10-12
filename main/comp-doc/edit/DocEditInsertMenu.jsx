import { useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { LoaderCircle } from '../../frontend/UICommon.js';
import { useDocStores } from '../../frontend/src/store/context.js';
import { useDocEditDoc } from './DocEditDocContext.js';
import { editTemplateListBuild } from './edit-template.js';
import './DocEdit.css';

// The menu of an insert button: the starting texts of a new block, the
// basic blocks in one row and the components in another. It floats below
// the toolbar that opened it (DocEditBlockToolbar, or the empty-document
// notice) and adds nothing to the flow; choosing an entry writes that text
// to the document as the new block, at the border of the open menu
// (DocEditStore.insertMenu), and opens it in edit mode in its place
// (DocEditStore.blockCreate). Escape closes the menu; a pointer going down
// outside the toolbar closes it too.
export const DocEditInsertMenu = observer(function DocEditInsertMenu() {
  const { compById, editStore, sourceStore } = useDocStores();
  const { path } = useDocEditDoc();
  const menu = editStore.insertMenu;
  const templateList = useMemo(
    () => editTemplateListBuild(sourceStore.configDoc, compById),
    [compById, sourceStore.configDoc],
  );
  if (!menu) return null;
  const isSubmitting = menu.status === 'submitting';

  const keyDownHandle = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      editStore.insertMenuClose();
    }
  };

  const groupRender = (group, label) => (
    <div className="doc-edit-insert-group" role="group" aria-label={label}>
      <span className="doc-edit-insert-group-label">{label}</span>
      {templateList.filter((template) => template.group === group).map((template) => (
        <button
          key={template.id}
          type="button"
          disabled={isSubmitting}
          onClick={() => void editStore.blockCreate(path, template.text)}
        >
          {template.icon ? <template.icon size={12} aria-hidden="true" /> : null}
          <span>{template.label}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div
      className="doc-edit-insert-menu not-prose"
      role="menu"
      aria-label="Insert a block"
      onKeyDown={keyDownHandle}
    >
      {groupRender('text', 'Text')}
      {templateList.some((template) => template.group === 'component') ? groupRender('component', 'Components') : null}
      {isSubmitting ? (
        <span className="doc-edit-insert-status" role="status">
          <LoaderCircle aria-hidden="true" size={12} strokeWidth={2.2} className="doc-edit-spin" />
          <span>Creating the block…</span>
        </span>
      ) : null}
      {menu.status === 'error' && menu.message ? (
        <span className="doc-edit-message" role="alert">{menu.message}</span>
      ) : null}
    </div>
  );
});
