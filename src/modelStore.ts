import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three-stdlib';

type ProgressListener = (loaded: number, total: number) => void;
type Entry = {
  refs: number;
  promise: Promise<GLTF>;
  gltf?: GLTF;
  error?: unknown;
  listeners: Set<ProgressListener>;
  disposalTimer?: number;
  disposeWhenSettled?: boolean;
  abort?: () => void;
};

const entries = new Map<string, Entry>();
const diagnostics = { loads: 0, disposals: 0, disposedUrls: [] as string[] };
const RETRY_EVENT = 'figurine-model-retry';

function startLoad(url: string, entry: Entry): void {
  const manager = new THREE.LoadingManager();
  const draco = new DRACOLoader(manager);
  draco.setDecoderPath(new URL('draco/', document.baseURI).href);
  const loader = new GLTFLoader(manager);
  loader.setDRACOLoader(draco);
  entry.gltf = undefined;
  entry.error = undefined;
  entry.disposeWhenSettled = false;
  entry.abort = () => manager.abort();
  diagnostics.loads += 1;
  entry.promise = new Promise<GLTF>((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        entry.gltf = gltf;
        entry.abort = undefined;
        draco.dispose();
        resolve(gltf);
        if (entry.disposeWhenSettled) window.setTimeout(() => disposeEntry(url, entry), 0);
      },
      (event) => entry.listeners.forEach((listener) => listener(event.loaded, event.total)),
      (error) => {
        entry.error = error;
        entry.abort = undefined;
        draco.dispose();
        reject(error);
        if (entry.disposeWhenSettled) window.setTimeout(() => disposeEntry(url, entry), 0);
      }
    );
  });
  // A rejected loader promise remains observable by the component and retry UI.
  entry.promise.catch(() => undefined);
}

function createEntry(url: string): Entry {
  const entry = { refs: 0, listeners: new Set<ProgressListener>() } as Entry;
  startLoad(url, entry);
  return entry;
}

function disposeGLTF(gltf: GLTF): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const imageSources = new Set<{ close?: () => void }>();
  gltf.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    meshMaterials.filter(Boolean).forEach((material) => materials.add(material));
  });
  materials.forEach((material) => {
    Object.values(material).forEach((value) => {
      if (value instanceof THREE.Texture) textures.add(value);
    });
  });
  textures.forEach((texture) => {
    const source = texture.source?.data as { close?: () => void } | undefined;
    if (source) imageSources.add(source);
    texture.dispose();
  });
  imageSources.forEach((source) => source.close?.());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
}

function disposeEntry(url: string, entry: Entry): void {
  if (entry.refs !== 0) return;
  if (!entry.gltf && !entry.error) {
    entry.disposeWhenSettled = true;
    entry.abort?.();
    return;
  }
  if (entry.gltf) disposeGLTF(entry.gltf);
  if (entries.get(url) === entry) entries.delete(url);
  diagnostics.disposals += 1;
  diagnostics.disposedUrls.push(url);
}

export function acquireModel(url: string, onProgress: ProgressListener) {
  let entry = entries.get(url);
  if (!entry) {
    entry = createEntry(url);
    entries.set(url, entry);
  }
  if (entry.disposalTimer !== undefined) window.clearTimeout(entry.disposalTimer);
  entry.disposalTimer = undefined;
  entry.disposeWhenSettled = false;
  entry.refs += 1;
  entry.listeners.add(onProgress);
  let released = false;
  return {
    promise: entry.promise,
    release: () => {
      if (released) return;
      released = true;
      releaseEntry(url, entry, onProgress);
    },
  };
}

function releaseEntry(url: string, entry: Entry, onProgress: ProgressListener): void {
  entry.listeners.delete(onProgress);
  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs !== 0) return;
  if (entry.error) {
    disposeEntry(url, entry);
    return;
  }
  // The short grace avoids aborting A/B swaps while still cancelling abandoned downloads.
  entry.disposalTimer = window.setTimeout(() => disposeEntry(url, entry), 350);
}

export function requestModelRetry(url: string): void {
  const failed = entries.get(url);
  if (!failed?.error) return;
  entries.delete(url);
  window.dispatchEvent(new CustomEvent(RETRY_EVENT, { detail: url }));
}

export function subscribeModelRetry(url: string, listener: () => void): () => void {
  const handler = (event: Event) => {
    if ((event as CustomEvent<string>).detail === url) listener();
  };
  window.addEventListener(RETRY_EVENT, handler);
  return () => window.removeEventListener(RETRY_EVENT, handler);
}

export function modelStoreProbe() {
  return {
    loads: diagnostics.loads,
    disposals: diagnostics.disposals,
    disposedUrls: [...diagnostics.disposedUrls],
    entries: Array.from(entries, ([url, entry]) => ({
      url,
      refs: entry.refs,
      state: entry.gltf ? 'loaded' : entry.error ? 'error' : 'loading',
    })),
  };
}

(window as any).__modelStoreProbe = modelStoreProbe;
