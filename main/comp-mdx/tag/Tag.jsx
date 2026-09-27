import './Tag.css';

// Compact tag label. Registered as common/Tag under the built-in name Tag,
// so tag definitions without display.component render with it.
//
//   data.text              label
//   data.colorBorder       border color
//   data.colorBackground   background color
//   data.colorText         text color
//
// In MDX: <Tag text="Guide" colorBorder="#2563eb" colorBackground="#dbeafe" />
export function Tag({ data = {} }) {
  const style = {};
  if (data.colorBorder) style['--doc-tag-color-border'] = String(data.colorBorder);
  if (data.colorBackground) style['--doc-tag-color-background'] = String(data.colorBackground);
  if (data.colorText) style['--doc-tag-color-text'] = String(data.colorText);
  return (
    <span className="doc-tag" style={style}>
      {String(data.text ?? data.tagId ?? '')}
    </span>
  );
}
