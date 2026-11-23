# oa: office automation

Components for the things an office keeps track of, each a block of a document, and each one a card of a [card diagram](../../cloud-dev-vis/doc/card-diagram-usage.md#a-component-in-a-card) can hold:

| Component | What it is | Typed after `/` |
| --- | --- | --- |
| [MeetingZoomReservation](./meeting-zoom.md#a-reservation) | a Zoom meeting at a time: what, when, how long, the link joining it, a description | `/meeting-zoom-reservation`, `/zoom-reservation` |
| [MeetingZoomInstance](./meeting-zoom.md#an-instance) | a Zoom meeting joined at any time: its number and passcode, a description | `/meeting-zoom-instance`, `/zoom-instance` |

A component is in `comp-mdx/{group}/` (its `comp.yaml` lists it), with its data read and written in one module (`MeetingZoomData.js`), the look two components share in one (`MeetingZoomCard.jsx`) and the edit mode beside them (`MeetingZoomEdit.jsx`), as every component of react-doc is written ([Component edit mode](../../../main/doc_page_impl_edit.md#component-edit-mode)). A component that should be found in the slash menu says the word typed for it (`meta.slashName`, [Components in the slash menu](../../../main/doc_page_impl_edit_slash.md#components-in-the-slash-menu)).

A component of this package is sized in `em`, and takes `--doc-card-font-size` when a card of a diagram holds it (`font-size: var(--doc-card-font-size, 0.875em)`), so in a diagram it is as large as the cards around it.
