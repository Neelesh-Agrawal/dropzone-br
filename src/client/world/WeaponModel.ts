import * as THREE from 'three';
import { getCarbonTexture, getNoiseTexture } from './Textures';

const matCache = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: number, roughness: number, metalness: number, bump = 0.006) {
  const key = `${color}:${roughness}:${metalness}:${bump}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness,
      map: metalness > 0.45 ? getCarbonTexture() : getNoiseTexture(),
      bumpMap: getNoiseTexture(),
      bumpScale: bump
    });
    matCache.set(key, m);
  }
  return m;
}

const glowCache = new Map<number, THREE.MeshBasicMaterial>();
function glow(color: number, opacity = 1) {
  const key = color * 100 + Math.round(opacity * 100);
  let m = glowCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
    glowCache.set(key, m);
  }
  return m;
}

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cyl(rt: number, rb: number, h: number, s: number, m: THREE.Material, x = 0, y = 0, z = 0, rx = Math.PI / 2, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, s), m);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function addPicatinnyRail(group: THREE.Group, y: number, zStart: number, zEnd: number, width: number, railMat: THREE.Material, darkMat: THREE.Material) {
  const len = Math.abs(zEnd - zStart);
  const zMid = (zStart + zEnd) * 0.5;
  group.add(box(width, 0.008, len, railMat, 0, y, zMid));
  const toothCount = Math.max(5, Math.floor(len / 0.015));
  const step = len / toothCount;
  for (let i = 0; i < toothCount; i++) {
    const tz = Math.min(zStart, zEnd) + (i + 0.5) * step;
    group.add(box(width + 0.003, 0.0045, step * 0.52, darkMat, 0, y + 0.005, tz));
  }
}

export function createWeaponModel(id = 'viper_ar', attachments: Record<string, string | null> = {}): THREE.Group {
  const root = new THREE.Group();

  const isSmg = id === 'rook_smg';
  const isShotgun = id === 'hammer_shotgun';
  const isSniper = id === 'longbow';
  const isDmr = id === 'sentinel_dmr';

  const steel = mat(isSniper ? 0x22292d : isDmr ? 0x28302d : 0x1e2326, 0.28, 0.84, 0.005);
  const bluedSteel = mat(0x121619, 0.22, 0.90, 0.004);
  const boltSteel = mat(isDmr || isSniper ? 0x8d9599 : 0x626a6e, 0.18, 0.92, 0.003);
  const bodyTone = id === 'viper_ar'
    ? 0x3b473b
    : isSmg
      ? 0x283036
      : isDmr
        ? 0x5c5342
        : isShotgun
          ? 0x4f3b2c
          : 0x303e37;
  const polymer = mat(bodyTone, 0.62, 0.16, 0.010);
  const darkPolymer = mat(0x171a1c, 0.72, 0.10, 0.012);
  const brass = mat(0xbd964c, 0.30, 0.84, 0.004);

  const recLen = isSniper ? 0.30 : isDmr ? 0.28 : isShotgun ? 0.27 : isSmg ? 0.20 : 0.25;
  const handguardLen = isSniper ? 0.30 : isDmr ? 0.26 : isShotgun ? 0.25 : isSmg ? 0.13 : 0.22;
  const barrelLen = isSniper ? 0.54 : isDmr ? 0.44 : isShotgun ? 0.39 : isSmg ? 0.20 : 0.34;
  const width = isShotgun ? 0.050 : isSmg ? 0.042 : 0.046;

  // Upper & lower receivers with chamfered crown & magwell flare
  root.add(
    box(width, 0.048, recLen, steel, 0, 0.022, -0.01),
    box(width * 0.84, 0.016, recLen * 0.96, steel, 0, 0.050, -0.01),
    box(width * 0.92, 0.042, recLen * 0.78, polymer, 0, -0.014, 0.00),
    box(width * 0.98, 0.034, 0.066, steel, 0, -0.032, -0.052, 0.08, 0, 0),
    // Trigger guard & curved trigger
    box(0.012, 0.006, 0.056, darkPolymer, 0, -0.054, 0.024),
    box(0.012, 0.028, 0.006, darkPolymer, 0, -0.040, -0.002),
    box(0.008, 0.022, 0.007, bluedSteel, 0, -0.036, 0.028, 0.38, 0, 0),
    // Fire selector & bolt catch paddles
    box(width + 0.009, 0.007, 0.020, brass, 0, -0.004, 0.042, 0.25, 0, 0),
    box(width + 0.007, 0.015, 0.010, bluedSteel, 0, 0.014, -0.032)
  );

  // Reciprocating bolt carrier & charging handle (named 'bolt' so CombatSystem animates it)
  const boltGroup = new THREE.Group();
  boltGroup.name = 'bolt';
  const ejectionPort = box(0.005, 0.019, 0.066, boltSteel, width * 0.5 + 0.001, 0.026, -0.032);
  const chargingLatch = box(0.038, 0.011, 0.020, bluedSteel, 0, 0.050, recLen * 0.45);
  boltGroup.add(ejectionPort, chargingLatch);
  if (isSniper || isDmr) {
    const boltKnobStem = cyl(0.0035, 0.0035, 0.028, 8, boltSteel, width * 0.5 + 0.012, 0.022, 0.026, 0, 0, -Math.PI * 0.38);
    const boltKnobBall = new THREE.Mesh(new THREE.SphereGeometry(0.009, 10, 10), bluedSteel);
    boltKnobBall.position.set(width * 0.5 + 0.024, 0.012, 0.026);
    boltGroup.add(boltKnobStem, boltKnobBall);
  }
  root.add(boltGroup);

  // Ergonomic contoured pistol grip (matches right hand anchor at (0, -0.1, 0.095))
  const gripGroup = new THREE.Group();
  gripGroup.position.set(0, -0.072, 0.068);
  gripGroup.rotation.x = 0.32;
  gripGroup.add(
    box(0.032, 0.102, 0.046, darkPolymer, 0, 0, 0),
    box(0.035, 0.012, 0.052, bluedSteel, 0, -0.050, 0.002)
  );
  for (let i = -2; i <= 2; i++) {
    gripGroup.add(box(0.034, 0.008, 0.034, polymer, 0, i * 0.015, -0.003));
  }
  root.add(gripGroup);

  // Handguard / Forend
  const hgZ = -recLen * 0.5 - handguardLen * 0.46;
  const barrelY = isShotgun ? 0.032 : 0.024;
  const barrelStartZ = -0.08;
  if (isShotgun) {
    root.add(
      cyl(0.013, 0.013, barrelLen, 16, bluedSteel, 0, barrelY, barrelStartZ - barrelLen * 0.5),
      cyl(0.0115, 0.0115, barrelLen * 0.88, 14, steel, 0, 0.006, barrelStartZ - barrelLen * 0.44),
      box(0.016, 0.034, 0.012, bluedSteel, 0, 0.019, barrelStartZ - barrelLen * 0.78)
    );
    const pumpGroup = new THREE.Group();
    pumpGroup.position.set(0, 0.002, hgZ - 0.02);
    pumpGroup.add(cyl(0.022, 0.021, 0.165, 12, polymer, 0, 0, 0));
    for (let i = -4; i <= 4; i++) {
      pumpGroup.add(cyl(0.024, 0.024, 0.008, 12, darkPolymer, 0, 0, i * 0.016));
    }
    root.add(pumpGroup);
  } else {
    root.add(
      box(width * 0.88, 0.046, handguardLen, polymer, 0, 0.020, hgZ),
      box(width * 0.72, 0.056, handguardLen * 0.98, steel, 0, 0.020, hgZ)
    );
    const slotCount = Math.max(3, Math.floor(handguardLen / 0.052));
    for (let i = 0; i < slotCount; i++) {
      const sz = hgZ + handguardLen * 0.36 - i * (handguardLen * 0.74 / Math.max(1, slotCount - 1));
      root.add(
        box(width * 0.93, 0.012, 0.028, bluedSteel, 0, 0.026, sz),
        box(width * 0.93, 0.010, 0.024, bluedSteel, 0, 0.006, sz)
      );
    }
    root.add(
      cyl(isSniper ? 0.0125 : 0.0105, isSniper ? 0.015 : 0.0125, barrelLen, 16, bluedSteel, 0, barrelY, barrelStartZ - barrelLen * 0.5),
      cyl(0.005, 0.005, handguardLen * 0.94, 8, boltSteel, 0, 0.038, hgZ),
      box(0.024, 0.036, 0.026, steel, 0, 0.030, hgZ - handguardLen * 0.48)
    );
  }

  // Full-length top Picatinny rail
  const railFront = isShotgun ? -0.24 : hgZ - handguardLen * 0.46;
  const railTop = 0.060;
  addPicatinnyRail(root, railTop, recLen * 0.44, railFront, width * 0.68, steel, bluedSteel);

  // Backup flip-up iron sights (folded down when an optic is equipped)
  const optic = attachments.optic;
  const hasOptic = Boolean(optic);
  const sightLift = hasOptic ? 0.008 : 0.026;
  root.add(
    box(0.025, sightLift, 0.014, bluedSteel, 0, railTop + 0.004 + sightLift * 0.5, recLen * 0.38),
    box(0.022, sightLift, 0.012, bluedSteel, 0, railTop + 0.004 + sightLift * 0.5, railFront + 0.020)
  );
  if (!hasOptic) {
    // Glowing tritium 3-dot iron sights aligned with sightHeight = 0.088
    root.add(
      box(0.0035, 0.012, 0.0035, glow(0x52f296), 0, 0.086, railFront + 0.020),
      box(0.0035, 0.009, 0.0035, glow(0x52f296), -0.007, 0.085, recLen * 0.38),
      box(0.0035, 0.009, 0.0035, glow(0x52f296), 0.007, 0.085, recLen * 0.38)
    );
  }

  // Buttstock assembly
  if (isSmg) {
    root.add(
      cyl(0.005, 0.005, 0.17, 8, steel, -width * 0.48, 0.022, 0.16),
      cyl(0.005, 0.005, 0.17, 8, steel, width * 0.48, 0.022, 0.16),
      box(0.036, 0.095, 0.020, darkPolymer, 0, 0.002, 0.24)
    );
  } else if (isSniper || isDmr) {
    root.add(
      cyl(0.013, 0.013, 0.20, 12, steel, 0, 0.022, 0.20),
      box(0.038, 0.076, 0.18, polymer, 0, 0.002, 0.21),
      box(0.042, 0.025, 0.11, darkPolymer, 0, 0.046, 0.20),
      box(0.040, 0.108, 0.024, darkPolymer, 0, -0.002, 0.30),
      cyl(0.006, 0.006, 0.052, 8, steel, 0, -0.038, 0.27, 0, 0, 0)
    );
  } else {
    root.add(
      cyl(0.013, 0.013, 0.18, 12, steel, 0, 0.024, 0.18),
      box(0.038, 0.074, 0.15, polymer, 0, 0.004, 0.20, -0.08, 0, 0),
      box(0.042, 0.022, 0.125, polymer, 0, 0.038, 0.19),
      box(0.042, 0.104, 0.022, darkPolymer, 0, -0.002, 0.27)
    );
  }

  // Magazine assembly (named 'mag' for CombatSystem reload choreography at y = -0.045)
  const mag = new THREE.Group();
  mag.name = 'mag';
  mag.position.set(0, -0.045, -0.054);
  if (!isShotgun) {
    const ext = attachments.mag === 'mag_extended';
    const qd = attachments.mag === 'mag_quickdraw';
    const magH = (isSmg ? 0.14 : isSniper || isDmr ? 0.10 : 0.13) * (ext ? 1.28 : 1);
    const magD = isSmg ? 0.030 : isSniper || isDmr ? 0.062 : 0.048;
    const magW = isSmg ? 0.022 : 0.030;
    const tilt = isSmg ? -0.18 : 0.16;
    mag.add(box(magW, magH, magD, qd ? polymer : darkPolymer, 0, -magH * 0.42, 0, tilt, 0, 0));
    for (let i = -1; i <= 1; i++) {
      mag.add(box(magW + 0.003, 0.011, magD * 0.78, steel, 0, -magH * 0.42 + i * 0.026, 0, tilt, 0, 0));
    }
    if (qd) {
      mag.add(
        box(magW + 0.004, 0.015, magD + 0.004, brass, 0, -magH * 0.62, 0, tilt, 0, 0),
        box(magW * 0.85, 0.026, 0.009, darkPolymer, 0, -magH * 0.92, 0.006)
      );
    }
  } else {
    for (let i = 0; i < 5; i++) {
      const sz = -0.055 + i * 0.022;
      root.add(
        cyl(0.006, 0.006, 0.036, 8, mat(0x9e2a24, 0.45, 0.15), width * 0.5 + 0.007, 0.020, sz, 0, 0, 0),
        cyl(0.0065, 0.0065, 0.011, 8, brass, width * 0.5 + 0.007, 0.003, sz, 0, 0, 0)
      );
    }
  }
  root.add(mag);

  // Underbarrel Grip + Side Tactical Laser Module
  if (!isShotgun) {
    root.add(
      box(0.020, 0.024, 0.066, darkPolymer, width * 0.56, 0.022, hgZ - 0.025),
      cyl(0.0045, 0.0045, 0.012, 8, brass, width * 0.58, 0.026, hgZ - 0.062)
    );
  }
  const gripType = attachments.grip;
  if (gripType === 'grip_vertical') {
    const vg = new THREE.Group();
    vg.position.set(0, -0.032, hgZ - 0.015);
    vg.add(
      box(0.028, 0.016, 0.036, steel, 0, 0.022, 0),
      cyl(0.013, 0.012, 0.080, 12, darkPolymer, 0, -0.020, 0, 0, 0, 0),
      cyl(0.0145, 0.0145, 0.011, 12, polymer, 0, -0.010, 0, 0, 0, 0),
      cyl(0.0145, 0.0145, 0.011, 12, polymer, 0, -0.034, 0, 0, 0, 0)
    );
    root.add(vg);
  } else if (gripType === 'grip_angled') {
    const ag = new THREE.Group();
    ag.position.set(0, -0.018, hgZ - 0.02);
    ag.add(
      box(0.026, 0.016, 0.094, darkPolymer, 0, 0.006, 0),
      box(0.025, 0.030, 0.066, polymer, 0, -0.010, 0.008, 0.46, 0, 0),
      box(0.026, 0.020, 0.016, darkPolymer, 0, -0.010, -0.036, -0.35, 0, 0)
    );
    root.add(ag);
  }

  // Muzzle Device + Muzzle Anchor (named 'muzzle' for flash & shell ejection)
  const muzzleBaseZ = barrelStartZ - barrelLen;
  let muzzleTipZ = muzzleBaseZ - 0.032;
  if (attachments.muzzle === 'muzzle_suppressor') {
    const supLen = isSniper || isDmr ? 0.175 : 0.135;
    root.add(
      cyl(0.018, 0.018, supLen, 16, darkPolymer, 0, barrelY, muzzleBaseZ - supLen * 0.42),
      cyl(0.0195, 0.0195, 0.022, 16, steel, 0, barrelY, muzzleBaseZ - 0.008),
      cyl(0.019, 0.019, 0.012, 16, steel, 0, barrelY, muzzleBaseZ - supLen * 0.78)
    );
    muzzleTipZ = muzzleBaseZ - supLen * 0.92;
  } else if (attachments.muzzle === 'muzzle_compensator') {
    root.add(
      box(0.026, 0.025, 0.062, bluedSteel, 0, barrelY, muzzleBaseZ - 0.022),
      box(0.030, 0.011, 0.012, polymer, 0, barrelY, muzzleBaseZ - 0.012),
      box(0.030, 0.011, 0.012, polymer, 0, barrelY, muzzleBaseZ - 0.032)
    );
    muzzleTipZ = muzzleBaseZ - 0.055;
  } else {
    root.add(
      cyl(0.013, 0.012, 0.044, 12, bluedSteel, 0, barrelY, muzzleBaseZ - 0.016),
      cyl(0.0085, 0.0085, 0.046, 10, mat(0x050708, 0.9, 0.1), 0, barrelY, muzzleBaseZ - 0.018)
    );
    muzzleTipZ = muzzleBaseZ - 0.040;
  }
  const muzzleNode = new THREE.Object3D();
  muzzleNode.name = 'muzzle';
  muzzleNode.position.set(0, barrelY, muzzleTipZ);
  root.add(muzzleNode);

  // Optical Sight Attachment + Sight Height Calculation
  let sightHeight = 0.088;
  const opticZ = -0.022;
  if (optic === 'optic_reddot') {
    const rd = new THREE.Group();
    rd.position.set(0, railTop, opticZ);
    // Open reflex housing: base mount + left/right/top protective arch + glass window + glowing dot
    rd.add(
      box(0.034, 0.012, 0.062, steel, 0, 0.006, 0),
      box(0.004, 0.028, 0.036, bluedSteel, -0.017, 0.025, -0.004),
      box(0.004, 0.028, 0.036, bluedSteel, 0.017, 0.025, -0.004),
      box(0.038, 0.004, 0.036, bluedSteel, 0, 0.039, -0.004),
      box(0.030, 0.024, 0.002, glow(0x183c44, 0.18), 0, 0.025, -0.010),
      cyl(0.0018, 0.0018, 0.002, 12, glow(0xff3824), 0, 0.025, -0.011)
    );
    root.add(rd);
    sightHeight = railTop + 0.025;
  } else if (optic === 'optic_holo') {
    const holo = new THREE.Group();
    holo.position.set(0, railTop, opticZ);
    holo.add(
      box(0.038, 0.014, 0.074, darkPolymer, 0, 0.007, 0),
      box(0.005, 0.032, 0.048, steel, -0.019, 0.028, -0.004),
      box(0.005, 0.032, 0.048, steel, 0.019, 0.028, -0.004),
      box(0.042, 0.005, 0.048, steel, 0, 0.044, -0.004),
      box(0.032, 0.026, 0.002, glow(0x18343c, 0.16), 0, 0.028, -0.008),
      cyl(0.0016, 0.0016, 0.002, 12, glow(0xff3b28), 0, 0.028, -0.009),
      box(0.043, 0.010, 0.018, brass, 0, 0.016, 0.018)
    );
    root.add(holo);
    sightHeight = railTop + 0.028;
  } else if (optic) {
    const is8x = optic === 'optic_8x';
    const is6x = optic === 'optic_6x';
    const is4x = optic === 'optic_4x';
    const scopeLen = is8x ? 0.24 : is6x ? 0.20 : is4x ? 0.155 : 0.125;
    const objR = is8x ? 0.021 : is6x ? 0.0185 : 0.016;
    const eyeR = 0.015;
    const sc = new THREE.Group();
    sc.position.set(0, railTop, opticZ);
    sc.add(
      box(0.026, 0.024, 0.020, steel, 0, 0.014, scopeLen * 0.24),
      box(0.026, 0.024, 0.020, steel, 0, 0.014, -scopeLen * 0.24),
      cyl(0.011, 0.011, scopeLen * 0.72, 16, bluedSteel, 0, 0.031, 0),
      cyl(objR, 0.012, scopeLen * 0.30, 18, bluedSteel, 0, 0.031, -scopeLen * 0.42),
      cyl(0.012, eyeR, scopeLen * 0.24, 18, bluedSteel, 0, 0.031, scopeLen * 0.40),
      cyl(objR * 0.86, objR * 0.86, 0.004, 16, glow(0x286678, 0.55), 0, 0.031, -scopeLen * 0.55),
      cyl(eyeR * 0.86, eyeR * 0.86, 0.004, 16, glow(0x1c3844, 0.65), 0, 0.031, scopeLen * 0.51),
      cyl(0.0085, 0.0085, 0.015, 12, brass, 0, 0.046, 0, 0, 0, 0),
      cyl(0.008, 0.008, 0.015, 12, steel, 0.015, 0.031, 0, 0, 0, Math.PI / 2)
    );
    if (is4x) {
      sc.add(cyl(0.0025, 0.0025, 0.066, 8, glow(0xff3b24, 0.9), 0, 0.048, -0.014));
    }
    root.add(sc);
    sightHeight = railTop + 0.031;
  }

  root.userData.sightHeight = sightHeight;
  return root;
}

export function disposeObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
    }
  });
}

