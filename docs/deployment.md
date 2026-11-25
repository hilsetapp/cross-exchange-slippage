# GitHub Pages deployment

The live site is served from the root of the `gh-pages` branch. The branch contains only the production Vite build; application source stays on `main`.

To publish a local update:

```bash
npm ci
npm run check
GITHUB_ACTIONS=true npm run build
```

Then replace the contents of the `gh-pages` branch root with the generated `dist/` contents and push that branch. The Pages source is configured for `gh-pages` at `/`. The `GITHUB_ACTIONS=true` setting makes Vite emit asset paths under `/cross-exchange-slippage/` for the project site.
