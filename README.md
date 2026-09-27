# Sudoku — a little space to think

A responsive Sudoku game with a quiet, paper-inspired interface. Play a generated puzzle, or bring an unfinished one from a newspaper, screenshot, or camera photo.

## Run locally

Requires Node.js 22.12+ (Node.js 24 recommended).

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5186**. The explicit port avoids common development-server ports. To use another available port, run `npm run dev -- --port 5190`.

```sh
npm run build       # TypeScript check and production bundle in dist/
npm run preview     # Serve the production bundle
npm test            # Sudoku engine tests
npm run test:e2e    # Real Chromium game and photo-import tests
```

For first-time browser test setup, run `npx playwright install chromium`. The end-to-end runner starts the app if it is not already running. The actual OCR integration test needs internet access to download its recognition model.

## Play

- Three difficulty presets generate randomized puzzles, accepting clue removals only when the puzzle still has exactly one solution. Difficulty is based on clue density, not a human-solving technique rating.
- Select a square and use the number pad or keys **1–9**. Use **arrow keys** to move, **Backspace/Delete** to erase, **N** for pencil notes, and **U** or **Ctrl/Cmd+Z** to undo.
- Check entries, reveal a hint, pause the timer, restart, or create a new puzzle. Starting clues cannot be edited during a game.
- Notes in related squares are cleaned up when a correct number is entered. Notes are also included in screen-reader labels.
- Progress and preferences are saved in this browser’s local storage. Clearing browser data removes the saved game; undo history lasts for the current session.
- Settings control automatic mistake checking, related-square highlighting, and a dark theme.

## Bring a picture

1. Drop a photo onto the import panel, choose **Upload a puzzle**, paste an image, or choose **Scan with your camera**. The phone layout also has an import shortcut above the board.
2. Align the crop with the outer edges of the Sudoku grid. Straight-on grid detection provides an initial crop; drag it, resize its lower-right corner, or adjust the crop sliders.
3. Scan and compare the editable result with the original photo. Correct missing or mistaken digits, and remove handwritten guesses and small pencil marks. You can also enter the grid manually.
4. Choose **Use this puzzle**. Contradictory, unsolvable, and ambiguous grids are rejected with a useful message. A valid import replaces the current game and treats all confirmed numbers as starting clues.

**Privacy:** recognition runs in your browser using [Tesseract.js](https://github.com/naptha/tesseract.js). Image pixels are never uploaded to a server. The first scan downloads the OCR engine and English recognition model from its public asset providers. Google Fonts supplies the interface fonts; system fonts are the fallback.

**Photo limits:** JPG, PNG, and WebP, up to 20 MB and 50 megapixels, at least 180 × 180 pixels. Clear printed digits work best. Handwriting, perspective distortion, rotated images, shadows, and low resolution can require manual corrections. This version uses a rectangular crop and does not straighten perspective or rotate images. HEIC and SVG are not supported.

**Camera:** live capture requires permission and a secure origin (HTTPS or localhost). If it is unavailable or permission is denied, file upload and the device’s photo picker remain available. Camera tracks stop when leaving capture, switching input, or closing the dialog.

## Implementation

- React + TypeScript + Vite, with Lucide icons and responsive CSS.
- `src/lib/sudoku.ts`: constraint solver, unique puzzle generation, conflict detection, and import validation.
- `src/lib/ocr.ts`: grid detection, cell preprocessing, blank detection, cancellable browser OCR, and confidence reporting.
- `src/components/ImportModal.tsx`: camera, upload, crop, scan progress, recovery, and editable review.
- `src/App.tsx`: gameplay, keyboard interaction, settings, and browser persistence.
- `src/lib/sudoku.test.ts` and `tests/e2e/`: solver and real browser regression coverage, including an actual printed-photo recognition test.
