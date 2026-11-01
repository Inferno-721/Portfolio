# Shubham Joshi: portfolio

Source for [inferno-721.vercel.app](https://inferno-721.vercel.app). An [Astro](https://astro.build/) site with a cursor-reactive dot field behind it, a real AI agent you can talk to, and a Writing page fed by LinkedIn and blog posts.

## Run it

```bash
pnpm install
cp .env.example .env
pnpm dev
```

| Command                 | What it does                                              |
| ----------------------- | --------------------------------------------------------- |
| `pnpm dev`              | Dev server on `localhost:4321`                            |
| `pnpm build`            | Type-checks, then builds for Vercel                       |
| `pnpm test`             | Agent loop, endpoint, sync parsers, WCAG contrast, tokens |
| `pnpm eval`             | Offline agent evals: routing and retrieval, no model      |
| `pnpm eval:live`        | Every eval case against the real model. Uses free quota   |
| `pnpm posts:sync`       | Fetch new posts from LinkedIn and RSS feeds               |
| `pnpm posts:import <f>` | Load `Shares.csv` from LinkedIn's data export             |

## Environment

| Variable            | Where                 | Purpose                                                                               |
| ------------------- | --------------------- | ------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY`    | Vercel                | Powers the agent on Gemini's free tier. Without a model key, answers come from search |
| `ANTHROPIC_API_KEY` | Vercel, optional      | Used only if `GEMINI_API_KEY` is not set                                              |
| `AGENT_MODEL`       | Vercel, optional      | Defaults to `gemini-3.5-flash-lite`                                                   |
| `APIFY_TOKEN`       | GitHub Actions secret | Daily LinkedIn sync                                                                   |

On the free tier, going over Gemini's limits simply switches answers to search until the quota resets at midnight Pacific. The in-app rate limit lives in serverless memory, so it only stops casual abuse.

## The AI agent

Code in `src/features/agent`. The endpoint is `POST /api/agent`, streaming server-sent events.

```
question → deterministic gate → streaming tool-use loop (max 3 turns) → grounded answer
                  │                         │
                  └ fixed answers, no LLM   └ any failure → BM25 search answer
```

- **Tool selection:** four read-only tools (`search_profile`, `list_projects`, `get_experience`, `search_posts`). They can't change anything, which limits what prompt injection can do.
- **State and memory:** the server is stateless. The browser keeps the last 6 turns in `sessionStorage`, so the chat follows the visitor across pages and ends with the tab.
- **Failure recovery:** SDK retries, then a fallback to search. Refusals show a short decline. Truncated tool calls never run. The loop's last turn is forced to answer.
- **Observability:** the console shows every real step. Each request logs one JSON line with mode, tools, tokens and latency. Visitors' questions and IP addresses are not logged.
- **Chunking and metadata:** each role highlight, project, skill group and post is one chunk, tagged with kind, title, URL and date.
- **Retrieval:** BM25 over a few dozen chunks. Embeddings and a vector database would add cost and failure modes without improving recall at this size, so there's no reranker either.
- **Evaluation:** `evals/cases.json` has deterministic pass/fail cases. The score on the home page is read from the last run's output, so it can't claim more than was measured.
- **Cost:** Gemini's free tier, a 2,048 token cap per model turn, and the fast path that skips the model. `AGENT_MODEL` switches model without a code change.

## The post sync

LinkedIn closed the API permission for reading a member's own posts (`r_member_social`) to new applicants, so there's no official live connection. Sources are pluggable instead, and all end up as one `Post` shape in `src/features/writing/data/posts.json`:

- **LinkedIn via Apify** (`APIFY_TOKEN`): `harvestapi/linkedin-profile-posts` reads public posts with no LinkedIn login. It's a third-party scraper, so check you're comfortable with LinkedIn's terms.
- **LinkedIn data export** (`pnpm posts:import Shares.csv`): official and free, but manual.
- **Blogs via RSS** (`rssFeeds` in `feed.config.json`): Medium, Substack, Hashnode, dev.to or any RSS or Atom feed.

`.github/workflows/sync-posts.yml` runs every 6 hours and commits changes, which triggers a Vercel deploy, so a new post appears within about 6 hours. Medium needs no setup. LinkedIn needs the `APIFY_TOKEN` secret. For a quicker refresh, run the workflow by hand from GitHub's Actions tab. A failing source keeps the saved posts, so an outage can't empty the page the way the old garden broke. For the first run, use `pnpm posts:sync --all` to pull the full history.

## Update the content

Almost everything comes from **`cv.json`**, including the About story (`basics.bio`), the engineering principles (`principles`) and each project's pipeline (`flow`). To show Medium, add a `medium` entry to `basics.socials` and the feed URL to `rssFeeds` in `feed.config.json`, then run `pnpm posts:sync`. **`public/Shubham_Joshi_Resume.pdf`** is the file behind the Résumé buttons.

## Change the design

- **`design-language.json`**: the record of each design decision.
- **`src/shared/styles/tokens.css`**: the wired copy, as CSS variables.
- **`tailwind.config.mjs`**: replaces Tailwind's default scales with those variables, so off-scale classes don't exist.
- **`src/features/projects/client`**: the project card effects. `liquid-glass.ts` builds the refraction filter for the card backs (Chromium; other browsers get a frosted blur), and `project-gallery.ts` runs the flip and the lightbox, which morphs from the card using the View Transitions API.
- **`src/shared/effects`**: the canvas dot field, the WebGL crumpled paper used by project and About cards (`shared/ui/paper-card.astro`), and cursor effects, driven by `data-spotlight`, `data-tilt`, `data-magnetic`, `data-heat`, `data-reveal` and `data-count`. All of it respects `prefers-reduced-motion`.

## Structure

Imports only flow one way: `pages → features → shared`. Other code imports a feature through its `index.ts` only.

```
src/
  pages/      routes, wiring only
  features/
    agent/        the AI agent: console, endpoint logic, tools, retrieval
    writing/      posts page and the sync sources
    profile/      hero, metrics, contact
    experience/   timeline and summary
    projects/     project list
    credentials/  skills, achievements, education
  shared/     layout, UI primitives, effects, tokens. Knows nothing about the CV
evals/        agent eval cases and runner
scripts/      post sync CLI
```

## Credits

Started as a fork of [MAX-786's personal site](https://github.com/MAX-786) (MIT, see `LICENSE`). Fonts are Bricolage Grotesque, Inter and JetBrains Mono (OFL), self-hosted in `public/fonts`.
