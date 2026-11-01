/**
 * Cursor-driven details, wired by data attributes so markup stays declarative:
 *   data-spotlight  a glow that follows the cursor across the element's border and fill
 *   data-tilt       a small 3D tilt toward the cursor; "subtle" for long cards
 *   data-magnetic   pulled toward the cursor while hovered
 *   data-heat       text that heats up around the cursor
 * All of it is skipped on touch devices and under prefers-reduced-motion.
 */

const MAX_TILT_DEG = 5;
const SUBTLE_TILT_DEG = 1.5;
const MAGNET_PULL = 0.28;

type Point = { x: number; y: number };

function updateSpotlights(point: Point): void {
  for (const element of document.querySelectorAll<HTMLElement>(
    "[data-spotlight]",
  )) {
    const rect = element.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > innerHeight) continue;
    element.style.setProperty("--mx", `${point.x - rect.left}px`);
    element.style.setProperty("--my", `${point.y - rect.top}px`);
    const dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
    const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
    const reach = Math.max(0, 1 - Math.hypot(dx, dy) / 260);
    element.style.setProperty("--glow-on", reach.toFixed(3));
  }
}

function updateHeatText(point: Point): void {
  for (const element of document.querySelectorAll<HTMLElement>("[data-heat]")) {
    const rect = element.getBoundingClientRect();
    if (rect.bottom < -200 || rect.top > innerHeight + 200) continue;
    element.style.setProperty("--hx", `${point.x - rect.left}px`);
    element.style.setProperty("--hy", `${point.y - rect.top}px`);
  }
}

function updateTilt(target: Element | null, point: Point): void {
  const element = target?.closest<HTMLElement>("[data-tilt]");
  if (!element) return;
  const rect = element.getBoundingClientRect();
  const x = (point.x - rect.left) / rect.width - 0.5;
  const y = (point.y - rect.top) / rect.height - 0.5;
  const maxTilt =
    element.dataset.tilt === "subtle" ? SUBTLE_TILT_DEG : MAX_TILT_DEG;
  element.style.setProperty("--ry", `${(x * maxTilt * 2).toFixed(2)}deg`);
  element.style.setProperty("--rx", `${(-y * maxTilt * 2).toFixed(2)}deg`);
}

function updateMagnet(target: Element | null, point: Point): void {
  const element = target?.closest<HTMLElement>("[data-magnetic]");
  if (!element) return;
  const rect = element.getBoundingClientRect();
  const x = point.x - (rect.left + rect.width / 2);
  const y = point.y - (rect.top + rect.height / 2);
  element.style.setProperty("--tx", `${(x * MAGNET_PULL).toFixed(1)}px`);
  element.style.setProperty("--ty", `${(y * MAGNET_PULL).toFixed(1)}px`);
}

function resetOnLeave(selector: string, properties: string[]): void {
  document.addEventListener(
    "pointerout",
    (event) => {
      const from = (event.target as Element).closest<HTMLElement>(selector);
      if (!from || from.contains(event.relatedTarget as Node | null)) return;
      for (const property of properties) from.style.removeProperty(property);
    },
    { passive: true },
  );
}

export function startPointerEffects(): void {
  const canHover = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!canHover || reduced) return;

  let latest: { point: Point; target: Element | null } | null = null;
  let scheduled = false;

  function flush(): void {
    scheduled = false;
    if (!latest) return;
    const { point, target } = latest;
    updateSpotlights(point);
    updateHeatText(point);
    updateTilt(target, point);
    updateMagnet(target, point);
  }

  document.addEventListener(
    "pointermove",
    (event) => {
      latest = {
        point: { x: event.clientX, y: event.clientY },
        target: event.target instanceof Element ? event.target : null,
      };
      if (!scheduled) {
        scheduled = true;
        requestAnimationFrame(flush);
      }
    },
    { passive: true },
  );

  resetOnLeave("[data-tilt]", ["--rx", "--ry"]);
  resetOnLeave("[data-magnetic]", ["--tx", "--ty"]);
}
