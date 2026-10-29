import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { X } from '../../../../main/frontend/UICommon.js';
import { useDocStores } from '../../../../main/frontend/src/store/context.js';
import { cardModelBuild } from './DiagramEditCardModel.js';
import { CheckValue, TextValue, ValueMenu } from './DiagramValueControls.jsx';

// The edit card of the visual editor: the settings of what is selected (a
// card with its row, column and cell, or a line), beside it, as a popup of
// the edit layer (doc-edit-popup), so a click in it is not a click outside
// the editor. The tabs come from the selection (DiagramEditCardModel.js); a
// tab without a subject is greyed out. The card is drawn with the host's
// PropEditor (componentConfig.PropEditor) when the host injects it, and as a
// plain form otherwise. It follows its anchor while the canvas pans or zooms.
export const DiagramEditCard = observer(function DiagramEditCard({ editor, anchor, onKeyDown }) {
	const { componentConfig } = useDocStores();
	const { store } = editor;
	const panelRef = useRef(null);
	const [position, positionSet] = useState(null);
	useEffect(() => {
		let frame;
		const update = () => {
			const target = anchor.current;
			const rect = typeof target === 'function' ? target()?.getBoundingClientRect?.() ?? target() : target?.getRect ? target.getRect() : target?.isConnected ? target.getBoundingClientRect() : null;
			const panel = panelRef.current;
			if (rect && panel) {
				const width = panel.offsetWidth;
				const height = panel.offsetHeight;
				const isRight = rect.right + width + 16 <= innerWidth;
				const isLeft = rect.left >= width + 16;
				const left = isRight ? rect.right + 8 : isLeft ? rect.left - width - 8 : rect.left;
				const top = isRight || isLeft ? rect.top : rect.bottom + height + 16 <= innerHeight ? rect.bottom + 8 : rect.top - height - 8;
				const next = {
					left: Math.max(8, Math.min(innerWidth - width - 8, left)),
					top: Math.max(8, Math.min(innerHeight - height - 8, top)),
				};
				positionSet(previous => previous?.left === next.left && previous?.top === next.top ? previous : next);
			}
			frame = requestAnimationFrame(update);
		};
		update();
		return () => cancelAnimationFrame(frame);
	}, [anchor]);
	const model = cardModelBuild(editor);
	if (!model) return null;
	const tab = model.tabList.find(item => item.id === model.tabId);
	const PropEditor = componentConfig?.PropEditor;
	return createPortal(<section ref={panelRef} className="doc-edit-popup doc-edit-panel doc-vis-card-panel not-prose" style={{ ...position, visibility: position ? 'visible' : 'hidden' }} aria-label="Edit card" onKeyDown={onKeyDown}>
		<div className="doc-edit-panel-row doc-vis-card-head">
			<strong>{model.title}</strong>
			<button type="button" className="doc-button-icon" aria-label="Close" title="Close (Esc)" onClick={editor.clearSelection}><X size={13} /></button>
		</div>
		{PropEditor
			? <PropEditorCard PropEditor={PropEditor} model={model} store={store} editor={editor} />
			: <PlainCard model={model} tab={tab} store={store} editor={editor} />}
		{store.message ? <span role="alert" className="doc-error doc-vis-card-message">{store.message}</span> : null}
	</section>, document.body);
});

// ---------- the host's PropEditor ----------

const propertyPathBuild = (tab, section, property) => `${tab.id}.${section.id}.${property.id}`;

// the PropEditor data of the model: one top tab per tab, a group per
// section, a custom item for the actions of a section
function propEditorDataBuild(model, store) {
	const propertyById = {};
	const levelTopList = model.tabList.map(tab => ({
		id: tab.id, label: tab.label, isDisabled: tab.isDisabled,
		children: tab.sectionList.flatMap(section => {
			const children = [];
			if (section.propertyList.length) {
				children.push({
					id: section.id, type: 'group', label: section.label, isCollapsible: false,
					children: section.propertyList.map(property => {
						const propertyId = propertyPathBuild(tab, section, property);
						propertyById[propertyId] = propertyMetaBuild(propertyId, property, store);
						return { id: property.id, type: 'property', propertyId };
					}),
				});
			}
			if (section.note) children.push({ id: `${section.id}-note`, type: 'custom', compName: 'note', data: { text: section.note } });
			if (section.actionList.length) children.push({ id: `${section.id}-actions`, type: 'custom', compName: 'actions', data: { actionList: section.actionList } });
			return children;
		}),
	}));
	return { levelTopList, levelTopSelectedId: model.tabId, propertyById };
}

function propertyMetaBuild(id, property, store) {
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

function ActionsComp({ data, config }) {
	return <div className="doc-vis-card-actions">
		{data.actionList.map(action => (
			<button key={action.id} type="button" className={`doc-button-dialog${action.kind === 'danger' ? ' is-danger' : ''}`} disabled={config.isReadOnly || action.isDisabled} onClick={() => action.act()}>{action.label}</button>
		))}
	</div>;
}

function NoteComp({ data }) {
	return <p className="doc-note doc-vis-card-note">{data.text}</p>;
}

const cardCompByName = { menu: MenuValueComp, textMultiline: TextMultilineComp, actions: ActionsComp, note: NoteComp };

const PropEditorCard = observer(function PropEditorCard({ PropEditor, model, store, editor }) {
	const data = propEditorDataBuild(model, store);
	const propertyByPath = useMemo(() => {
		const map = new Map();
		for (const tab of model.tabList) for (const section of tab.sectionList) for (const property of section.propertyList) map.set(propertyPathBuild(tab, section, property), property);
		return map;
	}, [model]);
	return <div className="doc-vis-card-body">
		<PropEditor
			data={data}
			config={{ width: '100%', getComp: name => cardCompByName[name] ?? null, isGroupCollapsible: false, isReadOnly: editor.isLocked, keyColWidth: 'min', keyColMinWidth: 72 }}
			onEvent={(type, eventData) => {
				if (type === 'levelTopSelect') {
					const tab = model.tabList.find(item => item.id === eventData.levelId);
					if (tab && !tab.isDisabled) store.cardTabSet(tab.id);
					return { code: 0 };
				}
				if (type === 'propertyChangeAttempt') {
					const property = propertyByPath.get(eventData.propertyPath);
					if (!property) return { code: -1, message: 'Unknown property.' };
					const value = property.kind === 'color' ? colorNormalize(eventData.valueNext) : eventData.valueNext;
					const isChanged = property.set(value);
					return isChanged ? { code: 0 } : { code: -1, message: store.message || 'The change was not applied.' };
				}
				return { code: 0 };
			}}
		/>
	</div>;
});

// ---------- the plain form, without PropEditor ----------

const PlainCard = observer(function PlainCard({ model, tab, store, editor }) {
	return <div className="doc-vis-card-body is-plain">
		<div className="doc-vis-card-tabs" role="tablist">
			{model.tabList.map(item => <button key={item.id} type="button" role="tab" aria-selected={item.id === model.tabId} className="doc-vis-card-tab" disabled={item.isDisabled} onClick={() => store.cardTabSet(item.id)}>{item.label}</button>)}
		</div>
		{tab?.sectionList.map(section => <div key={section.id} className="doc-vis-card-section">
			{section.label ? <div className="doc-vis-card-section-label">{section.label}</div> : null}
			{section.propertyList.map(property => <PlainProperty key={property.id} property={property} isLocked={editor.isLocked || property.isReadOnly === true} />)}
			{section.note ? <p className="doc-note doc-vis-card-note">{section.note}</p> : null}
			{section.actionList.length ? <ActionsComp data={{ actionList: section.actionList }} config={{ isReadOnly: editor.isLocked }} /> : null}
		</div>)}
	</div>;
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
