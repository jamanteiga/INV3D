// Panel del asistente IA (Gemini), a la derecha de Propiedades. F1 o botón «IA» de la barra rápida.
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../core/store';
import { aiKey, aiModel, listModels, type GContent, type GModel } from '../ai/gemini';
import { runTurn, type ChatMsg } from '../ai/assistant';

const AUTO_LS = 'inv3d.ai.auto';
const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
/** Markdown mínimo: negrita, código, listas y saltos de línea */
function md(t: string): string {
  const lines = esc(t).split('\n');
  let html = '', inList = false, inCode = false;
  for (const l of lines) {
    if (l.trim().startsWith('```')) { html += inCode ? '</pre>' : '<pre>'; inCode = !inCode; continue; }
    if (inCode) { html += l + '\n'; continue; }
    const li = /^\s*(?:[-*•]|\d+\.)\s+(.*)$/.exec(l);
    if (li && !inList) { html += '<ul>'; inList = true; }
    if (!li && inList) { html += '</ul>'; inList = false; }
    const inl = (li ? li[1] : l).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/^#{1,4}\s*(.*)$/, '<b>$1</b>');
    html += li ? `<li>${inl}</li>` : inl ? `<p>${inl}</p>` : '';
  }
  if (inList) html += '</ul>'; if (inCode) html += '</pre>';
  return html;
}

export default function AiPanel() {
  const open = useStore((s) => s.aiOpen);
  const [key, setKey] = useState(aiKey.get());
  const [keyIn, setKeyIn] = useState('');
  const [models, setModels] = useState<GModel[]>([]);
  const [model, setModel] = useState(aiModel.get());
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [hist, setHist] = useState<GContent[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [img, setImg] = useState<{ mimeType: string; data: string; name: string } | null>(null);
  const [auto, setAuto] = useState(() => { try { return localStorage.getItem(AUTO_LS) === '1'; } catch { return false; } });
  const [ask, setAsk] = useState<{ title: string; detail: string; res: (ok: boolean) => void } | null>(null);
  const [showCfg, setShowCfg] = useState(!key);
  const abort = useRef<AbortController | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (open && key && !models.length) listModels(key).then((m) => { setModels(m); if (!model || !m.some((x) => x.name === model)) { setModel(m[0]?.name ?? ''); aiModel.set(m[0]?.name ?? ''); } }).catch((e) => push({ role: 'error', text: (e as Error).message })); }, [open, key]);
  useEffect(() => { list.current?.scrollTo({ top: 1e9, behavior: 'smooth' }); }, [msgs, ask]);
  useEffect(() => { if (open) setTimeout(() => ta.current?.focus(), 50); }, [open]);
  if (!open) return null;

  const push = (m: ChatMsg) => setMsgs((x) => [...x, m]);
  const saveKey = async () => {
    const k = keyIn.trim(); if (!k) return;
    try { const m = await listModels(k); aiKey.set(k); setKey(k); setModels(m); const d = m[0]?.name ?? ''; setModel(d); aiModel.set(d); setKeyIn(''); setShowCfg(false); push({ role: 'model', text: `Conectado a Gemini · ${m.length} modelos disponibles · usando **${d}**.` }); }
    catch (e) { push({ role: 'error', text: (e as Error).message }); }
  };
  const confirm = (title: string, detail: string) => auto ? Promise.resolve(true) : new Promise<boolean>((res) => setAsk({ title, detail, res: (ok) => { setAsk(null); res(ok); } }));
  const send = async (text = q) => {
    const t = text.trim(); if (!t || busy) return;
    if (!key) { setShowCfg(true); return; }
    setQ(''); push({ role: 'user', text: t + (img ? `  [imagen: ${img.name}]` : '') });
    setBusy(true); abort.current = new AbortController();
    try {
      const h = await runTurn({ key, model, history: hist, question: t, image: img ? { mimeType: img.mimeType, data: img.data } : undefined, confirm, onMsg: push, signal: abort.current.signal });
      setHist(h.slice(-30)); setImg(null);
    } catch (e) { if ((e as Error).name !== 'AbortError') push({ role: 'error', text: (e as Error).message }); }
    setBusy(false);
  };
  const pickImg = () => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*,application/pdf';
    i.onchange = () => { const f = i.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => setImg({ mimeType: f.type, data: String(r.result).split(',')[1], name: f.name }); r.readAsDataURL(f); };
    i.click();
  };
  const close = () => useStore.setState({ aiOpen: false });

  return (
    <aside className="ai-panel" onKeyDown={(e) => e.stopPropagation()}>
      <div className="ai-head">
        <b>Asistente IA</b><span className="ai-sub">Gemini</span>
        <span className="grow" />
        <button className="ai-ib" title="Configuración (clave y modelo)" onClick={() => setShowCfg(!showCfg)}>⚙</button>
        <button className="ai-ib" title="Nueva conversación" onClick={() => { setMsgs([]); setHist([]); }}>⟲</button>
        <button className="ai-ib" title="Cerrar (F1)" onClick={close}>×</button>
      </div>
      {showCfg && (
        <div className="ai-cfg">
          {key ? <div className="ai-row">Clave guardada en este navegador <button className="btn" onClick={() => { aiKey.set(''); setKey(''); setModels([]); }}>Quitar</button></div>
            : <p className="phelp" style={{ margin: '0 0 6px' }}>Pega tu clave de API de Gemini (gratuita en <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio › Get API key</a>). Se guarda solo en este navegador; no va a los ficheros ni a la configuración exportada.</p>}
          {!key && <div className="ai-row"><input type="password" placeholder="AIza…" value={keyIn} onChange={(e) => setKeyIn(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveKey(); }} style={{ flex: 1 }} /><button className="btn primary" onClick={saveKey}>Conectar</button></div>}
          {key && <div className="ai-row">Modelo <select value={model} onChange={(e) => { setModel(e.target.value); aiModel.set(e.target.value); }} style={{ flex: 1 }}>{models.map((m) => <option key={m.name} value={m.name}>{m.displayName} ({m.name})</option>)}</select></div>}
          <label className="check"><input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); try { localStorage.setItem(AUTO_LS, e.target.checked ? '1' : '0'); } catch { /* */ } }} />Aplicar los cambios sin preguntar (se deshacen con Ctrl+Z)</label>
        </div>
      )}
      <div className="ai-list" ref={list}>
        {!msgs.length && (
          <div className="ai-empty">
            <p>Pregunta sobre el documento abierto o pide cambios. Ejemplos:</p>
            {['¿Por qué falla la última operación?', 'Crea una placa de 200×150×12 con 4 taladros Ø14 a 25 mm de los bordes', 'Pon empalmes de 2 mm en todas las aristas', '¿Qué junta y espárragos lleva una brida ASME B16.5 4" clase 300?', '¿Cuántos grados de libertad le quedan a cada componente y cómo los quito?'].map((t) => <button key={t} className="ai-sugg" onClick={() => send(t)}>{t}</button>)}
          </div>
        )}
        {msgs.map((m, i) => m.role === 'user' ? <div key={i} className="ai-msg user">{m.text}</div>
          : m.role === 'action' ? <div key={i} className="ai-msg act">⚙ {m.text}</div>
          : m.role === 'error' ? <div key={i} className="ai-msg err">{m.text}</div>
          : <div key={i} className="ai-msg model" dangerouslySetInnerHTML={{ __html: md(m.text) }} />)}
        {ask && (
          <div className="ai-ask">
            <div><b>¿Aplicar?</b> {ask.title}</div>
            <details><summary>Detalle</summary><pre>{ask.detail}</pre></details>
            <div className="ai-row"><span className="grow" /><button className="btn" onClick={() => ask.res(false)}>Descartar</button><button className="btn primary" onClick={() => ask.res(true)}>Aplicar</button></div>
          </div>
        )}
        {busy && !ask && <div className="ai-msg model ai-dots">Pensando…</div>}
      </div>
      <div className="ai-input">
        {img && <div className="ai-img">📎 {img.name} <button className="ai-ib" onClick={() => setImg(null)}>×</button></div>}
        <textarea ref={ta} rows={3} placeholder={key ? 'Escribe… (Intro envía, Mayús+Intro salto de línea)' : 'Configura antes la clave de Gemini (⚙)'} value={q}
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } if (e.key === 'Escape') close(); }} />
        <div className="ai-row">
          <button className="ai-ib" title="Adjuntar imagen o PDF (croquis, plano…)" onClick={pickImg}>📎</button>
          <span className="ai-sub">{model}</span><span className="grow" />
          {busy ? <button className="btn" onClick={() => abort.current?.abort()}>Parar</button> : <button className="btn primary" disabled={!q.trim()} onClick={() => send()}>Enviar</button>}
        </div>
      </div>
    </aside>
  );
}
