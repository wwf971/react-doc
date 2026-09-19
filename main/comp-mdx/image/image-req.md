# Image block UI behavior

An image block displays one image inside a bounded area.

## Source data

MD and MDX may specify `src`, `alt`, `caption`, `displayMode`, `width`, and `height`. Width and height control the image area rather than changing the source image.

In plain Markdown, keep the component marker free of properties and put every authored property in the following YAML block:

````markdown
<!--renderComp=DocImage-->
```yaml
src: /doc-aux/image/example.png
alt: Example screen
caption: Figure: Example screen
displayMode: contain-auto
width: 520
height: 300
```
````

The YAML block remains readable when a normal Markdown renderer ignores the component marker. Direct MDX may continue to pass the same properties as component attributes.

## Display modes

- **Contain** keeps the complete image visible and preserves its proportions.
- **Contain auto** (`displayMode: contain-auto`) uses the full configured width, keeps the complete image visible, and lets the image area height follow the scaled image's aspect ratio. A configured height is ignored in this mode.
- **Fill** covers the complete image area and may crop the image.

## Toolbar

The toolbar appears when the image is hovered or focused:

```text
[contain / fill] [copy image] [open expanded view]
```

For an image authored with `contain-auto`, the display toggle returns from Fill to Contain auto. Copy places the rendered image on the system clipboard. Expanded view always starts in contain mode. The mouse wheel zooms around the pointer, dragging translates the image, and double-clicking restores contain mode. Escape or the close button closes it.