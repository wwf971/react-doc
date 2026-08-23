<!-- This is a minimalist requirement document, aiming at letting reader get a overall grasp of core concepts/workflows, and design and implementation requiremen, at a few glances-->




The file system should support automatically rendering a beautiful and organized doc page, with highly customizable ui layout and behavior, based on local directories and files, including mdx, md and other files. 

The source is typically a folder, but its most complete form is `0..N folder + 0..N file`. The source should be represented as a list of rules, for exapmle:

```
add xxx folder
add files: /path/to/file1, /path/to/file/2
remove files with file name pattern: *.pyc
remove file with path pattern: **/.gitignore

# remove all things in /xx/yy/ folder, except one file
remove folder with path pattern /xx/yy/
add file with path /xx/yy/zz 

```

The files/folders included in source should eventually be parsed by executing the list of rules in order, and form the following structure. In its most complete form, it should be multi-root(of course it can be single-root in case only one root item exists).

```text
source
  ├──root folder1
  ├──root folder2
  ├──root file1
  └──root file2
```

And the internal representation of a folder/file should always be `/{root-folder-or-file-id}/xx/yy/`. We use id for root folder/file, so that we can deal with situation when there are root items with same name.


For files other than md/mdx, there should be a default display, and display strategies based on file suffices should also be supported. For example, python scripts might be treated as a markdown file with a title(being its file name) and a one single code block.

Source should be able to be specified from a file.

## SidePanel

Custom side panel structure should be supported, not necessarily plainly reflecting the file tree structure of source. The custom side panel tree structure should be able to be specified from an index file.

## Link/Ref

Custom link parsing/rendering logic and navigation behavior should be supported.

Not only will link parsing logic be applied to typical links like `[a.md](a.md)`, but we also support applying it to `a.md`(incline code), or other patterns `[[a.md]]`(obsidian style link).

This might require taking over the rendering of almost everything, including the most basic nodes like plain text, so link pattern matching logic can be applied, and links embedded in plain text can be rendered properly.

Various navigation mode should be supported. One basic example is to make clicking `[a.md](a.md)` possible to navigate to `a.md` within the source, regardless of where it is. A more advanced most is to display a dropdown allowing user to choose which one to navigate to, in case multiple `a.md` exists in the source.

## Graceful degration to normal markdown

It's possible that the .mdx files in source will be directly read using normal markdown. So we need some special stipulation as well as corresponding processing logic to ensure that the file look totally normal when rendered as normal markdown, without unpredicatable rendering behaviors.

HTML comment will be used to mark specific content that needs special rendering logic, for exapmle rendering using special comment.

```
<!--special comment before the code block-->
| Product ID | Description | Stock Status |
| :--- | :--- | :---: | ---: |
| #1024 | Wireless Ergonomic Mouse | In Stock |
| #2048 | Mechanical Keyboard (RGB) | Low Stock |
```

And embedded component preferably will be written inside a code block, to avoid unpredictable rendering behavior when rendered using normal markdown renderer.

<!--renderComp=xxx,a=b,c=d-->
```
<Comp a=b c=d>
```

To implement above design, remark plugins might be needed to parse html comment that contain specific patterns, and mark the node next to the comment node.

Note that above is just a stipulation. It's possible that some mdx violates the stipulation, and directly put `<Comp a=b c=d>` there(not in a code block), which is actually the more common style.