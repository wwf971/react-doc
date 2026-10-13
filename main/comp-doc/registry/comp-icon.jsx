// Icons a component exposes (expose.icon, the icon of a view or edit mode;
// doc_page_impl_mdx_comp.md#icons). An icon is a component drawn at any
// size: `size` for a square, or `width` and `height` separately; a
// rectangular size draws the icon in the largest square that fits, centered
// (a square viewBox with preserveAspectRatio "meet"). Line icons of the
// page (lucide, frontend/UICommon.js) already satisfy this contract and can
// be exposed as they are; compIconDefine builds one from an svg drawing.
//
//   compIconDefine(<path d="…" />, { viewBox: '0 0 24 24', isStroke: true })
//
// the drawing inherits the text color (currentColor); a stroke icon gets the
// stroke attributes of the page's line icons, a fill icon (isStroke false)
// paints its shapes.
//
// compIconDefault is drawn for a component that exposes no icon of its own
// (compIconGet in comp-expose.js).
export function compIconDefine(drawing, { viewBox = '0 0 24 24', isStroke = true } = {}) {
  const attributeList = isStroke
    ? { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }
    : { fill: 'currentColor', stroke: 'none' };
  return function CompIcon({ size = 16, width = size, height = size, className, title, ...props }) {
    return (
      <svg
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        width={width}
        height={height}
        className={className}
        role={title ? 'img' : undefined}
        aria-hidden={title ? undefined : true}
        {...attributeList}
        {...props}
      >
        {title ? <title>{title}</title> : null}
        {drawing}
      </svg>
    );
  };
}

// a block with a smaller block inside: "some component"
export const compIconDefault = compIconDefine(
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <rect x="8" y="8" width="8" height="8" rx="1" />
  </>,
);
