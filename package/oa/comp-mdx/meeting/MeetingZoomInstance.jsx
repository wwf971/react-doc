import { Video } from '../../../../main/frontend/UICommon.js';
import { CellValue } from '../../../../main/comp-doc/cell/CellValue.jsx';
import { useCell } from '../../../../main/comp-doc/cell/use-cell.js';
import { MeetingZoomCard, MeetingZoomCopy } from './MeetingZoomCard.jsx';
import { MeetingZoomEdit } from './MeetingZoomEdit.jsx';
import { MEETING_ZOOM_INSTANCE, meetingIdFormat, meetingJoinUrl, meetingRead } from './MeetingZoomData.js';

// A Zoom meeting instance (doc/meeting-zoom.md#an-instance): a meeting joined at any time by its
// number and passcode, each copied by its button; Join opens its link, or the link of its number.
// Its edit mode Fields (MeetingZoomEdit.jsx) draws the same card with every value typed where it stands.
export function MeetingZoomInstance({ data = {}, config = {}, onEvent }) {
	if (config.isEdit) return <MeetingZoomEdit kind={MEETING_ZOOM_INSTANCE} Render={MeetingZoomInstanceRender} data={data} config={config} onEvent={onEvent} />;
	return <MeetingZoomInstanceRead meeting={meetingRead(MEETING_ZOOM_INSTANCE, data)} config={config} />;
}

function MeetingZoomInstanceRead({ meeting, config }) {
	const cellText = useCell({ config });
	return <MeetingZoomInstanceRender meeting={meeting} cellText={cellText} />;
}

// the card, from an instance. valueRender(id): what stands in the place of a value (the editor's
// field); without it the value as read
export function MeetingZoomInstanceRender({ meeting, valueRender, cellText, isEditing = false }) {
	const value = (id, text) => (valueRender ? valueRender(id) : text);
	return (
		<MeetingZoomCard kind="instance" Icon={Video} isEditing={isEditing} joinUrl={meetingJoinUrl(meeting)}
			title={value('title', meeting.title || 'Zoom meeting')}
			description={meeting.description ? (valueRender ? valueRender('description') : <CellValue cell={cellText} text={meeting.description} />) : null}>
			{meeting.meetingId || meeting.passcode ? (
				<dl className="oa-meeting-zoom-code-list">
					{meeting.meetingId ? (
						<>
							<dt>ID</dt>
							<dd>
								<span className="oa-meeting-zoom-code">{value('meetingId', meetingIdFormat(meeting.meetingId))}</span>
								<MeetingZoomCopy text={meeting.meetingId.replace(/\D/g, '') || meeting.meetingId} label="Copy the meeting ID" />
							</dd>
						</>
					) : null}
					{meeting.passcode ? (
						<>
							<dt>Passcode</dt>
							<dd>
								<span className="oa-meeting-zoom-code">{value('passcode', meeting.passcode)}</span>
								<MeetingZoomCopy text={meeting.passcode} label="Copy the passcode" />
							</dd>
						</>
					) : null}
				</dl>
			) : null}
		</MeetingZoomCard>
	);
}
