import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const AA_TEXT = 4.5;

const design = JSON.parse(
  readFileSync(new URL("../design-language.json", import.meta.url), "utf8"),
);
const tokens = readFileSync(
  new URL("../src/shared/styles/tokens.css", import.meta.url),
  "utf8",
).toLowerCase();

const { color } = design;
const themes = {
  light: {
    primary: color.primary,
    primaryText: color.primaryText,
    ...color.role,
    ...color.semantic,
  },
  dark: {
    primary: color.dark.primary,
    primaryText: color.dark.primaryText,
    ...color.dark.role,
    ...color.dark.semantic,
  },
};

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.03928
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

for (const [name, theme] of Object.entries(themes)) {
  const foregrounds = [
    "text",
    "textMuted",
    "primary",
    "success",
    "warning",
    "danger",
    "info",
  ];
  for (const foreground of foregrounds) {
    test(`${name}: ${foreground} is AA on the page surface`, () => {
      const ratio = contrast(theme[foreground], theme.surface);
      assert.ok(ratio >= AA_TEXT, `${ratio.toFixed(2)}:1`);
    });
  }

  test(`${name}: muted text stays AA on the raised surface`, () => {
    const ratio = contrast(theme.textMuted, theme.surfaceRaised);
    assert.ok(ratio >= AA_TEXT, `${ratio.toFixed(2)}:1`);
  });

  test(`${name}: button text is AA on the primary button, resting and hovered`, () => {
    const hover = name === "light" ? color.primaryHover : color.dark.primaryHover;
    assert.ok(contrast(theme.primaryText, theme.primary) >= AA_TEXT);
    assert.ok(contrast(theme.primaryText, hover) >= AA_TEXT);
  });
}

test("every colour decided in design-language.json is wired into tokens.css", () => {
  const decided = JSON.stringify(color).match(/#[0-9a-fA-F]{6}/g) ?? [];
  const missing = [...new Set(decided)].filter(
    (hex) => !tokens.includes(hex.toLowerCase()),
  );
  assert.deepEqual(missing, []);
});
