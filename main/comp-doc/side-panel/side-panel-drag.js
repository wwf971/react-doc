// Dragging a side-panel item in edit mode (doc_page_impl_side_panel.md#moving-an-item).
//
// The rows are fumadocs' own (links, folder buttons, separators); every
// label inside one is wrapped by SidePanelItemHost in an element that names
// its item (data-side-panel-item-id) and takes no box (display: contents),
// so the row is the wrapper's parent. A drag measures the rows of the side
// panel it started in, on every move, and turns the pointer into a drop:
//
//   a row that can hold children (a document item, a folder):
//     top quarter      before the row
//     middle half      into it, as its last child (a box around the row)
//     bottom quarter   after the row; for an open folder showing children,
//                      its first child instead (the line is where that is)
//   any other row:     top half before, bottom half after
//
// after a row that ends its folder (and the folders around), the pointer's x
// picks the depth: further left puts the item after the folder instead, as
// in an outline. a zone is kept while the pointer stays within a few pixels
// of it, so the indicator does not flicker on a border. hovering the middle
// of a closed folder opens it after a moment; the side panel scrolls when
// the pointer is near its top or bottom edge. Escape cancels; the click that
// ends a drag never reaches the row (no navigation, no folder toggle).
//
// whether the drop is allowed, and why not, comes from the store
// (DocSidePanelStore.moveResolve); this module only measures. a drop that is
// allowed is reported by moveDispatch(position, targetItemId, point).

const dragStartDistance = 5;
const zoneHysteresis = 4;
const autoExpandDelay = 600;
const autoScrollEdge = 24;
const autoScrollSpeedMax = 12;
// the indentation of a row per depth and before depth 0, as
// DocSidebarFolder and fumadocs indent them: calc((2 + 3 * depth) * 4px)
const indentStep = 12;
const indentBase = 8;

export function sidePanelDragPointerDown(eventDown, { itemId, sidePanelStore, moveDispatch }) {
  if (eventDown.button !== 0 || eventDown.pointerType === 'touch') return;
  if (dragIsExcludedTarget(eventDown.target)) return;
  if (!sidePanelStore.itemIsMovable(itemId)) return;
  const container = eventDown.currentTarget.closest('#nd-sidebar, #nd-sidebar-mobile');
  if (!container) return;

  const pointStart = { clientX: eventDown.clientX, clientY: eventDown.clientY };
  const session = {
    isDragging: false,
    point: pointStart,
    zonePrevious: undefined,
    expandItemId: '',
    expandTimer: 0,
    scrollElement: scrollElementGet(eventDown.currentTarget, container),
    scrollSpeed: 0,
    scrollFrame: 0,
  };

  const dropUpdate = () => {
    const drop = dropCompute(container, session, itemId, sidePanelStore);
    sidePanelStore.dragUpdate(session.point, drop);
    autoExpandUpdate(drop);
  };

  const autoExpandUpdate = (drop) => {
    const isWanted = drop && drop.position === 'insideLast' && drop.isFolderClosed;
    if (!isWanted) {
      autoExpandClear();
      return;
    }
    if (session.expandItemId === drop.targetItemId) return;
    autoExpandClear();
    session.expandItemId = drop.targetItemId;
    session.expandTimer = window.setTimeout(() => {
      session.expandTimer = 0;
      sidePanelStore.folderOpenSet(drop.targetItemId, true);
      // the rows below moved: measure again once they are rendered
      window.requestAnimationFrame(() => {
        if (session.isDragging) dropUpdate();
      });
    }, autoExpandDelay);
  };

  const autoExpandClear = () => {
    if (session.expandTimer) window.clearTimeout(session.expandTimer);
    session.expandTimer = 0;
    session.expandItemId = '';
  };

  const autoScrollUpdate = () => {
    const element = session.scrollElement;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const y = session.point.clientY;
    let speed = 0;
    if (y < rect.top + autoScrollEdge) speed = -Math.ceil((rect.top + autoScrollEdge - y) / 4);
    else if (y > rect.bottom - autoScrollEdge) speed = Math.ceil((y - (rect.bottom - autoScrollEdge)) / 4);
    session.scrollSpeed = Math.max(-autoScrollSpeedMax, Math.min(autoScrollSpeedMax, speed));
    if (session.scrollSpeed !== 0 && !session.scrollFrame) session.scrollFrame = window.requestAnimationFrame(autoScrollStep);
  };

  const autoScrollStep = () => {
    session.scrollFrame = 0;
    if (!session.isDragging || session.scrollSpeed === 0 || !session.scrollElement) return;
    session.scrollElement.scrollTop += session.scrollSpeed;
    dropUpdate();
    session.scrollFrame = window.requestAnimationFrame(autoScrollStep);
  };

  const pointerMoveHandle = (event) => {
    session.point = { clientX: event.clientX, clientY: event.clientY };
    if (!session.isDragging) {
      const distance = Math.hypot(event.clientX - pointStart.clientX, event.clientY - pointStart.clientY);
      if (distance < dragStartDistance) return;
      if (!sidePanelStore.dragStart(itemId, session.point)) {
        finish();
        return;
      }
      session.isDragging = true;
      document.body.dataset.sidePanelDragging = 'true';
    }
    event.preventDefault();
    dropUpdate();
    autoScrollUpdate();
  };

  const pointerUpHandle = (event) => {
    session.point = { clientX: event.clientX, clientY: event.clientY };
    const wasDragging = session.isDragging;
    const drop = wasDragging ? sidePanelStore.drag?.drop : undefined;
    finish();
    if (!wasDragging) return;
    clickSuppressNext();
    if (drop && drop.isAllowed && !drop.isNoop) moveDispatch(drop.position, drop.targetItemId, session.point);
  };

  const keyDownHandle = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    const wasDragging = session.isDragging;
    finish();
    if (wasDragging) clickSuppressNext();
  };

  const finish = () => {
    window.removeEventListener('pointermove', pointerMoveHandle, true);
    window.removeEventListener('pointerup', pointerUpHandle, true);
    window.removeEventListener('pointercancel', finish, true);
    window.removeEventListener('keydown', keyDownHandle, true);
    autoExpandClear();
    if (session.scrollFrame) window.cancelAnimationFrame(session.scrollFrame);
    session.scrollFrame = 0;
    if (session.isDragging) {
      session.isDragging = false;
      delete document.body.dataset.sidePanelDragging;
      sidePanelStore.dragEnd();
    }
  };

  window.addEventListener('pointermove', pointerMoveHandle, true);
  window.addEventListener('pointerup', pointerUpHandle, true);
  window.addEventListener('pointercancel', finish, true);
  window.addEventListener('keydown', keyDownHandle, true);
}

// a drag is never started from an editable label, a button inside the label
// (edit, move), or a tag
export function dragIsExcludedTarget(target) {
  if (!(target instanceof Element)) return true;
  return Boolean(target.closest('[contenteditable="true"], [contenteditable="plaintext-only"], .doc-side-panel-item-edit, .doc-tag-list'));
}

// the rows shown in the side panel: { itemId, rect }, top to bottom
function rowListMeasure(container) {
  const rowList = [];
  for (const wrapper of container.querySelectorAll('[data-side-panel-item-id]')) {
    const element = wrapper.parentElement;
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    if (rect.height <= 0) continue;
    rowList.push({ itemId: wrapper.dataset.sidePanelItemId, rect });
  }
  return rowList;
}

function dropCompute(container, session, itemId, sidePanelStore) {
  const rowList = rowListMeasure(container);
  if (rowList.length === 0) return undefined;
  const { clientX, clientY } = session.point;
  const row = rowAtGet(rowList, clientY);
  const placeById = sidePanelStore.placeById;
  const place = placeById.get(row.itemId);
  if (!place) return undefined;

  const rowShownIdSet = new Set(rowList.map((rowShown) => rowShown.itemId));
  const isChildAccepted = place.nodeForm === 'doc' || place.nodeForm === 'folder';
  const isChildShown = place.childIdList.some((childId) => rowShownIdSet.has(childId));
  const zone = zoneCompute(row, clientY, isChildAccepted, isChildShown, session.zonePrevious);
  session.zonePrevious = { itemId: row.itemId, zone };

  let position = zone;
  let targetPlace = place;
  if (zone === 'after') targetPlace = afterTargetGet(placeById, place, row.rect, clientX);
  if (zone === 'insideFirst' && !isChildShown) position = 'after';

  const resolved = sidePanelStore.moveResolve(itemId, position, targetPlace.itemId);
  return {
    position,
    targetItemId: targetPlace.itemId,
    isAllowed: resolved.code === 0,
    isNoop: resolved.code === 0 && resolved.data.isNoop,
    message: resolved.code === 0 ? '' : resolved.message,
    isFolderClosed: position === 'insideLast' && place.childIdList.length > 0 && !isChildShown,
    indicator: indicatorBuild(container, row.rect, position, targetPlace.depth),
  };
}

// the row under the pointer; above the first or below the last row, that
// row; in the gap between two rows, the nearer one
function rowAtGet(rowList, clientY) {
  if (clientY < rowList[0].rect.top) return rowList[0];
  let rowNearest = rowList[0];
  let distanceNearest = Infinity;
  for (const row of rowList) {
    if (clientY >= row.rect.top && clientY < row.rect.bottom) return row;
    const distance = Math.min(Math.abs(clientY - row.rect.top), Math.abs(clientY - row.rect.bottom));
    if (distance < distanceNearest) {
      distanceNearest = distance;
      rowNearest = row;
    }
  }
  return rowNearest;
}

function zoneSegmentListGet(height, isChildAccepted, isChildShown) {
  if (!isChildAccepted) {
    return [
      { zone: 'before', start: 0, end: height * 0.5 },
      { zone: 'after', start: height * 0.5, end: height },
    ];
  }
  return [
    { zone: 'before', start: 0, end: height * 0.25 },
    { zone: 'insideLast', start: height * 0.25, end: height * 0.75 },
    { zone: isChildShown ? 'insideFirst' : 'after', start: height * 0.75, end: height },
  ];
}

function zoneCompute(row, clientY, isChildAccepted, isChildShown, zonePrevious) {
  const y = clientY - row.rect.top;
  const segmentList = zoneSegmentListGet(row.rect.height || 1, isChildAccepted, isChildShown);
  if (zonePrevious?.itemId === row.itemId) {
    const segmentPrevious = segmentList.find((segment) => segment.zone === zonePrevious.zone);
    if (segmentPrevious && y >= segmentPrevious.start - zoneHysteresis && y < segmentPrevious.end + zoneHysteresis) {
      return segmentPrevious.zone;
    }
  }
  if (y < 0) return segmentList[0].zone;
  const segment = segmentList.find((segmentEach) => y >= segmentEach.start && y < segmentEach.end);
  return segment ? segment.zone : segmentList[segmentList.length - 1].zone;
}

// "after" a row that is the last child of its folder can also mean after
// that folder, and after the folder around it, as far as each is the last
// child: the pointer's x picks the depth among these
function afterTargetGet(placeById, place, rect, clientX) {
  const candidateList = [place];
  let placeCurrent = place;
  while (placeCurrent.parentId) {
    const parent = placeById.get(placeCurrent.parentId);
    if (!parent || parent.childIdList[parent.childIdList.length - 1] !== placeCurrent.itemId) break;
    candidateList.push(parent);
    placeCurrent = parent;
  }
  const depthWanted = Math.floor((clientX - rect.left - indentBase) / indentStep);
  return candidateList.find((candidate) => candidate.depth <= depthWanted) ?? candidateList[candidateList.length - 1];
}

function indicatorBuild(container, rect, position, depth) {
  const containerRect = container.getBoundingClientRect();
  const right = Math.min(rect.right, containerRect.right) - 4;
  if (position === 'insideLast') {
    return { kind: 'box', left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }
  const depthLine = position === 'insideFirst' ? depth + 1 : depth;
  const left = rect.left + indentBase + depthLine * indentStep;
  const top = position === 'before' ? rect.top : rect.bottom;
  return { kind: 'line', left, top: top - 1, width: Math.max(right - left, 16), height: 2 };
}

// the scrolling element of the side panel around the row
function scrollElementGet(element, container) {
  let current = element.parentElement;
  while (current && current !== container.parentElement) {
    const style = window.getComputedStyle(current);
    const isScrollable = (style.overflowY === 'auto' || style.overflowY === 'scroll') && current.scrollHeight > current.clientHeight;
    if (isScrollable) return current;
    current = current.parentElement;
  }
  return undefined;
}

// the click the browser sends after the pointer goes up ends the drag; it
// must not navigate nor toggle the folder of the row
function clickSuppressNext() {
  const clickHandle = (event) => {
    event.preventDefault();
    event.stopPropagation();
    window.removeEventListener('click', clickHandle, true);
  };
  window.addEventListener('click', clickHandle, true);
  window.setTimeout(() => window.removeEventListener('click', clickHandle, true), 0);
}
