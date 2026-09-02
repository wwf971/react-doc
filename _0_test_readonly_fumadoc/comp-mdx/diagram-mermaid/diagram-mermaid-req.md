# Mermaid block UI behavior

A Mermaid block presents one diagram inside a bounded document area. It should keep the document layout stable while making large diagrams readable.

## Display modes

- **Contain** is the default mode. The complete diagram scales to the available width.
- **Fill** uses the diagram's original size. A horizontal scrollbar appears when the diagram is wider than the block.
- The display-mode button switches the current block between these modes without changing the document source.

## Toolbar

The toolbar appears when the block is hovered or focused:

```text
[contain / fill] [copy source] [open expanded view]
```

Each action must have an accessible label. Copy copies the Mermaid source rather than rendered SVG markup.

## Horizontal scrolling

In fill mode, a wide diagram supports normal scrollbar use and left-button drag scrolling.

```text
press inside diagram -> drag horizontally -> move viewport -> release
```

While a scroll drag is possible, the diagram must not start browser text selection. Pointer release or cancellation ends the drag. A simple click without movement must not scroll the viewport.

## Expanded view

Expanded view uses the available window area. Dragging pans the diagram, the mouse wheel zooms around the pointer, and double-clicking restores the fitted view. Text selection remains disabled during these direct-manipulation gestures.

## Rendering isolation

Temporary Mermaid rendering must stay inside a hidden, contained host owned by the component. Temporary elements must not change document or window overflow before the final SVG is ready.