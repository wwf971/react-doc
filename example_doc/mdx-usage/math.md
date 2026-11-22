---
title: LaTeX Math
description: Formulas in a line and on a row of their own, drawn by KaTeX, typed in place in edit mode
language: en
---

A formula is written in the Markdown of math. In a line: the energy of a body at rest is $E = mc^2$, and the share of $a$ in $a + b$ is $\frac{a}{b + a}$. On a row of its own, set apart and centered, between lines of `$$`:

$$
\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}
$$

## In a list

- an item with $x^2 + y^2 = z^2$ in its line
- an item with a formula on a row of its own, among its text
  $$
  \int_0^1 x \, dx = \frac{1}{2}
  $$
  and the text after it, on the lines of the item
- a plain item

## Typing a formula

In edit mode a formula is one thing of its text: a click on it opens its source in a field below it, and the formula is drawn again at each key. Nothing on the page moves when the field opens or closes. In the field, Enter finishes a formula in the line (in a formula on a row it is a line break, and Ctrl or ⌘ + Enter finishes); ← at its start and → at its end lead back into the text; Backspace in an empty source takes the formula out.

`/math` (or `/latex`) puts a new formula at the caret: Enter in the line, Tab to choose a row of its own. In a paragraph, a formula on a row becomes a block of its own between the text before and after it when the paragraph is saved.

A block of math, like the sum above, is drawn in its place while it is edited, its source below it.

**Copying a formula.** Point at a formula on a row of its own, like the sum above: a small control floats right after it. Its button copies the LaTeX; the arrow beside it copies the formula as an image (as drawn here) or as an SVG of paths, or downloads the image or the SVG as a file.

**Deleting a formula.** Right-click it. Outside the editor the menu of its block starts with **Delete Formula…**, which asks first and then writes the paragraph or the item without it; on a formula of a text being typed the menu is **Delete Formula** alone, and Undo brings it back. A block of math is a block: right-click it for **Delete Blocks…**.
