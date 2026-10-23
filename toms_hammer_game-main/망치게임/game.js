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
  background: "assets/background/stage1.jpg",
  stage1: {
    cliff: "assets/stage1/cliff.png",
    ruin: "assets/stage1/ruin.png",
    branch: "assets/stage1/branch.png",
    rock: "assets/stage1/rock.png",
    bench: "assets/stage1/bench.png",
    chair: "assets/stage1/chair.png",
  },
  /**
   * 충돌 전용 실루엣. 키가 없으면 보이는 이미지를 그대로 쓴다.
   * 예: rock: "assets/collision/rock.png"
   */
  collision: {},
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
  playerScale: 0.128,
  /** 손 스프라이트 배율. 양손이 포개져도 손잡이를 덮을 정도 */
  handScale: 0.68,
  /**
   * 팔 굵기. 길이 축은 뼈 길이에 고정하고, 수직 방향만 키운다.
   * 1이면 에셋 비율 그대로.
   */
  armThickness: 1.28,
  /** 관절 양끝으로 스프라이트를 겹쳐 틈이 보이지 않게 하는 비율 */
  jointOverlap: 0.05,
  /** 망치 스프라이트 배율 (그립 위치도 같이 커짐) */
  hammerScale: 1.32,
  skin: "rgb(140, 189, 117)",
  /**
   * 항아리 물리. 여기 값만 바꿔서 무게·반동·미끄러짐을 조절한다.
   */
  gravity: 1800,
  maxFallSpeed: 1400,
  maxPlayerSpeed: 1200,
  airDrag: 0.22,
  groundFriction: 7,
  /** 망치 머리 충돌 반지름 (월드 픽셀) */
  hammerHeadRadius: 14,
  /** 표면을 밀어 넣는 마우스 속도 → 플레이어 반작용 */
  hammerPushGain: 1.15,
  /** 모서리에 걸고 회전할 때 지렛대 전달 비율 */
  hammerLeverGain: 0.28,
  /** 반작용 가속도 상한 */
  maxHammerForce: 1400,
  /** 망치 반동으로 얻는 최대 상승 속도 */
  maxHammerJumpSpeed: 520,
  /** 0~1. 클수록 마우스 따라감이 빠르고, 작을수록 부드럽게 보간 */
  mouseSmoothing: 0.3,
  collisionScale: 0.5,
  collisionAlpha: 24,
  /** 충돌 외곽선·접촉점 표시. V 키로 토글 */
  showCollisionDebug: false,
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

/** 불투명 영역. 배치 크기·중심은 이 박스 기준 */
const PROP_BOUNDS = {
  bench: { x: 10, y: 319, w: 979, h: 595 },
  branch: { x: 18, y: 9, w: 993, h: 663 },
  chair: { x: 61, y: 21, w: 460, h: 981 },
  cliff: { x: 532, y: 0, w: 491, h: 1023 },
  rock: { x: 14, y: 264, w: 995, h: 494 },
  ruin: { x: 0, y: 4, w: 654, h: 650 },
};

/**
 * 1단계 오브젝트. cx/cy/w 는 월드 비율(0~1).
 * w 는 보이는 스프라이트 가로. 절벽만 월드 전체에 맞춤.
 * collision 키를 주면 보이는 그림과 다른 실루엣으로 충돌한다.
 */
const STAGE1_PROPS = [
  { key: "cliff", fit: "world" },
  { key: "ruin", cx: 0.05, cy: 0.8, w: 0.2 },
  { key: "branch", cx: 0.43, cy: 0.755, w: 0.26, rotation: -1.05 },
  { key: "rock", cx: 0.5, cy: 0.9, w: 0.4 },
  { key: "bench", cx: 0.49, cy: 0.23, w: 0.16, rotation: -0.95 },
  { key: "chair", cx: 0.61, cy: 0.32, w: 0.075, rotation: -1.42 },
];

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
  smoothWorldX: null,
  smoothWorldY: null,
  prevWorldX: null,
  prevWorldY: null,
};

/**
 * 캐릭터 스프라이트 공간 기준점
 * - origin: 박스 바닥 중앙 → 월드 player.x/y 에 대응
 * - 파츠 bounds는 에셋 분석값
 */
const RIG = {
  originX: 533,
  originY: 978,
  /** 머리 좌우 반전 축. 목 위에 남도록 얼굴 중심을 쓴다. */
  headFlipX: 488,
  /**
   * 몸·꼬리·박스는 originX 기준으로 기본 좌우 반전한다.
   * 어깨도 그 축으로 미러해서 팔이 뒤집힌 몸통에 붙게 한다.
   */
  shoulderL: { x: 461, y: 415 },
  /** 앞에 보이는 팔. 몸통 가운데에 붙여 어깨가 밖으로 빠지지 않게 한다. */
  shoulderR: { x: 545, y: 420 },
  /** 도끼가 몸을 중심으로 도는 기준점. 손은 여기 고정되지 않는다. */
  hammerPivot: { x: 524, y: 470 },
  /**
   * 망치를 1024 스프라이트 공간에 맞출 때 쓰는 좌표.
   * PNG는 1536×2048이라 그 비율로 투영한다. 손은 자루 맨 아래를 잡는다.
   */
  hammer: {
    pivotX: 513,
    pivotY: 1002,
    headX: 507,
    headY: 110,
    gripFront: { x: 513, y: 740 },
    gripBack: { x: 513, y: 820 },
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
  lastMouseDist: null,
  prevAim: null,
  prevGripDist: null,
  prevHammerAngle: 0,
  vx: 0,
  vy: 0,
  grounded: false,
  contact: null,
  /** 망치 머리가 고정된 표면 좌표. 있으면 머리는 고정, 몸만 움직인다. */
  plant: null,
  lastHead: null,
  plantCooldown: 0,
  prevPlantX: null,
  prevPlantY: null,
  /** 이전 프레임 팔꿈치. 꺾임 방향이 갑자기 뒤집히지 않게 유지 */
  arms: {
    left: null,
    right: null,
  },
};

const collision = {
  width: 0,
  height: 0,
  scale: 0.5,
  /** @type {Uint8Array | null} */
  mask: null,
  /** @type {HTMLCanvasElement | null} */
  canvas: null,
};

/** 망치 스프라이트 불투명 픽셀. 월드로 변환해 관통을 막는다. */
const hammerCollider = {
  /** @type {{ x: number, y: number }[]} */
  samples: [],
};

/** 박스·몸 스프라이트 불투명 픽셀. 그린 것과 같은 좌우 반전을 적용한다. */
const playerCollider = {
  /** @type {{ x: number, y: number }[]} */
  samples: [],
  /** 박스 바닥. 착지 탐지용 */
  /** @type {{ x: number, y: number }[]} */
  feet: [],
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

function getPropSize(spec) {
  const bounds = PROP_BOUNDS[spec.key];
  const destW = world.width * spec.w;
  const destH = destW * (bounds.h / bounds.w);
  return { destW, destH, bounds };
}

/** 바위 위 설 자리. player.x/y 는 박스 바닥 중앙 */
function getRockStandPoint() {
  const spec = STAGE1_PROPS.find((prop) => prop.key === "rock");
  const { destW, destH } = getPropSize(spec);
  return {
    x: world.width * spec.cx - destW * 0.30,
    y: world.height * spec.cy - destH * 0.1,
  };
}

function spawnPlayer() {
  player.scale = CONFIG.playerScale;
  const stand = getRockStandPoint();
  player.x = stand.x;
  player.y = stand.y - 28;
  const reach = armReachProfile();
  player.aim = -Math.PI / 2;
  player.gripDist = reach.extendDist;
  player.hammerAngle = player.aim - hammerHeadFromGripAngle();
  player.targetHammerAngle = player.hammerAngle;
  player.arms.left = null;
  player.arms.right = null;
  player.lastMouseDist = null;
  player.vx = 0;
  player.vy = 0;
  player.grounded = false;
  player.contact = null;
  player.plant = null;
  player.lastHead = null;
  player.plantCooldown = 0;
  player.prevHammerAngle = player.hammerAngle;
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

function drawStagePropTo(targetCtx, spec, originX, originY, options = {}) {
  const imgKey = options.forCollision ? spec.collision || spec.key : spec.key;
  const img = images[imgKey] || images[spec.key];
  if (!img) return;

  if (spec.fit === "world") {
    targetCtx.drawImage(img, originX, originY, world.width, world.height);
    return;
  }

  const { destW, destH, bounds } = getPropSize(spec);
  targetCtx.save();
  targetCtx.translate(originX + world.width * spec.cx, originY + world.height * spec.cy);
  if (spec.rotation) targetCtx.rotate(spec.rotation);
  targetCtx.scale(destW / bounds.w, destH / bounds.h);
  targetCtx.drawImage(img, -bounds.x - bounds.w / 2, -bounds.y - bounds.h / 2);
  targetCtx.restore();
}

function drawStageProp(spec) {
  const screen = worldToScreen(0, 0);
  drawStagePropTo(ctx, spec, screen.x, screen.y);
}

function drawStageObjects() {
  for (const spec of STAGE1_PROPS) {
    drawStageProp(spec);
  }
}

// ---------------------------------------------------------------------------
// 충돌 / 표면 / 망치 고정
// ---------------------------------------------------------------------------

function rebuildCollision() {
  if (world.width <= 0 || world.height <= 0) return;
  const scale = CONFIG.collisionScale;
  const w = Math.max(1, Math.ceil(world.width * scale));
  const h = Math.max(1, Math.ceil(world.height * scale));
  const cnv = document.createElement("canvas");
  cnv.width = w;
  cnv.height = h;
  const c = cnv.getContext("2d", { willReadFrequently: true });
  c.clearRect(0, 0, w, h);
  c.save();
  c.scale(scale, scale);
  for (const spec of STAGE1_PROPS) {
    drawStagePropTo(c, spec, 0, 0, { forCollision: true });
  }
  c.restore();
  const data = c.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  const cutoff = CONFIG.collisionAlpha;
  for (let i = 0; i < w * h; i++) {
    mask[i] = data[i * 4 + 3] > cutoff ? 1 : 0;
  }
  collision.width = w;
  collision.height = h;
  collision.scale = scale;
  collision.mask = mask;
  collision.canvas = cnv;
}

function solidAt(wx, wy) {
  if (!collision.mask) return false;
  if (wy >= world.height - 1) return true;
  const x = Math.floor(wx * collision.scale);
  const y = Math.floor(wy * collision.scale);
  if (x < 0 || y < 0 || x >= collision.width || y >= collision.height) {
    return false;
  }
  return collision.mask[y * collision.width + x] === 1;
}

function surfaceNormal(wx, wy) {
  const e = 4;
  const gx =
    (solidAt(wx + e, wy) ? 1 : 0) - (solidAt(wx - e, wy) ? 1 : 0);
  const gy =
    (solidAt(wx, wy + e) ? 1 : 0) - (solidAt(wx, wy - e) ? 1 : 0);
  let nx = -gx;
  let ny = -gy;
  const len = Math.hypot(nx, ny);
  if (len < 0.01) return { x: 0, y: -1 };
  return { x: nx / len, y: ny / len };
}

function hitsSolidCircle(wx, wy, radius) {
  if (solidAt(wx, wy)) return true;
  const r = radius;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    if (solidAt(wx + Math.cos(a) * r, wy + Math.sin(a) * r)) return true;
  }
  return false;
}

function pushOutOfSolid(wx, wy, radius) {
  if (!hitsSolidCircle(wx, wy, radius)) return null;
  let x = wx;
  let y = wy;
  let nx = 0;
  let ny = -1;
  for (let i = 0; i < 22; i++) {
    const n = surfaceNormal(x, y);
    nx = n.x;
    ny = n.y;
    x += nx * 2;
    y += ny * 2;
    if (!hitsSolidCircle(x, y, radius)) {
      return { x, y, dx: x - wx, dy: y - wy, nx, ny };
    }
  }
  return { x, y, dx: x - wx, dy: y - wy, nx, ny };
}

function bakeSpriteSamples(img, options = {}) {
  if (!img) return [];
  const stride = options.stride ?? 8;
  const flipX = options.flipX;
  const yMin = options.yMin ?? 0;
  const yMax = options.yMax ?? SPRITE;
  const cnv = document.createElement("canvas");
  cnv.width = SPRITE;
  cnv.height = SPRITE;
  const c = cnv.getContext("2d", { willReadFrequently: true });
  c.clearRect(0, 0, SPRITE, SPRITE);
  c.drawImage(img, 0, 0, SPRITE, SPRITE);
  const data = c.getImageData(0, 0, SPRITE, SPRITE).data;
  const samples = [];
  for (let y = yMin; y < yMax; y += stride) {
    for (let x = 0; x < SPRITE; x += stride) {
      if (data[(y * SPRITE + x) * 4 + 3] > 24) {
        samples.push({
          x: flipX == null ? x : 2 * flipX - x,
          y,
        });
      }
    }
  }
  return samples;
}

function bakeHammerCollider() {
  hammerCollider.samples = bakeSpriteSamples(images.hammer, { stride: 8 });
}

function bakePlayerCollider() {
  const flipX = RIG.originX;
  playerCollider.samples = [
    ...bakeSpriteSamples(images.box, { flipX, stride: 8 }),
    ...bakeSpriteSamples(images.body, { flipX, stride: 8 }),
  ];
  playerCollider.feet = bakeSpriteSamples(images.box, {
    flipX,
    stride: 4,
    yMin: RIG.originY - 56,
    yMax: RIG.originY + 1,
  });
  if (!playerCollider.feet.length) {
    playerCollider.feet = playerCollider.samples;
  }
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function setHammerPose(aim, gripDist) {
  const reach = armReachProfile();
  player.aim = aim;
  player.gripDist = clamp(gripDist, reach.flexDist, reach.extendDist);
  player.targetHammerAngle = player.aim - hammerHeadFromGripAngle();
  player.hammerAngle = player.targetHammerAngle;
}

function firstSolidAlong(x0, y0, x1, y1, radius) {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  if (dist < 0.4) {
    return hitsSolidCircle(x1, y1, radius)
      ? pushOutOfSolid(x1, y1, radius)
      : null;
  }
  const steps = Math.max(3, Math.ceil(dist / 2.5));
  let clearX = x0;
  let clearY = y0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    if (hitsSolidCircle(x, y, radius)) {
      return (
        pushOutOfSolid(x, y, radius) ||
        pushOutOfSolid(clearX, clearY, radius)
      );
    }
    clearX = x;
    clearY = y;
  }
  return null;
}

function hammerHeadOffset() {
  const pose = getHammerPose();
  return { x: pose.head.x - player.x, y: pose.head.y - player.y };
}

function snapBodyToPlant() {
  const plant = player.plant;
  if (!plant) return;
  const off = hammerHeadOffset();
  player.x = plant.x - off.x;
  player.y = plant.y - off.y;
  player.vx = 0;
  player.vy = 0;
  player.grounded = false;
}

function withTempHammerPose(aim, grip, fn) {
  const snap = {
    x: player.x,
    y: player.y,
    aim: player.aim,
    gripDist: player.gripDist,
    hammerAngle: player.hammerAngle,
    targetHammerAngle: player.targetHammerAngle,
  };
  setHammerPose(aim, grip);
  const result = fn();
  player.x = snap.x;
  player.y = snap.y;
  player.aim = snap.aim;
  player.gripDist = snap.gripDist;
  player.hammerAngle = snap.hammerAngle;
  player.targetHammerAngle = snap.targetHammerAngle;
  return result;
}

function plantedBodyRadius(aim, grip) {
  return withTempHammerPose(aim, grip, () => {
    snapBodyToPlant();
    return Math.hypot(player.x - player.plant.x, player.y - player.plant.y);
  });
}

function updatePlantedHammer(mouse) {
  const plant = player.plant;
  const dx = mouse.x - plant.x;
  const dy = mouse.y - plant.y;
  const wantR = Math.hypot(dx, dy);
  if (wantR < 8) return;

  const aim = Math.atan2(dy, dx);
  const reach = armReachProfile();
  const minR = plantedBodyRadius(aim, reach.flexDist);
  const maxR = plantedBodyRadius(aim, reach.extendDist);
  const t = clamp((wantR - minR) / Math.max(1, maxR - minR), 0, 1);
  const grip = reach.flexDist + t * (reach.extendDist - reach.flexDist);
  player.aim = lerpAngle(player.aim, aim, 0.42);
  player.gripDist += (grip - player.gripDist) * 0.42;
  setHammerPose(player.aim, player.gripDist);
}

function shouldKeepPlant() {
  const plant = player.plant;
  if (!plant) return false;
  if (!hitsSolidCircle(plant.x, plant.y, CONFIG.hammerHeadRadius + 10)) {
    return false;
  }
  const mid = shoulderMidpoint();
  const mouseX = input.smoothWorldX ?? mid.x;
  const mouseY = input.smoothWorldY ?? mid.y;
  const toPlantX = plant.x - mid.x;
  const toPlantY = plant.y - mid.y;
  const toMouseX = mouseX - mid.x;
  const toMouseY = mouseY - mid.y;
  const align = toPlantX * toMouseX + toPlantY * toMouseY;
  const mouseDist = Math.hypot(toMouseX, toMouseY);
  if (align < 0 && mouseDist > 36) return false;
  return true;
}

function clearPlant(cooldown = 0.14) {
  player.plant = null;
  player.contact = null;
  player.plantCooldown = Math.max(player.plantCooldown, cooldown);
}

function applyPlantPose(aim, grip) {
  setHammerPose(aim, grip);
  snapBodyToPlant();
  return !playerBoxOverlaps();
}

function resolvePlantedMotion() {
  const prevAim = player.prevAim ?? player.aim;
  const prevGrip = player.prevGripDist ?? player.gripDist;
  const wantAim = player.aim;
  const wantGrip = player.gripDist;

  if (applyPlantPose(wantAim, wantGrip)) {
    player.prevAim = wantAim;
    player.prevGripDist = wantGrip;
    player.contact = player.plant;
    return;
  }

  let lo = 0;
  let hi = 1;
  let best = 0;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    if (applyPlantPose(lerpAngle(prevAim, wantAim, mid), prevGrip + (wantGrip - prevGrip) * mid)) {
      best = mid;
      lo = mid;
    } else {
      hi = mid;
    }
  }

  if (applyPlantPose(lerpAngle(prevAim, wantAim, best), prevGrip + (wantGrip - prevGrip) * best)) {
    player.prevAim = player.aim;
    player.prevGripDist = player.gripDist;
    player.contact = player.plant;
    return;
  }

  if (applyPlantPose(prevAim, prevGrip)) {
    player.contact = player.plant;
    return;
  }

  player.x = player.prevPlantX ?? player.x;
  player.y = player.prevPlantY ?? player.y;
  setHammerPose(prevAim, prevGrip);
  player.contact = player.plant;
}

function tryPlantHammerHead() {
  if (player.plantCooldown > 0) return false;
  const pose = getHammerPose();
  const radius = CONFIG.hammerHeadRadius;
  const head = pose.head;
  const prev = player.lastHead || head;
  const hit =
    firstSolidAlong(prev.x, prev.y, head.x, head.y, radius) ||
    (hitsSolidCircle(head.x, head.y, radius)
      ? pushOutOfSolid(head.x, head.y, radius)
      : null);
  if (!hit) return false;
  if (Math.hypot(hit.x - head.x, hit.y - head.y) > radius + 16) return false;

  const ox = player.x;
  const oy = player.y;
  player.plant = { x: hit.x, y: hit.y, nx: hit.nx, ny: hit.ny };
  snapBodyToPlant();
  if (playerBoxOverlaps()) {
    player.x = ox;
    player.y = oy;
    const still = getHammerPose().head;
    if (Math.hypot(still.x - hit.x, still.y - hit.y) > radius + 22) {
      player.plant = null;
      return false;
    }
  }
  player.prevAim = player.aim;
  player.prevGripDist = player.gripDist;
  player.prevPlantX = player.x;
  player.prevPlantY = player.y;
  player.contact = player.plant;
  return true;
}

/**
 * 망치 머리가 표면에 닿으면 그 자리에 고정하고, 몸은 그 축으로 움직인다.
 * 자루만 스치면 고정하지 않는다.
 */
function resolveHammerContact() {
  player.contact = player.plant;

  if (player.plant) {
    if (!shouldKeepPlant()) {
      clearPlant();
      return;
    }
    resolvePlantedMotion();
    player.prevPlantX = player.x;
    player.prevPlantY = player.y;
    return;
  }

  tryPlantHammerHead();
}

function playerBodyWorldPoints() {
  return playerCollider.samples.map((s) => spriteToWorld(s.x, s.y));
}

function playerBoxOverlaps() {
  return playerBodyWorldPoints().some((p) => solidAt(p.x, p.y));
}

function boxOverlapsAt(x, y) {
  const ox = player.x;
  const oy = player.y;
  player.x = x;
  player.y = y;
  const hit = playerBoxOverlaps();
  player.x = ox;
  player.y = oy;
  return hit;
}

function axisClearance(nx, ny, maxDist) {
  const ox = player.x;
  const oy = player.y;
  if (!playerBoxOverlaps()) return 0;
  if (boxOverlapsAt(ox + nx * maxDist, oy + ny * maxDist)) return Infinity;
  let lo = 0;
  let hi = maxDist;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (boxOverlapsAt(ox + nx * mid, oy + ny * mid)) lo = mid;
    else hi = mid;
  }
  return hi;
}

/** 겹치면 중력처럼 위로 빼서 바닥에 앉히고, 벽이면 옆으로만 민다. */
function pushBoxOut() {
  const maxPush = 80;
  const up = axisClearance(0, -1, maxPush);
  const left = axisClearance(-1, 0, maxPush);
  const right = axisClearance(1, 0, maxPush);
  const down = axisClearance(0, 1, maxPush);
  const side = Math.min(left, right);

  let nx = 0;
  let ny = -1;
  let dist = up;
  const wallLikely = side < Infinity && (up === Infinity || side + 2 < up);
  if (wallLikely) {
    nx = left < right ? -1 : 1;
    ny = 0;
    dist = side;
  } else if (up === Infinity) {
    if (side < Infinity) {
      nx = left < right ? -1 : 1;
      ny = 0;
      dist = side;
    } else if (down < Infinity) {
      nx = 0;
      ny = 1;
      dist = down;
    } else {
      return false;
    }
  }

  const eps = 0.2;
  player.x += nx * (dist + (ny === 0 ? eps : 0));
  player.y += ny * (dist + (ny < 0 ? 0.05 : 0));
  return ny < 0;
}

function nearestFloorGap(maxDrop) {
  let nearest = Infinity;
  const feet = playerCollider.feet.length
    ? playerCollider.feet
    : playerCollider.samples;
  for (const s of feet) {
    const p = spriteToWorld(s.x, s.y);
    for (let d = 1; d <= maxDrop; d++) {
      if (solidAt(p.x, p.y + d)) {
        if (d < nearest) nearest = d;
        break;
      }
    }
  }
  return nearest;
}

function hasGroundSupport(slop = 6) {
  return nearestFloorGap(slop) !== Infinity;
}

/** 아래 표면까지 떨어뜨려 겉면에 붙인다. 겹치기 직전에서 멈춘다. */
function snapDownToSurface(maxDrop = 14) {
  const ox = player.x;
  const oy = player.y;
  if (boxOverlapsAt(ox, oy)) return false;

  if (boxOverlapsAt(ox, oy + maxDrop)) {
    let lo = 0;
    let hi = maxDrop;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      if (boxOverlapsAt(ox, oy + mid)) hi = mid;
      else lo = mid;
    }
    player.y = oy + lo;
    return true;
  }

  const gap = nearestFloorGap(maxDrop);
  if (gap === Infinity) return false;
  player.y = oy + Math.max(0, gap - 0.35);
  return true;
}

function resolvePlayerBody() {
  if (playerBoxOverlaps()) {
    const up = pushBoxOut();
    if (up && player.vy > 0) player.vy = 0;
  }

  if (player.vy >= 0 && hasGroundSupport(6)) {
    snapDownToSurface(6);
    player.grounded = true;
    if (player.vy > 0) player.vy = 0;
  } else {
    player.grounded = false;
  }
}

function settlePlayerOnSurface() {
  player.contact = null;
  player.plant = null;
  player.lastHead = null;
  player.plantCooldown = 0;
  player.grounded = false;
  for (let i = 0; i < 48; i++) {
    player.y += 8;
    if (playerBoxOverlaps()) {
      pushBoxOut();
      break;
    }
  }
  resolvePlayerBody();
  player.vx = 0;
  player.vy = 0;
}

function clampPlayerSpeed() {
  const speed = Math.hypot(player.vx, player.vy);
  if (speed > CONFIG.maxPlayerSpeed) {
    const s = CONFIG.maxPlayerSpeed / speed;
    player.vx *= s;
    player.vy *= s;
  }
  if (player.vy > CONFIG.maxFallSpeed) player.vy = CONFIG.maxFallSpeed;
}

function updatePhysics(dt) {
  if (player.plantCooldown > 0) {
    player.plantCooldown = Math.max(0, player.plantCooldown - dt);
  }
  if (!player.plant) {
    player.vy += CONFIG.gravity * dt;
    clampPlayerSpeed();
    player.x += player.vx * dt;
    player.y += player.vy * dt;
  }

  resolveHammerContact();
  const head = getHammerPose().head;
  player.lastHead = { x: head.x, y: head.y };

  if (!player.plant) {
    resolvePlayerBody();
    clampPlayerSpeed();
    if (player.grounded) {
      if (player.vy > 0) player.vy = 0;
      player.vx *= Math.exp(-CONFIG.groundFriction * dt);
    } else {
      player.vx *= Math.exp(-CONFIG.airDrag * dt);
    }
  }

  if (player.x < 24) {
    player.x = 24;
    if (player.vx < 0) player.vx = 0;
  }
  if (player.x > world.width - 24) {
    player.x = world.width - 24;
    if (player.vx > 0) player.vx = 0;
  }
  if (player.y > world.height - 4) {
    player.y = world.height - 4;
    player.vy = 0;
    player.grounded = true;
  }
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

function hammerFlipX(lx) {
  return 2 * RIG.hammer.pivotX - lx;
}

function hammerHeadFromGripAngle() {
  const H = RIG.hammer;
  const grip = hammerGripLocal();
  return Math.atan2(H.headY - grip.y, hammerFlipX(H.headX) - hammerFlipX(grip.x));
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

/** 팔 하나 기준 손까지 거리. 방향과 관계없이 같은 길이로 편다. */
function armReachProfile() {
  const upper = RIG.armLen.upper * player.scale;
  const lower = RIG.armLen.lower * player.scale;
  const maxReach = upper + lower;
  return {
    upper,
    lower,
    maxReach,
    extendDist: maxReach * 0.995,
    flexDist: maxReach * 0.28,
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
  const dx = (hammerFlipX(grip.x) - H.pivotX) * s;
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
    const ox = (hammerFlipX(lx) - H.pivotX) * s;
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
    toWorld: localToWorld,
  };
}

function solveArms() {
  const shoulderL = spriteToWorld(RIG.shoulderL.x, RIG.shoulderL.y);
  const shoulderR = spriteToWorld(RIG.shoulderR.x, RIG.shoulderR.y);
  const upper = RIG.armLen.upper * player.scale;
  const lower = RIG.armLen.lower * player.scale;
  const dist = player.gripDist;
  const dirX = Math.cos(player.aim);
  const dirY = Math.sin(player.aim);

  const left = solveTwoBone(
    shoulderL.x,
    shoulderL.y,
    shoulderL.x + dirX * dist,
    shoulderL.y + dirY * dist,
    upper,
    lower,
    player.arms.left,
    1
  );
  const right = solveTwoBone(
    shoulderR.x,
    shoulderR.y,
    shoulderR.x + dirX * dist,
    shoulderR.y + dirY * dist,
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

function updateHammer(dt) {
  player.prevHammerAngle = player.hammerAngle;
  const raw = screenToWorld(input.mouseX, input.mouseY);
  if (input.smoothWorldX == null) {
    input.smoothWorldX = raw.x;
    input.smoothWorldY = raw.y;
  }
  input.prevWorldX = input.smoothWorldX;
  input.prevWorldY = input.smoothWorldY;
  if (!input.mouseInView) return;

  const k = 1 - Math.pow(1 - CONFIG.mouseSmoothing, dt * 60);
  input.smoothWorldX += (raw.x - input.smoothWorldX) * k;
  input.smoothWorldY += (raw.y - input.smoothWorldY) * k;

  const mouse = { x: input.smoothWorldX, y: input.smoothWorldY };
  if (player.plant) {
    updatePlantedHammer(mouse);
    return;
  }

  const pivot = shoulderMidpoint();
  const aim = Math.atan2(mouse.y - pivot.y, mouse.x - pivot.x);
  const dist = Math.hypot(mouse.x - pivot.x, mouse.y - pivot.y);
  const reach = armReachProfile();
  const targetGrip = clamp(dist, reach.flexDist, reach.extendDist);
  player.aim = lerpAngle(player.aim, aim, k);
  player.gripDist += (targetGrip - player.gripDist) * k;
  player.targetHammerAngle = player.aim - hammerHeadFromGripAngle();
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

function drawFlippedLayer(key) {
  const img = images[key];
  if (!img) return;
  ctx.save();
  ctx.translate(RIG.originX, 0);
  ctx.scale(-1, 1);
  ctx.translate(-RIG.originX, 0);
  ctx.drawImage(img, 0, 0, SPRITE, SPRITE);
  ctx.restore();
}

function isHammerOnRight() {
  return Math.cos(player.aim) > 0;
}

function drawHead() {
  const img = images.head;
  if (!img) return;
  if (!isHammerOnRight()) {
    ctx.drawImage(img, 0, 0, SPRITE, SPRITE);
    return;
  }
  ctx.save();
  ctx.translate(RIG.headFlipX, 0);
  ctx.scale(-1, 1);
  ctx.translate(-RIG.headFlipX, 0);
  ctx.drawImage(img, 0, 0, SPRITE, SPRITE);
  ctx.restore();
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

  drawJoint(shoulder.x, shoulder.y, jointRadius(upperLen, RIG.limbs.upper) * 0.62);
  drawLimb(imgUpper, RIG.limbs.upper, a.x, a.y, e.x, e.y);
  drawJoint(elbow.x, elbow.y, jointRadius(upperLen, RIG.limbs.upper) * 0.7);
  drawLimb(imgLower, RIG.limbs.lower, e.x, e.y, w.x, w.y);
  drawJoint(wrist.x, wrist.y, jointRadius(lowerLen, RIG.limbs.lower) * 0.55);
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
    -player.scale * CONFIG.hammerScale,
    player.scale * CONFIG.hammerScale
  );
  ctx.drawImage(img, -H.pivotX, -H.pivotY, SPRITE, SPRITE);
  ctx.restore();
}

function drawPlayer() {
  const pose = getHammerPose();
  const arms = solveArms();
  const leftElbow = { x: arms.left.elbowX, y: arms.left.elbowY };
  const rightElbow = { x: arms.right.elbowX, y: arms.right.elbowY };
  const leftWrist = { x: arms.left.handX, y: arms.left.handY };
  const rightWrist = { x: arms.right.handX, y: arms.right.handY };

  // 왼팔은 가장 뒤. 몸통·얼굴과 겹치면 그 아래로 가려진다.
  drawArm(images.leftArm2, images.leftArm1, arms.shoulderL, leftElbow, leftWrist);

  // 꼬리 → 몸통 → 박스(몸통 아래를 가림) → 머리
  withPlayerTransform(() => {
    drawFlippedLayer("tail");
    drawFlippedLayer("body");
    drawFlippedLayer("box");
    drawHead();
  });

  drawArm(images.rightArm2, images.rightArm1, arms.shoulderR, rightElbow, rightWrist);

  drawHammer(pose);

  // 손은 도끼보다 위. 손잡이와 겹쳐도 손이 앞에 보인다.
  drawHandOnGrip(images.rightHand, pose.gripFront, pose.angle, true);
  drawHandOnGrip(images.leftHand, pose.gripBack, pose.angle, false);
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
    if (e.code === "KeyV") {
      CONFIG.showCollisionDebug = !CONFIG.showCollisionDebug;
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
    player.lastMouseDist = null;
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
  const prevWorldWidth = world.width;
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

  const prevPlayerRatioX =
    prevWorldWidth > 0 ? player.x / prevWorldWidth : 0.36;
  const prevPlayerRatioY =
    prevWorldHeight > 0 ? player.y / prevWorldHeight : 0.82;

  dpr = window.devicePixelRatio || 1;
  const cssWidth = window.innerWidth;
  const cssHeight = window.innerHeight;
  canvas.width = Math.floor(cssWidth * dpr);
  canvas.height = Math.floor(cssHeight * dpr);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  rebuildWorldFromBackground();
  rebuildCollision();

  if (world.height > 0) {
    if (prevWorldHeight > 0) {
      player.x = prevPlayerRatioX * world.width;
      player.y = prevPlayerRatioY * world.height;
    } else {
      const stand = getRockStandPoint();
      player.x = stand.x;
      player.y = stand.y;
    }
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
    `head: (${Math.round(pose.head.x)}, ${Math.round(pose.head.y)})`,
    `plant: ${player.plant ? `(${Math.round(player.plant.x)}, ${Math.round(player.plant.y)})` : "none"}`,
    `camera: ${CONFIG.freeCamera ? "FREE (C to follow)" : "FOLLOW (C to free)"}`,
    `vel: (${Math.round(player.vx)}, ${Math.round(player.vy)})`,
    `mouse: aim hammer`,
    `contact: ${player.plant ? "PINNED" : player.contact ? "HAMMER" : player.grounded ? "GROUND" : "AIR"}`,
    `debug: ${CONFIG.showCollisionDebug ? "ON (V)" : "OFF (V)"}`,
  ].join("\n");
}

function update(dt) {
  if (gameState !== GameState.PLAYING) return;
  updateHammer(dt);
  updatePhysics(dt);
  updateCameraFromKeyboard(dt);
  updateCamera(dt);
}

function drawCollisionDebug() {
  if (!CONFIG.showCollisionDebug) return;
  const pose = getHammerPose();
  const origin = worldToScreen(0, 0);

  if (collision.canvas) {
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.drawImage(
      collision.canvas,
      origin.x,
      origin.y,
      world.width,
      world.height
    );
    ctx.restore();
  }

  const head = worldToScreen(pose.head.x, pose.head.y);
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = player.contact ? "#5dff6a" : "#ffd84a";
  ctx.beginPath();
  ctx.arc(head.x, head.y, CONFIG.hammerHeadRadius, 0, Math.PI * 2);
  ctx.stroke();

  if (player.contact) {
    const c = worldToScreen(player.contact.x, player.contact.y);
    ctx.fillStyle = "#ff3b5c";
    ctx.beginPath();
    ctx.arc(c.x, c.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#6ad8ff";
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(
      c.x + player.contact.nx * 32,
      c.y + player.contact.ny * 32
    );
    ctx.stroke();
  }
  ctx.restore();
}

function render() {
  const { width: vw, height: vh } = getViewportSize();
  ctx.clearRect(0, 0, vw, vh);
  drawBackground();
  drawStageObjects();
  drawCollisionDebug();
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
    await Promise.all([
      ...Object.entries(ASSETS.stage1).map(async ([key, src]) => {
        images[key] = await loadImage(src);
      }),
      ...Object.entries(ASSETS.player).map(async ([key, src]) => {
        images[key] = await loadPlayerImage(src);
      }),
      ...Object.entries(ASSETS.collision).map(async ([key, src]) => {
        images[key] = await loadImage(src);
      }),
    ]);
  } catch (err) {
    console.error(err);
    debugHud.textContent = String(err.message || err);
    return;
  }

  bakeHammerCollider();
  bakePlayerCollider();
  resize();
  spawnPlayer();
  settlePlayerOnSurface();
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
