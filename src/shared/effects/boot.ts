import { startPaper } from "./paper-crumple.ts";
import { startPointerEffects } from "./pointer-effects.ts";
import { startPointerField } from "./pointer-field.ts";
import { startReveals } from "./reveal.ts";

document.documentElement.classList.add("fx-ready");
startReveals();
startPointerEffects();

// Both are decoration, so nothing else depends on them starting.
try {
  startPaper();
} catch (error) {
  console.warn("Paper effect failed to start:", error);
}

const canvas = document.getElementById("pointer-field");
if (canvas instanceof HTMLCanvasElement) {
  try {
    if (!startPointerField(canvas)) canvas.style.display = "none";
  } catch (error) {
    console.warn("Pointer field failed to start:", error);
    canvas.style.display = "none";
  }
}
