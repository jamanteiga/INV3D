// Asistente IA (Gemini): contexto del documento activo, herramientas que actúan sobre INV3D y bucle de conversación.
import { useStore, type State } from '../core/store';
import { uid, MATERIALS, type PartDoc, type Feature } from '../core/doc';
type Param = PartDoc['parameters'][number];
import { COMMANDS, ctxNow } from '../ui/commands';
import { type GTool } from './gemini';
import { chat, provInfo, type AiConn, type Msg } from './providers';
import { ASM_TOOLS, ASM_MODIFY, execAsmTool, portsContext } from './asmtools';

const S = () => useStore.getState();
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + `… [recortado, ${s.length} caracteres]` : s);

/** Resumen compacto del estado de la app que acompaña a cada pregunta */
export function buildContext(s: State = S()): string {
  const L: string[] = [];
  const entry = s.docs.find((d) => d.id === s.active);
  L.push(`INV3D v${__APP_VERSION__} · documento activo: ${entry?.fileName ?? '(sin nombre)'} · tipo: ${s.kind}${s.kind === 'part' ? ` · modo: ${s.mode}${s.sketchId ? ` (editando boceto ${s.sketchId})` : ''}` : ''}`);
  L.push(`Documentos abiertos: ${s.docs.map((d) => `${d.fileName} [${d.kind}]`).join(', ')}`);
  if (s.kind === 'part' || s.kind === 'sheet' as never) {
    const d = s.doc;
    L.push(`iPropiedades: ${JSON.stringify(d.iProperties)}`);
    if (d.parameters.length) L.push(`Parámetros: ${d.parameters.map((p) => `${p.name} = ${p.expr}${p.comment ? ` (${p.comment})` : ''}`).join('; ')}`);
    L.push('Operaciones (id · nombre · tipo · datos · estado):');
    for (const f of d.features) {
      const st = s.result?.status[f.id];
      const { id, name, type, ...rest } = f as Feature & Record<string, unknown>;
      const data = clip(JSON.stringify(rest), type === 'sketch' ? 500 : 260);
      L.push(`- ${id} · ${name} · ${type}${f.suppressed ? ' (suprimida)' : ''} · ${data}${st && !st.ok ? ` · ERROR: ${st.error}` : ''}`);
    }
    const p = s.result?.props;
    if (p) L.push(`Propiedades físicas: volumen ${Math.round(p.volume)} mm³, área ${Math.round(p.area)} mm², CDG [${p.cog.map((x) => x.toFixed(1)).join(', ')}], caja [${p.bbox[0].map((x) => x.toFixed(1)).join(', ')}] – [${p.bbox[1].map((x) => x.toFixed(1)).join(', ')}] mm`);
    if (s.selFeature) L.push(`Operación seleccionada: ${s.selFeature}`);
    if (s.selEntities.length || s.selEntity) L.push(`Entidades de boceto seleccionadas: ${(s.selEntities.length ? s.selEntities : [s.selEntity]).join(', ')}`);
  }
  if (s.kind === 'assembly') {
    const a = s.asm;
    L.push('Componentes (id · nombre · pieza · fijo · GDL):');
    for (const o of a.occurrences) L.push(`- ${o.id} · ${o.name} · ${s.docs.find((d) => d.id === o.part)?.fileName ?? o.part}${o.grounded ? ' · fijo' : ''}${s.asmDof?.[o.id] != null ? ` · ${s.asmDof[o.id]} GDL` : ''}`);
    if (a.joints.length) L.push(`Restricciones: ${a.joints.map((j) => `${j.name} [${j.type}] ${j.a.occ}↔${j.b.occ}${j.suppressed ? ' (suprimida)' : ''}`).join('; ')}`);
    const errs = s.asmResult && Object.entries(s.asmResult.parts).filter(([, v]) => !v.ok);
    if (errs?.length) L.push(`Piezas con error: ${errs.map(([k, v]) => `${k}: ${v.error}`).join('; ')}`);
    if (s.selItem) L.push(`Seleccionado: ${s.selItem}`);
    const pc = portsContext(); if (pc) L.push(pc);
    L.push(`Modo de inserción: ${(s.settings.insertMode ?? 'foran') === 'foran' ? 'espacial (las piezas nuevas se unen por ePoints a la boca libre)' : 'paramétrica (sigue al cursor y se restringe después)'}`);
  }
  if (s.kind === 'drawing') {
    const w = s.drw;
    L.push(`Plano: hoja ${w.sheet}, norma ${w.std ?? 'ISO'}, ${w.views.length} vistas: ${w.views.map((v) => `${v.id} (${v.kind ?? 'base'} ${v.dir ?? ''} 1:${Math.round(1 / v.scale * 100) / 100}) de ${s.docs.find((d) => d.id === v.source)?.fileName ?? v.source}`).join('; ')}; ${w.dims.length} cotas, ${w.notes.length} notas`);
    if (s.selItem) L.push(`Seleccionado: ${s.selItem}`);
  }
  return L.join('\n');
}

export const SYSTEM = `Eres el asistente de INV3D, una aplicación CAD web libre al estilo de Autodesk Inventor (piezas, ensamblajes, planos, tubería ASME/EN, tornillería, soldadura). El usuario es un ingeniero mecánico senior.
Responde SIEMPRE en castellano, de forma concisa y directa, con rutas de menú exactas cuando expliques cómo hacer algo (p. ej. «Modelo 3D › Agujero»). Si citas una norma, indica la norma y no inventes valores: si no estás seguro de una cifra, dilo.
Recibes en cada mensaje el ESTADO ACTUAL del documento. Usa las herramientas para actuar: los cambios se aplican tras la confirmación del usuario y se deshacen con Ctrl+Z. Después de modificar, revisa el estado devuelto y corrige si hay errores.

FORMATO DE OPERACIONES DE PIEZA (JSON; todas las cotas son cadenas con expresiones en mm, pueden usar parámetros: "40", "L/2", "d+2"):
- Boceto: {"id":"s1","name":"Boceto1","type":"sketch","plane":{"kind":"std","name":"XY"|"XZ"|"YZ","offset":"0"},"entities":[...]}
  Planos: XY → x=X, y=Y, normal +Z · XZ → x=X, y=Z, normal −Y · YZ → x=Y, y=Z, normal +X. Plano sobre una cara: {"kind":"custom","label":"Cara","origin":[x,y,z],"xDir":[..],"normal":[..]}.
  Entidades: {"id":"r1","type":"rect","x":"-30","y":"-20","w":"60","h":"40"} (esquina inferior izquierda + ancho/alto) · {"id":"c1","type":"circle","cx":"0","cy":"0","d":"20"} · {"id":"l1","type":"line","a":["0","0"],"b":["50","0"]} · {"id":"p1","type":"point","cx":"10","cy":"5"} · {"id":"a1","type":"arc","cx":"0","cy":"0","r":"10","a0":"0","a1":"90"} · {"id":"n1","type":"npoly","cx":"0","cy":"0","d":"20","n":"6","rot":"0"} · {"id":"o1","type":"slot","x1":"0","y1":"0","x2":"30","y2":"0","w":"10"}. Añade "construction":true para geometría auxiliar y "center":true en una línea eje.
  Un perfil cerrado dentro de otro forma un hueco.
- Extrusión: {"id":"e1","name":"Extrusión1","type":"extrude","profile":"s1","distance":"20","dir":"normal"|"reverse"|"symmetric","op":"join"|"cut"|"intersect"|"new","extent":"distance"|"through"}
- Revolución: {"type":"revolve","profile":"s1","axis":"<id de una línea del boceto>","angle":"360","op":"join"}
- Agujero en puntos de boceto: {"type":"hole","sketch":"s2","dia":"8.5","depth":"20","through":true,"kind":"simple"|"cbore"|"csink"|"tap","cbDia":"0","cbDepth":"0","csDia":"0","csAngle":"90","thread":""} (roscado: "kind":"tap","std":"M","size":"M10x1.5","thread":"M10x1.5","dia":"8.5","tapDepth":"15"). Taladra siempre hacia el material.
- Empalme: {"type":"fillet","radius":"3","edges":{"mode":"all"|"X"|"Y"|"Z"|"circle","points":[]}} o por caras planas "faces":[[x,y,z] punto de la cara]. Chaflán: {"type":"chamfer","distance":"2","edges":{...}}.
- Vaciado: {"type":"shell","thickness":"2","faces":[[x,y,z] caras a quitar]}
- Patrón: {"type":"pattern","ptype":"circ","features":["h1"],"axis":"Z","count":"6","angle":"360","dir1":"X","n1":"1","d1":"0","dir2":"","n2":"1","d2":"0"} o "ptype":"rect" con dir1/n1/d1 y dir2/n2/d2.
- Simetría: {"type":"mirror","features":["e1"],"plane":"XY"|"XZ"|"YZ"}
Usa ids nuevos y únicos (no repitas los existentes). Para piezas nuevas, empieza por un boceto y una extrusión «new» o «join».

ENSAMBLAJES (HVAC y tubería): NO modeles conductos, codos, tubos ni bridas con operaciones: usa insert_hvac / insert_pipe, que generan la pieza normalizada y la colocan unida por ePoints (bocas) a la anterior con 0 GDL.
- Un tendido se hace pieza a pieza: cada pieza nueva se une por defecto a la boca libre del componente seleccionado o del último insertado (la pieza nueva queda seleccionada), o a la boca que indiques con at {occ, ep}.
- En codos y tes indica «towards» (+X, -X, +Y, -Y, +Z, -Z): dirección mundial de la salida. Los rectangulares hacia el lado H se generan con W y H cambiados solos; no pases W/H en codos si quieres que tomen la sección de la boca.
- Para llegar a un punto, calcula las longitudes de los tramos rectos restando lo que ocupan los codos (usa los puntos de las bocas libres que se devuelven tras cada inserción).
- Ensamblaje vacío: el primer componente se coloca con first {ep, pos, face, roll}.
- Para corregir: spin_component (giro sobre la unión), offset_component, reconnect_component, delete_components. Al terminar, check_assembly y comenta el resultado.`;

/** Declaraciones de herramientas para Gemini */
export const TOOLS: GTool[] = [
  { name: 'get_document_json', description: 'Devuelve el JSON completo del documento activo (pieza, ensamblaje o plano).' },
  { name: 'list_commands', description: 'Lista las órdenes de la interfaz disponibles en el contexto actual (id y nombre).' },
  { name: 'run_command', description: 'Ejecuta una orden de la interfaz por su id (abre su diálogo o herramienta). Úsala para llevar al usuario al sitio adecuado.', parameters: { type: 'OBJECT', properties: { id: { type: 'STRING' } }, required: ['id'] } },
  { name: 'add_features', description: 'Añade operaciones a la pieza activa (al final del árbol). features = array JSON de operaciones con el formato indicado.', parameters: { type: 'OBJECT', properties: { features: { type: 'STRING', description: 'Array JSON de operaciones' }, summary: { type: 'STRING', description: 'Resumen breve para el usuario' } }, required: ['features', 'summary'] } },
  { name: 'update_feature', description: 'Modifica campos de una operación existente de la pieza activa. patch = objeto JSON con los campos a cambiar.', parameters: { type: 'OBJECT', properties: { id: { type: 'STRING' }, patch: { type: 'STRING', description: 'Objeto JSON' }, summary: { type: 'STRING' } }, required: ['id', 'patch', 'summary'] } },
  { name: 'delete_features', description: 'Elimina operaciones de la pieza activa por id.', parameters: { type: 'OBJECT', properties: { ids: { type: 'ARRAY', items: { type: 'STRING' } }, summary: { type: 'STRING' } }, required: ['ids', 'summary'] } },
  { name: 'set_parameters', description: 'Crea o cambia parámetros de usuario de la pieza activa.', parameters: { type: 'OBJECT', properties: { params: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, expr: { type: 'STRING', description: 'p. ej. "40 mm" o "L/2"' }, comment: { type: 'STRING' } }, required: ['name', 'expr'] } }, summary: { type: 'STRING' } }, required: ['params', 'summary'] } },
  { name: 'set_iproperties', description: 'Cambia iPropiedades de la pieza activa (partNumber, description, designer, material, revision). Materiales válidos: ' + MATERIALS.map((m) => m.name).join(', '), parameters: { type: 'OBJECT', properties: { props: { type: 'STRING', description: 'Objeto JSON con los campos' }, summary: { type: 'STRING' } }, required: ['props', 'summary'] } },
  { name: 'new_part', description: 'Crea una pieza nueva (documento nuevo) con sus operaciones y parámetros, y la abre.', parameters: { type: 'OBJECT', properties: { fileName: { type: 'STRING', description: 'Nombre sin extensión' }, features: { type: 'STRING', description: 'Array JSON de operaciones' }, parameters: { type: 'STRING', description: 'Array JSON [{name,expr,comment}] (opcional)' }, material: { type: 'STRING' }, summary: { type: 'STRING' } }, required: ['fileName', 'features', 'summary'] } },
  { name: 'undo', description: 'Deshace el último cambio del documento activo.' },
  ...ASM_TOOLS,
];

const MODIFY = new Set(['add_features', 'update_feature', 'delete_features', 'set_parameters', 'set_iproperties', 'new_part', 'undo', ...ASM_MODIFY]);

/** Espera a que termine la regeneración y devuelve los errores de la pieza activa */
async function regenStatus(): Promise<{ ok: boolean; errors: string[]; volume?: number }> {
  await new Promise((r) => setTimeout(r, 150));
  const t0 = Date.now();
  while (S().busy && Date.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 150));
  const s = S();
  if (s.kind !== 'part') return { ok: true, errors: [] };
  const errors = Object.entries(s.result?.status ?? {}).filter(([, v]) => !v.ok).map(([k, v]) => `${s.doc.features.find((f) => f.id === k)?.name ?? k}: ${v.error}`);
  return { ok: !errors.length, errors, volume: s.result?.props ? Math.round(s.result.props.volume) : undefined };
}
const parseJ = <T,>(t: unknown, what: string): T => { if (typeof t !== 'string') return t as T; try { return JSON.parse(t) as T; } catch { throw new Error(`JSON no válido en ${what}`); } };
function fixIds(feats: Feature[], doc: PartDoc) {
  const used = new Set(doc.features.map((f) => f.id));
  const ren = new Map<string, string>();
  for (const f of feats) { if (!f.id || used.has(f.id)) { const n = uid('f'); ren.set(f.id, n); f.id = n; } used.add(f.id); if (!f.name) f.name = `${f.type}${doc.features.length + feats.indexOf(f) + 1}`; }
  if (ren.size) { const j = JSON.stringify(feats); return JSON.parse(ren.size ? [...ren].reduce((a, [o, n]) => a.split(`"${o}"`).join(`"${n}"`), j) : j) as Feature[]; }
  return feats;
}

export function describeCall(name: string, args: Record<string, unknown>): string {
  if (args.summary) return String(args.summary);
  if (name === 'undo') return 'Deshacer el último cambio';
  return `${name} ${clip(JSON.stringify(args), 200)}`;
}

/** Ejecuta una herramienta; las que modifican piden confirmación */
export async function execTool(name: string, args: Record<string, unknown>, confirm: (title: string, detail: string) => Promise<boolean>): Promise<unknown> {
  const s = S();
  if (MODIFY.has(name) && !(await confirm(describeCall(name, args), clip(JSON.stringify(args, null, 1), 4000)))) return { applied: false, reason: 'El usuario no lo ha aceptado' };
  switch (name) {
    case 'get_document_json': return { json: clip(JSON.stringify(s.kind === 'assembly' ? s.asm : s.kind === 'drawing' ? s.drw : s.doc), 60000) };
    case 'list_commands': { const ctx = ctxNow(s); return { commands: COMMANDS.filter((c) => ctx.includes(c.ctx)).map((c) => `${c.id}: ${c.label}`) }; }
    case 'run_command': { const c = COMMANDS.find((x) => x.id === args.id); if (!c) return { error: 'Orden no encontrada' }; c.run(s); return { ok: true }; }
    case 'undo': s.undo(); return regenStatus();
  }
  if (ASM_TOOLS.some((t) => t.name === name)) return execAsmTool(name, args);
  if (name === 'new_part') {
    const feats = parseJ<Feature[]>(args.features, 'features'), params = args.parameters ? parseJ<Param[]>(args.parameters, 'parameters') : [];
    const doc: PartDoc = { format: 'inv3d.part', version: 1, units: 'mm', iProperties: { partNumber: String(args.fileName), description: '', designer: s.settings.userName || '', material: String(args.material || s.settings.defaultMaterial || 'Acero S275JR'), revision: 'A' }, parameters: params.map((p) => ({ name: p.name, expr: p.expr, comment: p.comment ?? '' })), features: [] };
    doc.features = fixIds(feats, doc);
    s.addDocument('part', doc, `${String(args.fileName).replace(/\.i3p$/i, '')}.i3p`, true);
    return regenStatus();
  }
  if (s.kind !== 'part') return { error: 'El documento activo no es una pieza' };
  switch (name) {
    case 'add_features': { const feats = fixIds(parseJ<Feature[]>(args.features, 'features'), s.doc); s.commit((d) => { d.features.push(...feats); }); return { ...(await regenStatus()), ids: feats.map((f) => f.id) }; }
    case 'update_feature': { const patch = parseJ<Record<string, unknown>>(args.patch, 'patch'); if (!s.doc.features.some((f) => f.id === args.id)) return { error: 'Operación no encontrada' }; s.commit((d) => { const f = d.features.find((x) => x.id === args.id); if (f) Object.assign(f, patch, { id: f.id }); }); return regenStatus(); }
    case 'delete_features': { const ids = (args.ids as string[]) ?? []; s.commit((d) => { d.features = d.features.filter((f) => !ids.includes(f.id)); }); return regenStatus(); }
    case 'set_parameters': { const ps = (args.params as Param[]) ?? []; s.commit((d) => { for (const p of ps) { const q = d.parameters.find((x) => x.name === p.name); if (q) { q.expr = p.expr; if (p.comment) q.comment = p.comment; } else d.parameters.push({ name: p.name, expr: p.expr, comment: p.comment ?? '' }); } }); return regenStatus(); }
    case 'set_iproperties': { const pr = parseJ<Record<string, string>>(args.props, 'props'); s.commit((d) => { Object.assign(d.iProperties, pr); }); return regenStatus(); }
  }
  return { error: `Herramienta desconocida: ${name}` };
}

export interface ChatMsg { role: 'user' | 'model' | 'action' | 'error'; text: string }

/** Un turno: envía la pregunta con el contexto y resuelve las llamadas a herramientas hasta la respuesta final (cualquier proveedor) */
export async function runTurn(opts: {
  conn: AiConn; history: Msg[]; question: string; image?: { mimeType: string; data: string; name?: string };
  confirm: (title: string, detail: string) => Promise<boolean>; onMsg: (m: ChatMsg) => void; signal?: AbortSignal;
}): Promise<Msg[]> {
  const hist: Msg[] = [...opts.history];
  const tools = provInfo(opts.conn.prov).tools ? TOOLS : [];
  const sys = tools.length ? SYSTEM : SYSTEM + '\n\nEn esta conexión NO tienes herramientas: no puedes modificar el documento. Responde y explica los pasos con rutas de menú exactas.';
  hist.push({ role: 'user', text: `ESTADO ACTUAL:\n${buildContext()}\n\nPREGUNTA:\n${opts.question}`, att: opts.image });
  for (let step = 0; step < 24; step++) {
    const r = await chat(opts.conn, sys, hist, tools, opts.signal);
    hist.push({ role: 'assistant', text: r.text, calls: r.calls, raw: r.raw });
    if (r.text) opts.onMsg({ role: 'model', text: r.text });
    if (!r.calls.length) break;
    const results: { id: string; name: string; result: unknown }[] = [];
    for (const c of r.calls) {
      let result: unknown;
      try { result = await execTool(c.name, c.args, opts.confirm); } catch (e) { result = { error: (e as Error).message }; }
      if (MODIFY.has(c.name) || c.name === 'run_command') opts.onMsg({ role: 'action', text: `${describeCall(c.name, c.args)} → ${(result as { applied?: boolean })?.applied === false ? 'no aplicado' : (result as { error?: string })?.error ? `error: ${(result as { error: string }).error}` : (result as { ok?: boolean })?.ok === false ? `con errores: ${(result as { errors: string[] }).errors.join('; ')}` : 'hecho'}` });
      results.push({ id: c.id, name: c.name, result });
    }
    hist.push({ role: 'tool', results });
  }
  // el contexto de turnos anteriores se aligera: solo se conserva la pregunta (sin el estado completo ni el adjunto)
  return hist.map((h, i) => (i === opts.history.length && h.role === 'user' ? { role: 'user', text: `PREGUNTA:\n${opts.question}` } : h));
}
/** Recorta el historial empezando siempre por una pregunta del usuario (sin respuestas de herramientas huérfanas) */
export function trimHistory(h: Msg[], max = 30): Msg[] {
  if (h.length <= max) return h;
  let i = h.length - max; while (i < h.length && !(h[i].role === 'user')) i++;
  return h.slice(i);
}
