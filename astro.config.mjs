import vercel from "@astrojs/vercel";
import icon from "astro-icon";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  site: "https://inferno-721.vercel.app",
  adapter: vercel(),
  integrations: [icon()],
  redirects: {
    "/garden": "/writing",
  },
  devToolbar: {
    enabled: false,
  },
});
