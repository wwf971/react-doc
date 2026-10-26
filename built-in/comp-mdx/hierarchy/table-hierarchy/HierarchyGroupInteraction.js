function hierarchyGroupHandlersBuild(toggle) {
  let press;
  const isControl = (target) => target.closest('button, a, input, select, textarea, [role="button"]');
  return {
    onPointerDown(event) {
      press = event.button === 0 && !isControl(event.target)
        ? { x: event.clientX, y: event.clientY }
        : undefined;
    },
    onPointerCancel() {
      press = undefined;
    },
    onClick(event) {
      const start = press;
      press = undefined;
      if (event.target.closest('.table-hierarchy-toggle')) {
        toggle();
        return;
      }
      if (isControl(event.target) || !start
        || event.clientX !== start.x || event.clientY !== start.y
        || event.currentTarget.ownerDocument.getSelection()?.isCollapsed === false) return;
      toggle();
    },
  };
}

export { hierarchyGroupHandlersBuild };