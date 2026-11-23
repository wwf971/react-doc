import { useState } from 'react';
import { Check, Copy, ExternalLink } from '../../../../main/frontend/UICommon.js';
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
export function MeetingZoomCard({ kind, Icon, title, joinUrl = '', isEditing = false, description = null, children }) {
	return (
		<div className="oa-meeting-zoom not-prose" data-kind={kind} data-editing={isEditing ? '' : undefined}>
			<div className="oa-meeting-zoom-head">
				<span className="oa-meeting-zoom-tile" aria-hidden="true"><Icon /></span>
				<div className="oa-meeting-zoom-main">
					<div className="oa-meeting-zoom-title-row">
						<span className="oa-meeting-zoom-title">{title}</span>
						{joinUrl ? (
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
