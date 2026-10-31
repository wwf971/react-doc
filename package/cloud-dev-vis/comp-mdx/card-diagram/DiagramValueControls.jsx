import { useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from '../../../../main/frontend/UICommon.js';
import { useDocStores } from '../../../../main/frontend/src/store/context.js';

// The value controls of the diagram editor, built on the host's injected
// components (componentConfig.EditableValueComp, componentConfig.Menu), so
// the cells of a card and the fields of the edit card look like the rest of
// the page's edit layer.

// the host's contenteditable text control: every keystroke reaches the draft
// (the bubbling input event), so no exit path depends on a blur commit
export function TextValue({ value, label, isLocked, isMultiline = false, isCell = false, isEditing, onChange, onEnd, onCancel }) {
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
	return <span className={`doc-vis-text nodrag nopan${isMultiline ? ' is-multiline' : ''}${isCell ? ' is-cell' : ''}`} onFocus={() => { if (!isLocked) editingSet(true); }} onClick={event => { event.stopPropagation(); if (!isLocked) editingSet(true); }} onContextMenuCapture={event => event.stopPropagation()} onInput={() => onChange(element.current.textContent)}>
		{TextEditor ? <TextEditor data={{ text: value }} config={{ configKey: label, width: '100%', isEditing: isActive, isEditable: !isLocked, isExternalSubmitting: isLocked, isFocusOnEdit: false, isEditIconVisible: false, editElementRef: element, messageConfig: { isVisible: false } }} onEvent={(type, data) => {
			if (type === 'valueCommit') { onChange(data.valueNext); return { code: 0 }; }
			if (type === 'cancel') { if (onCancel) onCancel(); else onChange(data.valuePrevious); }
			if (type === 'editStateChange' && !data.isEditing) { editingSet(false); onEnd?.(); }
		}} /> : <span>{value}</span>}
	</span>;
}

export function CheckValue({ label, isChecked, isLocked, onChange }) {
	return <button type="button" role="checkbox" aria-checked={isChecked} className="doc-vis-check nodrag nopan" disabled={isLocked} onClick={event => { event.stopPropagation(); onChange(!isChecked); }}>
		<span className="doc-vis-checkbox" aria-hidden="true"><Check size={11} strokeWidth={3} /></span>{label}
	</button>;
}

function MenuValue({ label, isSelected }) {
	return <span className="doc-vis-menu-value">{isSelected ? <Check size={12} /> : <span />}{label || '(none)'}</span>;
}

// a long list of values: the common ones first, the whole list once a search
// is typed. the current value is offered even when it is not in the list, so
// an authored custom value stays choosable
function ValuePicker({ value, values, valueLabels = {}, commonList, onChoose, onClose }) {
	const [query, querySet] = useState('');
	const [indexActive, indexSet] = useState(0);
	const [reset, resetSet] = useState(0);
	const isQuery = query.trim() !== '';
	const common = [value, ...(commonList ?? values.slice(0, 8))];
	const results = isQuery ? values.filter(option => (valueLabels[option] ?? option).toLowerCase().includes(query.trim().toLowerCase())) : [...new Set(common)].filter(option => values.includes(option));
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
		<div className="doc-vis-picker-search"><Search size={13} /><TextValue key={reset} label="Search values" value={query} isEditing onChange={change} /></div>
		<div className="doc-vis-picker-caption">{isQuery ? `${results.length} of ${values.length}` : 'Common values · type to search all'}</div>
		<div className="doc-vis-picker-results" role="listbox" aria-label="Values">
			{results.map((option, index) => <button type="button" key={option} role="option" aria-selected={index === indexActive} className="doc-vis-picker-option" onPointerDown={event => event.preventDefault()} onMouseEnter={() => indexSet(index)} onClick={() => onChoose(option)}>
				{option === value ? <Check size={12} /> : <span />}{(valueLabels[option] ?? option) || '(none)'}
			</button>)}
			{!results.length ? <span className="doc-note" role="status">No matches</span> : null}
		</div>
	</div>;
}

// a fixed set of values through the host's Menu; valueLabels names a value
// where its stored form is not what the author should read; isSearchable
// opens the picker above instead of a plain list
export function ValueMenu({ label, value, values, valueLabels = {}, commonList, onChange, onOpen, isLocked, isCell = false, isSearchable = false, className = '' }) {
	const { componentConfig } = useDocStores();
	const Menu = componentConfig?.Menu;
	const buttonRef = useRef(null);
	const [isOpen, openSet] = useState(false);
	const options = [...new Set([value, ...values])];
	const choose = option => { onChange(option); openSet(false); };
	return <>
		<button ref={buttonRef} type="button" className={`${isCell ? 'doc-vis-cell-value doc-vis-value-menu is-cell' : 'doc-button-dialog doc-vis-value-menu'} nodrag nopan ${className}`.trim()} aria-label={label} aria-haspopup="menu" aria-expanded={isOpen} disabled={isLocked || !Menu} onClick={event => { event.stopPropagation(); onOpen?.(); openSet(!isOpen); }}><span>{valueLabels[value] ?? (value || (isCell ? ' ' : 'None'))}</span><ChevronDown size={12} /></button>
		{isOpen && Menu ? <Menu data={{ items: isSearchable ? [{ id: 'values', isContainer: true, comp: ValuePicker, compProps: { value, values: options, valueLabels, commonList, onChoose: choose, onClose: () => openSet(false) } }] : options.map((option, index) => ({ id: String(index), comp: MenuValue, compProps: { label: valueLabels[option] ?? option, isSelected: option === value } })) }} config={{ isOpen: true, className: 'doc-edit-popup doc-vis-menu', isBackdropScrollPassThrough: true, isClickPropagationStopped: true, minWidth: isSearchable ? 260 : 170, anchor: { getRect: () => buttonRef.current?.getBoundingClientRect(), getTargetEl: () => buttonRef.current, offsetY: (buttonRef.current?.offsetHeight ?? 0) + 2 } }} onEvent={(type, data) => {
			if (type === 'itemClick' && !isSearchable) choose(options[Number(data.itemId)]);
			if (type === 'closeRequest') openSet(false);
		}} /> : null}
	</>;
}
