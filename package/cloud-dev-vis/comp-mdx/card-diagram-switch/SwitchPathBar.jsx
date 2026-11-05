import { useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { ArrowLeft, ChevronRight, Scan, SquareDashedMousePointer } from '../../../../main/frontend/UICommon.js';
import { AnchoredPopover } from '../../../../main/comp-doc/popup/AnchoredPopover.jsx';

// The bar over a switching viewport (card-diagram-flexible-switch.md#the-path-bar):
// the path of the view shown, aligned to the left, one button per segment. A click on
// a segment switches to it; the chevron before a segment lists the views beside it.
// At the right, what acts on the view shown: the camera back to its default, the box.
const SwitchPathSibling = observer(function SwitchPathSibling({ store, path }) {
	const ref = useRef(null);
	const [isOpen, isOpenSet] = useState(false);
	const siblingList = store.siblingListGet(path);
	if (siblingList.length <= 1) return <ChevronRight size={13} className="doc-switch-path-gap" aria-hidden="true" />;
	return (
		<>
			<button ref={ref} type="button" className="doc-switch-path-chevron" title="The views beside this one" aria-label="List the views beside this one" aria-expanded={isOpen} onClick={() => isOpenSet(!isOpen)} onBlur={(event) => {
				if (!event.relatedTarget?.closest?.('.doc-switch-path-menu')) isOpenSet(false);
			}}>
				<ChevronRight size={13} aria-hidden="true" />
			</button>
			{isOpen ? (
				<AnchoredPopover anchorRef={ref} className="doc-switch-path-menu">
					{siblingList.map((item) => (
						<button key={item.path} type="button" data-current={item.path === path ? '' : undefined} onClick={() => { isOpenSet(false); void store.pathSet(item.path); }}>
							<span>{item.label}</span>
							{item.description ? <em>{item.description}</em> : null}
						</button>
					))}
				</AnchoredPopover>
			) : null}
		</>
	);
});

export const SwitchPathBar = observer(function SwitchPathBar({ store, trailing }) {
	const chain = store.pathChain;
	const childList = store.provider.childListGet(store.pathCurrent);
	return (
		<div className="doc-switch-bar not-prose">
			<button type="button" className="doc-switch-bar-button" title="Back to the previous view" aria-label="Back to the previous view" disabled={store.historyList.length === 0} onClick={store.back}>
				<ArrowLeft size={13} aria-hidden="true" />
			</button>
			<nav className="doc-switch-path" aria-label="Path of the view">
				{chain.map((path, index) => (
					<span key={path} className="doc-switch-path-item">
						{index > 0 ? <SwitchPathSibling store={store} path={path} /> : null}
						<button type="button" className="doc-switch-path-segment" aria-current={path === store.pathCurrent ? 'page' : undefined} title={path} onClick={() => void store.pathSet(path)}>
							{store.labelGet(path)}
						</button>
					</span>
				))}
				{childList.length > 0 ? <SwitchPathChildren store={store} childList={childList} /> : null}
			</nav>
			<span className="doc-switch-bar-trailing">
				{trailing}
				<button type="button" className="doc-switch-bar-button" title="Back to the default range of this view" aria-label="Fit the view" onClick={() => void store.cameraReset()}>
					<Scan size={13} aria-hidden="true" />
				</button>
				<button type="button" className="doc-switch-bar-button" title="Adjust the bounding box of this view (the red frame): the range shown by default and when embedded" aria-label="Adjust the bounding box" aria-pressed={store.isBoxAdjust} onClick={store.boxAdjustToggle}>
					<SquareDashedMousePointer size={13} aria-hidden="true" />
				</button>
			</span>
		</div>
	);
});

// the way further down from the view shown: its children, in the same menu
const SwitchPathChildren = observer(function SwitchPathChildren({ store, childList }) {
	const ref = useRef(null);
	const [isOpen, isOpenSet] = useState(false);
	return (
		<span className="doc-switch-path-item">
			<button ref={ref} type="button" className="doc-switch-path-chevron is-more" title="The views below this one" aria-label="List the views below this one" aria-expanded={isOpen} onClick={() => isOpenSet(!isOpen)} onBlur={(event) => {
				if (!event.relatedTarget?.closest?.('.doc-switch-path-menu')) isOpenSet(false);
			}}>
				<ChevronRight size={13} aria-hidden="true" />
				<span>{childList.length}</span>
			</button>
			{isOpen ? (
				<AnchoredPopover anchorRef={ref} className="doc-switch-path-menu">
					{childList.map((item) => (
						<button key={item.path} type="button" onClick={() => { isOpenSet(false); void store.pathSet(item.path); }}>
							<span>{item.label}</span>
							{item.description ? <em>{item.description}</em> : null}
						</button>
					))}
				</AnchoredPopover>
			) : null}
		</span>
	);
});
