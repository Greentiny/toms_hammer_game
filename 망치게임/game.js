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
  /** 플레이어 표시 스케일 (1024 논리 스프라이트 기준) */
  playerScale: 0.38,
  hammerFollowSpeed: 14,
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
  shoulderL: { x: 410, y: 475 },
  shoulderR: { x: 630, y: 455 },
  /** 몸 기준 망치 회전축 (양손 사이) */
  hammerPivot: { x: 520, y: 560 },
  /**
   * 망치 이미지 로컬 좌표
   * 손잡이 세로, 돌머리가 위쪽
   */
  hammer: {
    pivotX: 505,
    pivotY: 640,
    headX: 505,
    headY: 140,
    gripUpper: { x: 505, y: 560 },
    gripLower: { x: 505, y: 700 },
  },
  parts: {
    // 2048 캔버스 기준 opaque bounds (교체 에셋 재측정)
    leftArm2: { x: 985, y: 723, w: 368, h: 378, naturalAngle: -0.7 },
    leftArm1: { x: 697, y: 1006, w: 392, h: 311, naturalAngle: -0.55 },
    leftHand: { x: 554, y: 1200, w: 224, h: 251, naturalAngle: -0.9 },
    rightArm2: { x: 985, y: 723, w: 368, h: 378, naturalAngle: 0.7 },
    rightArm1: { x: 697, y: 1006, w: 392, h: 311, naturalAngle: 0.55 },
    rightHand: { x: 554, y: 1200, w: 224, h: 251, naturalAngle: 0.9 },
  },
  armLen: {
    leftUpper: 130,
    leftLower: 125,
    rightUpper: 130,
    rightLower: 125,
  },
};

const player = {
  x: 0,
  y: 0,
  scale: CONFIG.playerScale,
  /** 망치 각도 (캔버스 기준, 0=오른쪽, 시계방향+) */
  hammerAngle: -Math.PI / 2,
  targetHammerAngle: -Math.PI / 2,
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
  player.hammerAngle = -Math.PI / 2;
  player.targetHammerAngle = -Math.PI / 2;
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

function solveTwoBone(ax, ay, tx, ty, len1, len2, bendDir) {
  const dx = tx - ax;
  const dy = ty - ay;
  let dist = Math.hypot(dx, dy);
  const maxReach = len1 + len2 - 0.5;
  const minReach = Math.abs(len1 - len2) + 0.5;
  if (dist > maxReach) dist = maxReach;
  if (dist < minReach) dist = minReach;

  const ux = dx / (Math.hypot(dx, dy) || 1);
  const uy = dy / (Math.hypot(dx, dy) || 1);
  const clampedX = ax + ux * dist;
  const clampedY = ay + uy * dist;

  const cosA = clamp(
    (len1 * len1 + dist * dist - len2 * len2) / (2 * len1 * dist),
    -1,
    1
  );
  const angleOffset = Math.acos(cosA) * bendDir;
  const base = Math.atan2(clampedY - ay, clampedX - ax);
  const elbowAngle = base + angleOffset;

  return {
    elbowX: ax + Math.cos(elbowAngle) * len1,
    elbowY: ay + Math.sin(elbowAngle) * len1,
    handX: clampedX,
    handY: clampedY,
  };
}

function getHammerPose() {
  const pivot = spriteToWorld(RIG.hammerPivot.x, RIG.hammerPivot.y);
  const angle = player.hammerAngle;
  const s = player.scale;
  const H = RIG.hammer;

  const localToWorld = (lx, ly) => {
    const dx = (lx - H.pivotX) * s;
    const dy = (ly - H.pivotY) * s;
    const c = Math.cos(angle);
    const sn = Math.sin(angle);
    return {
      x: pivot.x + dx * c - dy * sn,
      y: pivot.y + dx * sn + dy * c,
    };
  };

  return {
    pivot,
    angle,
    head: localToWorld(H.headX, H.headY),
    gripUpper: localToWorld(H.gripUpper.x, H.gripUpper.y),
    gripLower: localToWorld(H.gripLower.x, H.gripLower.y),
  };
}

function updateHammer(dt) {
  if (!input.mouseInView) return;

  const pivot = spriteToWorld(RIG.hammerPivot.x, RIG.hammerPivot.y);
  const mouse = screenToWorld(input.mouseX, input.mouseY);
  player.targetHammerAngle = Math.atan2(mouse.y - pivot.y, mouse.x - pivot.x);

  // 최단 각 보간
  let diff = player.targetHammerAngle - player.hammerAngle;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const t = 1 - Math.exp(-CONFIG.hammerFollowSpeed * dt);
  player.hammerAngle += diff * t;
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

function drawBoneSegment(img, part, ax, ay, bx, by) {
  if (!img) return;
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const boneLen = Math.hypot(bx - ax, by - ay) || 1;
  const boneAngle = Math.atan2(by - ay, bx - ax);
  const nativeLen = Math.max(part.w, part.h);

  ctx.save();
  ctx.translate(mx, my);
  ctx.rotate(boneAngle - part.naturalAngle);
  const scale = boneLen / nativeLen;
  ctx.scale(scale, scale);
  ctx.drawImage(
    img,
    part.x,
    part.y,
    part.w,
    part.h,
    -part.w / 2,
    -part.h / 2,
    part.w,
    part.h
  );
  ctx.restore();
}

function drawHandOnGrip(img, part, grip, hammerAngle, flipHint) {
  if (!img) return;
  const screen = worldToScreen(grip.x, grip.y);
  const handAngle = hammerAngle + flipHint;

  ctx.save();
  ctx.translate(screen.x, screen.y);
  ctx.rotate(handAngle - part.naturalAngle);
  ctx.scale(player.scale, player.scale);
  ctx.drawImage(
    img,
    part.x,
    part.y,
    part.w,
    part.h,
    -part.w / 2,
    -part.h / 2,
    part.w,
    part.h
  );
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
  ctx.scale(player.scale, player.scale);
  ctx.drawImage(img, -H.pivotX, -H.pivotY, SPRITE, SPRITE);
  ctx.restore();
}

function drawPlayer() {
  const pose = getHammerPose();
  const shoulderL = spriteToWorld(RIG.shoulderL.x, RIG.shoulderL.y);
  const shoulderR = spriteToWorld(RIG.shoulderR.x, RIG.shoulderR.y);

  // 왼팔: 어깨 → 위쪽 그립, 오른팔: 어깨 → 아래쪽 그립
  const left = solveTwoBone(
    shoulderL.x,
    shoulderL.y,
    pose.gripUpper.x,
    pose.gripUpper.y,
    RIG.armLen.leftUpper * player.scale,
    RIG.armLen.leftLower * player.scale,
    1
  );
  const right = solveTwoBone(
    shoulderR.x,
    shoulderR.y,
    pose.gripLower.x,
    pose.gripLower.y,
    RIG.armLen.rightUpper * player.scale,
    RIG.armLen.rightLower * player.scale,
    -1
  );

  // 1) 뒤쪽 파츠
  withPlayerTransform(() => {
    drawSpriteLayer("tail");
    drawSpriteLayer("box");
    drawSpriteLayer("body");
    drawSpriteLayer("head");
  });

  // 2) 팔 (월드 좌표 뼈대)
  const toScreenBone = (ax, ay, bx, by, imgKey, partKey) => {
    const a = worldToScreen(ax, ay);
    const b = worldToScreen(bx, by);
    // drawBoneSegment는 이미 스크린 픽셀 기준이므로 scale 보정:
    // shoulder/hand는 월드 좌표 → 스크린은 카메라만 빼므로 거리는 월드=스크린 스케일 동일
    drawBoneSegment(images[imgKey], RIG.parts[partKey], a.x, a.y, b.x, b.y);
  };

  // 뼈 길이가 player.scale 반영된 월드 단위라, 스크린에서도 동일
  // 다만 drawBoneSegment가 part 픽셀을 scale로 맞추므로, 스크린 상의 뼈 길이를 그대로 사용
  toScreenBone(
    shoulderL.x,
    shoulderL.y,
    left.elbowX,
    left.elbowY,
    "leftArm2",
    "leftArm2"
  );
  toScreenBone(
    left.elbowX,
    left.elbowY,
    left.handX,
    left.handY,
    "leftArm1",
    "leftArm1"
  );
  toScreenBone(
    shoulderR.x,
    shoulderR.y,
    right.elbowX,
    right.elbowY,
    "rightArm2",
    "rightArm2"
  );
  toScreenBone(
    right.elbowX,
    right.elbowY,
    right.handX,
    right.handY,
    "rightArm1",
    "rightArm1"
  );

  // 3) 망치 (손 아래/사이)
  drawHammer(pose);

  // 4) 손 — 망치 그립에 부착
  drawHandOnGrip(
    images.leftHand,
    RIG.parts.leftHand,
    pose.gripUpper,
    pose.angle,
    0.15
  );
  drawHandOnGrip(
    images.rightHand,
    RIG.parts.rightHand,
    pose.gripLower,
    pose.angle,
    -0.15
  );
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
    `grip: (${Math.round(pose.gripUpper.x)}, ${Math.round(pose.gripUpper.y)})`,
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
