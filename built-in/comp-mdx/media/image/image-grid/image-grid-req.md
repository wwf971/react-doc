# Image grid UI behavior

An image grid presents related images as one responsive group.

```text
wide area:    [image] [image] [image]
narrow area:  [image]
              [image]
              [image]
```

Rows wrap automatically when the available width becomes too small. Images are centered in every row by default. `itemWidth` controls the preferred item width, and `gap` controls the space between items.

Each entry supports the image block's `src`, `alt`, `caption`, `displayMode`, and `height` options. Its hover toolbar provides display-mode switching, image copy, and expanded pan/zoom.