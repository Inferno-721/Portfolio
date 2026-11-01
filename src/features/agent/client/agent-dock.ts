/**
 * The floating agent available on every page. On the home page, where the full console
 * is already in the hero, the button tucks away until the hero has scrolled off.
 */
export function startAgentDock(): void {
  const dock = document.querySelector<HTMLElement>("[data-agent-dock]");
  const panel = dock?.querySelector<HTMLElement>("[data-agent-dock-panel]");
  const toggle = dock?.querySelector<HTMLElement>("[data-agent-dock-toggle]");
  const close = dock?.querySelector<HTMLElement>("[data-agent-dock-close]");
  if (!dock || !panel || !toggle || !close) return;

  const heroConsole = document.getElementById("ask");
  const canHover = matchMedia("(hover: hover) and (pointer: fine)").matches;

  function setOpen(open: boolean): void {
    panel!.hidden = !open;
    toggle!.setAttribute("aria-expanded", String(open));
    if (open && canHover) {
      // On phones this would pop up the keyboard before anyone asked for it.
      panel!.querySelector<HTMLElement>("[data-agent-input]")?.focus();
    }
    if (!open) toggle!.focus({ preventScroll: true });
  }

  toggle.addEventListener("click", () => setOpen(panel.hidden));
  close.addEventListener("click", () => setOpen(false));
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false);
  });

  // The header's "Ask my AI" scrolls to the hero at home and opens the dock elsewhere.
  if (!heroConsole) {
    for (const link of document.querySelectorAll('a[href="/#ask"]')) {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        setOpen(true);
      });
    }
    return;
  }

  new IntersectionObserver(
    ([entry]) => {
      if (!entry) return;
      if (entry.isIntersecting && !panel.hidden) setOpen(false);
      dock.classList.toggle("is-tucked", entry.isIntersecting);
    },
    { threshold: 0.15 },
  ).observe(heroConsole);
}
