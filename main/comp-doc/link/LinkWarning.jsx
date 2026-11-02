import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function LinkWarning({ text = '', onDismiss, anchorRef }) {
  const refWarning = useRef(null);
  const [position, setPosition] = useState(null);

  useLayoutEffect(() => {
    if (!text || !anchorRef?.current || !refWarning.current) return undefined;
    const anchor = anchorRef.current;
    const warning = refWarning.current;
    const update = () => {
      const bounds = anchor.getBoundingClientRect();
      const size = warning.getBoundingClientRect();
      const isAbove = bounds.bottom + 8 + size.height > window.innerHeight - 8
        && bounds.top >= size.height + 16;
      const left = Math.max(8, Math.min(bounds.left, window.innerWidth - size.width - 8));
      const top = Math.max(8, Math.min(isAbove ? bounds.top - size.height - 8 : bounds.bottom + 8,
        window.innerHeight - size.height - 8));
      const arrowLeft = Math.max(left + 12, Math.min(bounds.left + bounds.width / 2, left + size.width - 12));
      const arrowTop = isAbove ? top + size.height : top;
      setPosition(previous => previous?.left === left && previous?.top === top
        && previous?.arrowLeft === arrowLeft && previous?.arrowTop === arrowTop && previous?.isAbove === isAbove
        ? previous : { left, top, arrowLeft, arrowTop, isAbove });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(anchor);
    observer.observe(warning);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [text, anchorRef]);

  if (!text) return null;

  return createPortal(
    <>
      <span ref={refWarning} className="doc-link-warning" role="alert"
        style={{ left: position?.left, top: position?.top, visibility: position ? 'visible' : 'hidden' }}
        onMouseDown={event => event.stopPropagation()}>
        <span>{text}</span>
        <button type="button" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      </span>
      {position ? <span className="doc-link-warning-arrow" aria-hidden="true"
        style={{ left: position.arrowLeft, top: position.arrowTop,
          transform: `translate(-50%, -50%) rotate(${position.isAbove ? 225 : 45}deg)` }} /> : null}
    </>, document.body,
  );
}