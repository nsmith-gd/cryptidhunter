import * as THREE from 'three';
import {
  pixelMaterial, gripTexture, oliveCaseTexture, gloveLeatherTexture, canvasTexture, anodizedTexture, leatheretteTexture,
} from '../art/pixelTex.js';
import { buildTorchHand, buildCameraHand, buildGoggles, buildTrailCam } from './viewmodelModels.js';

// First-person hands and held gear (#44, rebuilt #57): sculpted low-poly models (viewmodelModels.js),
// flat-shaded with pixel textures.
//   right hand  — gloved fist around the flashlight (lens glows warm while it's on; thumb clicks
//                 the switch when you toggle it);
//   left hand   — holding the camera, raised to your eye by the camera's own raise animation;
//   goggles     — swing down over your eyes when night vision turns on, and back up when off;
//   trail cam   — appears in the left hand and is pushed forward when you place one.
// Idle life: breathing, a walking bob with footstep rhythm, and a slight lag when you turn.

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Cinematic rim light for viewmodel materials only: a thin cool edge (moonlight wrapping the
 * silhouette) so hands and gear separate from the dark forest without lighting the world.
 */
function addRim(mat, color = 0x6a83a0, strength = 0.55, power = 2.6) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.rimColor = { value: new THREE.Color(color) };
    sh.uniforms.rimStrength = { value: strength };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 rimColor; uniform float rimStrength;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float rimF = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), ${power.toFixed(2)});
        rimF = floor(rimF * 3.0 + 0.5) / 3.0;           // stepped, like painted pixel highlights
        totalEmissiveRadiance += rimColor * rimF * rimStrength;`);
  };
  mat.customProgramCacheKey = () => `rim-${color}-${strength}`;
  return mat;
}

export class Viewmodel {
  constructor({ camera, player, flashlight, photo = null, nightVision = null, trailCams = null }) {
    this.camera = camera;
    this.player = player;
    this.flashlight = flashlight;
    this.photo = photo;
    this.nightVision = nightVision;
    this.t = 0;
    this.bobPhase = 0;
    this.lastYaw = player.yaw;
    this.sway = new THREE.Vector2();
    this.click = 0;
    this.goggleT = nightVision?.on ? 1 : 0;
    this.placeT = 0;

    const M = this.M = {
      glove: pixelMaterial(gloveLeatherTexture(), { flatShading: true, roughness: 0.75 }),
      sleeve: pixelMaterial(canvasTexture(), { flatShading: true }),
      metal: pixelMaterial(anodizedTexture(), { roughness: 0.35, metalness: 0.6, flatShading: true }),
      leatherette: pixelMaterial(leatheretteTexture(), { flatShading: true, roughness: 0.9 }),
      grip: pixelMaterial(gripTexture(), { flatShading: true }),
      olive: pixelMaterial(oliveCaseTexture(), { flatShading: true }),
      glass: new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.15, metalness: 0.6 }),
      lensOn: new THREE.MeshBasicMaterial({ color: 0xfff0c8 }),
      lensOff: new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.2, metalness: 0.5 }),
      red: new THREE.MeshBasicMaterial({ color: 0xc0281a }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.95, flatShading: true }),
      glassGreen: new THREE.MeshStandardMaterial({ color: 0x0c1a12, roughness: 0.1, metalness: 0.6, emissive: 0x041208 }),
    };

    for (const k of ['glove', 'sleeve', 'metal', 'leatherette', 'grip']) addRim(M[k]);
    for (const k of ['olive', 'rubber']) addRim(M[k], 0x6a83a0, 0.18);   // goggles sit right at your eyes: a softer edge

    // --- right: flashlight in a fist, at the spotlight's origin ----------------------------
    const right = this.right = new THREE.Group();
    right.name = 'viewmodel-right';
    const torchHand = buildTorchHand(M);
    right.add(torchHand);
    this.lens = torchHand.userData.lens;
    this.rightThumb = torchHand.userData.thumb;
    this.rightRest = V(0.17, -0.165, -0.33);
    camera.add(right);

    // --- left: hands the camera model to the photo camera's raise animation ---------------
    this.left = new THREE.Group();
    this.left.name = 'viewmodel-left';
    const camHand = buildCameraHand(M);
    camHand.rotation.set(0.3, 0.85, 0.12);            // held low, lens turned out to the right, as if ready to raise
    this.left.add(camHand);
    if (photo?.body) {
      // Replace the greybox block inside the photo camera's animated group with this model.
      for (const ch of [...photo.body.children]) ch.visible = false;
      photo.body.add(this.left);
    } else {
      this.left.position.set(-0.2, -0.26, -0.42);
      camera.add(this.left);
    }

    // --- goggles: swing down over the eyes (night vision) -----------------------------------
    const gog = this.goggles = new THREE.Group();
    gog.name = 'viewmodel-goggles';
    gog.add(buildGoggles(M));
    camera.add(gog);

    // --- trail camera: shown in the left hand while placing one ----------------------------
    const tc = this.trailCam = new THREE.Group();
    tc.name = 'viewmodel-trailcam';
    tc.add(buildTrailCam(M));
    tc.visible = false;
    camera.add(tc);
    if (trailCams) {
      const place = trailCams.place.bind(trailCams);
      trailCams.place = (...a) => { const r = place(...a); if (r) this.placeT = 1; return r; };
    }

    // A faint, very short-range fill so your hands read at night without lighting the world.
    this.fill = new THREE.PointLight(0x9fb0c8, 0.35, 0.7, 2);
    this.fill.position.set(0, -0.28, -0.2);
    camera.add(this.fill);
    // Warm bounce: the torch beam lighting the ground throws a little warm light back up onto
    // your hands and gear (only while it's on) - the main thing that makes them feel lit, not pasted on.
    this.bounce = new THREE.PointLight(0xffb070, 0.0, 1.1, 2);
    this.bounce.position.set(0.05, -0.45, -0.55);
    camera.add(this.bounce);
    // Goggles come down first: night vision is on at once, but for the first quarter second you
    // still see the normal view with the goggles swinging down over your eyes.
    this.lowerUntil = 0;   // real-clock time until which the goggles are still swinging down
    if (nightVision) {
      const toggle = nightVision.toggle.bind(nightVision);
      // Only a player's V press plays the swing (systems that switch it on directly get it instantly).
      let fromKey = false;
      addEventListener('keydown', (e) => { if (e.code === 'KeyV') fromKey = true; }, true);
      nightVision.toggle = (want = !nightVision.on) => {
        const was = nightVision.on;
        toggle(want);
        if (!was && nightVision.on && fromKey) { this.lowerUntil = performance.now() + 260; this.goggleT = 0; }
        fromKey = false;
      };
      const render = nightVision.render.bind(nightVision);
      nightVision.render = () => (performance.now() < this.lowerUntil ? false : render());
    }

    for (const g of [right, this.left, gog, tc]) g.traverse((m) => { if (m.isMesh) { m.renderOrder = 5; m.castShadow = false; m.frustumCulled = false; } });
    this.lastOn = flashlight.on;
  }

  update(dt) {
    this.t += dt;
    const p = this.player;
    const speed = Math.hypot(p.velocity.x, p.velocity.z);
    this.bobPhase += speed * dt * 2.2;
    const moving = Math.min(1, speed / 3) * (this.bobScale ?? 1);   // reduced camera shake (settings) damps the bob
    // Turn lag: the hands trail a little behind fast mouse turns, then settle.
    let dyaw = p.yaw - this.lastYaw; this.lastYaw = p.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    this.sway.x += (THREE.MathUtils.clamp(dyaw * 2.2, -0.05, 0.05) - this.sway.x) * Math.min(1, dt * 8);
    const breathe = Math.sin(this.t * 1.6) * 0.004;
    // Dread (#131): a tremor in your hands, on the held tools only (the view itself never shakes from
    // it; in VR the head camera is untouched too). tremor 0..1 is set from dreadFeedback each frame.
    const tr = this.tremor ?? 0;
    const shakeX = tr * 0.006 * (Math.sin(this.t * 23.1) + 0.6 * Math.sin(this.t * 37.7));
    const shakeY = tr * 0.005 * (Math.sin(this.t * 29.3 + 1.3) + 0.5 * Math.sin(this.t * 41.9));
    const shakeR = tr * 0.035 * Math.sin(this.t * 19.7 + 0.4);
    this.tremorOffset = { x: shakeX, y: shakeY, r: shakeR };
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.012 * moving;
    const bobX = Math.sin(this.bobPhase) * 0.008 * moving;

    // Flashlight: lens glows when on; the thumb clicks down when you toggle it.
    if (this.flashlight.on !== this.lastOn) { this.click = 1; this.lastOn = this.flashlight.on; }
    this.click = Math.max(0, this.click - dt * 6);
    const on = this.flashlight.on && (this.flashlight.battery ?? 1) > 0;
    this.lens.material = on ? this.M.lensOn : this.M.lensOff;
    this.rightThumb.position.y = -0.005 * Math.sin(this.click * Math.PI);   // thumb presses the switch
    this.bounce.intensity = on ? 0.55 : 0;
    const r = this.rightRest;
    this.right.position.set(r.x + bobX - this.sway.x + shakeX, r.y + breathe - bobY + shakeY, r.z);
    this.right.rotation.set(0.04 + breathe * 2 + shakeR, -0.06 + this.sway.x * 2 + shakeR * 0.6, 0.55 + bobX * 2);   // rolled so the back of the glove faces you
    this.right.visible = !this.photo?.raised && !this.nightVision?.on;
    // The beam comes out of the torch's lens (so it doesn't light up your own glove), aimed ahead.
    this.right.updateMatrix();
    this._lens = (this._lens ?? new THREE.Vector3()).set(0, 0, -0.16).applyMatrix4(this.right.matrix);
    this.flashlight.light.position.copy(this._lens);

    // Left hand idles with the same breath and bob (the photo camera moves its parent group).
    this.left.position.set(bobX * 0.8 - this.sway.x * 0.7 - shakeX * 0.9, breathe * 1.2 - bobY * 0.8 + shakeY * 1.1, 0);
    this.left.rotation.z = -shakeR * 0.8;

    // Goggles: down over the eyes while night vision is on.
    const lowering = performance.now() < this.lowerUntil || this.lowering;
    const want = lowering ? 1 : this.nightVision?.on ? 1 : 0;
    this.goggleT += (want - this.goggleT) * Math.min(1, dt * 9);
    const k = this.goggleT;
    // Visible while moving; once night vision is on, the tube view is what you see through them.
    this.goggles.visible = k > 0.02 && (!this.nightVision?.on || lowering);
    this.goggles.position.set(0, 0.16 - 0.17 * k, -0.12);
    this.goggles.rotation.x = -1.1 * (1 - k);

    // Trail camera: lifted into view, pushed forward, gone.
    this.placeT = Math.max(0, this.placeT - dt * 1.4);
    const pt = this.placeT;
    this.trailCam.visible = pt > 0;
    if (pt > 0) {
      const push = 1 - pt;                              // 0 -> 1 over the placement
      this.trailCam.position.set(-0.12, -0.2 + 0.08 * Math.sin(push * Math.PI), -0.32 - 0.25 * push);
      this.trailCam.rotation.set(0.1, 0.25, 0);
    }
  }
}
