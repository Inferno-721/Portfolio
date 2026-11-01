import { refractGlass } from "./liquid-glass.ts";

/** Matches the delay before a card's far side becomes visible and focusable. */
const FLIP_FOCUS_DELAY_MS = 190;

function face(card: HTMLElement, side: "front" | "back"): HTMLElement {
  const element = card.querySelector<HTMLElement>(`[data-face="${side}"]`);
  if (!element) throw new Error(`Project card is missing its ${side} face`);
  return element;
}

function setFlipped(card: HTMLElement, flipped: boolean): void {
  card.classList.toggle("is-flipped", flipped);
  face(card, "front").inert = flipped;
  face(card, "back").inert = !flipped;
  if (flipped) refractGlass(face(card, "back"));
}

/** Runs a DOM change as a morph where the browser can, and straight away where it can't. */
function transition(update: () => void, done?: () => void): void {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced || !document.startViewTransition) {
    update();
    done?.();
    return;
  }
  const running = document.startViewTransition(update);
  // A skipped animation rejects `ready`, but the DOM change has still been applied.
  running.ready.catch((error: unknown) => {
    console.debug("View transition skipped:", error);
  });
  void running.finished.finally(() => done?.());
}

export function startProjectGallery(): void {
  const gallery = document.querySelector<HTMLElement>("[data-project-gallery]");
  if (!gallery) return;

  const cards = [...gallery.querySelectorAll<HTMLElement>("[data-flip-card]")];
  const dialog = gallery.querySelector<HTMLDialogElement>("[data-lightbox]");
  const panel = gallery.querySelector<HTMLElement>("[data-lightbox-panel]");
  const counter = gallery.querySelector<HTMLElement>("[data-lightbox-counter]");
  const items = [
    ...gallery.querySelectorAll<HTMLElement>("[data-lightbox-item]"),
  ];
  if (!dialog || !panel || !counter) return;

  for (const card of cards) setFlipped(card, false);

  let currentIndex = 0;

  function showItem(index: number): void {
    currentIndex = (index + items.length) % items.length;
    items.forEach((item, itemIndex) => {
      item.hidden = itemIndex !== currentIndex;
    });
    counter!.textContent = `${currentIndex + 1} / ${items.length}`;
    dialog!.setAttribute(
      "aria-label",
      items[currentIndex]?.dataset.lightboxItem ?? "Project details",
    );
    panel!.scrollTop = 0;
  }

  function openLightbox(index: number): void {
    const card = cards[index];
    if (!card) return;
    card.style.viewTransitionName = "project-morph";
    transition(
      () => {
        card.style.viewTransitionName = "";
        panel!.style.viewTransitionName = "project-morph";
        showItem(index);
        dialog!.showModal();
      },
      () => {
        panel!.style.viewTransitionName = "";
        // Focus can't land while a transition holds rendering, so set it afterwards.
        dialog!
          .querySelector<HTMLElement>("[data-lightbox-close]")
          ?.focus({ preventScroll: true });
      },
    );
  }

  function closeLightbox(): void {
    const card = cards[currentIndex];
    panel!.style.viewTransitionName = "project-morph";
    transition(
      () => {
        panel!.style.viewTransitionName = "";
        dialog!.close();
        if (card) card.style.viewTransitionName = "project-morph";
      },
      () => {
        if (card) card.style.viewTransitionName = "";
      },
    );
  }

  gallery.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const flip = target.closest<HTMLElement>("[data-flip]");
    if (flip) {
      const card = flip.closest<HTMLElement>("[data-flip-card]");
      if (!card) return;
      const flipped = !card.classList.contains("is-flipped");
      // One open card at a time keeps the grid easy to read.
      for (const other of cards) {
        if (other !== card && other.classList.contains("is-flipped")) {
          setFlipped(other, false);
        }
      }
      setFlipped(card, flipped);
      // detail is 0 for keyboard activation, where focus has to follow the flip.
      if (event instanceof MouseEvent && event.detail === 0) {
        const side = flipped ? "back" : "front";
        window.setTimeout(() => {
          face(card, side)
            .querySelector<HTMLElement>("button, a")
            ?.focus({ preventScroll: true });
        }, FLIP_FOCUS_DELAY_MS);
      }
      return;
    }

    const open = target.closest<HTMLElement>("[data-open-lightbox]");
    if (open) {
      openLightbox(Number(open.dataset.openLightbox));
      return;
    }

    if (target.closest("[data-lightbox-prev]")) showItem(currentIndex - 1);
    else if (target.closest("[data-lightbox-next]")) showItem(currentIndex + 1);
    else if (target.closest("[data-lightbox-close]") || target === dialog) {
      closeLightbox();
    }
  });

  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeLightbox();
  });

  dialog.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") showItem(currentIndex - 1);
    if (event.key === "ArrowRight") showItem(currentIndex + 1);
  });
}
