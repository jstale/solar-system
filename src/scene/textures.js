// Loads textures listed in public/textures/manifest.json (written by tools/fetch-textures.mjs).
// Every texture has a default (≤2K) variant loaded up front and optionally a hi-res (≤8K)
// variant that bodies stream in when the camera gets close and release when it leaves.

import * as THREE from 'three';

export class TextureStore {
  constructor(renderer, manager) {
    this.renderer = renderer;
    this.loader = new THREE.TextureLoader(manager);
    // hi-res maps are decoded off the main thread when the browser supports it
    if (typeof createImageBitmap === 'function') {
      this.bitmapLoader = new THREE.ImageBitmapLoader();
      this.bitmapLoader.setOptions({ imageOrientation: 'flipY', premultiplyAlpha: 'none' });
    }
    this.hiLoader = new THREE.TextureLoader();
    this.manifest = {};
    this.lo = new Map();
    this.hi = new Map(); // name -> { promise, texture, users }
    this.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.maxSize = renderer.capabilities.maxTextureSize;
  }

  async init() {
    try {
      const res = await fetch('textures/manifest.json');
      this.manifest = await res.json();
    } catch {
      console.warn('No texture manifest – run `npm run textures`. Falling back to flat colours.');
      this.manifest = {};
    }
  }

  has(name) {
    return Boolean(name && this.manifest[name]);
  }

  hasHi(name) {
    return Boolean(this.manifest[name]?.hi) && this.maxSize >= 8192;
  }

  _configure(tex, color) {
    tex.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.anisotropy = this.anisotropy;
    tex.wrapS = THREE.RepeatWrapping;
    return tex;
  }

  /** Default-resolution texture (returned immediately, filled when loaded). */
  get(name, { color = true } = {}) {
    if (!this.has(name)) return null;
    const key = `${name}|${color}`;
    if (!this.lo.has(key)) {
      this.lo.set(key, this._configure(this.loader.load(this.manifest[name].lo), color));
    }
    return this.lo.get(key);
  }

  /** Hi-res texture, resolved once decoded and uploaded. Reference counted. */
  acquireHi(name, { color = true } = {}) {
    const key = `${name}|${color}`;
    let entry = this.hi.get(key);
    if (!entry) {
      entry = { users: 0, texture: null, promise: null };
      const url = this.manifest[name].hi;
      const done = (tex, resolve) => {
        this._configure(tex, color);
        this.renderer.initTexture(tex);
        entry.texture = tex;
        resolve(tex);
      };
      entry.promise = new Promise((resolve, reject) => {
        if (this.bitmapLoader) {
          this.bitmapLoader.load(
            url,
            (bitmap) => {
              const tex = new THREE.Texture(bitmap);
              tex.flipY = false; // already flipped while decoding
              tex.needsUpdate = true;
              done(tex, resolve);
            },
            undefined,
            reject,
          );
        } else {
          this.hiLoader.load(url, (tex) => done(tex, resolve), undefined, reject);
        }
      });
      this.hi.set(key, entry);
    }
    entry.users++;
    return entry.promise;
  }

  releaseHi(name, { color = true } = {}) {
    const key = `${name}|${color}`;
    const entry = this.hi.get(key);
    if (!entry) return;
    entry.users--;
    if (entry.users <= 0) {
      entry.promise
        .then((tex) => {
          tex.dispose();
          tex.image?.close?.(); // ImageBitmap
        })
        .catch(() => {});
      this.hi.delete(key);
    }
  }
}
