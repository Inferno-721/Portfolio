/**
 * Scroll entrances. `data-reveal` fades an element in once; `data-count` counts its
 * number up when it arrives. Server-rendered text is already final, so nothing is lost
 * if this never runs.
 */

const COUNT_MS = 900;

function countUp(element: HTMLElement): void {
  const final = element.textContent ?? "";
  const match = final.match(/\d+/);
  if (!match || match.index === undefined) return;
  const target = Number(match[0]);
  const before = final.slice(0, match.index);
  const after = final.slice(match.index + match[0].length);
  const start = performance.now();

  function tick(now: number): void {
    const progress = Math.min(1, (now - start) / COUNT_MS);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = `${before}${Math.round(target * eased)}${after}`;
    if (progress < 1) requestAnimationFrame(tick);
    else element.textContent = final;
  }
  requestAnimationFrame(tick);
}

export function startReveals(): void {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const elements = document.querySelectorAll<HTMLElement>("[data-reveal]");

  if (reduced || !("IntersectionObserver" in window)) {
    for (const element of elements) element.classList.add("is-in");
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const element = entry.target as HTMLElement;
        element.classList.add("is-in");
        for (const counter of element.querySelectorAll<HTMLElement>(
          "[data-count]",
        )) {
          countUp(counter);
        }
        observer.unobserve(element);
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
  );
  for (const element of elements) observer.observe(element);
}
