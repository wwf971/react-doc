import { CalendarClock } from '../../../../main/frontend/UICommon.js';
import { CellValue } from '../../../../main/comp-doc/cell/CellValue.jsx';
import { useCell } from '../../../../main/comp-doc/cell/use-cell.js';
import { MeetingZoomCard } from './MeetingZoomCard.jsx';
import { MeetingZoomEdit } from './MeetingZoomEdit.jsx';
import { MEETING_ZOOM_RESERVATION, meetingJoinUrl, meetingRead, meetingTimeParse, meetingWhenPartList } from './MeetingZoomData.js';

// A Zoom meeting reservation (doc/meeting-zoom.md#a-reservation): a meeting at a time, how long it
// lasts when written, the link joining it, a description. Its edit mode Fields (MeetingZoomEdit.jsx)
// draws the same card with every value typed where it stands.
export function MeetingZoomReservation({ data = {}, config = {}, onEvent }) {
	if (config.isEdit) return <MeetingZoomEdit kind={MEETING_ZOOM_RESERVATION} Render={MeetingZoomReservationRender} data={data} config={config} onEvent={onEvent} />;
	return <MeetingZoomReservationRead meeting={meetingRead(MEETING_ZOOM_RESERVATION, data)} config={config} />;
}

function MeetingZoomReservationRead({ meeting, config }) {
	const cellText = useCell({ config });
	return <MeetingZoomReservationRender meeting={meeting} cellText={cellText} />;
}

// the card, from a reservation. valueRender(id): what stands in the place of a value (the editor's
// field); without it the value as read. The day of the week is read from the time, beside it, so
// the time typed is the time shown
export function MeetingZoomReservationRender({ meeting, valueRender, cellText, isEditing = false }) {
	const { timeText, durationText } = meetingWhenPartList(meeting);
	const weekday = meetingTimeParse(meeting.time)?.weekday;
	const timeShown = weekday ? timeText.slice(weekday.length + 1) : timeText;
	return (
		<MeetingZoomCard kind="reservation" Icon={CalendarClock} isEditing={isEditing} joinUrl={meetingJoinUrl(meeting)}
			title={valueRender ? valueRender('title') : meeting.title || 'Zoom meeting'}
			description={meeting.description ? (valueRender ? valueRender('description') : <CellValue cell={cellText} text={meeting.description} />) : null}>
			{meeting.time || meeting.duration ? (
				<div className="oa-meeting-zoom-line">
					{meeting.time ? (
						<span className="oa-meeting-zoom-when">
							{weekday ? <span className="oa-meeting-zoom-weekday">{weekday}</span> : null}
							{valueRender ? valueRender('time') : timeShown}
						</span>
					) : null}
					{meeting.duration ? (
						<span className="oa-meeting-zoom-length">
							{valueRender && /^\d+$/.test(meeting.duration) ? <>{valueRender('duration')} min</> : valueRender ? valueRender('duration') : durationText}
						</span>
					) : null}
				</div>
			) : null}
		</MeetingZoomCard>
	);
}
