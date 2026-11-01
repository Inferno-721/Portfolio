/**
 * Real refraction for the glass face: a generated displacement map bends whatever is
 * behind the card's edges, like looking through a lens. Only Chromium paints SVG filters
 * in backdrop-filter. Safari and Firefox keep the plain frosted blur from the stylesheet.
 */

const SUPPORTED = /\bChrome\//.test(navigator.userAgent);
const EDGE_BAND_PX = 26;
const CORNER_RADIUS_PX = 8;
const REFRACTION = 46;
const MAP_SCALE = 0.5;
const SVG_NS = "http://www.w3.org/2000/svg";

const built = new WeakMap<HTMLElement, string>();
let defs: SVGSVGElement | null = null;
let nextId = 0;

function createDisplacementMap(width: number, height: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * MAP_SCALE));
  canvas.height = Math.max(1, Math.round(height * MAP_SCALE));
  const context = canvas.getContext("2d");
  if (!context) return "";

  const image = context.createImageData(canvas.width, canvas.height);
  const halfX = width / 2;
  const halfY = height / 2;

  for (let row = 0; row < canvas.height; row++) {
    for (let column = 0; column < canvas.width; column++) {
      const x = (column + 0.5) / MAP_SCALE - halfX;
      const y = (row + 0.5) / MAP_SCALE - halfY;
      // Signed distance to a rounded box, and the direction to its nearest edge.
      const qx = Math.abs(x) - (halfX - CORNER_RADIUS_PX);
      const qy = Math.abs(y) - (halfY - CORNER_RADIUS_PX);
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
      const distance =
        outside + Math.min(Math.max(qx, qy), 0) - CORNER_RADIUS_PX;
      const depth = -distance;

      let normalX = 0;
      let normalY = 0;
      if (qx > 0 && qy > 0) {
        normalX = (Math.sign(x) * qx) / (outside || 1);
        normalY = (Math.sign(y) * qy) / (outside || 1);
      } else if (qx > qy) {
        normalX = Math.sign(x);
      } else {
        normalY = Math.sign(y);
      }

      const strength =
        depth < EDGE_BAND_PX ? (1 - Math.max(depth, 0) / EDGE_BAND_PX) ** 2 : 0;
      const pixel = (row * canvas.width + column) * 4;
      image.data[pixel] = 128 - normalX * strength * 127;
      image.data[pixel + 1] = 128 - normalY * strength * 127;
      image.data[pixel + 2] = 128;
      image.data[pixel + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

function svgElement(
  name: string,
  attributes: Record<string, string>,
): SVGElement {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }
  return element;
}

/** Builds the filter on first flip, and again if the card has changed size. */
export function refractGlass(element: HTMLElement): void {
  if (!SUPPORTED) return;
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  const size = `${width}x${height}`;
  if (!width || !height || built.get(element) === size) return;

  if (!defs) {
    defs = document.createElementNS(SVG_NS, "svg");
    defs.setAttribute("aria-hidden", "true");
    defs.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    document.body.append(defs);
  }

  const id = `liquid-glass-${nextId++}`;
  const filter = svgElement("filter", {
    id,
    x: "0",
    y: "0",
    width: "100%",
    height: "100%",
    "color-interpolation-filters": "sRGB",
  });
  filter.append(
    svgElement("feImage", {
      href: createDisplacementMap(width, height),
      x: "0",
      y: "0",
      width: String(width),
      height: String(height),
      preserveAspectRatio: "none",
      result: "map",
    }),
    svgElement("feDisplacementMap", {
      in: "SourceGraphic",
      in2: "map",
      scale: String(REFRACTION),
      xChannelSelector: "R",
      yChannelSelector: "G",
    }),
  );
  defs.append(filter);

  const value = `url(#${id}) blur(3px) saturate(150%)`;
  element.style.backdropFilter = value;
  element.style.setProperty("-webkit-backdrop-filter", value);
  built.set(element, size);
}
