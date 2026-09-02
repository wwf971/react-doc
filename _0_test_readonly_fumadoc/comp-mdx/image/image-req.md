# Image block UI behavior

An image block displays one image inside a bounded area.

## Source data

MD and MDX may specify `src`, `alt`, `caption`, `displayMode`, `width`, and `height`. Width and height control the image area rather than changing the source image.

## Display modes

- **Contain** keeps the complete image visible and preserves its proportions.
- **Fill** covers the complete image area and may crop the image.

## Toolbar

The toolbar appears when the image is hovered or focused:

```text
[contain / fill] [copy image] [open expanded view]
```

Copy places the rendered image on the system clipboard. Expanded view always starts in contain mode. The mouse wheel zooms around the pointer, dragging translates the image, and double-clicking restores contain mode. Escape or the close button closes it.