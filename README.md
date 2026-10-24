# Steaming Pars review

Interactive comparison: **[open the site](https://bitz3d.github.io/steaming-pars-review/)**.

- Left: source-traced flat appearance approved in Blender.
- Right: full-depth candidate, still under visual review.
- Original mesh lettering stays fixed while the center orbits/zooms.
- Steam playback and looping are enabled by default; shared timeline controls both panes.

Publishing this review is not approval of the depth candidate or encoded appearances, and is not integration into the receiving application. No physical-phone performance or universal compatibility claim.

## Repository

`src/` contains the standalone React/Three.js comparison wrapper; `public/` contains the two explicit GLB review transports, catalog and thumbnails. `docs/` is the prebuilt GitHub Pages site, published from `main /docs`. Native Blender projects, reference GIF, account data and local working files are deliberately not included.

All assets and scripts use repository-relative URLs; no local server/API or external CDN is required. Included models are uncompressed review transports, not optimized delivery assets. `PROVENANCE.json` records their hashes and review scope. No separate asset license is granted by this publication.

## Build

Dependencies are pinned in `package-lock.json`. With dependencies available, run `npm run build`; inspect and commit the generated `docs/` together with its sources. Changes go through a branch and pull request, not direct pushes to `main`. The initial publication reused existing installed dependencies without installs/upgrades.

The reviewed code deliberately renders lettering as a separate orthographic HUD. This wrapper is not the unchanged receiving-application viewer; any later integration must implement and validate the same policy explicitly.
