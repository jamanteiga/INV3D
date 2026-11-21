// Cliente mínimo de la API de Gemini (Google AI Studio) desde el navegador.
// La clave se guarda solo en este navegador (localStorage), nunca en los ficheros ni en la configuración exportada.

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const KEY_LS = 'inv3d.gemini.key', MODEL_LS = 'inv3d.gemini.model';

export const aiKey = {
  get: (): string => { try { return localStorage.getItem(KEY_LS) ?? ''; } catch { return ''; } },
  set: (k: string) => { try { if (k) localStorage.setItem(KEY_LS, k.trim()); else localStorage.removeItem(KEY_LS); } catch { /* */ } },
};
export const aiModel = {
  get: (): string => { try { return localStorage.getItem(MODEL_LS) ?? ''; } catch { return ''; } },
  set: (m: string) => { try { localStorage.setItem(MODEL_LS, m); } catch { /* */ } },
};

export interface GPart { text?: string; thought?: boolean; thoughtSignature?: string; functionCall?: { name: string; args?: Record<string, unknown>; id?: string }; functionResponse?: { name: string; response: unknown; id?: string }; inlineData?: { mimeType: string; data: string } }
export interface GContent { role: 'user' | 'model'; parts: GPart[] }
export interface GTool { name: string; description: string; parameters?: Record<string, unknown> }
export interface GModel { name: string; displayName: string; description?: string; inputTokenLimit?: number }

async function call<T>(path: string, key: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const r = await fetch(`${BASE}/${path}`, {
    method: body ? 'POST' : 'GET', signal,
    headers: { 'x-goog-api-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (j as { error?: { message?: string; status?: string } }).error;
    throw new Error(r.status === 400 && /API key/i.test(msg?.message ?? '') ? 'Clave de Gemini no válida' : r.status === 429 ? 'Límite de peticiones de Gemini alcanzado (espera un poco o revisa tu cuota)' : `Gemini ${r.status}: ${msg?.message ?? r.statusText}`);
  }
  return j as T;
}

/** Modelos de la cuenta que admiten generateContent (los «flash» primero: rápidos y con nivel gratuito) */
export async function listModels(key: string): Promise<GModel[]> {
  const out: GModel[] = [];
  let token = '';
  for (let i = 0; i < 5; i++) {
    const j = await call<{ models?: (GModel & { supportedGenerationMethods?: string[] })[]; nextPageToken?: string }>(`models?pageSize=200${token ? `&pageToken=${token}` : ''}`, key);
    for (const m of j.models ?? []) if (m.supportedGenerationMethods?.includes('generateContent') && /gemini/i.test(m.name) && !/embedding|image|tts|audio|live|vision-only/i.test(m.name)) out.push({ name: m.name.replace(/^models\//, ''), displayName: m.displayName, description: m.description, inputTokenLimit: m.inputTokenLimit });
    if (!j.nextPageToken) break; token = j.nextPageToken;
  }
  const rank = (n: string) => (/flash/i.test(n) && !/lite/i.test(n) ? 0 : /pro/i.test(n) ? 1 : /lite/i.test(n) ? 2 : 3) + (/preview|exp/i.test(n) ? 0.5 : 0);
  return out.sort((a, b) => rank(a.name) - rank(b.name) || b.name.localeCompare(a.name));
}

export interface GResponse { candidates?: { content?: GContent; finishReason?: string }[]; promptFeedback?: { blockReason?: string }; usageMetadata?: { totalTokenCount?: number } }

export async function generate(key: string, model: string, system: string, contents: GContent[], tools: GTool[], signal?: AbortSignal): Promise<GResponse> {
  return call<GResponse>(`models/${model}:generateContent`, key, {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    tools: tools.length ? [{ functionDeclarations: tools }] : undefined,
    toolConfig: tools.length ? { functionCallingConfig: { mode: 'AUTO' } } : undefined,
    generationConfig: { temperature: 0.3 },
  }, signal);
}
