import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Palette render pass (#34): renders the scene at low resolution into a target, then draws it
// to the screen with every pixel snapped to the nearest master-palette colour, so the final
// image contains nothing but palette colours. "Nearest" is measured in luma + chroma (YUV) with
// chroma weighted up, so dark greens stay green instead of falling into a brown near-black, and
// a light 4x4 ordered dither picks between the two nearest colours where a gradient would band.

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

export class PaletteQuantizer {
  constructor(renderer, { width, height, palette = PALETTE, dither = 0.6, chroma = 3.0 } = {}) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(width, height, { magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter });
    const n = palette.length;
    const data = new Uint8Array(n * 4);
    palette.forEach((h, i) => { const [r, g, b] = hexToRgb(h); data.set([r, g, b, 255], i * 4); });
    const pal = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat);
    pal.magFilter = pal.minFilter = THREE.NearestFilter;
    pal.needsUpdate = true;
    this.material = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: this.target.texture }, tPal: { value: pal }, dither: { value: dither }, chroma: { value: chroma } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        #define N ${n}
        uniform sampler2D tScene; uniform sampler2D tPal; uniform float dither; varying vec2 vUv;
        vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
        uniform float chroma;
        vec3 yuv(vec3 c) { float y = dot(c, vec3(0.299, 0.587, 0.114)); return vec3(y, (c.b - y) * 0.565, (c.r - y) * 0.713); }
        float bayer(vec2 p) {
          int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0)); int i = x + y * 4;
          float m[16]; m[0]=0.;m[1]=8.;m[2]=2.;m[3]=10.;m[4]=12.;m[5]=4.;m[6]=14.;m[7]=6.;
          m[8]=3.;m[9]=11.;m[10]=1.;m[11]=9.;m[12]=15.;m[13]=7.;m[14]=13.;m[15]=5.;
          for (int k = 0; k < 16; k++) if (k == i) return (m[k] + 0.5) / 16.0;
          return 0.5;
        }
        void main() {
          vec3 c = toSRGB(clamp(texture2D(tScene, vUv).rgb, 0.0, 1.0));
          // Match in luma + chroma (YUV), with chroma weighted up so dark greens stay green
          // instead of collapsing into whichever near-black is closest in plain RGB.
          vec3 cy = yuv(c);
          float d1 = 1e9, d2 = 1e9; vec3 c1 = vec3(0.0), c2 = vec3(0.0);
          for (int i = 0; i < N; i++) {
            vec3 p = texture2D(tPal, vec2((float(i) + 0.5) / float(N), 0.5)).rgb;
            vec3 e = cy - yuv(p); float d = e.x * e.x + chroma * (e.y * e.y + e.z * e.z);
            if (d < d1) { d2 = d1; c2 = c1; d1 = d; c1 = p; } else if (d < d2) { d2 = d; c2 = p; }
          }
          // Ordered dither between the two nearest colours, only where they're close calls.
          float t = d1 / max(d1 + d2, 1e-6);           // 0 = exactly c1, 0.5 = halfway
          vec3 o = (t * 2.0 * dither > bayer(gl_FragCoord.xy)) ? c2 : c1;
          gl_FragColor = vec4(o, 1.0);                  // palette bytes, written as-is
        }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.screenScene = new THREE.Scene();
    this.screenScene.add(this.quad);
    this.screenCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize(width, height) { this.target.setSize(width, height); }

  render(scene, camera) {
    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.render(this.screenScene, this.screenCam);
  }
}
