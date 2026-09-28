import './Tag.css';

// Compact tag label: how one tag looks. Registered as common/TagLabel under
// the built-in name TagLabel, so tag definitions without display.component
// render with it.
//
//   data.text              label
//   data.colorBorder       border color
//   data.colorBackground   background color
//   data.colorText         text color
//
// In MDX: <TagLabel text="Guide" colorBorder="#2563eb" colorBackground="#dbeafe" />
// To mention a tag defined in config, use <Tag tagId="guide" /> instead.
export function TagLabel({ data = {} }) {
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
