/**
 * Cards made of crumpled paper. At rest each one is a still, faintly creased surface. Under the cursor the paper wrinkles and catches the light, then
 * smooths out again and rendering stops. One shared WebGL context draws them all.
 */

const VERTEX = `#version 300 es
in vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uSize;
uniform vec2 uPointer;
uniform float uPresence;
uniform float uSeed;
uniform vec3 uPaper;
uniform vec3 uAccent;
uniform float uLightTheme;
out vec4 fragColor;

vec2 hash(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

// Each Voronoi cell is one facet of the paper: tilted its own way and sloping toward its
// centre, so neighbouring facets meet in a sharp crease rather than a flat colour step.
vec3 facet(vec2 p, float seed) {
  p += 0.22 * sin(p.yx * 2.3 + seed);
  vec2 cell = floor(p);
  vec2 local = fract(p);
  vec2 nearest = cell;
  vec2 toCentre = vec2(0.0);
  float best = 9.0;
  float second = 9.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y));
      vec2 r = offset + hash(cell + offset + seed) - local;
      float d = dot(r, r);
      if (d < best) {
        second = best;
        best = d;
        nearest = cell + offset;
        toCentre = r;
      } else if (d < second) {
        second = d;
      }
    }
  }
  vec2 tilt = (hash(nearest + seed + 3.7) * 2.0 - 1.0) * 0.55 + toCentre * 0.75;
  float crease = smoothstep(0.0, 0.09, sqrt(second) - sqrt(best));
  return vec3(tilt, crease);
}

void main() {
  vec2 px = gl_FragCoord.xy;
  vec2 uv = px / uSize.y;

  float dist = length(px - uPointer);
  float near = smoothstep(uSize.y * 0.8, 0.0, dist) * uPresence;
  float crumple = 0.3 + near * 0.34;

  vec3 large = facet(uv * 3.4, uSeed);
  vec3 medium = facet(uv * 7.3, uSeed + 5.0);
  vec3 fine = facet(uv * 16.0, uSeed + 11.0);
  vec2 tilt = large.xy * 0.6 + medium.xy * 0.34 + fine.xy * 0.16;
  float crease = large.z * mix(1.0, medium.z, 0.6);
  vec3 normal = normalize(vec3(-tilt * crumple, 1.0));

  vec3 restLight = vec3(uSize.x * 0.15, uSize.y * 1.3, uSize.y * 0.9);
  vec3 cursorLight = vec3(uPointer, uSize.y * 0.7);
  vec3 toLight = normalize(mix(restLight, cursorLight, uPresence) - vec3(px, 0.0));

  float diffuse = clamp(dot(normal, toLight), 0.0, 1.0);
  float gloss = pow(clamp(dot(normal, normalize(toLight + vec3(0.0, 0.0, 1.0))), 0.0, 1.0), 30.0);
  float grain = hash(px * 0.73 + uSeed).x - 0.5;
  float creaseDepth = uLightTheme > 0.5 ? 0.035 : 0.1;
  float creaseShade = mix(1.0 - creaseDepth * (0.35 + near), 1.0, crease);

  vec3 color;
  if (uLightTheme > 0.5) {
    color = mix(uPaper, vec3(1.0), 0.5) * (0.84 + diffuse * 0.13) * creaseShade;
    color += uAccent * gloss * near * 0.07;
  } else {
    color = uPaper * (0.5 + diffuse * 0.82) * creaseShade;
    color += uPaper * near * 0.42;
    color += uAccent * gloss * near * 0.2;
  }
  color += grain * 0.01;
  fragColor = vec4(min(color, vec3(1.0)), 1.0);
}`;

const MAX_SCALE = 1.5;
const SETTLED = 0.004;

type Sheet = {
  card: HTMLElement;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  seed: number;
  presence: number;
  wanted: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
};

function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.trim().replace("#", ""), 16);
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  ];
}

export function startPaper(): void {
  const canvases = [
    ...document.querySelectorAll<HTMLCanvasElement>("canvas[data-paper]"),
  ];
  if (canvases.length === 0) return;

  const surface = document.createElement("canvas");
  const gl = surface.getContext("webgl2", { alpha: false, antialias: false });

  const sheets: Sheet[] = canvases.flatMap((canvas) => {
    const card = canvas.closest<HTMLElement>("[data-paper-host]");
    const context = canvas.getContext("2d");
    if (!card || !context) return [];
    return [
      {
        card,
        canvas,
        context,
        seed: Number(canvas.dataset.seed) * 7.31,
        presence: 0,
        wanted: 0,
        x: 0,
        y: 0,
        targetX: 0,
        targetY: 0,
      },
    ];
  });

  // Without WebGL the cards keep the plain raised surface behind the canvas.
  if (!gl) {
    for (const { canvas } of sheets) canvas.style.display = "none";
    return;
  }

  function compile(type: number, source: string): WebGLShader {
    const shader = gl!.createShader(type);
    if (!shader) throw new Error("Could not create shader");
    gl!.shaderSource(shader, source);
    gl!.compileShader(shader);
    if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
      throw new Error(gl!.getShaderInfoLog(shader) ?? "Shader failed");
    }
    return shader;
  }

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.bindAttribLocation(program, 0, "aPos");
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "Link failed");
  }
  gl.useProgram(program);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const uSize = uniform("uSize");
  const uPointer = uniform("uPointer");
  const uPresence = uniform("uPresence");
  const uSeed = uniform("uSeed");
  const uPaper = uniform("uPaper");
  const uAccent = uniform("uAccent");
  const uLightTheme = uniform("uLightTheme");

  function readTheme(): void {
    const tokens = getComputedStyle(document.documentElement);
    gl!.uniform3fv(
      uPaper,
      hexToRgb(tokens.getPropertyValue("--surface-raised")),
    );
    gl!.uniform3fv(uAccent, hexToRgb(tokens.getPropertyValue("--primary")));
    gl!.uniform1f(
      uLightTheme,
      document.documentElement.classList.contains("dark") ? 0 : 1,
    );
  }

  function render(sheet: Sheet): void {
    const { canvas, context } = sheet;
    const scale = Math.min(devicePixelRatio || 1, MAX_SCALE);
    const width = Math.max(1, Math.round(canvas.clientWidth * scale));
    const height = Math.max(1, Math.round(canvas.clientHeight * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    if (surface.width !== width || surface.height !== height) {
      surface.width = width;
      surface.height = height;
    }
    gl!.viewport(0, 0, width, height);
    gl!.uniform2f(uSize, width, height);
    gl!.uniform2f(uPointer, sheet.x * scale, height - sheet.y * scale);
    gl!.uniform1f(uPresence, sheet.presence);
    gl!.uniform1f(uSeed, sheet.seed);
    gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
    context.drawImage(surface, 0, 0);
  }

  function renderAll(): void {
    for (const sheet of sheets) render(sheet);
  }

  readTheme();
  renderAll();

  new MutationObserver(() => {
    readTheme();
    renderAll();
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });

  const resized = new ResizeObserver(renderAll);
  for (const { canvas } of sheets) resized.observe(canvas);

  const canHover = matchMedia("(hover: hover) and (pointer: fine)").matches;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!canHover || reduced) return;

  let frameId = 0;

  function frame(): void {
    let moving = false;
    for (const sheet of sheets) {
      if (sheet.presence === 0 && sheet.wanted === 0) continue;
      sheet.presence += (sheet.wanted - sheet.presence) * 0.14;
      sheet.x += (sheet.targetX - sheet.x) * 0.3;
      sheet.y += (sheet.targetY - sheet.y) * 0.3;
      const settled =
        Math.abs(sheet.wanted - sheet.presence) < SETTLED &&
        Math.abs(sheet.targetX - sheet.x) < 0.5 &&
        Math.abs(sheet.targetY - sheet.y) < 0.5;
      if (settled) {
        sheet.presence = sheet.wanted;
        sheet.x = sheet.targetX;
        sheet.y = sheet.targetY;
      } else {
        moving = true;
      }
      render(sheet);
    }
    frameId = moving ? requestAnimationFrame(frame) : 0;
  }

  function wake(): void {
    if (!frameId) frameId = requestAnimationFrame(frame);
  }

  for (const sheet of sheets) {
    sheet.card.addEventListener(
      "pointermove",
      (event) => {
        const rect = sheet.canvas.getBoundingClientRect();
        sheet.targetX = event.clientX - rect.left;
        sheet.targetY = event.clientY - rect.top;
        if (sheet.presence === 0) {
          sheet.x = sheet.targetX;
          sheet.y = sheet.targetY;
        }
        sheet.wanted = 1;
        wake();
      },
      { passive: true },
    );
    sheet.card.addEventListener(
      "pointerleave",
      () => {
        sheet.wanted = 0;
        wake();
      },
      { passive: true },
    );
  }
}
