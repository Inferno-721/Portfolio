import vercel from "@astrojs/vercel";
import icon from "astro-icon";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  site: "https://inferno-721.vercel.app",
  // The agent stops itself at 20s, so this leaves room to answer from search.
  adapter: vercel({ maxDuration: 30 }),
  integrations: [icon()],
  redirects: {
    "/garden": "/writing",
  },
  devToolbar: {
    enabled: false,
  },
});
