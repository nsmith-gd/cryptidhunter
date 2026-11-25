import * as THREE from 'three';
import { samplePoints, isPartOf } from '../hunt/photoCamera.js';
import { scorePhoto, PHOTO_SCORE } from '../hunt/photoScore.js';

// Trail camera (Hunting Gear, L1): press T to set one on a stake in front of you, facing the way
// you're looking. It watches a cone and photographs any cryptid that wanders into it - you don't
// need to be anywhere near. Shots are grainy (lower score) and arrive as a notification.
export const TRAIL_CAM = {
  carried: 2,
  placeDistance: 1.2,
  halfAngle: 25,        // degrees: half of the cone it watches
  range: 15,            // metres
  height: 1.0,          // lens height on the stake
  cooldown: 6,          // seconds between triggers per camera
  maxPhotos: 12,        // per camera (memory card)
};

export class TrailCameras {
  constructor({ scene, player, input, getSubjects, onPhoto, notify = () => {} }) {
    this.scene = scene;
    this.player = player;
    this.getSubjects = getSubjects;
    this.onPhoto = onPhoto;
    this.notify = notify;
    this.carried = TRAIL_CAM.carried;
    this.cams = [];
    this.raycaster = new THREE.Raycaster();
    this.frustum = new THREE.Frustum();
    this.t = 0;
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyT' && !e.repeat && input.locked) this.place();
    });
  }

  /** Set a camera on a stake in front of the player, facing where they look. */
  place(at = null, yaw = null) {
    if (this.carried <= 0) return null;
    this.carried--;
    const p = this.player;
    const y = yaw ?? p.yaw;
    const x = at?.x ?? p.position.x - Math.sin(y) * TRAIL_CAM.placeDistance;
    const z = at?.z ?? p.position.z - Math.cos(y) * TRAIL_CAM.placeDistance;
    const id = this.cams.length + 1;
    const group = buildDevice();
    group.position.set(x, 0, z);
    group.rotation.y = y;
    group.name = `trail-camera-${id}`;
    this.scene.add(group);
    // The lens: a camera object used only to test what's in its cone.
    const lens = new THREE.PerspectiveCamera(TRAIL_CAM.halfAngle * 2, 4 / 3, 0.3, TRAIL_CAM.range);
    lens.position.set(0, TRAIL_CAM.height, -0.1);
    group.add(lens);
    const cam = { id, group, lens, x, z, yaw: y, cooldown: 1.5, photos: [], flash: 0 };
    this.cams.push(cam);
    this.notify(`Trail camera ${id} set. It photographs anything that walks into its view.`);
    return cam;
  }

  update(dt) {
    this.t += dt;
    for (const cam of this.cams) {
      cam.cooldown = Math.max(0, cam.cooldown - dt);
      cam.flash = Math.max(0, cam.flash - dt);
      const led = cam.group.userData.led;
      led.material.color.set(cam.flash > 0 ? 0xffffff : (Math.sin(this.t * 3 + cam.id) > 0.6 ? 0xff2a1a : 0x330806));
      cam.group.userData.ir.intensity = cam.flash > 0 ? 6 : 0;
      if (cam.cooldown > 0 || cam.photos.length >= TRAIL_CAM.maxPhotos) continue;
      const shot = this.evaluate(cam);
      if (shot) this.trigger(cam, shot);
    }
  }

  /** What this camera would capture right now: best subject in its cone with a clear line. */
  evaluate(cam) {
    cam.group.updateMatrixWorld(true);
    cam.lens.updateMatrixWorld();
    cam.lens.matrixWorldInverse.copy(cam.lens.matrixWorld).invert();
    const m = new THREE.Matrix4().multiplyMatrices(cam.lens.projectionMatrix, cam.lens.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(m);
    const eye = cam.lens.getWorldPosition(new THREE.Vector3());
    let best = null;
    for (const s of this.getSubjects()) {
      if (!s.object3d?.visible) continue;
      const dist = eye.distanceTo(s.center);
      if (dist > TRAIL_CAM.range + s.radius) continue;
      const pts = samplePoints(s, eye);
      const inFrame = pts.filter((p) => this.frustum.containsPoint(p));
      if (!inFrame.length) continue;
      const visible = inFrame.filter((p) => this.clearLine(eye, p, s.object3d, cam.group)).length;
      if (!visible) continue;
      if (!best || visible > best.visible) best = { subject: s.name, distance: dist, visible, samples: pts.length };
    }
    return best;
  }

  clearLine(eye, p, target, own) {
    const to = new THREE.Vector3().subVectors(p, eye);
    const dist = to.length();
    this.raycaster.set(eye, to.normalize());
    this.raycaster.far = dist - 0.05;
    this.raycaster.camera = this.player.camera ?? null;
    for (const hit of this.raycaster.intersectObjects(this.scene.children, true)) {
      const o = hit.object;
      if (!o.isMesh || !o.visible || o.isSprite) continue;
      if (o.material?.transparent || o.material?.depthTest === false) continue;
      if (isPartOf(o, target) || isPartOf(o, own)) continue;
      if (hit.point.y < 0.15 && hit.face && hit.face.normal.y > 0.9) continue;
      return false;
    }
    return true;
  }

  trigger(cam, shot) {
    cam.cooldown = TRAIL_CAM.cooldown;
    cam.flash = 0.25;
    const score = scorePhoto({ ...shot, factor: PHOTO_SCORE.trailCamFactor });
    const photo = { ...shot, score, source: `trail camera ${cam.id}`, at: this.t };
    cam.photos.push(photo);
    console.info(`[trail cam ${cam.id}] ${shot.subject} at ${shot.distance.toFixed(1)} m, score ${score}`);
    this.notify(`Trail camera ${cam.id} caught ${shot.subject}! (score ${score})`);
    this.onPhoto?.(photo);
  }

  get photos() { return this.cams.flatMap((c) => c.photos); }
}

// Greybox device: camo box on a stake, lens, blinking red LED, IR flash.
function buildDevice() {
  const g = new THREE.Group();
  const stake = new THREE.Mesh(new THREE.BoxGeometry(0.06, TRAIL_CAM.height, 0.06), new THREE.MeshStandardMaterial({ color: 0x3a2f22, roughness: 1 }));
  stake.position.y = TRAIL_CAM.height / 2;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.1), new THREE.MeshStandardMaterial({ color: 0x4a5236, roughness: 0.9 }));
  body.position.y = TRAIL_CAM.height;
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 10).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2 }));
  lens.position.set(0, TRAIL_CAM.height + 0.03, -0.06);
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.01), new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
  led.position.set(0.05, TRAIL_CAM.height + 0.08, -0.056);
  const ir = new THREE.PointLight(0xffe8e0, 0, 12, 1.5);
  ir.position.set(0, TRAIL_CAM.height, -0.3);
  for (const m of [stake, body]) m.castShadow = true;
  g.add(stake, body, lens, led, ir);
  g.userData.led = led;
  g.userData.ir = ir;
  return g;
}
