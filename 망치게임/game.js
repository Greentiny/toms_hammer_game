/**
 * 도마뱀 톰 항아리 게임
 * 현재 단계: 세로 월드 + 배경 + 카메라 + 관절형 플레이어 + 망치 부착
 *
 * 좌표계 (Matter.js / Canvas와 동일한 Y-down)
 * - 월드 원점 (0, 0): 맵 왼쪽 위 (우주 / 3단계 끝)
 * - Y가 커질수록 아래로 (지상 / 1단계 시작)
 */

const GameState = {
  MENU: "MENU",
  PLAYING: "PLAYING",
  STAGE_CLEAR: "STAGE_CLEAR",
  ENDING: "ENDING",
  GAME_END: "GAME_END",
};

const ASSETS = {
  background: "assets/background/background-long.png",
  player: {
    box: "assets/player/box.png",
    body: "assets/player/body.png",
    head: "assets/player/head.png",
    tail: "assets/player/tail.png",
    leftArm1: "assets/player/left-arm1.png",
    leftArm2: "assets/player/left-arm2.png",
    leftHand: "assets/player/left-hand.png",
    rightArm1: "assets/player/right-arm1.png",
    rightArm2: "assets/player/right-arm2.png",
    rightHand: "assets/player/right-hand.png",
    hammer: "assets/player/hammer.png",
  },
};

/** 논리 스프라이트 공간 (구 1024 레이아웃). 더 큰 PNG는 이 크기로 맞춰 그림 */
const SPRITE = 1024;

const CONFIG = {
  cameraKeySpeed: 900,
  cameraWheelStep: 80,
  cameraLerp: 8,
  backgroundBlur: 3,
  backgroundDim: 0.28,
  showDebugHud: true,
  /** false면 카메라가 플레이어를 따라감 */
  freeCamera: false,
  /** 플레이어 표시 스케일. 캐릭터·박스·망치가 한 화면에 들어오게 작게 */
  playerScale: 0.2,
  /** 손 스프라이트 배율. 양손이 포개져도 손잡이를 덮을 정도 */
  handScale: 0.5,
  /**
   * 팔 굵기. 길이 축은 뼈 길이에 고정하고, 수직 방향만 키운다.
   * 1이면 에셋 비율 그대로.
   */
  armThickness: 1.55,
  /** 관절 양끝으로 스프라이트를 겹쳐 틈이 보이지 않게 하는 비율 */
  jointOverlap: 0.2,
  /** 망치 스프라이트 배율 (그립 위치도 같이 커짐) */
  hammerScale: 1.32,
  skin: "rgb(140, 189, 117)",
};

const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");
const debugHud = document.getElementById("debug-hud");

/** @type {Record<string, HTMLImageElement>} */
const images = {};

const world = {
  width: 0,
  height: 0,
  scale: 1,
};

const camera = {
  x: 0,
  y: 0,
  targetX: 0,
  targetY: 0,
};

const input = {
  keys: new Set(),
  /** 스크린 좌표 */
  mouseX: 0,
  mouseY: 0,
  mouseInView: false,
  dragActive: false,
  lastDragX: 0,
  lastDragY: 0,
};

/**
 * 캐릭터 스프라이트 공간 기준점
 * - origin: 박스 바닥 중앙 → 월드 player.x/y 에 대응
 * - 파츠 bounds는 에셋 분석값
 */
const RIG = {
  originX: 533,
  originY: 978,
  /** 상체 좌우. 팔이 서로 겹쳐 한 팔처럼 보이지 않게 벌린다. */
  shoulderL: { x: 450, y: 425 },
  shoulderR: { x: 605, y: 415 },
  /** 도끼가 몸을 중심으로 도는 기준점. 손은 여기 고정되지 않는다. */
  hammerPivot: { x: 524, y: 470 },
  /**
   * 망치 이미지 로컬 좌표 (1024). 나무 손잡이는 대략 y 300–870.
   * 회전축은 자루 끝이라 손이 몸에서 멀리 나가고, 팔이 그곳까지 뻗는다.
   * 양손 그립은 나무 손잡이 길이의 한가운데.
   */
  hammer: {
    pivotX: 608,
    pivotY: 850,
    headX: 488,
    headY: 128,
    gripFront: { x: 576, y: 568 },
    gripBack: { x: 580, y: 604 },
  },
  /**
   * 2048 에셋에서 측정한 팔 중심선 양끝.
   * 오른쪽 이미지는 왼쪽과 동일한 파일이라 같은 앵커를 쓴다.
   */
  limbs: {
    upper: { ax: 1037, ay: 1059, bx: 1310, by: 779, radius: 64 },
    lower: { ax: 746, ay: 1277, bx: 1045, by: 1053, radius: 62 },
    hand: { palmX: 663, palmY: 1313, axis: -1.103 },
  },
  /** 스프라이트 픽셀 기준 뼈 길이. 화면에서는 player.scale 을 곱함 */
  armLen: {
    upper: 270,
    lower: 250,
  },
};

const player = {
  x: 0,
  y: 0,
  scale: CONFIG.playerScale,
  /**
   * 망치 각도 (캔버스, Y-down, 시계방향+)
   * 0 = 돌머리가 위, PI/2 = 오른쪽, PI = 아래
   */
  hammerAngle: 0,
  targetHammerAngle: 0,
  /** 어깨 중앙에서 손잡이까지의 거리. 마우스가 멀수록 커진다. */
  aim: -Math.PI / 2,
  gripDist: 90,
  /** 이전 프레임 팔꿈치. 꺾임 방향이 갑자기 뒤집히지 않게 유지 */
  arms: {
    left: null,
    right: null,
  },
};

let gameState = GameState.PLAYING;
let lastTime = 0;
let dpr = 1;

// ---------------------------------------------------------------------------
// 좌표 변환
// ---------------------------------------------------------------------------

function worldToScreen(worldX, worldY) {
  return { x: worldX - camera.x, y: worldY - camera.y };
}

function screenToWorld(screenX, screenY) {
  return { x: screenX + camera.x, y: screenY + camera.y };
}

function getViewportSize() {
  return {
    width: canvas.width / dpr,
    height: canvas.height / dpr,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampCameraTarget() {
  const { width: vw, height: vh } = getViewportSize();
  camera.targetX = clamp(camera.targetX, 0, Math.max(0, world.width - vw));
  camera.targetY = clamp(camera.targetY, 0, Math.max(0, world.height - vh));
}

function clampCamera() {
  const { width: vw, height: vh } = getViewportSize();
  camera.x = clamp(camera.x, 0, Math.max(0, world.width - vw));
  camera.y = clamp(camera.y, 0, Math.max(0, world.height - vh));
}

function focusCameraOn(worldX, worldY, options = {}) {
  const { width: vw, height: vh } = getViewportSize();
  const deadZoneX = options.deadZoneX ?? vw * 0.18;
  const deadZoneY = options.deadZoneY ?? vh * 0.22;
  const screen = worldToScreen(worldX, worldY);
  const centerX = vw / 2;
  const centerY = vh / 2;

  if (screen.x < centerX - deadZoneX) {
    camera.targetX -= centerX - deadZoneX - screen.x;
  } else if (screen.x > centerX + deadZoneX) {
    camera.targetX += screen.x - (centerX + deadZoneX);
  }

  if (screen.y < centerY - deadZoneY) {
    camera.targetY -= centerY - deadZoneY - screen.y;
  } else if (screen.y > centerY + deadZoneY) {
    camera.targetY += screen.y - (centerY + deadZoneY);
  }

  clampCameraTarget();
  if (options.snap) {
    camera.x = camera.targetX;
    camera.y = camera.targetY;
  }
}

/** 스프라이트 좌표 → 월드 좌표 */
function spriteToWorld(sx, sy) {
  return {
    x: player.x + (sx - RIG.originX) * player.scale,
    y: player.y + (sy - RIG.originY) * player.scale,
  };
}

// ---------------------------------------------------------------------------
// 월드 / 배경
// ---------------------------------------------------------------------------

function rebuildWorldFromBackground() {
  const bg = images.background;
  if (!bg) return;
  const { width: vw } = getViewportSize();
  world.scale = vw / bg.naturalWidth;
  world.width = vw;
  world.height = bg.naturalHeight * world.scale;
  clampCameraTarget();
  clampCamera();
}

function placeCameraAtStart() {
  const { height: vh } = getViewportSize();
  camera.targetX = 0;
  camera.targetY = Math.max(0, world.height - vh);
  camera.x = camera.targetX;
  camera.y = camera.targetY;
}

function spawnPlayer() {
  const { width: vw, height: vh } = getViewportSize();
  player.scale = CONFIG.playerScale;
  player.x = world.width * 0.5;
  // 박스 바닥이 화면 하단에서 조금 위
  player.y = world.height - Math.min(120, vh * 0.12);
  const reach = armReachProfile();
  player.aim = -Math.PI / 2;
  player.gripDist = reach.extendDist;
  player.hammerAngle = player.aim - hammerHeadFromGripAngle();
  player.targetHammerAngle = player.hammerAngle;
  player.arms.left = null;
  player.arms.right = null;
}

function drawBackground() {
  const bg = images.background;
  if (!bg || world.width <= 0 || world.height <= 0) return;

  const screen = worldToScreen(0, 0);
  const { width: vw, height: vh } = getViewportSize();

  ctx.save();
  ctx.filter = `blur(${CONFIG.backgroundBlur}px)`;
  ctx.drawImage(bg, screen.x, screen.y, world.width, world.height);
  ctx.restore();

  ctx.fillStyle = `rgba(0, 0, 0, ${CONFIG.backgroundDim})`;
  ctx.fillRect(0, 0, vw, vh);
}

// ---------------------------------------------------------------------------
// 플레이어: IK / 망치 / 렌더
// ---------------------------------------------------------------------------

function bendSignOf(ax, ay, hx, hy, ex, ey) {
  const cross = (hx - ax) * (ey - ay) - (hy - ay) * (ex - ax);
  return cross >= 0 ? 1 : -1;
}

/**
 * 2본 IK. 상완/하완 길이는 고정하고, 닿지 않으면 손목만 어깨 방향으로 당긴다.
 * 팔꿈치는 두 해 중 이전 프레임과 더 가까운 쪽을 골라 뒤집힘을 막는다.
 */
function solveTwoBone(ax, ay, tx, ty, len1, len2, prev, preferredBend = 1) {
  const dx = tx - ax;
  const dy = ty - ay;
  const raw = Math.hypot(dx, dy) || 1;
  const maxReach = len1 + len2 - 0.01;
  const minReach = Math.abs(len1 - len2) + 0.01;
  const dist = clamp(raw, minReach, maxReach);
  const handX = ax + (dx / raw) * dist;
  const handY = ay + (dy / raw) * dist;

  const cosA = clamp(
    (len1 * len1 + dist * dist - len2 * len2) / (2 * len1 * dist),
    -1,
    1
  );
  const offset = Math.acos(cosA);
  const base = Math.atan2(handY - ay, handX - ax);

  const candidates = [1, -1].map((dir) => {
    const elbowAngle = base + offset * dir;
    const elbowX = ax + Math.cos(elbowAngle) * len1;
    const elbowY = ay + Math.sin(elbowAngle) * len1;
    return {
      elbowX,
      elbowY,
      handX,
      handY,
      bend: bendSignOf(ax, ay, handX, handY, elbowX, elbowY),
    };
  });

  if (prev && Number.isFinite(prev.elbowX)) {
    const dist2 = (pose) => {
      const ex = pose.elbowX - prev.elbowX;
      const ey = pose.elbowY - prev.elbowY;
      return ex * ex + ey * ey;
    };
    const d0 = dist2(candidates[0]);
    const d1 = dist2(candidates[1]);
    if (Math.abs(d0 - d1) < 4 && prev.bend) {
      const same = candidates.find((pose) => pose.bend === prev.bend);
      if (same) return same;
    }
    return d0 <= d1 ? candidates[0] : candidates[1];
  }

  const preferred = prev && prev.bend ? prev.bend : preferredBend;
  return candidates.find((pose) => pose.bend === preferred) || candidates[0];
}

/** 이미지에서 손잡이 중심 → 도끼 머리 방향 */
function hammerGripLocal() {
  const H = RIG.hammer;
  return {
    x: (H.gripFront.x + H.gripBack.x) / 2,
    y: (H.gripFront.y + H.gripBack.y) / 2,
  };
}

function hammerHeadFromGripAngle() {
  const H = RIG.hammer;
  const grip = hammerGripLocal();
  return Math.atan2(H.headY - grip.y, H.headX - grip.x);
}

function shoulderMidpoint() {
  const left = spriteToWorld(RIG.shoulderL.x, RIG.shoulderL.y);
  const right = spriteToWorld(RIG.shoulderR.x, RIG.shoulderR.y);
  return {
    x: (left.x + right.x) / 2,
    y: (left.y + right.y) / 2,
    sep: Math.hypot(right.x - left.x, right.y - left.y),
  };
}

/** 팔 길이로 정한, 어깨 중앙 기준 손잡이 거리 */
function armReachProfile() {
  const upper = RIG.armLen.upper * player.scale;
  const lower = RIG.armLen.lower * player.scale;
  const maxReach = upper + lower;
  const half = shoulderMidpoint().sep / 2;
  const toMid = (shoulderDist) =>
    Math.sqrt(Math.max(shoulderDist * shoulderDist - half * half, 1));
  return {
    upper,
    lower,
    maxReach,
    /** 거의 180도로 편 상태 */
    extendDist: toMid(maxReach * 0.9995),
    /** 팔꿈치가 분명히 접히는 상태 */
    flexDist: toMid(maxReach * 0.5),
  };
}

function smoothstep(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function getHammerPose() {
  const mid = shoulderMidpoint();
  const angle = player.hammerAngle;
  const aim = player.aim;
  const s = player.scale * CONFIG.hammerScale;
  const H = RIG.hammer;
  const grip = hammerGripLocal();
  const dx = (grip.x - H.pivotX) * s;
  const dy = (grip.y - H.pivotY) * s;
  const c = Math.cos(angle);
  const sn = Math.sin(angle);
  const rx = dx * c - dy * sn;
  const ry = dx * sn + dy * c;
  const dist = player.gripDist;
  const target = {
    x: mid.x + Math.cos(aim) * dist,
    y: mid.y + Math.sin(aim) * dist,
  };
  const pivot = { x: target.x - rx, y: target.y - ry };

  const localToWorld = (lx, ly) => {
    const ox = (lx - H.pivotX) * s;
    const oy = (ly - H.pivotY) * s;
    return {
      x: pivot.x + ox * c - oy * sn,
      y: pivot.y + ox * sn + oy * c,
    };
  };

  return {
    pivot,
    angle,
    head: localToWorld(H.headX, H.headY),
    gripFront: localToWorld(H.gripFront.x, H.gripFront.y),
    gripBack: localToWorld(H.gripBack.x, H.gripBack.y),
  };
}

function solveArms(pose) {
  const shoulderL = spriteToWorld(RIG.shoulderL.x, RIG.shoulderL.y);
  const shoulderR = spriteToWorld(RIG.shoulderR.x, RIG.shoulderR.y);
  const upper = RIG.armLen.upper * player.scale;
  const lower = RIG.armLen.lower * player.scale;

  const left = solveTwoBone(
    shoulderL.x,
    shoulderL.y,
    pose.gripFront.x,
    pose.gripFront.y,
    upper,
    lower,
    player.arms.left,
    1
  );
  const right = solveTwoBone(
    shoulderR.x,
    shoulderR.y,
    pose.gripBack.x,
    pose.gripBack.y,
    upper,
    lower,
    player.arms.right,
    -1
  );

  player.arms.left = left;
  player.arms.right = right;

  return {
    shoulderL,
    shoulderR,
    left,
    right,
  };
}

function updateHammer() {
  if (!input.mouseInView) return;

  const mid = shoulderMidpoint();
  const mouse = screenToWorld(input.mouseX, input.mouseY);
  const aim = Math.atan2(mouse.y - mid.y, mouse.x - mid.x);
  const mouseDist = Math.hypot(mouse.x - mid.x, mouse.y - mid.y);
  const reach = armReachProfile();
  const t = smoothstep(
    (mouseDist - reach.flexDist) / (reach.extendDist - reach.flexDist)
  );

  player.aim = aim;
  player.gripDist = reach.flexDist + (reach.extendDist - reach.flexDist) * t;
  player.targetHammerAngle = aim - hammerHeadFromGripAngle();
  player.hammerAngle = player.targetHammerAngle;
}

/**
 * 캐릭터 공통 변환: 월드 위치 → 스프라이트 공간
 * 콜백 안에서 스프라이트 좌표로 그리면 됨
 */
function withPlayerTransform(drawFn) {
  const screen = worldToScreen(player.x, player.y);
  ctx.save();
  ctx.translate(screen.x, screen.y);
  ctx.scale(player.scale, player.scale);
  ctx.translate(-RIG.originX, -RIG.originY);
  drawFn();
  ctx.restore();
}

function drawSpriteLayer(key) {
  const img = images[key];
  if (!img) return;
  ctx.drawImage(img, 0, 0, SPRITE, SPRITE);
}

/**
 * 팔 스프라이트의 양끝 앵커를 관절 좌표에 정확히 올린다.
 * 길이 축은 뼈 길이(+겹침)에 맞추고, 굵기만 armThickness 로 키운다.
 */
function drawLimb(img, spec, ax, ay, bx, by) {
  if (!img) return;
  const dx = bx - ax;
  const dy = by - ay;
  const boneLen = Math.hypot(dx, dy) || 1;
  const boneAngle = Math.atan2(dy, dx);
  const sx = spec.bx - spec.ax;
  const sy = spec.by - spec.ay;
  const srcLen = Math.hypot(sx, sy) || 1;
  const srcAngle = Math.atan2(sy, sx);
  const overlap = boneLen * CONFIG.jointOverlap;
  const along = (boneLen + overlap) / srcLen;
  const thick = along * CONFIG.armThickness;
  const ux = dx / boneLen;
  const uy = dy / boneLen;

  ctx.save();
  ctx.translate(ax - ux * (overlap / 2), ay - uy * (overlap / 2));
  ctx.rotate(boneAngle);
  ctx.scale(along, thick);
  ctx.rotate(-srcAngle);
  ctx.translate(-spec.ax, -spec.ay);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

function drawJoint(x, y, radius) {
  const screen = worldToScreen(x, y);
  ctx.beginPath();
  ctx.fillStyle = CONFIG.skin;
  ctx.arc(screen.x, screen.y, Math.max(radius, 1), 0, Math.PI * 2);
  ctx.fill();
}

function jointRadius(boneLen, spec) {
  const srcLen = Math.hypot(spec.bx - spec.ax, spec.by - spec.ay) || 1;
  return boneLen * (spec.radius / srcLen) * CONFIG.armThickness * 0.92;
}

function drawArm(imgUpper, imgLower, shoulder, elbow, wrist) {
  const upperLen = Math.hypot(elbow.x - shoulder.x, elbow.y - shoulder.y);
  const lowerLen = Math.hypot(wrist.x - elbow.x, wrist.y - elbow.y);
  const a = worldToScreen(shoulder.x, shoulder.y);
  const e = worldToScreen(elbow.x, elbow.y);
  const w = worldToScreen(wrist.x, wrist.y);

  drawJoint(shoulder.x, shoulder.y, jointRadius(upperLen, RIG.limbs.upper) * 0.85);
  drawLimb(imgUpper, RIG.limbs.upper, a.x, a.y, e.x, e.y);
  drawJoint(elbow.x, elbow.y, jointRadius(upperLen, RIG.limbs.upper));
  drawLimb(imgLower, RIG.limbs.lower, e.x, e.y, w.x, w.y);
  drawJoint(wrist.x, wrist.y, jointRadius(lowerLen, RIG.limbs.lower) * 0.8);
}

function drawHandOnGrip(img, grip, hammerAngle, mirror) {
  if (!img) return;
  const spec = RIG.limbs.hand;
  const screen = worldToScreen(grip.x, grip.y);
  const s = player.scale * CONFIG.handScale;

  ctx.save();
  ctx.translate(screen.x, screen.y);
  ctx.rotate(hammerAngle - spec.axis);
  ctx.scale(mirror ? -s : s, s);
  ctx.translate(-spec.palmX, -spec.palmY);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

function drawHammer(pose) {
  const img = images.hammer;
  if (!img) return;
  const screen = worldToScreen(pose.pivot.x, pose.pivot.y);
  const H = RIG.hammer;

  ctx.save();
  ctx.translate(screen.x, screen.y);
  ctx.rotate(pose.angle);
  ctx.scale(
    player.scale * CONFIG.hammerScale,
    player.scale * CONFIG.hammerScale
  );
  ctx.drawImage(img, -H.pivotX, -H.pivotY, SPRITE, SPRITE);
  ctx.restore();
}

function drawPlayer() {
  const pose = getHammerPose();
  const arms = solveArms(pose);
  const leftElbow = { x: arms.left.elbowX, y: arms.left.elbowY };
  const rightElbow = { x: arms.right.elbowX, y: arms.right.elbowY };
  const leftWrist = { x: arms.left.handX, y: arms.left.handY };
  const rightWrist = { x: arms.right.handX, y: arms.right.handY };

  // 왼팔은 가장 뒤. 몸통·얼굴과 겹치면 그 아래로 가려진다.
  drawArm(images.leftArm2, images.leftArm1, arms.shoulderL, leftElbow, leftWrist);

  // 꼬리 → 몸통 → 박스(몸통 아래를 가림) → 머리
  withPlayerTransform(() => {
    drawSpriteLayer("tail");
    drawSpriteLayer("body");
    drawSpriteLayer("box");
    drawSpriteLayer("head");
  });

  drawArm(images.rightArm2, images.rightArm1, arms.shoulderR, rightElbow, rightWrist);

  drawHammer(pose);

  // 손은 도끼보다 위. 손잡이와 겹쳐도 손이 앞에 보인다.
  drawHandOnGrip(images.rightHand, rightWrist, pose.angle, true);
  drawHandOnGrip(images.leftHand, leftWrist, pose.angle, false);
}

// ---------------------------------------------------------------------------
// 입력
// ---------------------------------------------------------------------------

function setupInput() {
  window.addEventListener("keydown", (e) => {
    input.keys.add(e.code);
    if (e.code === "KeyC") {
      CONFIG.freeCamera = !CONFIG.freeCamera;
    }
  });

  window.addEventListener("keyup", (e) => {
    input.keys.delete(e.code);
  });

  const updateMouse = (e) => {
    const rect = canvas.getBoundingClientRect();
    input.mouseX = ((e.clientX - rect.left) / rect.width) * (canvas.width / dpr);
    input.mouseY = ((e.clientY - rect.top) / rect.height) * (canvas.height / dpr);
    input.mouseInView = true;
  };

  canvas.addEventListener("pointermove", (e) => {
    updateMouse(e);
    if (!CONFIG.freeCamera || !input.dragActive) return;
    const dx = e.clientX - input.lastDragX;
    const dy = e.clientY - input.lastDragY;
    input.lastDragX = e.clientX;
    input.lastDragY = e.clientY;
    camera.targetX -= dx;
    camera.targetY -= dy;
    clampCameraTarget();
  });

  canvas.addEventListener("pointerenter", updateMouse);
  canvas.addEventListener("pointerleave", () => {
    input.mouseInView = false;
  });

  canvas.addEventListener(
    "wheel",
    (e) => {
      if (!CONFIG.freeCamera) return;
      e.preventDefault();
      camera.targetY += e.deltaY > 0 ? CONFIG.cameraWheelStep : -CONFIG.cameraWheelStep;
      clampCameraTarget();
    },
    { passive: false }
  );

  canvas.addEventListener("pointerdown", (e) => {
    updateMouse(e);
    if (!CONFIG.freeCamera) return;
    input.dragActive = true;
    input.lastDragX = e.clientX;
    input.lastDragY = e.clientY;
    canvas.classList.add("is-dragging");
    canvas.setPointerCapture(e.pointerId);
  });

  const endDrag = (e) => {
    if (!input.dragActive) return;
    input.dragActive = false;
    canvas.classList.remove("is-dragging");
    if (e.pointerId != null) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch (_) {
        /* ignore */
      }
    }
  };

  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);
}

function updateCameraFromKeyboard(dt) {
  if (!CONFIG.freeCamera) return;
  const speed = CONFIG.cameraKeySpeed * dt;
  let moved = false;
  if (input.keys.has("ArrowUp") || input.keys.has("KeyW")) {
    camera.targetY -= speed;
    moved = true;
  }
  if (input.keys.has("ArrowDown") || input.keys.has("KeyS")) {
    camera.targetY += speed;
    moved = true;
  }
  if (input.keys.has("ArrowLeft") || input.keys.has("KeyA")) {
    camera.targetX -= speed;
    moved = true;
  }
  if (input.keys.has("ArrowRight") || input.keys.has("KeyD")) {
    camera.targetX += speed;
    moved = true;
  }
  if (moved) clampCameraTarget();
}

function updateCamera(dt) {
  if (!CONFIG.freeCamera) {
    // 가슴/망치 피벗 쪽을 보도록 약간 위쪽을 추적
    const look = spriteToWorld(RIG.hammerPivot.x, RIG.hammerPivot.y - 40);
    focusCameraOn(look.x, look.y);
  }
  const t = 1 - Math.exp(-CONFIG.cameraLerp * dt);
  camera.x += (camera.targetX - camera.x) * t;
  camera.y += (camera.targetY - camera.y) * t;
  clampCamera();
}

// ---------------------------------------------------------------------------
// 리사이즈 / 루프
// ---------------------------------------------------------------------------

function resize() {
  const prevWorldHeight = world.height;
  const prevViewHeight = prevWorldHeight > 0 ? getViewportSize().height : 0;
  const wasNearBottom =
    prevWorldHeight > 0 &&
    camera.targetY >= prevWorldHeight - prevViewHeight - 2;

  let climbRatio = 0;
  if (prevWorldHeight > prevViewHeight) {
    climbRatio =
      (prevWorldHeight - prevViewHeight - camera.targetY) /
      (prevWorldHeight - prevViewHeight);
  }

  const prevPlayerRatioY =
    prevWorldHeight > 0 ? player.y / prevWorldHeight : 0.95;

  dpr = window.devicePixelRatio || 1;
  const cssWidth = window.innerWidth;
  const cssHeight = window.innerHeight;
  canvas.width = Math.floor(cssWidth * dpr);
  canvas.height = Math.floor(cssHeight * dpr);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  rebuildWorldFromBackground();

  if (world.height > 0) {
    player.x = world.width * 0.5;
    player.y =
      prevWorldHeight > 0
        ? prevPlayerRatioY * world.height
        : world.height - 120;
  }

  const { height: vh } = getViewportSize();
  if (wasNearBottom || prevWorldHeight === 0) {
    placeCameraAtStart();
  } else if (world.height > vh) {
    camera.targetY = world.height - vh - climbRatio * (world.height - vh);
    clampCameraTarget();
    camera.x = camera.targetX;
    camera.y = camera.targetY;
  } else {
    clampCameraTarget();
    clampCamera();
  }
}

function updateDebugHud() {
  if (!CONFIG.showDebugHud) {
    debugHud.textContent = "";
    return;
  }
  const pose = getHammerPose();
  const deg = ((player.hammerAngle * 180) / Math.PI).toFixed(0);
  debugHud.textContent = [
    `state: ${gameState}`,
    `player: (${Math.round(player.x)}, ${Math.round(player.y)})`,
    `hammer: ${deg}°`,
    `grip: (${Math.round(pose.gripFront.x)}, ${Math.round(pose.gripFront.y)})`,
    `camera: ${CONFIG.freeCamera ? "FREE (C to follow)" : "FOLLOW (C to free)"}`,
    `mouse: aim hammer`,
  ].join("\n");
}

function update(dt) {
  if (gameState !== GameState.PLAYING) return;
  updateHammer(dt);
  updateCameraFromKeyboard(dt);
  updateCamera(dt);
}

function render() {
  const { width: vw, height: vh } = getViewportSize();
  ctx.clearRect(0, 0, vw, vh);
  drawBackground();
  drawPlayer();
  updateDebugHud();
}

function frame(timestamp) {
  const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
  lastTime = timestamp;
  update(dt);
  render();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// 초기화
// ---------------------------------------------------------------------------

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

/** 하이픈/언더스코어 파일명 모두 시도 */
async function loadPlayerImage(src) {
  try {
    return await loadImage(src);
  } catch (firstErr) {
    const alt = src.includes("-")
      ? src.replace(/-/g, "_")
      : src.replace(/_/g, "-");
    if (alt === src) throw firstErr;
    try {
      return await loadImage(alt);
    } catch (_) {
      throw firstErr;
    }
  }
}

async function init() {
  setupInput();
  window.addEventListener("resize", resize);

  try {
    images.background = await loadImage(ASSETS.background);
    const entries = Object.entries(ASSETS.player);
    await Promise.all(
      entries.map(async ([key, src]) => {
        images[key] = await loadPlayerImage(src);
      })
    );
  } catch (err) {
    console.error(err);
    debugHud.textContent = String(err.message || err);
    return;
  }

  resize();
  spawnPlayer();
  focusCameraOn(player.x, player.y, { snap: true });

  lastTime = performance.now();
  requestAnimationFrame(frame);
}

init();

window.TomGame = {
  GameState,
  world,
  camera,
  player,
  RIG,
  worldToScreen,
  screenToWorld,
  focusCameraOn,
  getViewportSize,
  getHammerPose,
};
