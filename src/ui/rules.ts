// Reglas de automatización eLogic en JavaScript: Param(), eProp(), Suppress(), Msg(), Mass()…
import { useStore } from '../core/store';
import { docParams, MATERIALS, type PartDoc } from '../core/doc';
import { makeEval } from '../core/expr';
import type { Rule } from '../core/pmi';

let running = false;
export function ruleApi(log: (s: string) => void) {
  const S = () => useStore.getState();
  const ev = () => makeEval(docParams(S().doc));
  return {
    /** Param('ancho') lee el valor; Param('ancho', 120) o Param('ancho', '2*b') lo cambia */
    Param(name: string, value?: number | string) {
      if (value === undefined) return ev()(name);
      S().commit((d) => { const p = d.parameters.find((x) => x.name === name); if (p) p.expr = String(value); else d.parameters.push({ name, expr: String(value), comment: 'regla' }); });
      return value;
    },
    /** eProp('partNumber') / eProp('description', 'Soporte') (iProp sigue valiendo) */
    eProp(field: string, value?: string) { return this.iProp(field, value); },
    iProp(field: string, value?: string) {
      const ip = S().doc.iProperties as unknown as Record<string, string>;
      if (value === undefined) return ip[field];
      S().commit((d) => { (d.iProperties as unknown as Record<string, string>)[field] = value; });
      return value;
    },
    /** Suppress('Empalme1', true) */
    Suppress(name: string, on = true) { S().commit((d) => { const f = d.features.find((x) => x.name === name); if (f) f.suppressed = on || undefined; }); },
    Features() { return S().doc.features.map((f) => f.name); },
    Material(name?: string) { if (name === undefined) return S().doc.iProperties.material; S().commit((d) => { d.iProperties.material = name; }); return name; },
    Mass() { const v = S().result?.props?.volume ?? 0; const rho = MATERIALS.find((m) => m.name === S().doc.iProperties.material)?.density ?? 7850; return v * 1e-9 * rho; },
    Volume() { return S().result?.props?.volume ?? 0; },
    Msg(text: unknown) { S().notify(String(text)); log(String(text)); },
    Log(text: unknown) { log(String(text)); },
    Math,
  };
}
export function runRule(r: Rule, log: (s: string) => void = () => {}): string | null {
  if (r.off) return null;
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('API', `with (API) {\n${r.code}\n}`);
    fn(ruleApi(log));
    return null;
  } catch (e) { const m = `${r.name}: ${(e as Error).message}`; useStore.getState().notify(`Regla ${m}`, 'error'); return m; }
}
/** Ejecuta las reglas del documento activo asociadas a un evento */
export function fireRules(ev: Rule['on'][number]) {
  if (running) return;
  const s = useStore.getState(); if (s.kind !== 'part') return;
  const rules = ((s.doc as PartDoc).rules ?? []).filter((r) => !r.off && r.on.includes(ev));
  if (!rules.length) return;
  running = true;
  try { for (const r of rules) runRule(r); } finally { running = false; }
}
// cambios de parámetros → reglas «al cambiar parámetros»
let lastParams = '';
useStore.subscribe((s, p) => {
  if (s.kind !== 'part' || s.doc === p.doc || running) return;
  const k = JSON.stringify(s.doc.parameters);
  if (s.active !== p.active) { lastParams = k; return; }
  if (k !== lastParams) { lastParams = k; if (p.doc && JSON.stringify(p.doc.parameters) !== k) fireRules('param'); }
});
