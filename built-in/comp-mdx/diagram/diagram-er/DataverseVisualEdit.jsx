import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { ArrowLeft, ArrowRight, Minus, ChevronDown, Check, X, Lock, LockOpen, Search } from '../../../../main/frontend/UICommon.js';
import { useDocStores } from '../../../../main/frontend/src/store/context.js';
import { compDefinitionNormalize, compIdResolve } from '../../../../main/comp-doc/registry/comp-registry.js';
import { EditActions } from '../../../../main/comp-doc/edit/EditActions.jsx';
import { EditFloatingPanel } from '../../../../main/comp-doc/edit/EditFloatingPanel.jsx';
import { DataverseEditStore, dataverseKeyList, dataverseTypeList } from './DataverseEditStore.js';
import './DataverseVisualEdit.css';

export const DataverseVisualEdit = observer(function DataverseVisualEdit({ data, config, onEvent, kind, renderContent }) {
	const { compById, sourceStore } = useDocStores();
	const [result] = useState(() => {
		try {
			const resolve = (name, placement) => {
				const definition = compDefinitionNormalize(compById[compIdResolve(sourceStore.configDoc, name)]);
				return definition?.placementList?.includes(placement) ? definition.expose?.[placement] : undefined;
			};
			return { store: new DataverseEditStore(data.source || data.raw, kind, resolve) };
		} catch (error) { return { message: error.message }; }
	});
	const anchor = useRef(null);
	const canvas = useRef(null);
	const session = config.edit?.session ?? {};
	const isLocked = session.status === 'submitting';
	const { store } = result;
	// inline data is edited like any block; the data of an asset reference
	// only at its head and while the object is not locked, since a save
	// writes the head (the mode list already refuses other references)
	const asset = config.assetInfo;
	const isFromAsset = Boolean(asset?.isFromAsset);
	const reasonRefused = !isFromAsset ? ''
		: asset.isHead === false ? 'This block reads an older version of its asset; visual editing writes the head version.'
		: asset.isLocked ? 'The asset object is locked.'
		: '';
	const isAllowed = !reasonRefused;
	const report = () => { if (store) void onEvent?.('editDraftChange', store.report); };
	const change = operation => { if (!isLocked) { operation(); report(); } };
	const submit = () => {
		if (!isLocked && store) {
			canvas.current?.viewRemember();
			void onEvent?.('editSubmitRequest', store.report);
		}
	};
	const cancel = () => { if (!isLocked) void onEvent?.('editCancelRequest'); };
	// Escape steps out one level at a time: the cell being typed (restoring
	// it), then the selected row or table. it never ends the session, so a
	// stray key cannot discard the draft; Save, Cancel or a click outside do
	const keyDown = event => {
		if (event.nativeEvent.isComposing) return;
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			event.stopPropagation();
			submit();
		} else if (event.key === 'Escape' && store && (store.cell || store.focus)) {
			event.preventDefault();
			event.stopPropagation();
			if (store.cell) change(() => store.cellCancel());
			else editor?.clearFocus();
		} else if (event.key === 'Escape') {
			event.stopPropagation();
		}
	};
	const editor = store && isAllowed ? {
		store, isLocked, change, canvas,
		focus: (nodeId, rowId, element) => { anchor.current = element; store.focusSet(nodeId, rowId); },
		clearFocus: () => { document.activeElement?.blur(); anchor.current = null; store.focusSet(null); },
	} : undefined;
	return <div className={`doc-vis-edit${editor ? ' is-active' : ''}`} onKeyDown={keyDown} onClick={event => {
		if (event.target === event.currentTarget || event.target.classList.contains('doc-vis-card-static')) editor?.clearFocus();
	}}>
		{result.message || reasonRefused ? <div role="alert" className="doc-edit-message doc-vis-edit-message">{result.message || reasonRefused}</div> : null}
		{store ? renderContent({ data: { ...data, source: store.rawDraft, raw: store.rawDraft }, editor }) : null}
		<EditFloatingPanel label={kind === 'diagram' ? 'Diagram' : 'Table'} head={store ? <>
			<span className={`doc-vis-dirty${store.isDirty ? ' is-dirty' : ''}`} role="status">{store.isDirty ? 'Unsaved changes' : 'No changes'}</span>
			{isFromAsset ? <span className="doc-vis-save-target">
				<span>Save to</span>
				<ValueMenu label="Save to" value={store.saveTarget} values={['asset', 'inline']} valueLabels={saveTargetLabels} isLocked={isLocked || !isAllowed} onChange={value => change(() => store.saveTargetSet(value))} />
			</span> : null}
		</> : null} actions={<EditActions status={session.status} message={session.message} titleCancel="Cancel" isSubmitDisabled={!store || !isAllowed} onSubmit={submit} onCancel={cancel} />} />
		{editor && store.focus ? <FocusPanel editor={editor} anchor={anchor} onKeyDown={keyDown} /> : null}
	</div>;
});

const saveTargetLabels = { asset: 'Asset object', inline: 'Inline YAML' };

// the settings of the selected row or table, beside it: a popup of the edit
// layer (doc-edit-popup), so a click in it is not a click outside the editor
const FocusPanel = observer(function FocusPanel({ editor, anchor, onKeyDown }) {
	const { store, change, isLocked } = editor;
	const panelRef = useRef(null);
	const [position, positionSet] = useState(null);
	useEffect(() => {
		let frame;
		const update = () => {
			const element = anchor.current;
			const panel = panelRef.current;
			if (element?.isConnected && panel) {
				const rect = element.getBoundingClientRect();
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
	const node = store.nodeFocused;
	const row = store.rowFocused;
	if (!node) return null;
	const item = row ?? node.data;
	const field = (name, label, isMultiline = false) => (
		<label className="doc-vis-field">
			<span className="doc-vis-field-label">{label}</span>
			<TextValue key={`${node.id}:${row?.id ?? ''}:${name}`} label={label} value={item[name] ?? ''} isLocked={isLocked} isMultiline={isMultiline} onChange={value => change(() => store.fieldSet(node.id, row?.id, name, value))} />
		</label>
	);
	const isPositionRemembered = Boolean(node.position && node.position !== 'auto');
	const handleMode = row ? store.handleModeGet(node.id, row.id) : 'none';
	return createPortal(<section ref={panelRef} className="doc-edit-popup doc-edit-panel doc-vis-focus-panel not-prose" style={{ ...position, visibility: position ? 'visible' : 'hidden' }} aria-label={row ? 'Row settings' : 'Table settings'} onKeyDown={onKeyDown}>
		<div className="doc-edit-panel-row doc-vis-focus-head">
			<span className="doc-edit-panel-label">{row ? 'Row' : 'Table'}</span>
			<strong>{item.name || row?.id || node.id}</strong>
			<button type="button" className="doc-button-icon" aria-label="Close settings" title="Close settings (Esc)" onClick={editor.clearFocus}><X size={13} /></button>
		</div>
		<div className="doc-edit-panel-body">
			{field('name', 'Name')}
			{field('nameLogical', 'Logical name')}
			{row ? <>
				<div className="doc-vis-field">
					<span className="doc-vis-field-label">Key</span>
					<span className="doc-vis-choice-group" role="group" aria-label="Key">
						{dataverseKeyList.map(key => <button key={key || 'none'} type="button" className="doc-button-dialog" aria-pressed={(row.key ?? '') === key} disabled={isLocked} onClick={() => change(() => store.fieldSet(node.id, row.id, 'key', key))}>{key || 'None'}</button>)}
					</span>
				</div>
				<div className="doc-vis-field">
					<span className="doc-vis-field-label">Type</span>
					<ValueMenu label="Type" value={row.type ?? ''} values={dataverseTypeList} isLocked={isLocked} onChange={value => change(() => store.fieldSet(node.id, row.id, 'type', value))} />
				</div>
				<div className="doc-vis-field">
					<span className="doc-vis-field-label">Required</span>
					<CheckValue label="Required" isChecked={Boolean(row.isRequired)} isLocked={isLocked} onChange={isChecked => change(() => store.fieldSet(node.id, row.id, 'isRequired', isChecked))} />
				</div>
				{node.renderer.type !== 'dataverse-choice' ? <div className="doc-vis-field">
					<span className="doc-vis-field-label">Handles</span>
					<span className="doc-vis-choice-group" role="group" aria-label="Row handles">
						{handleModeList.map(([mode, Icon, label]) => <button key={mode} type="button" className="doc-button-dialog doc-vis-handle-option" title={label} aria-label={label} aria-pressed={handleMode === mode} disabled={isLocked} onClick={() => change(() => store.handleModeSet(node.id, row.id, mode))}><Icon size={13} /></button>)}
					</span>
				</div> : null}
			</> : null}
			{!row && store.kind === 'diagram' ? <div className="doc-vis-field">
				<span className="doc-vis-field-label">Position</span>
				<span className="doc-vis-position-options">
					<CheckValue label="Use current position" isChecked={isPositionRemembered} isLocked={isLocked || node.isPositionLocked} onChange={isChecked => change(() => store.positionRememberSet(node.id, isChecked, editor.canvas.current?.positionGet(node.id)))} />
					<button type="button" className="doc-button-dialog doc-vis-handle-option" aria-label={node.isPositionLocked ? 'Unlock position' : 'Lock position'} title={node.isPositionLocked ? 'Unlock position' : 'Lock position'} aria-pressed={Boolean(node.isPositionLocked)} disabled={isLocked} onClick={() => change(() => store.positionLockSet(node.id, !node.isPositionLocked, editor.canvas.current?.positionGet(node.id)))}>{node.isPositionLocked ? <Lock size={13} /> : <LockOpen size={13} />}</button>
				</span>
			</div> : null}
			{field('description', 'Description', true)}
			{store.message ? <span role="alert" className="doc-error">{store.message}</span> : null}
		</div>
	</section>, document.body);
});

const handleModeList = [
	['none', Minus, 'No handles'],
	['left', ArrowLeft, 'Left handle'],
	['right', ArrowRight, 'Right handle'],
	['both', HandlesBoth, 'Both handles'],
];

function CheckValue({ label, isChecked, isLocked, onChange }) {
	return <button type="button" role="checkbox" aria-checked={isChecked} className="doc-vis-check" disabled={isLocked} onClick={() => onChange(!isChecked)}>
		<span className="doc-vis-checkbox" aria-hidden="true"><Check size={11} strokeWidth={3} /></span>{label}
	</button>;
}

// one value of a card: text to read, or in the editor a control that edits
// it in place. Key and Type pick from a fixed set (the host's Menu), the
// others are typed. the cell keeps the height of the read view, so the card
// does not move when a cell starts or ends editing
export const DataverseCell = observer(function DataverseCell({ editor, nodeId, rowId = null, field, value, children, className = '' }) {
	const root = useRef(null);
	if (!editor) return <span className={className}>{children ?? value}</span>;
	const { store, change, isLocked, focus } = editor;
	const cell = store.cell;
	const isEditing = cell?.nodeId === nodeId && cell?.rowId === rowId && cell?.field === field;
	const start = () => {
		focus(nodeId, rowId, root.current.closest('.doc-er-table-column') ?? root.current.closest('.doc-er-table'));
		store.cellStart(nodeId, rowId, field);
	};
	const options = field === 'key' ? dataverseKeyList : field === 'type' ? dataverseTypeList : null;
	return <span ref={root} className={`${className} doc-vis-cell${isEditing ? ' is-editing' : ''}`}>
		{options ? <ValueMenu label={`Edit ${field}`} value={value ?? ''} values={options} isCell isLocked={isLocked} onOpen={start} onChange={next => { change(() => store.fieldSet(nodeId, rowId, field, next)); store.cellEnd(); }} /> : isEditing ? <TextValue
			label={`Edit ${field}`} value={value ?? ''} isLocked={isLocked} isEditing isCell
			onChange={next => change(() => store.fieldSet(nodeId, rowId, field, next))}
			onEnd={() => { if (store.cell?.nodeId === nodeId && store.cell?.rowId === rowId && store.cell?.field === field) store.cellEnd(); }}
			onCancel={() => change(() => store.cellCancel())}
		/> : <button type="button" className="doc-vis-cell-value nodrag" aria-label={`Edit ${field}`} disabled={isLocked} onClick={event => { event.stopPropagation(); start(); }}>{children ?? value ?? ' '}</button>}
	</span>;
});

// the host's contenteditable text control (componentConfig.EditableValueComp):
// every keystroke reaches the draft (the bubbling input event), so no exit
// path depends on a blur commit
function TextValue({ value, label, isLocked, isMultiline = false, isCell = false, isEditing, onChange, onEnd, onCancel }) {
	const { componentConfig } = useDocStores();
	const TextEditor = componentConfig?.EditableValueComp;
	const element = useRef(null);
	const [isEditingLocal, editingSet] = useState(false);
	const isActive = isEditing ?? isEditingLocal;
	useLayoutEffect(() => {
		if (!element.current) return;
		element.current.setAttribute('role', 'textbox');
		element.current.setAttribute('aria-label', label);
		element.current.setAttribute('aria-readonly', String(!isActive || isLocked));
		element.current.tabIndex = isLocked ? -1 : 0;
		if (isActive && !isLocked) {
			element.current.focus({ preventScroll: true });
			const range = document.createRange();
			range.selectNodeContents(element.current);
			const selection = window.getSelection();
			selection.removeAllRanges();
			selection.addRange(range);
		}
	}, [isActive, isLocked, label]);
	return <span className={`doc-vis-text nodrag${isMultiline ? ' is-multiline' : ''}${isCell ? ' is-cell' : ''}`} onFocus={() => { if (!isLocked) editingSet(true); }} onClick={event => { event.stopPropagation(); if (!isLocked) editingSet(true); }} onContextMenuCapture={event => event.stopPropagation()} onInput={() => onChange(element.current.textContent)}>
		{TextEditor ? <TextEditor data={{ text: value }} config={{ configKey: label, width: '100%', isEditing: isActive, isEditable: !isLocked, isExternalSubmitting: isLocked, isFocusOnEdit: false, isEditIconVisible: false, editElementRef: element, messageConfig: { isVisible: false } }} onEvent={(type, data) => {
			if (type === 'valueCommit') { onChange(data.valueNext); return { code: 0 }; }
			if (type === 'cancel') { if (onCancel) onCancel(); else onChange(data.valuePrevious); }
			if (type === 'editStateChange' && !data.isEditing) { editingSet(false); onEnd?.(); }
		}} /> : <span>{value}</span>}
	</span>;
}

function HandlesBoth() {
	return <span className="doc-vis-handles-both"><ArrowLeft size={11} /><ArrowRight size={11} /></span>;
}

function MenuValue({ label, isSelected }) {
	return <span className="doc-vis-menu-value">{isSelected ? <Check size={12} /> : <span />}{label || '(none)'}</span>;
}

// the Dataverse column types: the common ones first, the whole list once a
// search is typed. the current value is offered even when it is not a known
// type, so an authored custom type stays choosable
function ValuePicker({ value, values, onChoose, onClose }) {
	const [query, querySet] = useState('');
	const [indexActive, indexSet] = useState(0);
	const [reset, resetSet] = useState(0);
	const isQuery = query.trim() !== '';
	const common = [value, 'Text', 'Whole Number', 'Decimal Number', 'Date and Time', 'Choice', 'Lookup', 'Boolean', 'Unique identifier'];
	const results = isQuery ? values.filter(option => option.toLowerCase().includes(query.trim().toLowerCase())) : [...new Set(common)].filter(option => values.includes(option));
	const change = text => { querySet(text); indexSet(0); };
	return <div className="doc-vis-picker not-prose" onKeyDownCapture={event => {
		if (event.nativeEvent.isComposing) return;
		if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) {
			event.preventDefault();
			event.stopPropagation();
			if (event.key === 'Escape') {
				if (isQuery) { change(''); resetSet(reset + 1); } else onClose();
			} else if (event.key === 'Enter') { if (results[indexActive] !== undefined) onChoose(results[indexActive]); }
			else if (results.length) indexSet((indexActive + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
		}
	}}>
		<div className="doc-vis-picker-search"><Search size={13} /><TextValue key={reset} label="Search types" value={query} isEditing onChange={change} /></div>
		<div className="doc-vis-picker-caption">{isQuery ? `${results.length} of ${values.length} types` : 'Common types · type to search all'}</div>
		<div className="doc-vis-picker-results" role="listbox" aria-label="Types">
			{results.map((option, index) => <button type="button" key={option} role="option" aria-selected={index === indexActive} className="doc-vis-picker-option" onPointerDown={event => event.preventDefault()} onMouseEnter={() => indexSet(index)} onClick={() => onChoose(option)}>
				{option === value ? <Check size={12} /> : <span />}{option || '(none)'}
			</button>)}
			{!results.length ? <span className="doc-note" role="status">No matches</span> : null}
		</div>
	</div>;
}

// a fixed set of values through the host's Menu; valueLabels names a value
// where its stored form is not what the author should read
function ValueMenu({ label, value, values, valueLabels = {}, onChange, onOpen, isLocked, isCell = false }) {
	const { componentConfig } = useDocStores();
	const Menu = componentConfig?.Menu;
	const buttonRef = useRef(null);
	const [isOpen, openSet] = useState(false);
	const options = [...new Set([value, ...values])];
	const isSearchable = values === dataverseTypeList;
	const choose = option => { onChange(option); openSet(false); };
	return <>
		<button ref={buttonRef} type="button" className={isCell ? 'doc-vis-cell-value doc-vis-value-menu is-cell nodrag' : 'doc-button-dialog doc-vis-value-menu nodrag'} aria-label={label} aria-haspopup="menu" aria-expanded={isOpen} disabled={isLocked || !Menu} onClick={event => { event.stopPropagation(); onOpen?.(); openSet(!isOpen); }}><span>{valueLabels[value] ?? (value || (isCell ? '\u00a0' : 'None'))}</span><ChevronDown size={12} /></button>
		{isOpen && Menu ? <Menu data={{ items: isSearchable ? [{ id: 'types', isContainer: true, comp: ValuePicker, compProps: { value, values: options, onChoose: choose, onClose: () => openSet(false) } }] : options.map((option, index) => ({ id: String(index), comp: MenuValue, compProps: { label: valueLabels[option] ?? option, isSelected: option === value } })) }} config={{ isOpen: true, className: 'doc-edit-popup doc-vis-menu', isBackdropScrollPassThrough: true, isClickPropagationStopped: true, minWidth: isSearchable ? 260 : 170, anchor: { getRect: () => buttonRef.current?.getBoundingClientRect(), getTargetEl: () => buttonRef.current, offsetY: (buttonRef.current?.offsetHeight ?? 0) + 2 } }} onEvent={(type, data) => {
			if (type === 'itemClick' && !isSearchable) choose(options[Number(data.itemId)]);
			if (type === 'closeRequest') openSet(false);
		}} /> : null}
	</>;
}