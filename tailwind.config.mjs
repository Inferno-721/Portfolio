/**
 * Every utility resolves to a token in src/shared/styles/tokens.css.
 * The default colour, spacing, type and radius scales are replaced rather than
 * extended, so an off-scale class such as `py-2.5` or `bg-slate-300` does not exist.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  darkMode: ["class"],
  content: ["./src/**/*.{astro,html,js,ts}"],
  future: {
    hoverOnlyWhenSupported: true,
  },
  theme: {
    screens: {
      xs: "480px",
      sm: "640px",
      md: "768px",
      lg: "960px",
      xl: "1200px",
    },
    colors: {
      transparent: "transparent",
      current: "currentColor",
      primary: "var(--primary)",
      "primary-hover": "var(--primary-hover)",
      "primary-text": "var(--primary-text)",
      page: "var(--surface)",
      raised: "var(--surface-raised)",
      ink: "var(--text)",
      muted: "var(--text-muted)",
      line: "var(--border)",
      "line-strong": "var(--border-strong)",
      success: "var(--success)",
      warning: "var(--warning)",
      danger: "var(--danger)",
      info: "var(--info)",
    },
    spacing: {
      0: "0",
      px: "1px",
      1: "var(--space-1)",
      2: "var(--space-2)",
      3: "var(--space-3)",
      4: "var(--space-4)",
      6: "var(--space-6)",
      8: "var(--space-8)",
      12: "var(--space-12)",
      16: "var(--space-16)",
      24: "var(--space-24)",
      control: "var(--control-h)",
      header: "var(--header-h)",
    },
    fontFamily: {
      sans: "var(--font-body)",
      display: "var(--font-heading)",
      mono: "var(--font-mono)",
    },
    fontSize: {
      xs: ["var(--text-xs)", { lineHeight: "var(--leading-xs)" }],
      sm: ["var(--text-sm)", { lineHeight: "var(--leading-sm)" }],
      base: ["var(--text-base)", { lineHeight: "var(--leading-base)" }],
      lg: ["var(--text-lg)", { lineHeight: "var(--leading-lg)" }],
      xl: ["var(--text-xl)", { lineHeight: "var(--leading-xl)" }],
      "2xl": ["var(--text-2xl)", { lineHeight: "var(--leading-2xl)" }],
      "3xl": ["var(--text-3xl)", { lineHeight: "var(--leading-3xl)" }],
      display: [
        "var(--text-display)",
        {
          lineHeight: "var(--leading-display)",
          letterSpacing: "var(--tracking-display)",
        },
      ],
    },
    borderRadius: {
      none: "0",
      DEFAULT: "var(--radius)",
      lg: "var(--radius-lg)",
      full: "9999px",
    },
    extend: {
      borderColor: {
        DEFAULT: "var(--border)",
      },
      maxWidth: {
        page: "var(--page-width)",
        measure: "var(--measure)",
      },
      transitionDuration: {
        DEFAULT: "var(--duration-fast)",
      },
      transitionTimingFunction: {
        DEFAULT: "ease",
      },
    },
  },
  plugins: [],
};
