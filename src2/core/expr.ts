// Evaluador de expresiones con unidades, al estilo del cuadro de Parámetros (fx) de Inventor.
// Longitudes se normalizan a mm y ángulos a grados.

const UNITS: Record<string, number> = {
  mm: 1, cm: 10, m: 1000, um: 0.001, in: 25.4, ft: 304.8,
  deg: 1, '°': 1, rad: 180 / Math.PI, ul: 1,
};

const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: (d) => Math.sin((d * Math.PI) / 180),
  cos: (d) => Math.cos((d * Math.PI) / 180),
  tan: (d) => Math.tan((d * Math.PI) / 180),
  asin: (x) => (Math.asin(x) * 180) / Math.PI,
  acos: (x) => (Math.acos(x) * 180) / Math.PI,
  atan: (x) => (Math.atan(x) * 180) / Math.PI,
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  min: Math.min, max: Math.max, pow: Math.pow,
};

const CONSTS: Record<string, number> = { PI: Math.PI, pi: Math.PI, E: Math.E };

type Tok = { t: 'num' | 'id' | 'op'; v: string };

function tokenize(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      if (s[j] === 'e' || s[j] === 'E') {
        let k = j + 1;
        if (s[k] === '+' || s[k] === '-') k++;
        if (/[0-9]/.test(s[k] ?? '')) { j = k; while (j < s.length && /[0-9]/.test(s[j])) j++; }
      }
      out.push({ t: 'num', v: s.slice(i, j) });
      i = j; continue;
    }
    if (/[A-Za-z_°áéíóúñÁÉÍÓÚÑ]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_°áéíóúñÁÉÍÓÚÑ]/.test(s[j])) j++;
      out.push({ t: 'id', v: s.slice(i, j) });
      i = j; continue;
    }
    if ('+-*/^(),'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    throw new Error(`Carácter no válido: "${c}"`);
  }
  return out;
}

export type Resolver = (name: string) => number | undefined;

export function evaluate(src: string, resolve: Resolver = () => undefined): number {
  const toks = tokenize(String(src ?? ''));
  if (!toks.length) throw new Error('Expresión vacía');
  let p = 0;
  const peek = () => toks[p];
  const eat = (v?: string) => {
    const t = toks[p];
    if (!t || (v && t.v !== v)) throw new Error(v ? `Se esperaba "${v}"` : 'Expresión incompleta');
    p++; return t;
  };

  function primary(): number {
    const t = peek();
    if (!t) throw new Error('Expresión incompleta');
    if (t.t === 'op' && t.v === '(') { eat('('); const v = expr(); eat(')'); return unit(v); }
    if (t.t === 'op' && (t.v === '-' || t.v === '+')) { eat(); const v = power(); return t.v === '-' ? -v : v; }
    if (t.t === 'num') { eat(); const v = parseFloat(t.v); if (!isFinite(v)) throw new Error('Número no válido'); return unit(v); }
    if (t.t === 'id') {
      eat();
      if (peek()?.v === '(' && FUNCS[t.v]) {
        eat('(');
        const args: number[] = [];
        if (peek()?.v !== ')') { args.push(expr()); while (peek()?.v === ',') { eat(','); args.push(expr()); } }
        eat(')');
        return unit(FUNCS[t.v](...args));
      }
      if (t.v in CONSTS) return CONSTS[t.v];
      const r = resolve(t.v);
      if (r === undefined) throw new Error(`Parámetro desconocido: ${t.v}`);
      return unit(r);
    }
    throw new Error(`Símbolo inesperado: ${t.v}`);
  }
  // Sufijo de unidad opcional tras un número o paréntesis: "20 mm", "(a+b) cm", "45 deg".
  function unit(v: number): number {
    const t = peek();
    if (t && t.t === 'id' && t.v in UNITS) { eat(); return v * UNITS[t.v]; }
    return v;
  }
  function power(): number {
    const b = primary();
    if (peek()?.v === '^') { eat('^'); return Math.pow(b, power()); }
    return b;
  }
  function term(): number {
    let v = power();
    while (peek() && (peek().v === '*' || peek().v === '/')) {
      const o = eat().v; const r = power();
      v = o === '*' ? v * r : v / r;
    }
    return v;
  }
  function expr(): number {
    let v = term();
    while (peek() && (peek().v === '+' || peek().v === '-')) {
      const o = eat().v; const r = term();
      v = o === '+' ? v + r : v - r;
    }
    return v;
  }
  const v = expr();
  if (p < toks.length) throw new Error(`Sobra: "${toks[p].v}"`);
  if (!isFinite(v)) throw new Error('Resultado no finito');
  return v;
}

type Param = { name: string; expr: string };

/** Resuelve todos los parámetros respetando dependencias; detecta ciclos. */
export function resolveParams(params: Param[]): { values: Record<string, number>; errors: Record<string, string> } {
  const byName = new Map(params.map((p) => [p.name, p]));
  const values: Record<string, number> = {};
  const errors: Record<string, string> = {};
  const visiting = new Set<string>();
  const get = (name: string): number | undefined => {
    if (name in values) return values[name];
    const p = byName.get(name);
    if (!p) return undefined;
    if (visiting.has(name)) throw new Error(`Referencia circular en ${name}`);
    visiting.add(name);
    try {
      const v = evaluate(p.expr, get);
      values[name] = v;
      return v;
    } finally { visiting.delete(name); }
  };
  for (const p of params) {
    try { get(p.name); } catch (e) { errors[p.name] = (e as Error).message; }
  }
  return { values, errors };
}

export function makeEval(params: Param[]) {
  const { values } = resolveParams(params);
  return (s: string | number) => (typeof s === 'number' ? s : evaluate(s, (n) => values[n]));
}

export function fmt(v: number, d = 3): string {
  if (!isFinite(v)) return '—';
  const r = Math.round(v * 10 ** d) / 10 ** d;
  return String(r);
}

export const isValidName = (n: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n) && !(n in UNITS) && !(n in FUNCS) && !(n in CONSTS);

/** Evaluator with a fallback for invalid expressions (returns NaN instead of throwing). */
export function makeSafeEval(params: Param[]) {
  const { values } = resolveParams(params);
  return (s: string | number) => {
    if (typeof s === 'number') return s;
    try { return evaluate(s, (n) => values[n]); } catch { return NaN; }
  };
}

/** Format a value with Inventor-style units (mm / deg / ul). */
export function fmtU(v: number, unit: 'mm' | 'deg' | 'ul' = 'mm', d = 3): string {
  if (!isFinite(v)) return '—';
  return `${fmt(v, d)} ${unit}`;
}
