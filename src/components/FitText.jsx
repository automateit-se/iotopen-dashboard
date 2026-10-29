import { useLayoutEffect, useRef, useState } from 'react';
import { Modal } from './Modal.jsx';

/**
 * Text that shrinks until it fits its box (between `max` and `min` px), measured again when the box changes size
 * (another screen, a turned tablet, a new widget height). If it does not fit even at `min`, it is cut with … after
 * the lines that fit (`single`: one line). Only then can it be clicked or tapped to show the whole text, and it
 * carries the whole text as a tooltip for a mouse.
 */
export function FitText({ text, className = '', max = 28, min = 13, single = false, heading = '', detail = '' }) {
  const ref = useRef(null);
  const [cut, setCut] = useState(false);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let frame = 0;
    const fits = () => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1;
    const fit = () => {
      el.classList.remove('fit-cut');
      el.style.webkitLineClamp = '';
      el.style.fontSize = `${max}px`;
      if (fits()) return setCut(false);
      // the largest size that fits, to half a pixel
      let lo = min;
      let hi = max;
      while (hi - lo > 0.5) {
        const mid = (lo + hi) / 2;
        el.style.fontSize = `${mid}px`;
        if (fits()) lo = mid;
        else hi = mid;
      }
      el.style.fontSize = `${lo}px`;
      if (fits()) return setCut(false);
      // still too long at the smallest size: … after the lines that fit
      if (!single) {
        const line = parseFloat(getComputedStyle(el).lineHeight) || lo * 1.15;
        el.style.webkitLineClamp = String(Math.max(1, Math.floor((el.clientHeight + 1) / line)));
      }
      el.classList.add('fit-cut');
      return setCut(true);
    };
    fit();
    // the box changes size with the widget; the text's own size never changes the box (flex-basis, no growth)
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    ro.observe(el.parentElement);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [text, max, min, single]);

  const show = () => cut && setOpen(true);
  return (
    <>
      <div
        ref={ref}
        className={`fit ${single ? 'fit-single' : ''} ${cut ? 'fit-click' : ''} ${className}`}
        title={cut ? text : undefined}
        role={cut ? 'button' : undefined}
        tabIndex={cut ? 0 : undefined}
        aria-label={cut ? `${text} (visa hela texten)` : undefined}
        onClick={show}
        onKeyDown={(e) => cut && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), show())}
      >
        {text}
      </div>
      {open && (
        <Modal title={heading || 'Hela texten'} onClose={() => setOpen(false)}>
          <p className="fit-full">{text}</p>
          {detail && <p className="muted small">{detail}</p>}
        </Modal>
      )}
    </>
  );
}
