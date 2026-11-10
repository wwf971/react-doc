import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { ArrowDown, ArrowUp, Trash2, X } from '../../../../main/frontend/UICommon.js';
import { useDocStores } from '../../../../main/frontend/src/store/context.js';
import { cardModelBuild } from './DiagramEditCardModel.js';
import { CheckValue, TextValue, ValueMenu } from './DiagramValueControls.jsx';

// The edit card of the visual editor: the settings of the principal of the
// path (a card, or a line by itself), beside it, as a popup of the edit
// layer (doc-edit-popup), so a click in it is not a click outside the
// editor. From top to bottom: the title, the tabs, the path bar (the host's
// PathBar), and the view of the active tab (DiagramEditCardModel.js): the
// detail of one thing, drawn with the host's PropEditor, or the list of a
// collection, drawn with the PropEditor's draggable items (a drag handle
// and a remove button before every item). A plain form stands in when the
// host injects no PropEditor.
//
// The card stands beside the whole principal, never beside the row or
// cell within it, and its top edge is computed from the principal alone:
// the card grows and shrinks downward as its content changes, and never
// moves while the author works in it (../power-platform/comp-diagram-er.md#diagram-er-edit).
export const DiagramEditCard = observer(function DiagramEditCard({ editor, onKeyDown }) {
	const { componentConfig } = useDocStores();
	const { store } = editor;
	const panelRef = useRef(null);
	const [position, positionSet] = useState(null);
	useEffect(() => {
		let frame;
		const update = () => {
			const rect = editor.anchorRectGet();
			const panel = panelRef.current;
			if (rect && panel) {
				const width = panel.offsetWidth;
				const isRight = rect.right + width + 16 <= innerWidth;
				const isLeft = !isRight && rect.left - width - 16 >= 0;
				const left = isRight ? rect.right + 8 : isLeft ? rect.left - width - 8 : rect.left;
				const top = isRight || isLeft ? rect.top : rect.bottom + 8;
				const next = {
					left: Math.round(Math.max(8, Math.min(innerWidth - width - 8, left))),
					top: Math.round(Math.max(8, Math.min(innerHeight - 200, top))),
				};
				next.maxHeight = innerHeight - next.top - 8;
				positionSet(previous => previous?.left === next.left && previous?.top === next.top && previous?.maxHeight === next.maxHeight ? previous : next);
			}
			frame = requestAnimationFrame(update);
		};
		update();
		return () => cancelAnimationFrame(frame);
	}, [editor]);
	const model = cardModelBuild(editor);
	if (!model) return null;
	const PathBar = componentConfig?.PathBar;
	const PropEditor = componentConfig?.PropEditor;
	return createPortal(<section ref={panelRef} className="doc-edit-popup doc-edit-panel doc-vis-card-panel not-prose" style={{ ...position, visibility: position ? 'visible' : 'hidden' }} aria-label="Edit card" onKeyDown={onKeyDown}>
		<div className="doc-edit-panel-row doc-vis-card-head">
			<strong>{model.title}</strong>
			<span className="doc-vis-card-kind">{model.kindLabel}</span>
			<button type="button" className="doc-button-icon" aria-label="Close" title="Close (Esc)" onClick={editor.clearSelection}><X size={13} /></button>
		</div>
		<div className="doc-vis-card-tabs" role="tablist">
			{model.tabList.map(tab => <button key={tab.id} type="button" role="tab" aria-selected={tab.id === model.tabId} className="doc-vis-card-tab" disabled={tab.isDisabled} title={tab.isDisabled ? tab.disabledReason : undefined} onClick={() => editor.navigate(tab.path)}>{tab.label}</button>)}
		</div>
		<div className="doc-vis-card-path doc-path" data-plain="">
			{PathBar
				? <PathBar pathData={{ segments: model.segmentList.map(segment => ({ name: segment.name })) }} onPathSegClicked={index => editor.navigate(model.segmentList[index].path)} allowEditText={false} appendTrailingSlash={false} height={22} separator="›" />
				: <span className="doc-vis-card-path-plain">{model.segmentList.map((segment, index) => <span key={index}>{index > 0 ? <span className="doc-vis-card-path-separator">›</span> : null}<button type="button" className="doc-vis-card-path-segment" onClick={() => editor.navigate(segment.path)}>{segment.name}</button></span>)}</span>}
		</div>
		<div className="doc-vis-card-body">
			{PropEditor
				? <PropEditorView PropEditor={PropEditor} model={model} store={store} editor={editor} />
				: <PlainView model={model} store={store} editor={editor} />}
		</div>
		{store.message ? <span role="alert" className="doc-error doc-vis-card-message">{store.message}</span> : null}
	</section>, document.body);
});

// ---------- the host's PropEditor ----------

const propertyPathBuild = (section, property) => `${section.id}.${property.id}`;

// the PropEditor nodes of a detail view: a group per section, a custom
// item for the note and the actions of a section
function detailNodeListBuild(sectionList, propertyById) {
	return sectionList.flatMap(section => {
		const children = [];
		if (section.propertyList.length) {
			children.push({
				id: section.id, type: 'group', label: section.label, isCollapsible: false,
				children: section.propertyList.map(property => {
					const propertyId = propertyPathBuild(section, property);
					propertyById[propertyId] = propertyMetaBuild(propertyId, property);
					return { id: property.id, type: 'property', propertyId };
				}),
			});
		}
		if (section.note) children.push({ id: `${section.id}-note`, type: 'custom', compName: 'note', data: { text: section.note } });
		if (section.actionList.length) children.push({ id: `${section.id}-actions`, type: 'custom', compName: 'actions', data: { actionList: section.actionList } });
		return children;
	});
}

// the PropEditor nodes of a list view: one group whose children are the
// items, each with a drag handle and a remove button before it, then the
// note and the add action
function listNodeListBuild(view) {
	const reorderTitle = view.isReorderable ? 'Drag to reorder' : view.reorderReason;
	return [
		{
			id: view.id, type: 'group', label: view.label, isCollapsible: false, isChildrenDraggable: view.isReorderable,
			children: view.itemList.map(item => ({
				id: item.id, type: 'custom', compName: 'listItem', data: item,
				leadingControlList: [
					{ id: 'drag', type: 'drag', title: reorderTitle, ariaLabel: `Reorder ${item.name}`, isDisabled: !view.isReorderable },
					{ id: 'remove', type: 'action', iconName: 'delete', kind: 'danger', title: item.isRemovable ? `Remove ${item.name}` : item.removeReason, ariaLabel: `Remove ${item.name}`, isDisabled: !item.isRemovable },
				],
			})),
		},
		...(view.note ? [{ id: `${view.id}-note`, type: 'custom', compName: 'note', data: { text: view.note } }] : []),
		...(view.add || view.actionList ? [{ id: `${view.id}-actions`, type: 'custom', compName: 'actions', data: { actionList: [...(view.add ? [view.add] : []), ...(view.actionList ?? [])] } }] : []),
	];
}

function propertyMetaBuild(id, property) {
	const meta = { id, label: property.label, value: property.value, isReadOnly: property.isReadOnly === true };
	switch (property.kind) {
		case 'bool': return { ...meta, valueType: 'bool', displayType: 'checkbox' };
		case 'number': return { ...meta, valueType: 'number', min: property.min, max: property.max, step: property.step };
		case 'color': return { ...meta, valueType: 'color', valueConfig: { modeCommit: 'apply' } };
		case 'enum': {
			const optionList = property.values.map(value => ({ id: value, label: property.valueLabels?.[value] ?? (value || 'None') }));
			const isShort = optionList.length <= 3 && optionList.every(option => option.label.length <= 10);
			return isShort
				? { ...meta, valueType: 'enum', optionList }
				: { ...meta, valueType: 'custom', valueCompName: 'menu', valueConfig: { values: property.values, valueLabels: property.valueLabels ?? {}, isSearchable: property.isSearchable === true, label: property.label } };
		}
		default:
			return property.isMultiline
				? { ...meta, valueType: 'custom', valueCompName: 'textMultiline', valueConfig: { label: property.label } }
				: { ...meta, valueType: 'text', valueConfig: { placeholder: '' } };
	}
}

// a hex color with a full alpha channel is kept as the 6-digit form
function colorNormalize(value) {
	const text = String(value ?? '').trim();
	return /^#[0-9a-f]{6}ff$/i.test(text) ? text.slice(0, 7) : text;
}

const MenuValueComp = observer(function MenuValueComp({ data, config, itemRef }) {
	return <ValueMenu label={config.label} value={data ?? ''} values={config.values} valueLabels={config.valueLabels} isSearchable={config.isSearchable} isLocked={config.isReadOnly} className="doc-vis-card-menu" onChange={value => itemRef.onValueChangeAttempt?.(value)} />;
});

const TextMultilineComp = observer(function TextMultilineComp({ data, config, itemRef }) {
	return <TextValue label={config.label} value={data ?? ''} isMultiline isLocked={config.isReadOnly} onChange={value => itemRef.onValueChangeAttempt?.(value)} />;
});

// the actions of a section: a disabled one keeps its reason as its title
function ActionsComp({ data, config }) {
	return <div className="doc-vis-card-actions">
		{data.actionList.map(action => (
			<button key={action.id} type="button" className={`doc-button${action.kind === 'danger' ? ' is-danger' : ''}`} disabled={config?.isReadOnly || action.isDisabled} title={action.isDisabled ? action.reason : undefined} onClick={() => action.act()}>{action.label}</button>
		))}
	</div>;
}

function NoteComp({ data }) {
	return <p className="doc-note doc-vis-card-note">{data.text}</p>;
}

// one item of a list view: its name, a badge and a sub line; a click opens
// its detail. is-selected follows the path, so it can never be stale
const ListItemComp = observer(function ListItemComp({ data, editor }) {
	return <button type="button" className={`doc-vis-list-item${data.isSelected ? ' is-selected' : ''}`} onClick={() => editor.navigate(data.path)}>
		<span className="doc-vis-list-main"><span className="doc-vis-list-name">{data.name || '(empty)'}</span>{data.badge ? <span className="doc-badge doc-vis-list-badge">{data.badge}</span> : null}</span>
		{data.sub ? <span className="doc-vis-list-sub">{data.sub}</span> : null}
	</button>;
});

const PropEditorView = observer(function PropEditorView({ PropEditor, model, store, editor }) {
	const [dragStateByGroupPath, dragStateSet] = useState({});
	const { view } = model;
	const propertyById = {};
	const panelList = view.type === 'list' ? listNodeListBuild(view) : detailNodeListBuild(view.sectionList, propertyById);
	const propertyByPath = useMemo(() => {
		const map = new Map();
		if (view.type === 'detail') for (const section of view.sectionList) for (const property of section.propertyList) map.set(propertyPathBuild(section, property), property);
		return map;
	}, [view]);
	const compByName = useMemo(() => ({
		menu: MenuValueComp, textMultiline: TextMultilineComp, actions: ActionsComp, note: NoteComp,
		listItem: props => <ListItemComp {...props} editor={editor} />,
	}), [editor]);
	return <PropEditor
		data={{ panelList, propertyById, dragStateByGroupPath }}
		config={{ width: '100%', getComp: name => compByName[name] ?? null, isLevelTopShown: false, isGroupCollapsible: false, isReadOnly: editor.isLocked, keyColWidth: 'min', keyColMinWidth: 72 }}
		onEvent={(type, eventData) => {
			if (type === 'propertyChangeAttempt') {
				const property = propertyByPath.get(eventData.propertyPath);
				if (!property) return { code: -1, message: 'Unknown property.' };
				const value = property.kind === 'color' ? colorNormalize(eventData.valueNext) : eventData.valueNext;
				const isChanged = property.set(value);
				return isChanged ? { code: 0 } : { code: -1, message: store.message || 'The change was not applied.' };
			}
			if (view.type !== 'list') return { code: 0 };
			// the list: its items dragged (the PropEditor reports the drag, the
			// card keeps its state and moves the item on drop) and removed
			if (type === 'propertyDirectDragStart') dragStateSet({ [eventData.groupPath]: { isDragging: true, itemIdDragged: eventData.itemId, indexFrom: eventData.indexFrom, indexDrop: eventData.indexFrom } });
			else if (type === 'propertyDirectDragPreview') dragStateSet(previous => previous[eventData.groupPath] ? { [eventData.groupPath]: { ...previous[eventData.groupPath], indexDrop: eventData.indexDrop } } : previous);
			else if (type === 'propertyDirectDragDrop') {
				const state = dragStateByGroupPath[eventData.groupPath];
				if (state) {
					const indexTo = state.indexDrop > state.indexFrom ? state.indexDrop - 1 : state.indexDrop;
					if (indexTo !== state.indexFrom) view.move(state.indexFrom, indexTo);
				}
				dragStateSet({});
			} else if (type === 'propertyDirectDragClear') dragStateSet({});
			else if (type === 'propertyDirectItemAction' && eventData.actionId === 'remove') view.remove(eventData.itemId);
			return { code: 0 };
		}}
	/>;
});

// ---------- the plain form, without PropEditor ----------

const PlainView = observer(function PlainView({ model, store, editor }) {
	const { view } = model;
	if (view.type === 'list') {
		return <div className="doc-vis-card-section">
			<div className="doc-vis-card-section-label">{view.label}</div>
			<div className="doc-vis-list">
				{view.itemList.map((item, index) => <div key={item.id} className="doc-vis-list-row">
					<button type="button" className="doc-button-icon" title={view.isReorderable ? 'Move up' : view.reorderReason} aria-label={`Move ${item.name} up`} disabled={editor.isLocked || !view.isReorderable || index === 0} onClick={() => view.move(index, index - 1)}><ArrowUp size={12} /></button>
					<button type="button" className="doc-button-icon" title={view.isReorderable ? 'Move down' : view.reorderReason} aria-label={`Move ${item.name} down`} disabled={editor.isLocked || !view.isReorderable || index === view.itemList.length - 1} onClick={() => view.move(index, index + 1)}><ArrowDown size={12} /></button>
					<button type="button" className="doc-button-icon" title={item.isRemovable ? `Remove ${item.name}` : item.removeReason} aria-label={`Remove ${item.name}`} disabled={editor.isLocked || !item.isRemovable} onClick={() => view.remove(item.id)}><Trash2 size={12} /></button>
					<ListItemComp data={item} editor={editor} />
				</div>)}
			</div>
			{view.note ? <p className="doc-note doc-vis-card-note">{view.note}</p> : null}
			{view.add || view.actionList ? <ActionsComp data={{ actionList: [...(view.add ? [view.add] : []), ...(view.actionList ?? [])] }} config={{ isReadOnly: editor.isLocked }} /> : null}
		</div>;
	}
	return <>
		{view.sectionList.map(section => <div key={section.id} className="doc-vis-card-section">
			{section.label ? <div className="doc-vis-card-section-label">{section.label}</div> : null}
			{section.propertyList.map(property => <PlainProperty key={property.id} property={property} isLocked={editor.isLocked || property.isReadOnly === true} />)}
			{section.note ? <p className="doc-note doc-vis-card-note">{section.note}</p> : null}
			{section.actionList.length ? <ActionsComp data={{ actionList: section.actionList }} config={{ isReadOnly: editor.isLocked }} /> : null}
		</div>)}
	</>;
});

function PlainProperty({ property, isLocked }) {
	let control;
	if (property.kind === 'bool') control = <CheckValue label="" isChecked={Boolean(property.value)} isLocked={isLocked} onChange={property.set} />;
	else if (property.kind === 'enum') control = <ValueMenu label={property.label} value={property.value} values={property.values} valueLabels={property.valueLabels} isSearchable={property.isSearchable} isLocked={isLocked} onChange={property.set} />;
	else if (property.kind === 'number') control = <input type="number" className="doc-vis-card-number" value={property.value} min={property.min} max={property.max} step={property.step} disabled={isLocked} onChange={event => property.set(Number(event.target.value))} />;
	else if (property.kind === 'color') control = <input type="color" className="doc-vis-card-color" value={String(property.value).slice(0, 7)} disabled={isLocked} onChange={event => property.set(event.target.value)} />;
	else control = <TextValue key={`${property.id}:${property.isReadOnly}`} label={property.label} value={String(property.value ?? '')} isLocked={isLocked} isMultiline={property.isMultiline} onChange={property.set} />;
	return <label className="doc-vis-field"><span className="doc-vis-field-label">{property.label}</span>{control}</label>;
}
