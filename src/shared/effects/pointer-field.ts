/**
 * Full-page background: a still lattice that only moves when the cursor does. Nearby
 * points get pushed aside and light up, then spring back and the render loop stops, so
 * an idle page does no work and nothing moves on its own.
 */

const RADIUS = 250;
const PUSH = 24;
const STIFFNESS = 0.09;
const DAMPING = 0.78;
const ENERGY_RATE = 0.16;
const IDLE_MS = 300;
const SETTLED = 0.03;
const SETTLED_PX = 0.15;
const FRAME_MS = 1000 / 60;

const RIPPLE_SPEED = 0.9;
const RIPPLE_WIDTH = 70;
const RIPPLE_PUSH = 22;
const RIPPLE_LIFE_MS = 900;

const GLOW_RADIUS = 300;
const GLOW_ALPHA = 0.13;
const MESH_ALPHA = 0.75;

type Point = {
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  velocityX: number;
  velocityY: number;
  energy: number;
  right: Point | null;
  down: Point | null;
};

type Ripple = { x: number; y: number; start: number };

export function startPointerField(canvas: HTMLCanvasElement): boolean {
  const context = canvas.getContext("2d");
  if (!context) return false;
  const ctx = context;

  let width = 0;
  let height = 0;
  let points: Point[] = [];
  let ripples: Ripple[] = [];
  let ink = "";
  let accent = "";
  let restAlpha = 0;

  const pointer = {
    x: 0,
    y: 0,
    targetX: 0,
    targetY: 0,
    presence: 0,
    lastMove: 0,
  };

  function readTheme(): void {
    const tokens = getComputedStyle(document.documentElement);
    ink = tokens.getPropertyValue("--text").trim();
    accent = tokens.getPropertyValue("--primary").trim();
    restAlpha = Number(tokens.getPropertyValue("--field-rest-alpha")) || 0;
  }

  function layout(): void {
    const scale = Math.min(devicePixelRatio || 1, 2);
    width = innerWidth;
    height = innerHeight;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    const spacing = width < 640 ? 24 : 28;
    const offsetX = (width % spacing) / 2;
    const offsetY = (height % spacing) / 2;
    points = [];
    let above: Point[] = [];
    for (let y = offsetY; y <= height; y += spacing) {
      const row: Point[] = [];
      for (let x = offsetX; x <= width; x += spacing) {
        const point: Point = {
          x,
          y,
          offsetX: 0,
          offsetY: 0,
          velocityX: 0,
          velocityY: 0,
          energy: 0,
          right: null,
          down: null,
        };
        const left = row.at(-1);
        if (left) left.right = point;
        const up = above[row.length];
        if (up) up.down = point;
        row.push(point);
        points.push(point);
      }
      above = row;
    }
  }

  /** Advances the physics. Returns whether anything is still moving. */
  function update(now: number, step: number): boolean {
    const wanted = now - pointer.lastMove < IDLE_MS ? 1 : 0;
    pointer.presence += (wanted - pointer.presence) * (1 - 0.82 ** step);
    pointer.x += (pointer.targetX - pointer.x) * (1 - 0.72 ** step);
    pointer.y += (pointer.targetY - pointer.y) * (1 - 0.72 ** step);
    ripples = ripples.filter(({ start }) => now - start < RIPPLE_LIFE_MS);

    let moving = pointer.presence > SETTLED || ripples.length > 0;

    for (const point of points) {
      let targetX = 0;
      let targetY = 0;
      let energy = 0;

      const dx = point.x - pointer.x;
      const dy = point.y - pointer.y;
      const distance = Math.hypot(dx, dy) || 1;
      if (distance < RADIUS && pointer.presence > 0) {
        const influence = (1 - distance / RADIUS) ** 1.6 * pointer.presence;
        targetX += (dx / distance) * influence * PUSH;
        targetY += (dy / distance) * influence * PUSH;
        energy = influence;
      }

      for (const ripple of ripples) {
        const age = now - ripple.start;
        const rx = point.x - ripple.x;
        const ry = point.y - ripple.y;
        const reach = Math.hypot(rx, ry) || 1;
        const off = Math.abs(reach - age * RIPPLE_SPEED);
        if (off < RIPPLE_WIDTH) {
          const wave = (1 - off / RIPPLE_WIDTH) * (1 - age / RIPPLE_LIFE_MS);
          targetX += (rx / reach) * wave * RIPPLE_PUSH;
          targetY += (ry / reach) * wave * RIPPLE_PUSH;
          energy = Math.max(energy, wave);
        }
      }

      point.velocityX += (targetX - point.offsetX) * STIFFNESS * step;
      point.velocityY += (targetY - point.offsetY) * STIFFNESS * step;
      point.velocityX *= DAMPING ** step;
      point.velocityY *= DAMPING ** step;
      point.offsetX += point.velocityX * step;
      point.offsetY += point.velocityY * step;
      point.energy += (energy - point.energy) * (1 - (1 - ENERGY_RATE) ** step);

      const still =
        Math.abs(point.offsetX) < SETTLED_PX &&
        Math.abs(point.offsetY) < SETTLED_PX &&
        Math.abs(point.velocityX) < SETTLED_PX &&
        Math.abs(point.velocityY) < SETTLED_PX &&
        point.energy < SETTLED;
      if (still) {
        point.offsetX = 0;
        point.offsetY = 0;
        point.velocityX = 0;
        point.velocityY = 0;
        point.energy = 0;
      } else {
        moving = true;
      }
    }
    return moving;
  }

  function drawGlow(): void {
    if (pointer.presence <= SETTLED) return;
    const glow = ctx.createRadialGradient(
      pointer.x,
      pointer.y,
      0,
      pointer.x,
      pointer.y,
      GLOW_RADIUS,
    );
    glow.addColorStop(0, accent);
    glow.addColorStop(1, `${accent}00`);
    ctx.globalAlpha = GLOW_ALPHA * pointer.presence;
    ctx.fillStyle = glow;
    ctx.fillRect(
      pointer.x - GLOW_RADIUS,
      pointer.y - GLOW_RADIUS,
      GLOW_RADIUS * 2,
      GLOW_RADIUS * 2,
    );
  }

  function drawDots(): void {
    ctx.globalAlpha = restAlpha;
    ctx.fillStyle = ink;
    ctx.beginPath();
    for (const { x, y, energy } of points) {
      if (energy > 0) continue;
      ctx.moveTo(x + 1, y);
      ctx.arc(x, y, 1, 0, Math.PI * 2);
    }
    ctx.fill();

    // Near the cursor the dots join into a mesh that warps as they get pushed aside.
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    for (const point of points) {
      if (point.energy === 0) continue;
      for (const neighbour of [point.right, point.down]) {
        if (!neighbour || neighbour.energy === 0) continue;
        ctx.globalAlpha = Math.min(point.energy, neighbour.energy) * MESH_ALPHA;
        ctx.beginPath();
        ctx.moveTo(point.x + point.offsetX, point.y + point.offsetY);
        ctx.lineTo(
          neighbour.x + neighbour.offsetX,
          neighbour.y + neighbour.offsetY,
        );
        ctx.stroke();
      }
    }

    ctx.fillStyle = accent;
    for (const { x, y, offsetX, offsetY, energy } of points) {
      if (energy === 0) continue;
      ctx.globalAlpha = restAlpha + (1 - restAlpha) * Math.min(1, energy * 2);
      ctx.beginPath();
      ctx.arc(x + offsetX, y + offsetY, 1 + energy * 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function draw(): void {
    ctx.clearRect(0, 0, width, height);
    drawGlow();
    drawDots();
  }

  readTheme();
  layout();
  draw();

  new MutationObserver(() => {
    readTheme();
    draw();
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });

  let resizeTimer = 0;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      layout();
      draw();
    }, 150);
  });

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return true;

  let frameId = 0;
  let last = 0;

  function frame(now: number): void {
    const step = Math.max(0, Math.min((now - last) / FRAME_MS, 3));
    last = now;
    const moving = update(now, step);
    draw();
    frameId = moving ? requestAnimationFrame(frame) : 0;
  }

  function wake(): void {
    if (frameId) return;
    last = performance.now();
    frameId = requestAnimationFrame(frame);
  }

  function onMove(clientX: number, clientY: number): void {
    pointer.targetX = clientX;
    pointer.targetY = clientY;
    // Coming back after a pause, the effect starts at the cursor rather than sliding over.
    if (pointer.presence <= SETTLED) {
      pointer.x = clientX;
      pointer.y = clientY;
    }
    pointer.lastMove = performance.now();
    wake();
  }

  addEventListener(
    "pointermove",
    (event) => onMove(event.clientX, event.clientY),
    {
      passive: true,
    },
  );
  addEventListener(
    "touchmove",
    (event) => {
      const touch = event.touches[0];
      if (touch) onMove(touch.clientX, touch.clientY);
    },
    { passive: true },
  );
  // A click sends one ripple through the field.
  addEventListener(
    "pointerdown",
    (event) => {
      ripples.push({
        x: event.clientX,
        y: event.clientY,
        start: performance.now(),
      });
      wake();
    },
    { passive: true },
  );
  document.documentElement.addEventListener("pointerleave", () => {
    pointer.lastMove = 0;
  });

  return true;
}
