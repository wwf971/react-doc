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

Custom side panel structure should be supported, not necessarily plainly reflecting the file tree structure of source. The custom side panel tree structure should be able to be specified from an index config file.

The core design idea is that each item in the side panel tree does not necessarily correspond to a file or a folder in the tree, but can also be virtual node.

A non-leaf item should suport follwoing mode:

1. Be a virtual folder, under it that can be other items, such as real files.

2. Represent a folder in the source(not necessarily root folder). So the subtree under it will be fully reflecting the actual file tree structure under that folder. Files will appear as descedant items and be displayed in normal way.

A leaf item should support following mode:

1. Repersent a file in the source. the file can be specified by its path, or only by its name. In latter case, the item declares that it holds the file inside the source with given name. In case multiple files of given name exists, the first file under a default order will be selected. there will also be a warning area prepended, listing all matched files, warning user to deal with the problem

2. Have the panel to its right rendered using a component. the component is speicied by its name, as well as the data to be fed into it. the component will be resolved from the unified component registry.

All items should support custom display name in the side panel, or even using custom component. the component is specified by component name, and data to be fed to it. the component will be resolved from the unified component registry.

For the time being, we still assume that only leaf item can have corresponding panel to the right.

It's totally possible that there exists multiple leaf item corresponding to same file in source.

The link navigation system should have a layer that maintains for a file, what items are bound to it, and when navigating, which item to go to. For the time being, let us simply go to the first item according to tree order. Note that this might including item that exists as a descendant item that is bound to a folder.

The link navigation system should be able to deal with failure when a link points to a valid file in source, but navigation cannot happen because no item in tne side panel has picked it up.

For config file that describes that side panel's tree structure, the data format should be well designed, and keep things clean and clear.

## Unified Component Registry

The document page should maintain a unified component registry, supporting registering a component with given name, and fetching a component by component name. The component can be provided not only to mdx, but also used elsewhere such as side panel item that wants custom component to render themselves, and their main. 

## Link/Ref

Custom link parsing/rendering logic and navigation behavior should be supported.

Not only will link parsing logic be applied to typical links like `[a.md](a.md)`, but we also support applying it to `a.md`(incline code), or other patterns `[[a.md]]`(obsidian style link).

This might require taking over the rendering of almost everything, including the most basic nodes like plain text, so link pattern matching logic can be applied, and links embedded in plain text can be rendered properly.

Various navigation mode should be supported. One basic example is to make clicking `[a.md](a.md)` possible to navigate to `a.md` within the source, regardless of where it is. A more advanced most is to display a dropdown allowing user to choose which one to navigate to, in case multiple `a.md` exists in the source.

## Graceful degration to normal markdown

It's possible that the .mdx files in source will be directly read using normal markdown renderer. so we need some special stipulation as well as corresponding processing logic to ensure that the file look totally normal when treated as markdown, not mdx. without unpredicatable rendering behaviors.

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