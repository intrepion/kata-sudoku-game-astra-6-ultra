# Arcade metadata

`public/arcade/manifest.json` is this game’s v1 manifest. Its image paths are relative to the public site root; each image has a SHA-256 and source provenance. An empty screenshot array means no verified images are available. Existing captures have unknown date and deployed-build identity; they are not fresh automated captures. Run `node scripts/verify-arcade.mjs` after edits. Vite copies `public/` into the Pages artifact.
