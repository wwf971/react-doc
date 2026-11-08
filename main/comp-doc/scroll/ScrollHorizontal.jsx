import { useEffect, useLayoutEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';

// A row of things that may be wider than its place (the rule: ai-skills
// app-dev/references/frontend-scrollable-horizontal.md). The outer box clips; the inner strip
// is moved by the offset of its store (ScrollHorizontalStore), never by a scrollbar: the wheel
// over the row moves it (and the page does not scroll then), and so does dragging it. A
// click ending a drag is not passed on. What stands in it should say its full text in its
// title, since a part of it may be out of sight.
//
//   const [store] = useState(() => new ScrollHorizontalStore());
//   <ScrollHorizontal store={store} className="my-row">{buttons}</ScrollHorizontal>
//
// className goes on the outer box, innerClassName and innerProps (a role, a label) on the
// strip. The outer box takes no wheel of a canvas around it (React Flow's nowheel).
// isWheelEnabled false leaves the wheel to what is around (a canvas that zooms); a drag
// still moves the strip.
export const ScrollHorizontal = observer(function ScrollHorizontal({ store, isWheelEnabled = true, className = '', innerClassName = '', innerProps = {}, innerRef: innerRefOut, children }) {
	const outerRef = useRef(null);
	const innerRef = useRef(null);
	// the click that ends a drag is not a click on what is under the pointer
	const isDragEndedRef = useRef(false);
	useLayoutEffect(() => {
		const outer = outerRef.current;
		const inner = innerRef.current;
		if (!outer || !inner) return undefined;
		const measure = () => store.sizeSet(outer.clientWidth, inner.offsetWidth);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(outer);
		observer.observe(inner);
		return () => observer.disconnect();
	}, [store]);
	// the wheel is taken in a listener that may cancel it (React's are passive)
	useEffect(() => {
		const outer = outerRef.current;
		if (!outer || !isWheelEnabled) return undefined;
		const wheel = (event) => {
			if (event.ctrlKey || !store.wheel(event.deltaX, event.deltaY)) return;
			event.preventDefault();
			event.stopPropagation();
		};
		outer.addEventListener('wheel', wheel, { passive: false });
		return () => outer.removeEventListener('wheel', wheel);
	}, [store, isWheelEnabled]);
	const innerRefSet = (element) => {
		innerRef.current = element;
		if (typeof innerRefOut === 'function') innerRefOut(element);
		else if (innerRefOut) innerRefOut.current = element;
	};
	return (
		<div
			ref={outerRef}
			className={`doc-scroll-horizontal${isWheelEnabled ? ' nowheel' : ''}${store.isOverflowing ? ' is-overflowing' : ''}${className ? ` ${className}` : ''}`}
			onPointerDown={(event) => {
				isDragEndedRef.current = false;
				if (event.button === 0) store.dragStart(event.clientX);
			}}
			onPointerMove={(event) => {
				store.dragMove(event.clientX);
				// once it is a drag, the pointer stays with the row until it is let go
				if (store.drag?.isMoved && !outerRef.current.hasPointerCapture(event.pointerId)) outerRef.current.setPointerCapture(event.pointerId);
			}}
			onPointerUp={() => { isDragEndedRef.current = store.dragEnd(); }}
			onPointerCancel={() => store.dragEnd()}
			onClickCapture={(event) => {
				if (!isDragEndedRef.current) return;
				isDragEndedRef.current = false;
				event.preventDefault();
				event.stopPropagation();
			}}
		>
			<div ref={innerRefSet} className={`doc-scroll-horizontal-inner${innerClassName ? ` ${innerClassName}` : ''}`} style={{ transform: `translateX(${-store.offset}px)` }} {...innerProps}>
				{children}
			</div>
		</div>
	);
});
