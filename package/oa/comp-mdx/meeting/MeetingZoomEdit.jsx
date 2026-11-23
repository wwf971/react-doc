import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { observable, toJS } from 'mobx';
import { EditActions } from '../../../../main/comp-doc/edit/EditActions.jsx';
import { EditFloatingPanel } from '../../../../main/comp-doc/edit/EditFloatingPanel.jsx';
import { CellField } from '../../../../main/comp-doc/cell/CellField.jsx';
import { useCell } from '../../../../main/comp-doc/cell/use-cell.js';
import { meetingFieldNormalize, meetingRawBuild, meetingRead } from './MeetingZoomData.js';

// The edit mode Fields of both Zoom cards (main/doc_page_impl_edit.md#component-edit-mode): the same
// card the reader sees (Render), drawn from the draft, every value written typed where it stands (a
// field of the cell editing kit: a click opens it, Enter or a click elsewhere keeps it, Escape gives
// it up). What has no place of its own in the card is typed in the floating bar: the link (the card
// shows it as the button Join) and every field not written yet, so entering moves nothing; a field
// filled there takes its place in the card. Every change is reported as the yaml the block is saved
// as (editDraftChange), so leaving the block saves it.
//
// The description is a cell text (doc_page_impl_edit_cell.md): the token kinds of the page (a link,
// a view of an object), typed with its slash mode. The other values are plain: no token, no slash
// (a link is full of "/").
//
// It is the same in a block of a document and in a card of a card diagram holding it (card-comp): the
// owner of the session answers its events, and its bar goes where the owner's floating area is.
export const MeetingZoomEdit = observer(function MeetingZoomEdit({ kind, Render, data = {}, config = {}, onEvent }) {
	// the values in the form the card reads them, so the fields show what the card showed
	const [draft] = useState(() => {
		const meeting = meetingRead(kind, data);
		for (const id of Object.keys(meeting)) meeting[id] = meetingFieldNormalize(id, meeting[id]);
		return observable(meeting);
	});
	const session = config.edit?.session ?? {};
	const isLocked = session.status === 'submitting';
	const cellPlain = useCell({ config, tokenIdList: [] });
	const cellText = useCell({ config });
	const fieldById = Object.fromEntries(kind.fieldList.map((field) => [field.id, field]));
	const fieldSet = (id, text) => {
		draft[id] = meetingFieldNormalize(id, text);
		void onEvent?.('editDraftChange', { raw: meetingRawBuild(kind, draft) });
	};
	const valueRender = (id) => {
		const field = fieldById[id];
		return (
			<CellField cell={field.isCellText ? cellText : cellPlain} value={draft[id]} isEditable={!isLocked} isMultiline={field.isMultiline === true}
				placeholder={field.placeholder || field.label} className={`oa-meeting-zoom-field is-${id}`}
				fieldKey={`${config.instanceId ?? 'meeting'}:${id}`} ariaLabel={field.label} onCommit={(text) => fieldSet(id, text)} />
		);
	};
	const meeting = toJS(draft);
	// what the card has no place for: the link, and what is not written yet
	const barList = kind.fieldList.filter((field) => field.id === 'url' || (field.id !== 'title' && !meeting[field.id]));
	return (
		<>
			<Render meeting={meeting} valueRender={valueRender} cellText={cellText} isEditing />
			<EditFloatingPanel label={kind.label}
				actions={<EditActions status={session.status} message={session.message} onSubmit={() => { if (!isLocked) void onEvent?.('editSubmitRequest', { raw: meetingRawBuild(kind, draft) }); }} onCancel={() => { if (!isLocked) void onEvent?.('editCancelRequest'); }} />}>
				{barList.length ? (
					<div className="oa-meeting-zoom-edit-empty">
						{barList.map((field) => (
							<label key={field.id} className="oa-meeting-zoom-edit-field">
								<span className="oa-meeting-zoom-edit-name">{field.label}</span>
								{valueRender(field.id)}
							</label>
						))}
					</div>
				) : null}
			</EditFloatingPanel>
		</>
	);
});
