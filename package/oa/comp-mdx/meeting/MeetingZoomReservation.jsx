import { CalendarClock } from '../../../../main/frontend/UICommon.js';
import { CellValue } from '../../../../main/comp-doc/cell/CellValue.jsx';
import { useCell } from '../../../../main/comp-doc/cell/use-cell.js';
import { OaCard, OaCardEventLines, OaCardTime, oaCardIsShownOf, oaCardStatusDrawn } from '../oa-card/OaCard.jsx';
import { OaCardEdit } from '../oa-card/OaCardEdit.jsx';
import { oaCardRead, oaCardTimeShownOf } from '../oa-card/oa-card-data.js';
import { oaPreferenceGet } from '../time/oa-config.js';
import { MEETING_ZOOM_RESERVATION, meetingJoinUrl } from './MeetingZoomData.js';

// A Zoom meeting reservation (doc/meeting-zoom.md#a-reservation): a meeting at a time, an event of a
// special type (doc/event.md): who joins it, the link joining it, a description, its status beside its title. Its time is a span of the package (doc/time.md), written in the card's format or
// the package's preferences, its length beside it. Its edit mode Fields (OaCardEdit.jsx) draws the same
// card with every value typed where it stands.
export function MeetingZoomReservation({ data = {}, config = {}, onEvent }) {
	if (config.isEdit) return <OaCardEdit kind={MEETING_ZOOM_RESERVATION} Render={MeetingZoomReservationRender} data={data} config={config} onEvent={onEvent} />;
	return <MeetingZoomReservationRead card={oaCardRead(MEETING_ZOOM_RESERVATION, data)} config={config} />;
}

function MeetingZoomReservationRead({ card, config }) {
	const cellText = useCell({ config });
	return <MeetingZoomReservationRender card={card} cellText={cellText} preference={oaPreferenceGet(config)} />;
}

// the card, from a reservation. valueRender(id): what stands in the place of a value (the editor's
// field); without it the value as read. edit: what editing adds (OaCard), and which values stand
// (edit.isShown: written, or just added)
export function MeetingZoomReservationRender({ card, valueRender, cellText, preference, isEditing = false, edit = null }) {
	const isShown = oaCardIsShownOf(card, edit);
	return (
		<OaCard kind="reservation" tone="zoom" Icon={CalendarClock} isEditing={isEditing} joinUrl={meetingJoinUrl(card)} edit={edit}
			title={valueRender ? valueRender('title') : card.title || 'Zoom meeting'}
			status={oaCardStatusDrawn({ kind: MEETING_ZOOM_RESERVATION, card, valueRender, isShown })}
			description={isShown('description') ? (valueRender ? valueRender('description') : <CellValue cell={cellText} text={card.description} />) : null}>
			<OaCardTime shown={oaCardTimeShownOf(card, preference)} isShown={isShown('time')} field={valueRender ? valueRender('time') : null} />
			<OaCardEventLines kind={MEETING_ZOOM_RESERVATION} card={card} valueRender={valueRender} isShown={isShown} />
		</OaCard>
	);
}
