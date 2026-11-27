import { Video } from '../../../../main/frontend/UICommon.js';
import { CellValue } from '../../../../main/comp-doc/cell/CellValue.jsx';
import { useCell } from '../../../../main/comp-doc/cell/use-cell.js';
import { OaCard, OaCardCopy, OaCardEventLines, OaCardTime, oaCardIsShownOf, oaCardStatusDrawn } from '../oa-card/OaCard.jsx';
import { OaCardEdit } from '../oa-card/OaCardEdit.jsx';
import { oaCardRead, oaCardTimeShownOf } from '../oa-card/oa-card-data.js';
import { oaPreferenceGet } from '../time/oa-config.js';
import { MEETING_ZOOM_INSTANCE, meetingIdFormat, meetingJoinUrl } from './MeetingZoomData.js';

// A Zoom meeting instance (doc/meeting-zoom.md#an-instance): a meeting joined by its number and passcode,
// each copied by its button, at any time or at one (its time, at any granularity); Join opens its link,
// or the link of its number. An event of a special type: who joins it, its status beside its title.
// Its edit mode Fields (OaCardEdit.jsx) draws the same card with every value typed where it stands.
export function MeetingZoomInstance({ data = {}, config = {}, onEvent }) {
	if (config.isEdit) return <OaCardEdit kind={MEETING_ZOOM_INSTANCE} Render={MeetingZoomInstanceRender} data={data} config={config} onEvent={onEvent} />;
	return <MeetingZoomInstanceRead card={oaCardRead(MEETING_ZOOM_INSTANCE, data)} config={config} />;
}

function MeetingZoomInstanceRead({ card, config }) {
	const cellText = useCell({ config });
	return <MeetingZoomInstanceRender card={card} cellText={cellText} preference={oaPreferenceGet(config)} />;
}

// the card, from an instance. valueRender(id): what stands in the place of a value (the editor's
// field); without it the value as read. edit: what editing adds (OaCard), and which values stand
// (edit.isShown: written, or just added)
export function MeetingZoomInstanceRender({ card, valueRender, cellText, preference, isEditing = false, edit = null }) {
	const value = (id, text) => (valueRender ? valueRender(id) : text);
	const isShown = oaCardIsShownOf(card, edit);
	return (
		<OaCard kind="instance" tone="zoom" Icon={Video} isEditing={isEditing} joinUrl={meetingJoinUrl(card)} edit={edit}
			title={value('title', card.title || 'Zoom meeting')}
			status={oaCardStatusDrawn({ kind: MEETING_ZOOM_INSTANCE, card, valueRender, isShown })}
			description={isShown('description') ? (valueRender ? valueRender('description') : <CellValue cell={cellText} text={card.description} />) : null}>
			<OaCardTime shown={oaCardTimeShownOf(card, preference)} isShown={isShown('time')} field={valueRender ? valueRender('time') : null} />
			<OaCardEventLines kind={MEETING_ZOOM_INSTANCE} card={card} valueRender={valueRender} isShown={isShown} />
			{isShown('meetingId') || isShown('passcode') ? (
				<dl className="oa-card-code-list">
					{isShown('meetingId') ? (
						<>
							<dt>ID</dt>
							<dd>
								<span className="oa-card-code">{value('meetingId', meetingIdFormat(card.meetingId))}</span>
								{card.meetingId ? <OaCardCopy text={card.meetingId.replace(/\D/g, '') || card.meetingId} label="Copy the meeting ID" /> : null}
							</dd>
						</>
					) : null}
					{isShown('passcode') ? (
						<>
							<dt>Passcode</dt>
							<dd>
								<span className="oa-card-code">{value('passcode', card.passcode)}</span>
								{card.passcode ? <OaCardCopy text={card.passcode} label="Copy the passcode" /> : null}
							</dd>
						</>
					) : null}
				</dl>
			) : null}
		</OaCard>
	);
}
