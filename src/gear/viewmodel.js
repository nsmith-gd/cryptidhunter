import * as THREE from 'three';
import {
  pixelMaterial, gloveTexture, sleeveTexture, metalTexture, gripTexture, oliveCaseTexture,
} from '../art/pixelTex.js';

// First-person hands and held gear (#44): low-poly, pixel-textured.
//   right hand  — gloved fist around the flashlight (lens glows warm while it's on; thumb clicks
//                 the switch when you toggle it);
//   left hand   — holding the camera, raised to your eye by the camera's own raise animation;
//   goggles     — swing down over your eyes when night vision turns on, and back up when off;
//   trail cam   — appears in the left hand and is pushed forward when you place one.
// Idle life: breathing, a walking bob with footstep rhythm, and a slight lag when you turn.

const V = (x, y, z) => new THREE.Vector3(x, y, z);

function box(w, h, d, mat, x = 0, y = 0, z = 0, uv = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (uv !== 1) { const a = g.attributes.uv; for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i) * uv, a.getY(i) * uv); }
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  return m;
}

/** A gloved hand gripping something along -Z: palm block, 4 curled fingers, thumb, sleeve cuff. */
function buildHand(M, side = 1) {
  const g = new THREE.Group();
  g.add(box(0.075, 0.085, 0.05, M.glove, 0, 0, 0));                                 // palm / back of hand
  for (let i = 0; i < 4; i++) {                                                     // curled fingers wrapped round the grip
    const f = box(0.022, 0.024, 0.045, M.glove, side * 0.04, 0.03 - i * 0.022, -0.028);
    f.rotation.y = side * 0.25;
    g.add(f);
  }
  const thumb = box(0.022, 0.022, 0.05, M.glove, -side * 0.02, 0.05, -0.035);
  thumb.rotation.z = side * 0.6; thumb.name = 'thumb';
  g.add(thumb);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.16, 7), M.sleeve);
  cuff.rotation.x = Math.PI / 2; cuff.position.set(0, -0.005, 0.1);
  g.add(cuff);
  g.userData.thumb = thumb;
  return g;
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
      glove: pixelMaterial(gloveTexture()),
      sleeve: pixelMaterial(sleeveTexture()),
      metal: pixelMaterial(metalTexture(), { roughness: 0.5, metalness: 0.4 }),
      grip: pixelMaterial(gripTexture()),
      olive: pixelMaterial(oliveCaseTexture()),
      glass: new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.15, metalness: 0.6 }),
      lensOn: new THREE.MeshBasicMaterial({ color: 0xfff0c8 }),
      lensOff: new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.2, metalness: 0.5 }),
      red: new THREE.MeshBasicMaterial({ color: 0xc0281a }),
    };

    // --- right: flashlight in a fist, at the spotlight's origin ----------------------------
    const right = this.right = new THREE.Group();
    right.name = 'viewmodel-right';
    const torch = new THREE.Group();
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 8), M.grip); tube.rotation.x = Math.PI / 2;
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.026, 0.06, 8), M.metal); head.rotation.x = Math.PI / 2; head.position.z = -0.12;
    this.lens = new THREE.Mesh(new THREE.CircleGeometry(0.03, 10), M.lensOn); this.lens.position.z = -0.151; this.lens.rotation.y = Math.PI;
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.02, 8), M.metal); tail.rotation.x = Math.PI / 2; tail.position.z = 0.1;
    const button = box(0.012, 0.008, 0.016, M.red, 0, 0.024, -0.04);
    torch.add(tube, head, this.lens, tail, button);
    right.add(torch, buildHand(M, 1));
    right.children[1].position.set(0, -0.01, 0.01);
    this.rightThumb = right.children[1].userData.thumb;
    this.rightRest = V(0.2, -0.19, -0.36);
    camera.add(right);

    // --- left: hands the camera model to the photo camera's raise animation ---------------
    this.left = new THREE.Group();
    this.left.name = 'viewmodel-left';
    const cam = new THREE.Group();
    cam.add(box(0.15, 0.095, 0.065, M.metal, 0, 0, 0, 1.5));                                     // body
    cam.add(box(0.05, 0.03, 0.06, M.metal, -0.04, 0.06, 0));                                     // viewfinder hump
    const lensBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.038, 0.075, 10), M.grip);
    lensBarrel.rotation.x = Math.PI / 2; lensBarrel.position.set(0.02, 0, -0.065);
    const glass = new THREE.Mesh(new THREE.CircleGeometry(0.028, 10), M.glass); glass.position.set(0.02, 0, -0.103); glass.rotation.y = Math.PI;
    cam.add(lensBarrel, glass, box(0.02, 0.01, 0.02, M.red, 0.055, 0.052, 0.01));                // shutter button
    cam.add(box(0.012, 0.06, 0.012, M.sleeve, -0.07, 0.07, 0.02));                              // strap stub
    const hand = buildHand(M, -1);
    hand.position.set(-0.06, -0.035, 0.02); hand.rotation.z = 0.5;
    this.left.add(cam, hand);
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
    for (const s of [-1, 1]) {
      const tubeG = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.036, 0.09, 10, 1, true), M.olive);
      tubeG.rotation.x = Math.PI / 2; tubeG.position.set(s * 0.045, 0, 0);
      tubeG.material.side = THREE.DoubleSide;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.006, 4, 10), M.metal); ring.position.set(s * 0.045, 0, -0.045);
      gog.add(tubeG, ring);
    }
    gog.add(box(0.15, 0.03, 0.05, M.olive, 0, 0.04, 0.01), box(0.03, 0.06, 0.03, M.metal, 0, 0.07, 0.03));
    camera.add(gog);

    // --- trail camera: shown in the left hand while placing one ----------------------------
    const tc = this.trailCam = new THREE.Group();
    tc.name = 'viewmodel-trailcam';
    tc.add(box(0.11, 0.15, 0.07, M.olive, 0, 0, 0, 1.5));
    const tcl = new THREE.Mesh(new THREE.CircleGeometry(0.022, 10), M.glass); tcl.position.set(0, 0.025, -0.036); tcl.rotation.y = Math.PI;
    tc.add(tcl, box(0.012, 0.012, 0.01, M.red, 0.035, 0.055, -0.036), box(0.13, 0.02, 0.02, M.sleeve, 0, 0, 0.045));
    const tch = buildHand(M, -1); tch.position.set(-0.01, -0.08, 0.03); tch.rotation.x = -0.4;
    tc.add(tch);
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
    const moving = Math.min(1, speed / 3);
    // Turn lag: the hands trail a little behind fast mouse turns, then settle.
    let dyaw = p.yaw - this.lastYaw; this.lastYaw = p.yaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    this.sway.x += (THREE.MathUtils.clamp(dyaw * 2.2, -0.05, 0.05) - this.sway.x) * Math.min(1, dt * 8);
    const breathe = Math.sin(this.t * 1.6) * 0.004;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.012 * moving;
    const bobX = Math.sin(this.bobPhase) * 0.008 * moving;

    // Flashlight: lens glows when on; the thumb clicks down when you toggle it.
    if (this.flashlight.on !== this.lastOn) { this.click = 1; this.lastOn = this.flashlight.on; }
    this.click = Math.max(0, this.click - dt * 6);
    const on = this.flashlight.on && (this.flashlight.battery ?? 1) > 0;
    this.lens.material = on ? this.M.lensOn : this.M.lensOff;
    this.rightThumb.position.y = 0.05 - 0.012 * Math.sin(this.click * Math.PI);
    const r = this.rightRest;
    this.right.position.set(r.x + bobX - this.sway.x, r.y + breathe - bobY, r.z);
    this.right.rotation.set(0.04 + breathe * 2, -0.06 + this.sway.x * 2, 0.05 + bobX * 2);
    this.right.visible = !this.photo?.raised && !this.nightVision?.on;
    // The beam comes out of the torch's lens (so it doesn't light up your own glove), aimed ahead.
    this.right.updateMatrix();
    this._lens = (this._lens ?? new THREE.Vector3()).set(0, 0, -0.16).applyMatrix4(this.right.matrix);
    this.flashlight.light.position.copy(this._lens);

    // Left hand idles with the same breath and bob (the photo camera moves its parent group).
    this.left.position.set(bobX * 0.8 - this.sway.x * 0.7, breathe * 1.2 - bobY * 0.8, 0);

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
