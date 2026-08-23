# Component via Comment Mark

This file is plain markdown. An html comment `renderComp=...` marks the next
block for component rendering; a normal markdown renderer ignores the comment
and shows the block as-is.

## Marked code block

<!--renderComp=StockTable,title=Warehouse A-->
```
| Product ID | Description | Stock Status |
| :--- | :--- | :---: |
| #1024 | Wireless Ergonomic Mouse | In Stock |
| #2048 | Mechanical Keyboard (RGB) | Low Stock |
| #4096 | Monitor Arm | Out of Stock |
```

## Same block without the comment (degradation view)

```
| Product ID | Description | Stock Status |
| :--- | :--- | :---: |
| #1024 | Wireless Ergonomic Mouse | In Stock |
```

## Comment directly before a table

<!--renderComp=StockTable,title=Warehouse C-->
| Product ID | Description | Stock Status |
| :--- | :--- | :---: |
| #8192 | USB Dock | In Stock |
| #8193 | Webcam | Low Stock |

## Unknown component name

<!--renderComp=NoSuchComp-->
```
this block shows an inline error box instead of crashing the page
```
