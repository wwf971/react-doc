import { GraduationCap, UserRound } from '../../../../main/frontend/UICommon.js';
import { CellValue } from '../../../../main/comp-doc/cell/CellValue.jsx';
import { useCell } from '../../../../main/comp-doc/cell/use-cell.js';
import { OaCard, OaCardEventLines, OaCardTime, oaCardIsShownOf, oaCardStatusDrawn } from '../oa-card/OaCard.jsx';
import { OaCardEdit } from '../oa-card/OaCardEdit.jsx';
import { oaCardRead, oaCardTimeShownOf } from '../oa-card/oa-card-data.js';
import { oaPreferenceGet } from '../time/oa-config.js';
import { COURSE_ONLINE_RESERVATION } from './CourseOnlineData.js';

// A reservation of an online course (doc/course-online.md): an event of a special type (doc/event.md):
// the course, when its class is (a span of the package, doc/time.md), who gives it, who else takes it,
// the link of the class (Join), a description, its status beside its title. Its edit mode
// Fields (OaCardEdit.jsx) draws the same card with every value typed where it stands.
export function CourseOnlineReservation({ data = {}, config = {}, onEvent }) {
	if (config.isEdit) return <OaCardEdit kind={COURSE_ONLINE_RESERVATION} Render={CourseOnlineReservationRender} data={data} config={config} onEvent={onEvent} />;
	return <CourseOnlineReservationRead card={oaCardRead(COURSE_ONLINE_RESERVATION, data)} config={config} />;
}

function CourseOnlineReservationRead({ card, config }) {
	const cellText = useCell({ config });
	return <CourseOnlineReservationRender card={card} cellText={cellText} preference={oaPreferenceGet(config)} />;
}

// the card, from a reservation. valueRender(id): what stands in the place of a value (the editor's
// field); without it the value as read. edit: what editing adds (OaCard), and which values stand
// (edit.isShown: written, or just added)
export function CourseOnlineReservationRender({ card, valueRender, cellText, preference, isEditing = false, edit = null }) {
	const isShown = oaCardIsShownOf(card, edit);
	const url = /^https?:\/\//.test(String(card.url ?? '').trim()) ? card.url.trim() : '';
	return (
		<OaCard kind="course" tone="course" Icon={GraduationCap} isEditing={isEditing} joinUrl={url} edit={edit}
			title={valueRender ? valueRender('title') : card.title || 'Online course'}
			status={oaCardStatusDrawn({ kind: COURSE_ONLINE_RESERVATION, card, valueRender, isShown })}
			description={isShown('description') ? (valueRender ? valueRender('description') : <CellValue cell={cellText} text={card.description} />) : null}>
			<OaCardTime shown={oaCardTimeShownOf(card, preference)} isShown={isShown('time')} field={valueRender ? valueRender('time') : null} />
			{isShown('teacher') ? (
				<div className="oa-card-line">
					<span className="oa-card-person"><UserRound aria-hidden="true" />{valueRender ? valueRender('teacher') : card.teacher}</span>
				</div>
			) : null}
			<OaCardEventLines kind={COURSE_ONLINE_RESERVATION} card={card} valueRender={valueRender} isShown={isShown} />
		</OaCard>
	);
}
