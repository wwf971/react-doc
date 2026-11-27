import { CalendarDays } from '../../../../main/frontend/UICommon.js';
import { CellValue } from '../../../../main/comp-doc/cell/CellValue.jsx';
import { useCell } from '../../../../main/comp-doc/cell/use-cell.js';
import { OaCard, OaCardEventLines, OaCardTime, oaCardIsShownOf, oaCardStatusDrawn } from '../oa-card/OaCard.jsx';
import { OaCardEdit } from '../oa-card/OaCardEdit.jsx';
import { oaCardRead, oaCardTimeShownOf } from '../oa-card/oa-card-data.js';
import { oaPreferenceGet } from '../time/oa-config.js';
import { EVENT_GENERAL } from './EventGeneralData.js';

// An event (doc/event.md): what it is, when (a span of the package, doc/time.md), who, where, a
// description, and its status beside its title, the latest change of its history. Its edit mode Fields
// (OaCardEdit.jsx) draws the same card with every value typed where it stands.
export function EventGeneral({ data = {}, config = {}, onEvent }) {
	if (config.isEdit) return <OaCardEdit kind={EVENT_GENERAL} Render={EventGeneralRender} data={data} config={config} onEvent={onEvent} />;
	return <EventGeneralRead card={oaCardRead(EVENT_GENERAL, data)} config={config} />;
}

function EventGeneralRead({ card, config }) {
	const cellText = useCell({ config });
	return <EventGeneralRender card={card} cellText={cellText} preference={oaPreferenceGet(config)} />;
}

// the card, from an event. valueRender(id): what stands in the place of a value (the editor's field);
// without it the value as read. edit: what editing adds (OaCard), and which values stand
export function EventGeneralRender({ card, valueRender, cellText, preference, isEditing = false, edit = null }) {
	const isShown = oaCardIsShownOf(card, edit);
	return (
		<OaCard kind="event" tone="event" Icon={CalendarDays} isEditing={isEditing} edit={edit}
			title={valueRender ? valueRender('title') : card.title || 'Event'}
			status={oaCardStatusDrawn({ kind: EVENT_GENERAL, card, valueRender, isShown })}
			description={isShown('description') ? (valueRender ? valueRender('description') : <CellValue cell={cellText} text={card.description} />) : null}>
			<OaCardTime shown={oaCardTimeShownOf(card, preference)} isShown={isShown('time')} field={valueRender ? valueRender('time') : null} />
			<OaCardEventLines kind={EVENT_GENERAL} card={card} valueRender={valueRender} isShown={isShown} />
		</OaCard>
	);
}
