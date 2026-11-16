# ui-prototype: offline copy for UI, HUD and graphics experiments

This branch is a **local-only duplicate** of Clutch Manager for trying UI ideas.

- **Never merge it into `main`.** Port a finished idea to `main` in its own small pull request instead.
- It has **no connection to the live game**: online features are switched off in
  `src/online/supa.ts` (`UI_PROTOTYPE_OFFLINE`), and `.env.production` (the live server settings)
  is removed. There is no sign-in, closed-beta lock, Clutch League, beta tournament or cloud save.
  Careers are saved in the browser's local storage only.
- It **cannot be deployed**: `vite.config.ts` stops any build on Cloudflare Pages (`CF_PAGES`) or
  GitHub Actions, and the GitHub Pages workflow is removed on this branch.

## Play it locally

```sh
git checkout ui-prototype
npm install
npm run dev
```

Open the address Vite prints (usually http://localhost:5173). Edits under `src/` reload instantly.
Developer screens: http://localhost:5173/#dev-cards and #dev-map (see `src/main.tsx`).

The skills in `.claude/skills/` (frontend-design, game-ui-ux, game-feel) are included for UI work.
