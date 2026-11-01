# Changelog

All notable changes to this project will be documented in this file.

## [2.0.0] - 2026-11-02

### Added

- "Ask my AI": a Gemini-powered agent in the hero with a live trace, a deterministic gate, read-only tools, a search fallback and an eval harness
- Writing page and post sync: LinkedIn via Apify or data export, blogs via RSS, on a GitHub Action every 6 hours
- Canvas dot field behind every page: still at rest, pushed aside and lit by the cursor, with a ripple on click
- Cursor-following card glow, tilt, magnetic buttons, heat text, scroll reveals and count-ups
- Crumpled paper cards across the site that react to the cursor, plus a liquid glass flip side and a lightbox with each pipeline on project cards
- About page built around AI engineering experience and principles
- Original boy-with-hat drawing as theme-matching line art in the hero and on About, a clean infinity mark in the header and favicon, and a résumé download on every page
- LinkedIn posts and Medium articles on the Writing page, with Medium cover images
- The AI agent on every page, in a floating dock that keeps the conversation across pages
- Design system: `design-language.json`, CSS variable tokens and a locked Tailwind scale
- Content rewritten from the latest résumé and current public GitHub projects
- Résumé PDF download, Open Graph tags and a 404 page
- Agent, endpoint, sync, contrast and token-drift tests

### Changed

- Dark is now the default theme
- Pages are prerendered, and only `/api/agent` runs on demand
- Upgraded to Astro 7, with Tailwind wired through PostCSS
- Code organised as `pages → features → shared`

### Removed

- Digital garden, Supabase, Clerk and all garden admin routes (`/garden` redirects to `/writing`)
- React, framer-motion and tsparticles
- Committed database backup and the original author's `CNAME`

## [1.0.0] - 2025-03-16

### Added

- Mobile-friendly navbar with sign in/out functionality
- Edit functionality for digital garden trees and leaves
- Conditional "Edit Garden" option in header for admin users

## [0.3.0] - 2025-03-15

### Added

- Converted from SSG to SSR for garden pages
- Implemented data fetching from Supabase
- Added new project to portfolio
- Created modular code structure for garden components
- Implemented responsive design for mobile devices

### Changed

- Migrated from GitHub Pages to Vercel for SSR support
- Updated configuration for Vercel deployment

## [0.2.0] - 2025-03-14

### Added

- Initial Astro project setup
- Basic site structure and navigation
- About page with education, experience, and skills sections
- Projects showcase
- Social links and contact information
- Profile photo and personal information

### Changed

- Updated projects, work, awards, and skills information
- Improved site metadata and SEO

## [0.1.0] - 2025-03-14

### Added

- Initial repository setup
- Basic project structure
- GitHub repository configuration
