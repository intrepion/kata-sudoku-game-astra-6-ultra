import type { Worker } from "tesseract.js";

/** Coordinates are fractions of the original image, independent of preview size. */
export interface GridCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScanProgress {
  progress: number;
  message: string;
}

export interface ScanResult {
  board: number[];
  uncertain: number[];
  detectedCells: number;
}

function canvas(width: number, height: number) {
  const element = document.createElement("canvas");
  element.width = Math.round(width);
  element.height = Math.round(height);
  const context = element.getContext("2d", { willReadFrequently: true });
  if (!context)
    throw new Error(
      "Your browser could not open this image. Please try another browser.",
    );
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  return { element, context };
}

function regularRange(profile: number[]): [number, number] | null {
  const max = Math.max(...profile);
  if (max < 24) return null;
  const lines: number[] = [];
  let start = -1;
  for (let i = 0; i <= profile.length; i++) {
    if (i < profile.length && profile[i] >= max * 0.46) {
      if (start === -1) start = i;
    } else if (start !== -1) {
      lines.push((start + i - 1) / 2);
      start = -1;
    }
  }
  let best: [number, number] | null = null;
  let bestScore = 0;
  for (let a = 0; a < lines.length; a++) {
    for (let b = a + 3; b < lines.length; b++) {
      const span = lines[b] - lines[a];
      if (span < profile.length * 0.22) continue;
      const step = span / 9;
      let matches = 0;
      let majorMatches = 0;
      for (let n = 0; n <= 9; n++) {
        if (
          lines.some(
            (line) =>
              Math.abs(line - (lines[a] + n * step)) < Math.max(3, step * 0.16),
          )
        ) {
          matches++;
          if (n % 3 === 0) majorMatches++;
        }
      }
      const score = matches + majorMatches * 1.5 + span / profile.length;
      if (majorMatches === 4 && score > bestScore) {
        bestScore = score;
        best = [lines[a], lines[b]];
      }
    }
  }
  return best;
}

/** A conservative line-projection suggestion; the player always confirms the crop. */
export function suggestGridCrop(image: HTMLImageElement): GridCrop {
  const scale = Math.min(
    1,
    1000 / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const { element, context } = canvas(
    image.naturalWidth * scale,
    image.naturalHeight * scale,
  );
  context.drawImage(image, 0, 0, element.width, element.height);
  const pixels = context.getImageData(0, 0, element.width, element.height).data;
  const columns = Array<number>(element.width).fill(0);
  const rows = Array<number>(element.height).fill(0);
  for (let y = 0; y < element.height; y++) {
    for (let x = 0; x < element.width; x++) {
      const p = (y * element.width + x) * 4;
      const brightness =
        pixels[p] * 0.299 + pixels[p + 1] * 0.587 + pixels[p + 2] * 0.114;
      if (brightness < 125) {
        columns[x]++;
        rows[y]++;
      }
    }
  }
  const horizontal = regularRange(columns);
  const vertical = regularRange(rows);
  if (horizontal && vertical) {
    const width = horizontal[1] - horizontal[0];
    const height = vertical[1] - vertical[0];
    if (width / height > 0.72 && width / height < 1.4) {
      return {
        x: horizontal[0] / element.width,
        y: vertical[0] / element.height,
        width: width / element.width,
        height: height / element.height,
      };
    }
  }
  const side = Math.min(element.width, element.height) * 0.9;
  return {
    x: (element.width - side) / 2 / element.width,
    y: (element.height - side) / 2 / element.height,
    width: side / element.width,
    height: side / element.height,
  };
}

export function croppedImage(
  image: HTMLImageElement,
  crop: GridCrop,
  size = 720,
): HTMLCanvasElement {
  const { element, context } = canvas(size, size);
  context.drawImage(
    image,
    crop.x * image.naturalWidth,
    crop.y * image.naturalHeight,
    crop.width * image.naturalWidth,
    crop.height * image.naturalHeight,
    0,
    0,
    size,
    size,
  );
  return element;
}

function otsuThreshold(values: Uint8Array): number {
  const histogram = new Uint32Array(256);
  let sum = 0;
  for (const value of values) {
    histogram[value]++;
    sum += value;
  }
  let count = 0;
  let partial = 0;
  let best = -1;
  let threshold = 130;
  for (let i = 0; i < 256; i++) {
    count += histogram[i];
    if (!count) continue;
    const remaining = values.length - count;
    if (!remaining) break;
    partial += i * histogram[i];
    const difference = partial / count - (sum - partial) / remaining;
    const variance = count * remaining * difference * difference;
    if (variance > best) {
      best = variance;
      threshold = i;
    }
  }
  return Math.min(210, Math.max(50, threshold));
}

function prepareCell(
  grid: HTMLCanvasElement,
  row: number,
  col: number,
): HTMLCanvasElement | null {
  const size = 72;
  const { element, context } = canvas(size, size);
  const cellSize = grid.width / 9;
  // Discard the outer cell edges so grid rules never become recognized digits.
  const inset = cellSize * 0.13;
  context.drawImage(
    grid,
    col * cellSize + inset,
    row * cellSize + inset,
    cellSize - inset * 2,
    cellSize - inset * 2,
    0,
    0,
    size,
    size,
  );
  const imageData = context.getImageData(0, 0, size, size);
  const gray = new Uint8Array(size * size);
  let min = 255;
  let max = 0;
  for (let i = 0; i < gray.length; i++) {
    const p = i * 4;
    gray[i] =
      imageData.data[p] * 0.299 +
      imageData.data[p + 1] * 0.587 +
      imageData.data[p + 2] * 0.114;
    min = Math.min(min, gray[i]);
    max = Math.max(max, gray[i]);
  }
  if (max - min < 32) return null;
  const threshold = otsuThreshold(gray);
  const dark = gray.map((value) => (value <= threshold ? 1 : 0));
  const visited = new Uint8Array(size * size);
  let largest: number[] = [];
  // Keep the central connected character; remove shadows, line fragments and specks.
  for (let p = 0; p < dark.length; p++) {
    if (!dark[p] || visited[p]) continue;
    const component: number[] = [];
    const queue = [p];
    visited[p] = 1;
    let xMin = size;
    let xMax = 0;
    let yMin = size;
    let yMax = 0;
    for (let q = 0; q < queue.length; q++) {
      const current = queue[q];
      component.push(current);
      const x = current % size;
      const y = Math.floor(current / size);
      xMin = Math.min(xMin, x);
      xMax = Math.max(xMax, x);
      yMin = Math.min(yMin, y);
      yMax = Math.max(yMax, y);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
          const np = ny * size + nx;
          if (dark[np] && !visited[np]) {
            visited[np] = 1;
            queue.push(np);
          }
        }
      }
    }
    const width = xMax - xMin + 1;
    const height = yMax - yMin + 1;
    const centerX = (xMax + xMin) / 2;
    const centerY = (yMax + yMin) / 2;
    if (
      height >= size * 0.23 &&
      width >= 2 &&
      width < size * 0.94 &&
      height < size * 0.96 &&
      centerX > size * 0.12 &&
      centerX < size * 0.88 &&
      centerY > size * 0.12 &&
      centerY < size * 0.88 &&
      component.length >= 18 &&
      component.length > largest.length
    ) {
      largest = component;
    }
  }
  if (!largest.length) return null;
  let left = size;
  let top = size;
  let right = 0;
  let bottom = 0;
  const mask = new Set(largest);
  for (let p = 0; p < gray.length; p++) {
    const value = mask.has(p) ? 0 : 255;
    for (let channel = 0; channel < 3; channel++)
      imageData.data[p * 4 + channel] = value;
    imageData.data[p * 4 + 3] = 255;
    if (value === 0) {
      left = Math.min(left, p % size);
      right = Math.max(right, p % size);
      top = Math.min(top, Math.floor(p / size));
      bottom = Math.max(bottom, Math.floor(p / size));
    }
  }
  context.putImageData(imageData, 0, 0);
  const output = canvas(120, 120);
  const width = right - left + 1;
  const height = bottom - top + 1;
  const scale = Math.min(80 / width, 88 / height);
  output.context.imageSmoothingEnabled = false;
  output.context.drawImage(
    element,
    left,
    top,
    width,
    height,
    (120 - width * scale) / 2,
    (120 - height * scale) / 2,
    width * scale,
    height * scale,
  );
  return output.element;
}

function abortError() {
  return new DOMException("Scan cancelled.", "AbortError");
}

export async function recognizeSudoku(
  image: HTMLImageElement,
  crop: GridCrop,
  onProgress: (progress: ScanProgress) => void,
  signal: AbortSignal,
): Promise<ScanResult> {
  let worker: Worker | undefined;
  let rejectAbort: (reason: unknown) => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  // An abort can happen between awaited operations; prevent an unhandled rejection.
  void aborted.catch(() => {});
  const stop = () => {
    rejectAbort(abortError());
    if (worker) void worker.terminate().catch(() => {});
  };
  signal.addEventListener("abort", stop, { once: true });
  const check = () => {
    if (signal.aborted) throw abortError();
  };
  const wait = <T>(promise: Promise<T>) => Promise.race([promise, aborted]);
  try {
    check();
    onProgress({ progress: 0.03, message: "Looking for numbers…" });
    const grid = croppedImage(image, crop, 1080);
    const cells = Array.from({ length: 81 }, (_, index) =>
      prepareCell(grid, Math.floor(index / 9), index % 9),
    );
    const detectedCells = cells.filter(Boolean).length;
    if (!detectedCells)
      return { board: Array(81).fill(0), uncertain: [], detectedCells: 0 };
    check();
    onProgress({
      progress: 0.06,
      message: "Loading the private, on-device reader…",
    });
    const { createWorker, PSM } = await wait(import("tesseract.js"));
    check();
    const pendingWorker = createWorker("eng", 1, {
      logger: (event) => {
        if (signal.aborted) return;
        if (event.status === "loading language traineddata") {
          onProgress({
            progress: 0.06 + event.progress * 0.17,
            message: "Downloading the number reader (first scan only)…",
          });
        }
      },
      // Errors are returned to the caller; Tesseract otherwise throws from its message handler.
      errorHandler: () => {},
    });
    void pendingWorker
      .then((created) => {
        if (signal.aborted) void created.terminate().catch(() => {});
      })
      .catch(() => {});
    worker = await wait(pendingWorker);
    check();
    await wait(
      worker.setParameters({
        tessedit_char_whitelist: "123456789",
        tessedit_pageseg_mode: PSM.SINGLE_CHAR,
        user_defined_dpi: "300",
      }),
    );
    const board = Array<number>(81).fill(0);
    const uncertain: number[] = [];
    let read = 0;
    for (let index = 0; index < 81; index++) {
      check();
      const cell = cells[index];
      if (!cell) continue;
      onProgress({
        progress: 0.25 + (read / detectedCells) * 0.73,
        message: `Reading number ${read + 1} of ${detectedCells}…`,
      });
      let { data } = await wait(worker.recognize(cell));
      // A second segmentation pass helps round digits that SINGLE_CHAR can omit.
      if (!/^[1-9]$/.test(data.text.trim())) {
        await wait(
          worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_WORD }),
        );
        const retry = await wait(worker.recognize(cell));
        if (/^[1-9]$/.test(retry.data.text.trim())) data = retry.data;
        await wait(
          worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_CHAR }),
        );
      }
      const digit = data.text.trim();
      if (/^[1-9]$/.test(digit)) {
        board[index] = Number(digit);
        if (data.confidence < 75) uncertain.push(index);
      } else {
        uncertain.push(index);
      }
      read++;
    }
    onProgress({ progress: 1, message: "Ready for your review." });
    return { board, uncertain, detectedCells };
  } finally {
    signal.removeEventListener("abort", stop);
    if (worker) await worker.terminate().catch(() => {});
  }
}
