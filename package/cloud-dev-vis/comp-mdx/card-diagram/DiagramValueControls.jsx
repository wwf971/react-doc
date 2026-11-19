import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from '../../../../main/frontend/UICommon.js';
import { useDocStores } from '../../../../main/frontend/src/store/context.js';

// The value controls of the diagram editor, built on the host's injected
// components (componentConfig.EditableValueComp, componentConfig.Menu), so
// the cells of a card and the fields of the edit card look like the rest of
// the page's edit layer.

// the host's contenteditable text control: every keystroke reaches the draft
// (the bubbling input event), so no exit path depends on a blur commit
export function TextValue({ value, label, isLocked, isMultiline = false, isCell = false, isEditing, placeholder, onChange, onEnd, onCancel }) {
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
		if (!isActive || isLocked) return undefined;
		// the focus, with every word chosen. a control drawn before its canvas shows it (a node not
		// measured yet is hidden, and what is hidden takes no focus) is tried again until it takes it
		let frame;
		let tryCount = 0;
		const focusTake = () => {
			const target = element.current;
			if (!target) return;
			target.focus({ preventScroll: true });
			if (document.activeElement !== target) {
				if ((tryCount += 1) < 40) frame = requestAnimationFrame(focusTake);
				return;
			}
			const range = document.createRange();
			range.selectNodeContents(target);
			const selection = window.getSelection();
			selection.removeAllRanges();
			selection.addRange(range);
		};
		focusTake();
		return () => cancelAnimationFrame(frame);
	}, [isActive, isLocked, label]);
	return <span className={`doc-vis-text nodrag nopan${isMultiline ? ' is-multiline' : ''}${isCell ? ' is-cell' : ''}`} onFocus={() => { if (!isLocked) editingSet(true); }} onClick={event => { event.stopPropagation(); if (!isLocked) editingSet(true); }} onContextMenuCapture={event => event.stopPropagation()} onInput={() => onChange(element.current.textContent)}>
		{TextEditor ? <TextEditor data={{ text: value }} config={{ configKey: label, width: '100%', isEditing: isActive, isEditable: !isLocked, isExternalSubmitting: isLocked, isFocusOnEdit: false, isEditIconVisible: false, editElementRef: element, messageConfig: { isVisible: false } }} onEvent={(type, data) => {
			if (type === 'valueCommit') { onChange(data.valueNext); return { code: 0 }; }
			if (type === 'cancel') { if (onCancel) onCancel(); else onChange(data.valuePrevious); }
			if (type === 'editStateChange' && !data.isEditing) { editingSet(false); onEnd?.(); }
		}} /> : <TextPlain value={value} isActive={isActive} isLocked={isLocked} isMultiline={isMultiline} placeholder={placeholder} elementRef={element} onChange={onChange} onCancel={onCancel} onEnd={() => { editingSet(false); onEnd?.(); }} />}
	</span>;
}

// the text control where the host injects none (the diagrams drawn outside a doc page, in an
// app): a plain contenteditable to the same contract. every keystroke reaches the draft (the
// input event, taken by the span around it), Enter ends a text of one line, Escape puts back
// what it was when the typing started, and leaving it ends the typing
function TextPlain({ value, isActive, isLocked, isMultiline, placeholder, elementRef, onChange, onCancel, onEnd }) {
	const valueAtStart = useRef(value);
	// the words are written by hand, never while they are typed: a render would move the caret
	useLayoutEffect(() => {
		const element = elementRef.current;
		if (element && element.textContent !== String(value ?? '') && document.activeElement !== element) element.textContent = String(value ?? '');
	}, [value, elementRef]);
	useLayoutEffect(() => { if (isActive) valueAtStart.current = value; }, [isActive]); // eslint-disable-line react-hooks/exhaustive-deps
	return <span ref={elementRef} className={`doc-vis-text-plain${isActive && !isLocked ? ' is-editing' : ''}`} data-placeholder={placeholder || undefined} contentEditable={isLocked ? false : 'plaintext-only'} suppressContentEditableWarning spellCheck={false}
		onKeyDown={event => {
			if (event.nativeEvent.isComposing) return;
			if (event.key === 'Enter' && !(isMultiline && !event.ctrlKey && !event.metaKey)) {
				if (event.ctrlKey || event.metaKey) return;
				event.preventDefault();
				event.stopPropagation();
				event.currentTarget.blur();
			} else if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				event.currentTarget.textContent = String(valueAtStart.current ?? '');
				if (onCancel) onCancel(); else onChange(valueAtStart.current ?? '');
				event.currentTarget.blur();
			}
		}}
		onBlur={() => onEnd()} />;
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
// a button opening a list of things to do, each with what it does as its title: actionList
// [{ id, label, title, isDisabled }]
export function ActionMenu({ label, children, actionList, onAction, isLocked }) {
	const { componentConfig } = useDocStores();
	const Menu = componentConfig?.Menu;
	const buttonRef = useRef(null);
	const [isOpen, openSet] = useState(false);
	return <>
		<button ref={buttonRef} type="button" className="doc-button-icon nodrag nopan" title={label} aria-label={label} aria-haspopup="menu" aria-expanded={isOpen} disabled={isLocked || !Menu} onClick={event => { event.stopPropagation(); openSet(!isOpen); }}>{children}</button>
		{isOpen && Menu ? <Menu data={{ items: actionList.map(action => ({ id: action.id, comp: ActionMenuItem, compProps: action })) }} config={{ isOpen: true, className: 'doc-edit-popup doc-vis-menu', isBackdropScrollPassThrough: true, isClickPropagationStopped: true, minWidth: 260, anchor: { getRect: () => buttonRef.current?.getBoundingClientRect(), getTargetEl: () => buttonRef.current, offsetY: (buttonRef.current?.offsetHeight ?? 0) + 2 } }} onEvent={(type, data) => {
			if (type === 'itemClick' && !actionList.find(action => action.id === data.itemId)?.isDisabled) { onAction(data.itemId); openSet(false); }
			if (type === 'closeRequest') openSet(false);
		}} /> : null}
	</>;
}

function ActionMenuItem({ label, title, isDisabled }) {
	return <span className={`doc-vis-menu-action${isDisabled ? ' is-disabled' : ''}`} title={title}><strong>{label}</strong><small>{title}</small></span>;
}

// isOpenWanted(): asked once the control is drawn: true opens the menu without a click (an
// editor opened on this value)
export function ValueMenu({ label, value, values, valueLabels = {}, commonList, onChange, onOpen, isOpenWanted, isLocked, isCell = false, isSearchable = false, className = '' }) {
	const { componentConfig } = useDocStores();
	const Menu = componentConfig?.Menu;
	const buttonRef = useRef(null);
	const [isOpen, openSet] = useState(false);
	useEffect(() => {
		if (isLocked || !isOpenWanted?.()) return undefined;
		// once the canvas around it stands at its camera: the menu is placed from where the button is
		let frameInner;
		const frame = requestAnimationFrame(() => { frameInner = requestAnimationFrame(() => { onOpen?.(); openSet(true); }); });
		return () => { cancelAnimationFrame(frame); cancelAnimationFrame(frameInner); };
	}, []); // eslint-disable-line react-hooks/exhaustive-deps
	const options = [...new Set([value, ...values])];
	const choose = option => { onChange(option); openSet(false); };
	return <>
		<button ref={buttonRef} type="button" className={`${isCell ? 'doc-vis-cell-value doc-vis-value-menu is-cell' : 'doc-button-dialog doc-vis-value-menu'} nodrag nopan ${className}`.trim()} aria-label={label} aria-haspopup="menu" aria-expanded={isOpen} disabled={isLocked || !Menu} onClick={event => { event.stopPropagation(); onOpen?.(); openSet(!isOpen); }}><span>{isCell && !value ? ' ' : valueLabels[value] ?? (value || 'None')}</span><ChevronDown size={12} /></button>
		{isOpen && Menu ? <Menu data={{ items: isSearchable ? [{ id: 'values', isContainer: true, comp: ValuePicker, compProps: { value, values: options, valueLabels, commonList, onChoose: choose, onClose: () => openSet(false) } }] : options.map((option, index) => ({ id: String(index), comp: MenuValue, compProps: { label: valueLabels[option] ?? option, isSelected: option === value } })) }} config={{ isOpen: true, className: 'doc-edit-popup doc-vis-menu', isBackdropScrollPassThrough: true, isClickPropagationStopped: true, minWidth: isSearchable ? 260 : 170, anchor: { getRect: () => buttonRef.current?.getBoundingClientRect(), getTargetEl: () => buttonRef.current, offsetY: (buttonRef.current?.offsetHeight ?? 0) + 2 } }} onEvent={(type, data) => {
			if (type === 'itemClick' && !isSearchable) choose(options[Number(data.itemId)]);
			if (type === 'closeRequest') openSet(false);
		}} /> : null}
	</>;
}
