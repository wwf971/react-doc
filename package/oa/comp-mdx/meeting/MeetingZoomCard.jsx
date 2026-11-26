import { useRef, useState } from 'react';
import { Check, Copy, ExternalLink, Plus } from '../../../../main/frontend/UICommon.js';
import { EditButtonGroup } from '../../../../main/comp-doc/edit/EditButtonGroup.jsx';
import { AnchoredPopover } from '../../../../main/comp-doc/popup/AnchoredPopover.jsx';
import './MeetingZoom.css';

// The look both Zoom cards share (doc/meeting-zoom.md): a tile with the mark of the kind, beside it
// the title with the button joining the meeting, and under the title the lines of the kind in a
// monospace face; the description, when written, under them across the card. Sized in em: in a
// document at the size of its text, in a card of a card diagram at the size of the cards around it
// (--doc-card-font-size, given by the card holding it).
//
//   Icon         the mark of the kind
//   title        what stands as the title: a text, or the field typing it
//   joinUrl      the link of Join; none, no button. It does nothing while the card is edited
//   description  what stands as the description, or nothing
//   children     the lines of the kind
//   edit         while it is edited (MeetingZoomEdit.jsx), what only editing draws, floating: nothing moves
//                  add    { title, open(event) }: the + in its corner, the values not written yet
//                  link   { isOpen, open(), field }: Join a button typing the link, in a field floating
//                         under it (under the title when there is no Join yet)
export function MeetingZoomCard({ kind, Icon, title, joinUrl = '', isEditing = false, description = null, children, edit = null }) {
	const joinRef = useRef(null);
	const titleRowRef = useRef(null);
	const link = edit?.link;
	return (
		<div className="oa-meeting-zoom not-prose" data-kind={kind} data-editing={isEditing ? '' : undefined}>
			<div className="oa-meeting-zoom-head">
				<span className="oa-meeting-zoom-tile" aria-hidden="true"><Icon /></span>
				<div className="oa-meeting-zoom-main">
					<div ref={titleRowRef} className="oa-meeting-zoom-title-row">
						<span className="oa-meeting-zoom-title">{title}</span>
						{joinUrl && link ? (
							<button ref={joinRef} type="button" className="oa-meeting-zoom-join nodrag" title={`The link: ${joinUrl}. A click types it`}
								onClick={(event) => { event.stopPropagation(); link.open(); }}>
								Join<ExternalLink aria-hidden="true" />
							</button>
						) : joinUrl ? (
							<a className="oa-meeting-zoom-join" href={joinUrl} target="_blank" rel="noopener noreferrer" title={joinUrl}
								tabIndex={isEditing ? -1 : undefined} aria-disabled={isEditing || undefined}>
								Join<ExternalLink aria-hidden="true" />
							</a>
						) : null}
					</div>
					{children}
				</div>
			</div>
			{description ? <div className="oa-meeting-zoom-description">{description}</div> : null}
			{link?.isOpen ? (
				<AnchoredPopover anchorRef={joinUrl ? joinRef : titleRowRef} isTracked isShownFirst className="oa-meeting-zoom-link-popover">
					<span className="oa-meeting-zoom-link-name">Link</span>
					{link.field}
				</AnchoredPopover>
			) : null}
			{edit?.add ? (
				<span className="oa-meeting-zoom-add nodrag nopan">
					<EditButtonGroup actionList={[{ id: 'add', Icon: Plus, title: edit.add.title, act: edit.add.open }]} ariaLabel="Add a value" />
				</span>
			) : null}
		</div>
	);
}

// a value to type in the app, with the button copying it
export function MeetingZoomCopy({ text, label }) {
	const [isCopied, isCopiedSet] = useState(false);
	const copy = async (event) => {
		event.stopPropagation();
		try {
			await navigator.clipboard.writeText(text);
			isCopiedSet(true);
			setTimeout(() => isCopiedSet(false), 1200);
		} catch {
			// a page without the clipboard: nothing to say, the value is there to select
		}
	};
	return (
		<button type="button" className="oa-meeting-zoom-copy nodrag" title={label} aria-label={label} onClick={copy}>
			{isCopied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
		</button>
	);
}
