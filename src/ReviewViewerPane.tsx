import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { GLTF } from 'three-stdlib';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { acquireModel, requestModelRetry, subscribeModelRetry } from './modelStore';

export type PaneId = 'A' | 'B';
export type CameraSnapshot = { position: [number, number, number]; target: [number, number, number] };
export type PresetName = 'front' | 'quarter' | 'side' | 'rear' | 'reset';
export type CameraCommand = { sequence: number; targets: PaneId[]; preset: PresetName };
export type SyncUpdate = { sequence: number; source: PaneId; camera: CameraSnapshot } | null;

export type Variant = {
  id: string;
  name: string;
  shortName: string;
  status: string;
  statusTone: string;
  description: string;
  triangles: number;
  modelUrl: string;
  thumbnailUrl: string;
  artifactScope: string;
};

type LoadState =
  | { kind: 'loading'; progress: number | null }
  | { kind: 'loaded' }
  | { kind: 'error'; message: string };

const DEFAULT_CAMERA: CameraSnapshot = { position: [0, 0, 3.5], target: [0, 0, 0] };
const PRESETS: Record<PresetName, CameraSnapshot> = {
  front: DEFAULT_CAMERA,
  quarter: { position: [-2.47, .65, 2.47], target: [0, 0, 0] },
  side: { position: [-3.5, .3, .01], target: [0, 0, 0] },
  rear: { position: [0, .3, -3.5], target: [0, 0, 0] },
  reset: DEFAULT_CAMERA,
};

function cloneSnapshot(camera: THREE.Camera, target: THREE.Vector3): CameraSnapshot {
  return {
    position: [camera.position.x, camera.position.y, camera.position.z],
    target: [target.x, target.y, target.z],
  };
}

function Model({ url, scale, time, pane, hud, onLoadState }: { url: string; scale: number; time: number; pane: PaneId; hud: THREE.Scene; onLoadState: (state: LoadState) => void }) {
  const [source, setSource] = useState<GLTF | null>(null);
  const [retryRevision, setRetryRevision] = useState(0);
  const { gl, invalidate } = useThree();

  useEffect(() => subscribeModelRetry(url, () => setRetryRevision((value) => value + 1)), [url]);

  useEffect(() => {
    let active = true;
    setSource(null);
    onLoadState({ kind: 'loading', progress: null });
    const progress = (loaded: number, total: number) => {
      if (!active) return;
      onLoadState({ kind: 'loading', progress: total > 0 ? loaded / total : null });
    };
    const lease = acquireModel(url, progress);
    lease.promise.then(
      (gltf) => {
        if (!active) return;
        setSource(gltf);
        onLoadState({ kind: 'loaded' });
        invalidate();
      },
      (error) => {
        if (!active) return;
        onLoadState({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    );
    return () => {
      active = false;
      lease.release();
      // Prevent a removed multi-million-triangle scene from remaining in the renderer's draw lists.
      gl.renderLists.dispose();
    };
  }, [url, retryRevision, gl, invalidate, onLoadState]);

  const scene = useMemo(() => source?.scene.clone(true) ?? null, [source]);
  const mixer = useMemo(() => scene ? new THREE.AnimationMixer(scene) : null, [scene]);
  useEffect(() => {
    if (!source || !scene || !mixer) return;
    scene.updateMatrixWorld(true);
    const labels = scene.getObjectByName('Review_Fixed_Lettering');
    if (!labels) throw Error('Missing explicit fixed-letter mesh');
    const world = scene.matrixWorld.clone().invert().multiply(labels.matrixWorld);
    labels.removeFromParent(); labels.matrixAutoUpdate = true; world.decompose(labels.position, labels.quaternion, labels.scale);
    const frame = new THREE.Group(); frame.scale.setScalar(scale); frame.add(labels); hud.add(frame);
    source.animations.forEach(clip => mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1).play());
    const registry = ((window as any).__reviewModelProbes ||= {});
    registry[pane] = () => {
      hud.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(labels);
      const points = [bounds.min.clone(), bounds.max.clone()];
      const hudCamera = (hud.userData.camera as THREE.Camera);
      return { clipCount: source.animations.length, duration: source.animations[0]?.duration, time: mixer.time,
        fixedLetterNdc: hudCamera ? points.map(p => p.project(hudCamera).toArray()) : null,
        centerCameraIndependent: true };
    };
    return () => { mixer.stopAllAction(); mixer.uncacheRoot(scene); hud.remove(frame); delete registry[pane]; };
  }, [source, scene, mixer, hud, pane, scale]);
  useFrame(() => { if (mixer && source) {
    source.animations.forEach(clip => { const action = mixer.clipAction(clip); action.enabled = true; action.paused = false; action.clampWhenFinished = true; });
    mixer.setTime(time); scene?.updateMatrixWorld(true);
  } });
  return scene ? <primitive object={scene} scale={scale} /> : null;
}

function CompositeFrame({ hud }: { hud: THREE.Scene }) {
  const { gl, scene, camera, size } = useThree();
  const hudCamera = useMemo(() => new THREE.OrthographicCamera(-1.1,1.1,1.1,-1.1,.01,100), []);
  useEffect(() => {
    const aspect = size.width / size.height;
    hudCamera.left = -1.1 * aspect; hudCamera.right = 1.1 * aspect;
    hudCamera.top = 1.1; hudCamera.bottom = -1.1;
    hudCamera.position.set(0,0,5); hudCamera.lookAt(0,0,0); hudCamera.updateProjectionMatrix(); hudCamera.updateMatrixWorld(true);
    hud.userData.camera = hudCamera;
  }, [size.width, size.height, hudCamera, hud]);
  useFrame(() => {
    gl.info.autoReset = false; gl.info.reset(); gl.autoClear = false;
    gl.clear(); gl.render(scene, camera); gl.clearDepth(); gl.render(hud, hudCamera);
    gl.autoClear = true;
  }, 1);
  return null;
}

function PaneScene({
  pane,
  variant,
  time,
  scale,
  syncUpdate,
  command,
  onCameraChange,
  onLoadState,
}: {
  pane: PaneId;
  variant: Variant;
  time: number;
  scale: number;
  syncUpdate: SyncUpdate;
  command: CameraCommand | null;
  onCameraChange: (pane: PaneId, camera: CameraSnapshot, broadcast?: boolean) => void;
  onLoadState: (state: LoadState) => void;
}) {
  const hud = useMemo(() => new THREE.Scene(), []);
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const suppressChange = useRef(false);
  const { camera, gl, invalidate, scene } = useThree();

  const applyCamera = (snapshot: CameraSnapshot) => {
    const controls = controlsRef.current;
    if (!controls) return;
    suppressChange.current = true;
    camera.position.fromArray(snapshot.position);
    controls.target.fromArray(snapshot.target);
    controls.update();
    onCameraChange(pane, snapshot, false);
    invalidate();
    queueMicrotask(() => { suppressChange.current = false; });
  };

  useEffect(() => {
    if (syncUpdate && syncUpdate.source !== pane) applyCamera(syncUpdate.camera);
  }, [syncUpdate?.sequence, pane]);

  useEffect(() => {
    if (command?.targets.includes(pane)) applyCamera(PRESETS[command.preset]);
  }, [command?.sequence, pane]);

  useEffect(() => {
    const probe = () => {
      const controls = controlsRef.current;
      const context = gl.getContext();
      return {
        pane,
        variantId: variant.id,
        camera: controls ? cloneSnapshot(camera, controls.target) : null,
        triangles: gl.info.render.triangles,
        drawCalls: gl.info.render.calls,
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
        contextLost: context.isContextLost(),
        canvas: [gl.domElement.width, gl.domElement.height],
        animation: (window as any).__reviewModelProbes?.[pane]?.() ?? null,
      };
    };
    const registry = ((window as any).__reviewPaneProbes ||= {});
    registry[pane] = probe;
    return () => { delete registry[pane]; };
  }, [pane, variant.id, camera, gl, scene]);

  return (
    <>
      <color attach="background" args={['#ffffff']} />
      <ambientLight intensity={0.9} />
      <directionalLight position={[3, 4, 5]} intensity={2.2} />
      <directionalLight position={[-4, -1, -3]} intensity={0.7} />
      <Model url={variant.modelUrl} pane={pane} hud={hud} time={time} scale={scale} onLoadState={onLoadState} />
      <CompositeFrame hud={hud} />
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping={false}
        enablePan={false}
        enableZoom
        enableRotate
        minDistance={1.15}
        maxDistance={6}
        onChange={() => {
          const controls = controlsRef.current;
          if (!controls || suppressChange.current) return;
          onCameraChange(pane, cloneSnapshot(camera, controls.target));
        }}
      />
    </>
  );
}

export function ReviewViewerPane({
  pane,
  variant,
  variants,
  modelScale,
  time,
  active,
  syncUpdate,
  command,
  onActivate,
  onVariantChange,
  onCameraChange,
}: {
  pane: PaneId;
  variant: Variant;
  variants: Variant[];
  modelScale: number;
  time: number;
  active: boolean;
  syncUpdate: SyncUpdate;
  command: CameraCommand | null;
  onActivate: (pane: PaneId) => void;
  onVariantChange: (id: string) => void;
  onCameraChange: (pane: PaneId, camera: CameraSnapshot, broadcast?: boolean) => void;
}) {
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading', progress: null });
  const stableLoadState = useMemo(() => setLoadState, []);

  return (
    <section className={`viewer-pane ${active ? 'is-active' : ''}`} data-testid={`pane-${pane}`} onPointerDown={() => onActivate(pane)}>
      <header className="pane-header">
        <div className="pane-letter">{pane}</div>
        <div className="pane-title">
          <label htmlFor={`variant-${pane}`}>Model w panelu {pane}</label>
          <select
            id={`variant-${pane}`}
            data-testid={`selector-${pane}`}
            value={variant.id}
            onChange={(event) => onVariantChange(event.target.value)}
          >
            {variants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        <span className={`status status-${variant.statusTone}`}>{variant.status}</span>
      </header>
      <div className="canvas-wrap" data-active={active ? 'true' : 'false'}>
        <Canvas
          frameloop="always"
          dpr={1}
          camera={{ position: DEFAULT_CAMERA.position, fov: 35, near: 0.01, far: 100 }}
          gl={{ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' }}
          tabIndex={-1}
          onCreated={({ gl }) => { gl.domElement.dataset.pane = pane; gl.domElement.tabIndex = -1; }}
        >
          <PaneScene
            pane={pane}
            variant={variant}
            time={time}
            scale={modelScale}
            syncUpdate={syncUpdate}
            command={command}
            onCameraChange={onCameraChange}
            onLoadState={stableLoadState}
          />
        </Canvas>
        {loadState.kind === 'loading' && (
          <div className="load-overlay" role="status" data-testid={`loading-${pane}`}>
            <span className="spinner" />
            <strong>Ładowanie: {variant.shortName}</strong>
            <small>{loadState.progress === null ? 'Przygotowanie ciężkiego modelu…' : `${Math.round(loadState.progress * 100)}%`}</small>
          </div>
        )}
        {loadState.kind === 'error' && (
          <div className="load-overlay error" role="alert" data-testid={`error-${pane}`}>
            <strong>Nie udało się wczytać modelu.</strong>
            <small>{loadState.message}</small>
            <button onClick={() => requestModelRetry(variant.modelUrl)}>Spróbuj ponownie</button>
          </div>
        )}
      </div>
      <footer className="pane-footer">
        <span>{variant.triangles.toLocaleString('pl-PL')} trójkątów</span>
        <span>{variant.artifactScope}</span>
      </footer>
    </section>
  );
}
