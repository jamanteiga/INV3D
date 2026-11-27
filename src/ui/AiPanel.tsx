// Panel del asistente IA (Gemini, ChatGPT, Claude, Perplexity u otra compatible con OpenAI), a la derecha de Propiedades. F1 o botón «IA».
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../core/store';
import { runTurn, trimHistory, type ChatMsg } from '../ai/assistant';
import { PROVIDERS, aiCfg, provInfo, listModelsFor, connReady, type ProvId, type Msg } from '../ai/providers';

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
  const [prov, setProv] = useState<ProvId>(aiCfg.provider());
  const info = provInfo(prov);
  const [key, setKey] = useState(aiCfg.key(prov));
  const [base, setBase] = useState(aiCfg.base(prov));
  const [keyIn, setKeyIn] = useState('');
  const [baseIn, setBaseIn] = useState(aiCfg.base(prov));
  const [models, setModels] = useState<{ id: string; label: string }[]>([]);
  const [model, setModel] = useState(aiCfg.model(prov) || info.defModel);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [hist, setHist] = useState<Msg[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [img, setImg] = useState<{ mimeType: string; data: string; name: string } | null>(null);
  const [auto, setAuto] = useState(() => { try { return localStorage.getItem(AUTO_LS) === '1'; } catch { return false; } });
  const [ask, setAsk] = useState<{ title: string; detail: string; res: (ok: boolean) => void } | null>(null);
  const conn = { prov, key, model, base };
  const ready = connReady(conn);
  const [showCfg, setShowCfg] = useState(!ready);
  const abort = useRef<AbortController | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  // dictado por voz (Web Speech API: Chrome, Edge, Safari)
  const [mic, setMic] = useState(false);
  const [micSend, setMicSend] = useState(() => { try { return localStorage.getItem('inv3d.ai.micsend') !== '0'; } catch { return true; } });
  const rec = useRef<{ stop: () => void } | null>(null);
  const SR = (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;

  const loadModels = (p: ProvId, k: string, b: string, keep = true) => listModelsFor({ prov: p, key: k, base: b }).then((m) => {
    setModels(m);
    const cur = aiCfg.model(p) || provInfo(p).defModel;
    const pick = keep && cur && (m.some((x) => x.id === cur) || !m.length) ? cur : m[0]?.id ?? cur;
    setModel(pick); aiCfg.setModel(p, pick);
    return m;
  });
  useEffect(() => { if (open && (key || info.keyOptional) && (!info.needsBase || base) && !models.length) loadModels(prov, key, base).catch((e) => push({ role: 'error', text: (e as Error).message })); }, [open, prov, key, base]);
  useEffect(() => { list.current?.scrollTo({ top: 1e9, behavior: 'smooth' }); }, [msgs, ask]);
  useEffect(() => { if (open) setTimeout(() => ta.current?.focus(), 50); }, [open]);
  if (!open) return null;

  const push = (m: ChatMsg) => setMsgs((x) => [...x, m]);
  const switchProv = (p: ProvId) => {
    aiCfg.setProvider(p); setProv(p); setKey(aiCfg.key(p)); setBase(aiCfg.base(p)); setBaseIn(aiCfg.base(p)); setModels([]); setModel(aiCfg.model(p) || provInfo(p).defModel); setKeyIn('');
    setHist([]); // cada proveedor guarda la conversación a su manera: se empieza de nuevo
  };
  const saveKey = async () => {
    const k = keyIn.trim(), b = baseIn.trim().replace(/\/+$/, '');
    if (!k && !info.keyOptional) return;
    if (info.needsBase && !b) { push({ role: 'error', text: 'Indica la URL base del servicio (p. ej. https://api.deepseek.com/v1)' }); return; }
    try {
      if (info.needsBase) aiCfg.setBase(prov, b);
      const m = await loadModels(prov, k, b || base, false).catch((e) => { if (prov === 'custom') return [] as { id: string; label: string }[]; throw e; });
      aiCfg.setKey(prov, k); setKey(k); if (info.needsBase) setBase(b); setKeyIn(''); setShowCfg(!m.length && !model);
      push({ role: 'model', text: `Conectado a **${info.label}**${m.length ? ` · ${m.length} modelos` : ''}${m.length || model ? ` · usando **${aiCfg.model(prov) || model}**` : ' · escribe el nombre del modelo'}.` });
    } catch (e) { push({ role: 'error', text: (e as Error).message }); }
  };
  const confirm = (title: string, detail: string) => auto ? Promise.resolve(true) : new Promise<boolean>((res) => setAsk({ title, detail, res: (ok) => { setAsk(null); res(ok); } }));
  const send = async (text = q) => {
    const t = text.trim(); if (!t || busy) return;
    if (!ready) { setShowCfg(true); push({ role: 'error', text: `Configura antes ${info.label} (⚙): clave${info.needsBase ? ', URL' : ''} y modelo` }); return; }
    setQ(''); push({ role: 'user', text: t + (img ? `  [adjunto: ${img.name}]` : '') });
    setBusy(true); abort.current = new AbortController();
    try {
      const h = await runTurn({ conn, history: hist, question: t, image: img ?? undefined, confirm, onMsg: push, signal: abort.current.signal });
      setHist(trimHistory(h)); setImg(null);
    } catch (e) { if ((e as Error).name !== 'AbortError') push({ role: 'error', text: (e as Error).message }); }
    setBusy(false);
  };
  const pickImg = () => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*,application/pdf';
    i.onchange = () => { const f = i.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => setImg({ mimeType: f.type, data: String(r.result).split(',')[1], name: f.name }); r.readAsDataURL(f); };
    i.click();
  };
  const toggleMic = () => {
    if (mic) { rec.current?.stop(); return; }
    if (!SR) { push({ role: 'error', text: 'Este navegador no tiene reconocimiento de voz: usa Chrome o Edge, o el dictado del sistema (Windows: Win+H · macOS: Fn dos veces)' }); return; }
    const r = new SR() as { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: (e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void; onend: () => void; onerror: (e: { error: string }) => void };
    r.lang = 'es-ES'; r.interimResults = true; r.continuous = false;
    const prefix = q ? q.replace(/\s*$/, ' ') : '';
    let fin = '';
    r.onresult = (e) => { let inter = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) fin += t; else inter += t; } setQ(prefix + fin + inter); };
    r.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') push({ role: 'error', text: e.error === 'not-allowed' ? 'Permiso de micrófono denegado: actívalo en el candado de la barra de direcciones' : `Voz: ${e.error}` }); };
    r.onend = () => { setMic(false); rec.current = null; const t = (prefix + fin).trim(); if (t && micSend) void send(t); else ta.current?.focus(); };
    rec.current = r; setMic(true); r.start();
  };
  const close = () => { rec.current?.stop(); useStore.setState({ aiOpen: false }); };
  const shortModel = model.replace(/^models\//, '');

  return (
    <aside className="ai-panel" onKeyDown={(e) => e.stopPropagation()}>
      <div className="ai-head">
        <b>Asistente IA</b>
        <select className="ai-prov" value={prov} title="Proveedor de IA" onChange={(e) => switchProv(e.target.value as ProvId)}>
          {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}{aiCfg.key(p.id) || (p.keyOptional && aiCfg.base(p.id)) ? ' ✓' : ''}</option>)}
        </select>
        <span className="grow" />
        <button className="ai-ib" title="Configuración (proveedor, clave y modelo)" onClick={() => setShowCfg(!showCfg)}>⚙</button>
        <button className="ai-ib" title="Nueva conversación" onClick={() => { setMsgs([]); setHist([]); }}>⟲</button>
        <button className="ai-ib" title="Cerrar (F1)" onClick={close}>×</button>
      </div>
      {showCfg && (
        <div className="ai-cfg">
          <div className="phelp" style={{ margin: 0 }}><b>{info.label}</b>: {info.keyUrl ? <a href={info.keyUrl} target="_blank" rel="noreferrer">{info.keyHelp}</a> : info.keyHelp}. La clave se guarda solo en este navegador; no va a los ficheros ni a la configuración exportada.</div>
          {!info.tools && <div className="ai-msg act" style={{ margin: 0 }}>Con {info.label} el asistente responde y busca en la web, pero no puede crear ni modificar piezas ni ensamblajes.</div>}
          {info.needsBase && <div className="ai-row">URL base <input value={baseIn} placeholder="https://api.deepseek.com/v1" onChange={(e) => setBaseIn(e.target.value)} style={{ flex: 1 }} /></div>}
          {key ? <div className="ai-row">Clave guardada en este navegador <span className="grow" /><button className="btn" onClick={() => { aiCfg.setKey(prov, ''); setKey(''); setModels([]); }}>Quitar</button>{info.needsBase && baseIn !== base && <button className="btn" onClick={() => { aiCfg.setBase(prov, baseIn); setBase(baseIn.replace(/\/+$/, '')); setModels([]); }}>Guardar URL</button>}</div>
            : <div className="ai-row"><input type="password" placeholder={`Clave de API de ${info.label}${info.keyOptional ? ' (opcional en servicios locales)' : ''}`} value={keyIn} onChange={(e) => setKeyIn(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveKey(); }} style={{ flex: 1 }} /><button className="btn primary" onClick={saveKey}>Conectar</button></div>}
          {(key || (info.keyOptional && base)) && <div className="ai-row">Modelo
            <input list="ai-models" value={shortModel} onChange={(e) => { setModel(e.target.value); aiCfg.setModel(prov, e.target.value); }} style={{ flex: 1 }} placeholder="nombre del modelo" />
            <datalist id="ai-models">{models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</datalist>
            <button className="ai-ib" title="Volver a leer la lista de modelos" onClick={() => loadModels(prov, key, base).catch((e) => push({ role: 'error', text: (e as Error).message }))}>↻</button></div>}
          <label className="check"><input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); try { localStorage.setItem(AUTO_LS, e.target.checked ? '1' : '0'); } catch { /* */ } }} />Aplicar los cambios sin preguntar (se deshacen con Ctrl+Z)</label>
          <label className="check"><input type="checkbox" checked={micSend} onChange={(e) => { setMicSend(e.target.checked); try { localStorage.setItem('inv3d.ai.micsend', e.target.checked ? '1' : '0'); } catch { /* */ } }} />🎤 Enviar al terminar de hablar</label>
        </div>
      )}
      <div className="ai-list" ref={list}>
        {!msgs.length && (
          <div className="ai-empty">
            <p>Pregunta sobre el documento abierto o pide cambios (escribe o pulsa 🎤 y habla). Ejemplos:</p>
            {['¿Por qué falla la última operación?', 'Crea una placa de 200×150×12 con 4 taladros Ø14 a 25 mm de los bordes', 'Tiende un conducto 600×400 de 2 m en X, codo hacia arriba, 1,5 m y codo hacia +Y', 'Inserta un tubo de 6" schedule 80 de 2 m con brida WN clase 150', '¿Cuántos grados de libertad le quedan a cada componente y cómo los quito?'].map((t) => <button key={t} className="ai-sugg" onClick={() => send(t)}>{t}</button>)}
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
        <textarea ref={ta} rows={3} placeholder={mic ? 'Escuchando… habla ahora' : ready ? 'Escribe o pulsa 🎤… (Intro envía, Mayús+Intro salto de línea)' : `Configura antes ${info.label} (⚙)`} value={q}
          onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } if (e.key === 'Escape') close(); }} />
        <div className="ai-row">
          <button className="ai-ib" title="Adjuntar imagen o PDF (croquis, plano…)" onClick={pickImg}>📎</button>
          <button className={`ai-ib ${mic ? 'ai-mic-on' : ''}`} title={mic ? 'Dejar de escuchar' : 'Hablar (dictado en castellano)'} onClick={toggleMic} data-testid="ai-mic">🎤</button>
          <span className="ai-sub" title={`${info.label} · ${shortModel}`}>{shortModel}</span><span className="grow" />
          {busy ? <button className="btn" onClick={() => abort.current?.abort()}>Parar</button> : <button className="btn primary" disabled={!q.trim()} onClick={() => send()}>Enviar</button>}
        </div>
      </div>
    </aside>
  );
}
