// Proveedores de IA intercambiables: Gemini, OpenAI (ChatGPT), Anthropic (Claude), Perplexity y cualquier API
// compatible con OpenAI (DeepSeek, Mistral, Groq, OpenRouter, xAI, Ollama/LM Studio locales…).
// Las claves se guardan solo en este navegador (localStorage), nunca en los ficheros ni en la configuración exportada.
import { generate as gGenerate, listModels as gList, type GContent, type GPart, type GTool } from './gemini';

export type ProvId = 'gemini' | 'openai' | 'anthropic' | 'perplexity' | 'custom';
export interface ProvInfo { id: ProvId; label: string; keyUrl?: string; keyHelp: string; base?: string; needsBase?: boolean; keyOptional?: boolean; tools: boolean; defModel: string }
export const PROVIDERS: ProvInfo[] = [
  { id: 'gemini', label: 'Google Gemini', keyUrl: 'https://aistudio.google.com/apikey', keyHelp: 'Google AI Studio › Get API key (gratuita)', tools: true, defModel: '' },
  { id: 'openai', label: 'OpenAI (ChatGPT)', keyUrl: 'https://platform.openai.com/api-keys', keyHelp: 'platform.openai.com › API keys (de pago por uso; no es la suscripción ChatGPT Plus)', base: 'https://api.openai.com/v1', tools: true, defModel: '' },
  { id: 'anthropic', label: 'Anthropic (Claude)', keyUrl: 'https://console.anthropic.com/settings/keys', keyHelp: 'console.anthropic.com › API keys (de pago por uso; no es la suscripción Claude Pro)', tools: true, defModel: 'claude-sonnet-5-5' },
  { id: 'perplexity', label: 'Perplexity', keyUrl: 'https://www.perplexity.ai/settings/api', keyHelp: 'perplexity.ai › Settings › API. Responde con búsqueda web; no modifica el modelo (sin herramientas)', base: 'https://api.perplexity.ai', tools: false, defModel: 'sonar-pro' },
  { id: 'custom', label: 'Otra (compatible OpenAI)', keyHelp: 'Cualquier servicio con API compatible con OpenAI: indica la URL base (p. ej. https://api.deepseek.com/v1, https://api.mistral.ai/v1, https://openrouter.ai/api/v1, http://localhost:11434/v1 para Ollama) y su clave', needsBase: true, keyOptional: true, tools: true, defModel: '' },
];
export const provInfo = (id: ProvId) => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];

// ---------- configuración (por proveedor, en este navegador) ----------
const LS = (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const SET = (k: string, v: string) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch { /* */ } };
export const aiCfg = {
  provider: (): ProvId => (LS('inv3d.ai.provider') as ProvId) || 'gemini',
  setProvider: (p: ProvId) => SET('inv3d.ai.provider', p),
  key: (p: ProvId) => (p === 'gemini' ? LS('inv3d.gemini.key') : LS(`inv3d.ai.${p}.key`)),
  setKey: (p: ProvId, k: string) => SET(p === 'gemini' ? 'inv3d.gemini.key' : `inv3d.ai.${p}.key`, k.trim()),
  model: (p: ProvId) => (p === 'gemini' ? LS('inv3d.gemini.model') : LS(`inv3d.ai.${p}.model`)),
  setModel: (p: ProvId, m: string) => SET(p === 'gemini' ? 'inv3d.gemini.model' : `inv3d.ai.${p}.model`, m),
  base: (p: ProvId) => LS(`inv3d.ai.${p}.base`) || provInfo(p).base || '',
  setBase: (p: ProvId, b: string) => SET(`inv3d.ai.${p}.base`, b.trim().replace(/\/+$/, '')),
};
export interface AiConn { prov: ProvId; key: string; model: string; base: string }
export const currentConn = (): AiConn => { const p = aiCfg.provider(); return { prov: p, key: aiCfg.key(p), model: aiCfg.model(p) || provInfo(p).defModel, base: aiCfg.base(p) }; };
export const connReady = (c: AiConn) => (!!c.key || !!provInfo(c.prov).keyOptional) && (!provInfo(c.prov).needsBase || !!c.base) && !!c.model;

// ---------- conversación neutra ----------
export interface Call { id: string; name: string; args: Record<string, unknown> }
export interface Att { mimeType: string; data: string; name?: string }
export type Msg =
  | { role: 'user'; text: string; att?: Att }
  | { role: 'assistant'; text: string; calls: Call[]; raw?: GPart[] }
  | { role: 'tool'; results: { id: string; name: string; result: unknown }[] };
export interface Reply { text: string; calls: Call[]; raw?: GPart[] }

/** Esquemas de herramientas: los de Gemini usan tipos en mayúsculas; JSON Schema los quiere en minúsculas */
function jsonSchema(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(jsonSchema);
  if (x && typeof x === 'object') { const o: Record<string, unknown> = {}; for (const [k, v] of Object.entries(x)) o[k] = k === 'type' && typeof v === 'string' ? v.toLowerCase() : jsonSchema(v); return o; }
  return x;
}
const params = (t: GTool) => (t.parameters ? jsonSchema(t.parameters) : { type: 'object', properties: {} });

async function http<T>(url: string, init: RequestInit, who: string): Promise<T> {
  let r: Response;
  try { r = await fetch(url, init); }
  catch (e) { if ((e as Error).name === 'AbortError') throw e; throw new Error(`${who}: no se pudo conectar (${(e as Error).message}). Si es un servicio local, revisa que esté arrancado y que permita CORS; algunos servicios no admiten llamadas directas desde el navegador.`); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = (j as { error?: { message?: string } | string }).error;
    const msg = typeof m === 'string' ? m : m?.message ?? r.statusText;
    throw new Error(r.status === 401 || r.status === 403 ? `${who}: clave no válida o sin permiso (${msg})` : r.status === 429 ? `${who}: límite de peticiones o de saldo alcanzado (${msg})` : `${who} ${r.status}: ${msg}`);
  }
  return j as T;
}

// ---------- Gemini ----------
function toGemini(msgs: Msg[]): GContent[] {
  const out: GContent[] = [];
  for (const m of msgs) {
    if (m.role === 'user') out.push({ role: 'user', parts: [{ text: m.text }, ...(m.att ? [{ inlineData: { mimeType: m.att.mimeType, data: m.att.data } }] : [])] });
    else if (m.role === 'assistant') out.push({ role: 'model', parts: m.raw ?? [...(m.text ? [{ text: m.text }] : []), ...m.calls.map((c) => ({ functionCall: { name: c.name, args: c.args } }))] });
    else out.push({ role: 'user', parts: m.results.map((r) => ({ functionResponse: { name: r.name, response: { result: r.result }, ...(r.id && !/^g\d+$/.test(r.id) ? { id: r.id } : {}) } })) });
  }
  return out;
}
async function chatGemini(c: AiConn, system: string, msgs: Msg[], tools: GTool[], signal?: AbortSignal): Promise<Reply> {
  const r = await gGenerate(c.key, c.model, system, toGemini(msgs), tools, signal);
  if (r.promptFeedback?.blockReason) throw new Error(`Gemini bloqueó la consulta (${r.promptFeedback.blockReason})`);
  const ct = r.candidates?.[0]?.content;
  if (!ct?.parts?.length) throw new Error(`Respuesta vacía de Gemini (${r.candidates?.[0]?.finishReason ?? 'sin motivo'})`);
  return {
    text: ct.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim(),
    calls: ct.parts.filter((p) => p.functionCall).map((p, i) => ({ id: p.functionCall!.id ?? `g${i}`, name: p.functionCall!.name, args: p.functionCall!.args ?? {} })),
    raw: ct.parts,
  };
}

// ---------- OpenAI y compatibles (ChatGPT, Perplexity, DeepSeek, Mistral, Groq, OpenRouter, Ollama…) ----------
function toOpenAI(system: string, msgs: Msg[], files: boolean) {
  const out: Record<string, unknown>[] = [{ role: 'system', content: system }];
  for (const m of msgs) {
    if (m.role === 'user') {
      if (!m.att) { out.push({ role: 'user', content: m.text }); continue; }
      const url = `data:${m.att.mimeType};base64,${m.att.data}`;
      const part = m.att.mimeType === 'application/pdf'
        ? (files ? { type: 'file', file: { filename: m.att.name ?? 'adjunto.pdf', file_data: url } } : null)
        : { type: 'image_url', image_url: { url } };
      out.push({ role: 'user', content: [{ type: 'text', text: m.text + (part ? '' : '\n[El PDF adjunto no se puede enviar a este proveedor]') }, ...(part ? [part] : [])] });
    } else if (m.role === 'assistant') {
      out.push({ role: 'assistant', content: m.text || null, ...(m.calls.length ? { tool_calls: m.calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}) });
    } else for (const r of m.results) out.push({ role: 'tool', tool_call_id: r.id, content: JSON.stringify(r.result) });
  }
  return out;
}
async function chatOpenAI(c: AiConn, system: string, msgs: Msg[], tools: GTool[], signal?: AbortSignal): Promise<Reply> {
  const info = provInfo(c.prov);
  const useTools = info.tools && tools.length;
  // Perplexity y otros sin herramientas: se convierten los pasos de herramientas en texto
  const plain = useTools ? msgs : msgs.filter((m) => m.role !== 'tool').map((m) => (m.role === 'assistant' ? { ...m, calls: [] } : m));
  const body: Record<string, unknown> = { model: c.model, messages: toOpenAI(system, plain, c.prov === 'openai') };
  if (useTools) { body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: params(t) } })); body.tool_choice = 'auto'; }
  if (c.prov !== 'openai') body.temperature = 0.3;
  const j = await http<{ choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }; finish_reason?: string }[]; citations?: string[] }>(
    `${c.base}/chat/completions`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', ...(c.key ? { Authorization: `Bearer ${c.key}` } : {}) }, body: JSON.stringify(body) }, info.label);
  const m = j.choices?.[0]?.message;
  if (!m) throw new Error(`${info.label}: respuesta vacía`);
  let text = (m.content ?? '').trim();
  if (j.citations?.length) text += '\n\nFuentes:\n' + j.citations.map((u, i) => `${i + 1}. ${u}`).join('\n');
  return { text, calls: (m.tool_calls ?? []).map((t) => { let a: Record<string, unknown> = {}; try { a = JSON.parse(t.function.arguments || '{}'); } catch { /* */ } return { id: t.id, name: t.function.name, args: a }; }) };
}

// ---------- Anthropic (Claude) ----------
function toAnthropic(msgs: Msg[]) {
  const out: { role: 'user' | 'assistant'; content: unknown[] }[] = [];
  const add = (role: 'user' | 'assistant', blocks: unknown[]) => { const l = out[out.length - 1]; if (l && l.role === role) l.content.push(...blocks); else out.push({ role, content: blocks }); };
  for (const m of msgs) {
    if (m.role === 'user') add('user', [
      ...(m.att ? [m.att.mimeType === 'application/pdf' ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: m.att.data } } : { type: 'image', source: { type: 'base64', media_type: m.att.mimeType, data: m.att.data } }] : []),
      { type: 'text', text: m.text }]);
    else if (m.role === 'assistant') add('assistant', [...(m.text ? [{ type: 'text', text: m.text }] : []), ...m.calls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.args }))]);
    else add('user', m.results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: JSON.stringify(r.result) })));
  }
  return out;
}
async function chatAnthropic(c: AiConn, system: string, msgs: Msg[], tools: GTool[], signal?: AbortSignal): Promise<Reply> {
  const j = await http<{ content?: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[] }>('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: c.model, max_tokens: 8192, system, messages: toAnthropic(msgs), temperature: 0.3, ...(tools.length ? { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: params(t) })) } : {}) }),
  }, 'Anthropic');
  const ct = j.content ?? [];
  return { text: ct.filter((b) => b.type === 'text').map((b) => b.text).join('').trim(), calls: ct.filter((b) => b.type === 'tool_use').map((b) => ({ id: b.id!, name: b.name!, args: b.input ?? {} })) };
}

export function chat(c: AiConn, system: string, msgs: Msg[], tools: GTool[], signal?: AbortSignal): Promise<Reply> {
  if (c.prov === 'gemini') return chatGemini(c, system, msgs, tools, signal);
  if (c.prov === 'anthropic') return chatAnthropic(c, system, msgs, tools, signal);
  return chatOpenAI(c, system, msgs, tools, signal);
}

/** Modelos disponibles con esa clave (si el servicio los lista) */
export async function listModelsFor(c: Omit<AiConn, 'model'>): Promise<{ id: string; label: string }[]> {
  if (c.prov === 'gemini') return (await gList(c.key)).map((m) => ({ id: m.name, label: `${m.displayName} (${m.name})` }));
  if (c.prov === 'perplexity') return ['sonar-pro', 'sonar', 'sonar-reasoning-pro', 'sonar-deep-research'].map((id) => ({ id, label: id }));
  if (c.prov === 'anthropic') {
    const j = await http<{ data?: { id: string; display_name?: string }[] }>('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': c.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } }, 'Anthropic');
    return (j.data ?? []).map((m) => ({ id: m.id, label: m.display_name ? `${m.display_name} (${m.id})` : m.id }));
  }
  const j = await http<{ data?: { id: string }[]; models?: { name: string }[] }>(`${c.base}/models`, { headers: c.key ? { Authorization: `Bearer ${c.key}` } : {} }, provInfo(c.prov).label);
  let ids = (j.data ?? []).map((m) => m.id);
  if (c.prov === 'openai') ids = ids.filter((id) => /^(gpt|o\d|chatgpt)/i.test(id) && !/audio|realtime|tts|transcribe|image|search|embedding|instruct/i.test(id)).sort((a, b) => b.localeCompare(a));
  return ids.map((id) => ({ id, label: id }));
}
