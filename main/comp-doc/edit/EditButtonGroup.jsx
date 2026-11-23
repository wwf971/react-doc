// A floating button group of the edit layer (doc_page_impl_edit.md#floating-button-groups): a row of
// icon buttons in one frame, the look of .doc-button-group (src/css/button.css), as the toolbar of a
// block and of a list item have it. A component editing something of its own in place (a row of a
// card, a label of a block, an item of a list it draws) shows its few actions with it, floating
// beside what they act on, instead of a control group of its own.
//
//   <EditButtonGroup actionList grip? isLocked? className? ariaLabel? iconSize? />
//   actionList  [{ id, Icon, title, isDisabled?, reason?, isDanger?, isPressed?, act(event) }]
//               a button greyed out keeps its reason as its title; isDanger: it takes something away
//   grip        { Icon, title, isDisabled?, reason?, axis, indexFrom, rectListGet(), onPreview(insertion),
//               onDrop(indexTo) }: a handle dragged to move the thing among its siblings. axis: x, y,
//               or xy (siblings that wrap, in the order of reading). rectListGet answers the boxes of
//               the siblings in order (the thing's own among them); onPreview(insertion) says where it
//               would land (before the sibling of that index, or after the last), onDrop the index it
//               moves to (its own when nothing changes)
//   isLocked    every button greyed out
//
// A click on the group never reaches what lies under it. Where the group floats is its owner's: it
// takes no room in the flow (the no-jitter rule), and on a canvas it keeps its size on the screen.
export function EditButtonGroup({ actionList = [], grip, isLocked = false, className = '', ariaLabel = 'Actions', iconSize = 13 }) {
  return (
    <div className={`doc-button-group doc-edit-button-group${className ? ` ${className}` : ''}`} role="toolbar" aria-label={ariaLabel} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
      {grip ? (
        <button type="button" className="doc-edit-button-group-grip" title={grip.isDisabled ? grip.reason ?? grip.title : grip.title} aria-label={grip.title}
          disabled={isLocked || grip.isDisabled} onPointerDown={event => editReorderStart(event, grip)}>
          <grip.Icon size={iconSize} aria-hidden="true" />
        </button>
      ) : null}
      {actionList.map(action => (
        <button key={action.id} type="button" title={action.isDisabled ? action.reason ?? action.title : action.title} aria-label={action.title}
          aria-pressed={action.isPressed === undefined ? undefined : action.isPressed} data-danger={action.isDanger ? '' : undefined}
          disabled={isLocked || action.isDisabled} onClick={(event) => { event.stopPropagation(); action.act(event); }}>
          <action.Icon size={iconSize} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

// a pointer drag from a grip: the pointer is captured by the grip, the place it would land among
// the siblings follows it, and the drop reports the index the thing moves to
export function editReorderStart(event, grip) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const target = event.currentTarget;
  target.setPointerCapture(event.pointerId);
  let indexTo = grip.indexFrom;
  const move = (moveEvent) => {
    const insertion = editReorderInsertionOf(grip.rectListGet(), grip.axis, { x: moveEvent.clientX, y: moveEvent.clientY });
    indexTo = insertion > grip.indexFrom ? insertion - 1 : insertion;
    grip.onPreview?.(insertion);
  };
  const end = () => {
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', end);
    target.removeEventListener('pointercancel', end);
    try { target.releasePointerCapture(event.pointerId); } catch { /* released already */ }
    grip.onDrop(indexTo);
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
}

// where a thing dragged to a point lands among boxes in order: before the first box whose middle is
// past the point (x, y), or, for boxes that wrap (xy), after every box before the point in the order
// of reading (a row above it, or on its row and left of it)
export function editReorderInsertionOf(rectList, axis, point) {
  if (axis === 'xy') return rectList.filter(rect => rect.bottom <= point.y || (rect.top <= point.y && rect.left + rect.width / 2 <= point.x)).length;
  const at = axis === 'y' ? point.y : point.x;
  const index = rectList.findIndex(rect => at < (axis === 'y' ? rect.top + rect.height / 2 : rect.left + rect.width / 2));
  return index < 0 ? rectList.length : index;
}
