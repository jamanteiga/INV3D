// Cuadros de diálogo flotantes: se arrastran por su barra de título (.modal-head) y no bloquean el visor 3D.
// La posición se recuerda por título durante la sesión.
const pos = new Map<string, [number, number]>();
const keyOf = (el: HTMLElement) => el.getAttribute('aria-label') ?? el.className;
const SEL = '.modal, .fem-panel, [role=dialog]';
const apply = (el: HTMLElement, x: number, y: number) => { el.style.translate = `${x}px ${y}px`; el.dataset.dx = String(x); el.dataset.dy = String(y); };
/** Recoloca un diálogo recién abierto donde se dejó la última vez */
export function restoreDlg(el: HTMLElement | null) {
  if (!el || el.classList.contains('confirm')) return;
  const p = pos.get(keyOf(el)); if (p) { apply(el, p[0], p[1]); clamp(el); }
}
function clamp(el: HTMLElement) {
  const r = el.getBoundingClientRect(); let x = Number(el.dataset.dx ?? 0), y = Number(el.dataset.dy ?? 0);
  if (r.top < 0) y -= r.top; if (r.top > innerHeight - 40) y -= r.top - (innerHeight - 40);
  if (r.width <= innerWidth) { if (r.left < 0) x -= r.left; else if (r.right > innerWidth) x -= r.right - innerWidth; }
  else { if (r.right < 80) x += 80 - r.right; if (r.left > innerWidth - 80) x -= r.left - (innerWidth - 80); }
  apply(el, x, y);
}
let installed = false;
export function installDlgDrag() {
  if (installed) return; installed = true;
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    const head = t.closest('.modal-head') as HTMLElement | null; if (!head || t.closest('button, input, select, textarea, a')) return;
    const el = head.closest(SEL) as HTMLElement | null; if (!el || el.classList.contains('confirm')) return;
    e.preventDefault();
    const x0 = Number(el.dataset.dx ?? 0), y0 = Number(el.dataset.dy ?? 0), sx = e.clientX, sy = e.clientY;
    document.body.classList.add('dlg-dragging');
    const mv = (ev: PointerEvent) => apply(el, x0 + ev.clientX - sx, y0 + ev.clientY - sy);
    const up = () => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); document.body.classList.remove('dlg-dragging');
      clamp(el); pos.set(keyOf(el), [Number(el.dataset.dx), Number(el.dataset.dy)]);
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  }, true);
  // doble clic en el título: vuelve a su sitio
  document.addEventListener('dblclick', (e) => {
    const t = e.target as HTMLElement; const head = t.closest('.modal-head'); if (!head || t.closest('button')) return;
    const el = head.closest(SEL) as HTMLElement | null; if (!el) return;
    apply(el, 0, 0); pos.delete(keyOf(el));
  }, true);
}
