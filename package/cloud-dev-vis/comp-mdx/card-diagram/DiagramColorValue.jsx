import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { useDocStores } from '../../../../main/frontend/src/store/context.js';
import { colorHexNormalize, colorIsHex } from './DiagramNodeStyle.js';
import { usePopupCornerOffset, windowRectGet } from './DiagramPopupPlace.js';

// A color of the edit card (DiagramEditCardModel.js, property kind color): what a node is filled
// with, the color of a line. One click on a swatch sets it:
//
//   [default] [none] [tones of the palette ...] [custom]
//
// default (the look of the kind) and none are offered where the property says so; the tones are
// its swatchList, drawn as they will look. The last swatch is a color of the author's own: it shows
// that color when one is chosen, a ring of hues otherwise, and opens a picker below the row (the
// host's ColorPicker, componentConfig.ColorPicker with colorPickerStoreCreate; an input of the
// browser where the host injects none). What is picked is written at once, so the thing changes
// while the pointer moves, and the whole picking is one step of the history (a groupKey of its
// own); Escape puts back the color the picker opened on, a click outside keeps what was picked.
export const DiagramColorValue = observer(function DiagramColorValue({ label, value, swatchList = [], isDefaultOffered = false, defaultLabel = 'Default', isNoneOffered = false, isLocked = false, onChange }) {
	const [picker, pickerSet] = useState(null);
	const triggerRef = useRef(null);
	const valueText = String(value ?? '');
	const isOfSwatch = swatch => String(swatch.value).toLowerCase() === valueText.toLowerCase();
	const isCustom = colorIsHex(valueText) && !swatchList.some(isOfSwatch);
	const optionList = [
		...(isDefaultOffered ? [{ value: '', label: defaultLabel, variant: 'default' }] : []),
		...(isNoneOffered ? [{ value: 'none', label: 'None', variant: 'none' }] : []),
		...swatchList,
	];
	return <span className="doc-vis-color nodrag nopan" role="radiogroup" aria-label={label}>
		{optionList.map(option => {
			const isSelected = option.variant === 'default' ? valueText === '' : isOfSwatch(option);
			return <button key={option.value || 'default'} type="button" role="radio" aria-checked={isSelected} aria-label={option.label} title={option.label}
				className={`doc-vis-color-swatch${option.variant ? ` is-${option.variant}` : ''}${isSelected ? ' is-selected' : ''}`}
				style={option.css ? { '--doc-vis-color-swatch': option.css, '--doc-vis-color-swatch-edge': option.edgeCss ?? option.css } : undefined}
				disabled={isLocked} onClick={() => onChange(option.value)} />;
		})}
		<button ref={triggerRef} type="button" role="radio" aria-checked={isCustom} aria-label={isCustom ? `A color of your own: ${valueText}` : 'A color of your own'} title={isCustom ? `${valueText} (pick another)` : 'A color of your own'}
			className={`doc-vis-color-swatch is-custom${isCustom ? ' is-selected is-set' : ''}`} style={isCustom ? { '--doc-vis-color-swatch': valueText } : undefined}
			disabled={isLocked} aria-expanded={Boolean(picker)} onClick={() => pickerSet(previous => (previous ? null : { valueAtOpen: valueText, groupKey: `color:${label}:${Date.now()}` }))} />
		{picker ? <DiagramColorPicker triggerRef={triggerRef} label={label} value={isCustom ? valueText : (swatchList.find(isOfSwatch)?.hex ?? (colorIsHex(valueText) ? valueText : '#2563eb'))}
			onChange={hex => onChange(colorHexNormalize(hex), { groupKey: picker.groupKey })}
			onCancel={() => { onChange(picker.valueAtOpen, { groupKey: picker.groupKey }); pickerSet(null); }}
			onClose={() => pickerSet(null)} /> : null}
	</span>;
});

// the picker of a color of one's own, below the swatch that opened it (a corner on its bottom left)
const DiagramColorPicker = observer(function DiagramColorPicker({ triggerRef, label, value, onChange, onCancel, onClose }) {
	const { componentConfig } = useDocStores();
	const ColorPicker = componentConfig?.ColorPicker;
	const storeCreate = componentConfig?.colorPickerStoreCreate;
	const [pickerStore] = useState(() => (ColorPicker && storeCreate ? storeCreate({ colorInitialValue: value }) : null));
	const popupRef = useRef(null);
	const rect = triggerRef.current?.getBoundingClientRect();
	const offset = usePopupCornerOffset(popupRef, windowRectGet, 'color');
	const frameRef = useRef(0);
	const callbackRef = useRef({ onChange, onCancel, onClose });
	callbackRef.current = { onChange, onCancel, onClose };
	// a click outside keeps what was picked; Escape puts back what the picker opened on
	useEffect(() => {
		const pointerDown = (event) => {
			if (popupRef.current?.contains(event.target) || triggerRef.current?.contains(event.target)) return;
			callbackRef.current.onClose();
		};
		document.addEventListener('pointerdown', pointerDown, true);
		return () => { document.removeEventListener('pointerdown', pointerDown, true); cancelAnimationFrame(frameRef.current); };
	}, [triggerRef]);
	// the color written once a frame while the pointer drags the picker
	const write = (hex) => {
		cancelAnimationFrame(frameRef.current);
		frameRef.current = requestAnimationFrame(() => callbackRef.current.onChange(hex));
	};
	const keyDown = (event) => {
		if (event.key !== 'Escape' && !(event.key === 'Enter' && event.target.tagName !== 'INPUT')) return;
		event.preventDefault();
		event.stopPropagation();
		if (event.key === 'Escape') onCancel();
		else onClose();
	};
	if (!rect) return null;
	return createPortal(<div ref={popupRef} className="doc-edit-popup doc-vis-color-popup not-prose" role="dialog" aria-label={`${label}: a color of your own`}
		style={{ left: rect.left + offset.x, top: rect.bottom + 4 + offset.y }} onKeyDown={keyDown}>
		{pickerStore ? <ColorPicker
			data={{ modeOptions: [{ value: 'hsv', label: 'HSV' }], swatchGrid: pickerStore.swatchGrid }}
			config={{ hue: pickerStore.hue, saturation: pickerStore.saturation, value: pickerStore.value, alpha: pickerStore.alpha, modeCurrent: 'hsv', colorCurrentValue: pickerStore.colorCurrentValue, colorCurrentCss: pickerStore.colorCurrentCss, hueColorHex: pickerStore.hueColorHex, isSwatchGapShown: true, swatchCellShape: 'square' }}
			onEvent={(type, data) => {
				const result = pickerStore.handleEvent(type, data);
				if (['hsvSet', 'colorValueSet', 'swatchSelect'].includes(type)) write(pickerStore.colorCurrentValue);
				return result;
			}} />
			: <input type="color" className="doc-vis-color-native" aria-label={label} defaultValue={String(value).slice(0, 7)} onInput={event => write(event.target.value)} />}
		<div className="doc-vis-color-popup-actions">
			<span className="doc-note">Esc puts back the color it had.</span>
			<button type="button" className="doc-button" onClick={onCancel}>Restore</button>
			<button type="button" className="doc-button" onClick={onClose}>Done</button>
		</div>
	</div>, document.body);
});
