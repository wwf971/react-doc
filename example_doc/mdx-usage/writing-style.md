---
title: Recommended Writing Style
description: Introduce components through an HTML comment and a code block, so plain Markdown renderers stay compatible
---

Documents in this source can be opened by two kinds of renderers: the dedicated document page, and any normal Markdown renderer (a Git hosting site, an editor preview, ...). The recommended way to use a component keeps both working:

```markdown
<!--renderComp=ComponentName,prop=value-->
```

followed directly by a fenced code block, a quote block, or a table. The document page replaces the marked block with the rendered component. A normal Markdown renderer ignores the HTML comment and shows the plain block as-is — that is the degradation path. Writing `<ComponentName prop="value" />` directly is also supported, but only inside `.mdx` files; see [Direct MDX components](comp-mdx-native.mdx).

Simple scalar properties go into the comment as `key=value` pairs. Components with structured properties take a single YAML code block instead, with only the component name in the comment — the image, diagram, and index components in this part all use that form, for example [Image](comp-image.md#image-single).

## Marked code block

### Syntax

````markdown
<!--renderComp=StockTable,title=Warehouse A-->
```
| Product ID | Description | Stock Status |
| :--- | :--- | :---: |
| #1024 | Wireless Ergonomic Mouse | In Stock |
| #2048 | Mechanical Keyboard (RGB) | Low Stock |
| #4096 | Monitor Arm | Out of Stock |
```
````

### Display example

<!--renderComp=StockTable,title=Warehouse A-->
```
| Product ID | Description | Stock Status |
| :--- | :--- | :---: |
| #1024 | Wireless Ergonomic Mouse | In Stock |
| #2048 | Mechanical Keyboard (RGB) | Low Stock |
| #4096 | Monitor Arm | Out of Stock |
```

## Same block without the comment (degradation view)

This is what every marked block looks like in a renderer without component support — still perfectly readable:

```
| Product ID | Description | Stock Status |
| :--- | :--- | :---: |
| #1024 | Wireless Ergonomic Mouse | In Stock |
```

## Comment directly before a table

The marked node does not have to be a code block. A comment directly before a Markdown table hands that table to the component, and a plain renderer still shows a normal table:

<!--renderComp=StockTable,title=Warehouse C-->
| Product ID | Description | Stock Status |
| :--- | :--- | :---: |
| #8192 | USB Dock | In Stock |
| #8193 | Webcam | Low Stock |

## Unknown component name

A comment that names an unregistered component renders an inline error box instead of crashing the page, and the authored block stays visible inside it:

<!--renderComp=NoSuchComp-->
```
this block shows an inline error box instead of crashing the page
```
