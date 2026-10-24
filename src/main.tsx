import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ReviewViewerPane,
  type CameraCommand,
  type CameraSnapshot,
  type PaneId,
  type PresetName,
  type SyncUpdate,
  type Variant,
} from './ReviewViewerPane';
import { modelStoreProbe } from './modelStore';
import './styles.css';

type Catalog = {
  title: string;
  notice: string;
  defaultComparison: { left: string; right: string };
  presentation: {
    modelScale: number;
    cameraPosition: [number, number, number];
    cameraTarget: [number, number, number];
    cameraFov: number;
    framing: string;
  };
  variants: Variant[];
};

const PRESET_LABELS: Array<[PresetName, string]> = [
  ['front', 'Przód'],
  ['quarter', '3/4'],
  ['side', 'Bok'],
  ['rear', 'Tył'],
  ['reset', 'Reset'],
];

function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [leftId, setLeftId] = useState('');
  const [rightId, setRightId] = useState('');
  const [linked, setLinked] = useState(true);
  const [activePane, setActivePane] = useState<PaneId>('A');
  const [syncUpdate, setSyncUpdate] = useState<SyncUpdate>(null);
  const [command, setCommand] = useState<CameraCommand | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [loop, setLoop] = useState(true);
  useEffect(() => {
    if (!playing) return;
    const start = performance.now(), initial = time;
    let request = 0;
    const tick = () => {
      const next = initial + (performance.now() - start) / 1000;
      if (next >= 1.89 && !loop) { setTime(1.89); setPlaying(false); return; }
      setTime(loop ? next % 1.89 : next); request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [playing, loop]);
  const sequence = useRef(0);
  const cameras = useRef<Record<PaneId, CameraSnapshot | null>>({ A: null, B: null });

  useEffect(() => {
    fetch(new URL('catalog.json', document.baseURI), { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
        return response.json();
      })
      .then((data: Catalog) => {
        setCatalog(data);
        setLeftId(data.defaultComparison.left);
        setRightId(data.defaultComparison.right);
      })
      .catch((error) => setCatalogError(error instanceof Error ? error.message : String(error)));
  }, []);

  const variantsById = useMemo(() => new Map(catalog?.variants.map((variant) => [variant.id, variant])), [catalog]);
  const left = variantsById.get(leftId);
  const right = variantsById.get(rightId);

  const handleCameraChange = useCallback((pane: PaneId, camera: CameraSnapshot, broadcast = true) => {
    cameras.current[pane] = camera;
    if (linked && broadcast) {
      sequence.current += 1;
      setSyncUpdate({ sequence: sequence.current, source: pane, camera });
    }
  }, [linked]);

  const toggleLink = () => {
    const next = !linked;
    setLinked(next);
    if (next) {
      const camera = cameras.current[activePane];
      if (camera) {
        sequence.current += 1;
        setSyncUpdate({ sequence: sequence.current, source: activePane, camera });
      }
    }
  };

  const applyPreset = (preset: PresetName) => {
    sequence.current += 1;
    setCommand({ sequence: sequence.current, targets: linked ? ['A', 'B'] : [activePane], preset });
  };

  useEffect(() => {
    (window as any).__comparisonProbe = () => {
      const paneProbes = (window as any).__reviewPaneProbes || {};
      return {
        linked,
        animation: { time, playing, loop },
        activePane,
        selected: { A: leftId, B: rightId },
        panes: { A: paneProbes.A?.() ?? null, B: paneProbes.B?.() ?? null },
        modelStore: modelStoreProbe(),
      };
    };
    return () => { delete (window as any).__comparisonProbe; };
  }, [linked, activePane, leftId, rightId, time, playing, loop]);

  if (catalogError) return <main className="fatal"><h1>Nie można uruchomić katalogu.</h1><pre>{catalogError}</pre></main>;
  if (!catalog || !left || !right) return <main className="fatal"><div className="spinner" /><p>Ładowanie katalogu wariantów…</p></main>;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">PUBLIC COMPARISON · GITHUB PAGES</p>
          <h1>{catalog.title}</h1>
          <p className="notice">{catalog.notice}</p>
        </div>
        <div className="scope-chip">2 interaktywne modele · pozostałe na żądanie</div>
      </header>

      <section className="control-bar" aria-label="Sterowanie porównaniem">
        <div className="control-group">
          <span className="control-label">Widok środka</span>
          {PRESET_LABELS.map(([preset, label]) => (
            <button key={preset} data-testid={`preset-${preset}`} onClick={() => applyPreset(preset)}>{label}</button>
          ))}
        </div>
        <div className="control-group push-right">
          <button
            className={linked ? 'link-button is-linked' : 'link-button'}
            data-testid="link-toggle"
            aria-pressed={linked}
            onClick={toggleLink}
          >
            <span aria-hidden="true">{linked ? '⛓' : '⛓‍💥'}</span>
            {linked ? 'Kamery połączone' : `Niezależne · aktywny ${activePane}`}
          </button>
          <button
            className="swap-button"
            data-testid="swap-models"
            onClick={() => { setLeftId(rightId); setRightId(leftId); }}
          >
            Zamień A ↔ B
          </button>
        </div>
      </section>

      <section className="control-bar" aria-label="Animacja pary">
        <button data-testid="animation-start" onClick={() => { setPlaying(false); setTime(0); }}>Start</button>
        <button data-testid="animation-play" onClick={() => { if (time >= 1.89) setTime(0); setPlaying(!playing); }}>{playing ? 'Pauza' : 'Odtwórz'}</button>
        <input data-testid="animation-time" aria-label="Czas animacji" type="range" min="0" max="1.89" step=".01" value={time} onChange={e => { setPlaying(false); setTime(Number(e.target.value)); }} style={{ flex: 1 }} />
        <span>{time.toFixed(2)} / 1.89 s</span>
        <label><input data-testid="animation-loop" type="checkbox" checked={loop} onChange={e => setLoop(e.target.checked)} /> Pętla</label>
      </section>
      <section className="comparison-grid">
        <ReviewViewerPane
          pane="A"
          variant={left}
          variants={catalog.variants}
          modelScale={catalog.presentation.modelScale}
          time={time}
          active={activePane === 'A'}
          syncUpdate={syncUpdate}
          command={command}
          onActivate={setActivePane}
          onVariantChange={setLeftId}
          onCameraChange={handleCameraChange}
        />
        <ReviewViewerPane
          pane="B"
          variant={right}
          variants={catalog.variants}
          modelScale={catalog.presentation.modelScale}
          time={time}
          active={activePane === 'B'}
          syncUpdate={syncUpdate}
          command={command}
          onActivate={setActivePane}
          onVariantChange={setRightId}
          onCameraChange={handleCameraChange}
        />
      </section>

      <aside className="usage-note">
        <strong>Porównywalne kadrowanie:</strong> {catalog.presentation.framing} Przeciągnij, aby obracać; kółko/pinch zmienia zoom. Zmiana modelu lub „Zamień A ↔ B” nie resetuje kamery.
      </aside>

      <section className="catalog-section">
        <div className="catalog-heading">
          <div><p className="eyebrow">NAMED VARIANT CATALOG</p><h2>Warianty i status</h2></div>
          <p>Karta nie ładuje modelu 3D. Użyj A/B, aby załadować wybrany wariant do jednego z dwóch paneli.</p>
        </div>
        <div className="catalog-grid">
          {catalog.variants.map((variant) => (
            <article className="variant-card" key={variant.id} data-testid={`card-${variant.id}`}>
              <img src={variant.thumbnailUrl} alt="" loading="lazy" />
              <div className="variant-card-body">
                <span className={`status status-${variant.statusTone}`}>{variant.status}</span>
                <h3>{variant.name}</h3>
                <p>{variant.description}</p>
                <small>{variant.triangles.toLocaleString('pl-PL')} trójkątów</small>
                <div className="card-actions">
                  <button onClick={() => { setLeftId(variant.id); setActivePane('A'); }}>Pokaż w A</button>
                  <button onClick={() => { setRightId(variant.id); setActivePane('B'); }}>Pokaż w B</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <footer className="page-footer">
        Porównywarka modeli: nieruchome napisy i animacja STEP. Publiczny podgląd, nie integracja z aplikacją. Wygląd wersji 3D i plików web nadal do oceny.
      </footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
