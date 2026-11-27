// Barra flotante para elegir con el ratón las piezas de una unidad de montaje (longitud y peso máximos)
import { useStore } from '../core/store';
import { segCfg, unitInfo, setUnit, fitUnit } from './hvacops';

export default function UnitBar() {
  const s = useStore();
  const up = s.unitPick; if (!up) return null;
  const occs = s.selGroup ?? [];
  const u0 = up.id ? (s.asm.segUnits ?? []).find((u) => u.id === up.id) : undefined;
  const info = unitInfo({ id: 'tmp', name: '', occs });
  const cf = segCfg();
  const done = (ok: boolean) => {
    useStore.setState({ unitPick: null, selGroup: null });
    if (!ok || !occs.length) return;
    setUnit(occs, up.id, u0?.name);
    const u = (useStore.getState().asm.segUnits ?? []).find((x) => (up.id ? x.id === up.id : x.occs.length === occs.length && occs.every((o) => x.occs.includes(o))));
    if (u) setTimeout(() => fitUnit(u.id), 50);
  };
  return (
    <div className="unit-bar" onPointerDown={(e) => e.stopPropagation()}>
      <b>{u0 ? `Unidad ${u0.name}` : 'Nueva unidad de montaje'}</b>
      <span>Clic en las piezas para añadir o quitar · {occs.length} pieza(s) · {Math.round(info.len)} mm · {info.kg.toFixed(1)} kg</span>
      <span className={info.ok ? 'ok' : 'bad'}>{info.ok ? '✓' : '✗'} máx. {cf.maxL} mm / {cf.maxKg} kg ({cf.src})</span>
      <button className="btn sm primary" disabled={!occs.length} onClick={() => done(true)}>Aceptar</button>
      <button className="btn sm" onClick={() => done(false)}>Cancelar</button>
    </div>
  );
}
