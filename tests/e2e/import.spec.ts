import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { INITIAL_PUZZLE } from '../../src/lib/sudoku';

async function printedFixture(page: Page, board: number[] = INITIAL_PUZZLE) {
  const url = await page.evaluate((numbers) => {
    const image = document.createElement('canvas');
    image.width = 900;
    image.height = 960;
    const context = image.getContext('2d')!;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, image.width, image.height);
    context.fillStyle = '#315b48';
    context.font = '28px Georgia';
    context.fillText('A quiet Sunday puzzle', 90, 65);
    const x = 90;
    const y = 120;
    const cell = 80;
    context.strokeStyle = '#222222';
    for (let index = 0; index <= 9; index++) {
      context.lineWidth = index % 3 === 0 ? 4 : 1;
      context.beginPath();
      context.moveTo(x + index * cell, y);
      context.lineTo(x + index * cell, y + cell * 9);
      context.stroke();
      context.beginPath();
      context.moveTo(x, y + index * cell);
      context.lineTo(x + cell * 9, y + index * cell);
      context.stroke();
    }
    context.font = '44px Arial';
    context.fillStyle = '#222222';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    numbers.forEach((number, index) => {
      if (number) context.fillText(String(number), x + (index % 9 + 0.5) * cell,
        y + (Math.floor(index / 9) + 0.5) * cell + 2);
    });
    return image.toDataURL();
  }, board);
  return { name: 'sunday-puzzle.png', mimeType: 'image/png', buffer: Buffer.from(url.split(',')[1], 'base64') };
}

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('reads actual image pixels, reviews exact clues, and starts the imported game', async ({ page }) => {
  test.setTimeout(120_000);
  // This intentionally uses the real browser OCR worker and its downloaded model.
  const fixture = await printedFixture(page);
  await page.getByLabel('Upload a puzzle image').setInputFiles(fixture);
  await expect(page.getByRole('heading', { name: 'Just the nine-by-nine.' })).toBeVisible();
  await page.getByRole('button', { name: 'Read puzzle', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A quick double-check.' })).toBeVisible({ timeout: 100_000 });
  const actual = await page.locator('.import-review-board input').evaluateAll((inputs) =>
    inputs.map((input) => Number((input as HTMLInputElement).value)));
  expect(actual).toEqual(INITIAL_PUZZLE);
  await expect(page.getByRole('dialog')).toContainText('replaces your current game');
  await expect(page.getByText('Your imported puzzle', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Use this puzzle', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Your imported puzzle', { exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('sudoku-studio-game-v1')!));
  expect(saved.puzzle).toEqual(INITIAL_PUZZLE);
  expect(saved.board).toEqual(INITIAL_PUZZLE);
  expect(saved.elapsed).toBeLessThan(3);
});

test('accepts a dropped image and reports a blank scan without inventing clues', async ({ page }) => {
  const fixture = await printedFixture(page, Array(81).fill(0));
  const transfer = await page.evaluateHandle(({ data, name, mimeType }) => {
    const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], name, { type: mimeType }));
    return transfer;
  }, { data: fixture.buffer.toString('base64'), name: fixture.name, mimeType: fixture.mimeType });
  await page.getByRole('button', { name: 'Drop a puzzle image or click to browse' }).dispatchEvent('drop', { dataTransfer: transfer });
  await page.getByRole('button', { name: 'Read puzzle', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('No numbers were recognized');
  await expect(page.locator('.import-review-board input')).toHaveCount(81);
  expect(await page.locator('.import-review-board input').evaluateAll((inputs) =>
    inputs.every((input) => !(input as HTMLInputElement).value))).toBe(true);
  await page.getByRole('button', { name: 'Use this puzzle', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('at least 17 more numbers');
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('rejects unsupported files, allows manual correction, and blocks conflicting clues', async ({ page }) => {
  await page.getByLabel('Upload a puzzle image').setInputFiles({
    name: 'unsupported.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  });
  await expect(page.getByRole('alert')).toContainText('including HEIC and SVG');
  await page.getByRole('button', { name: /Enter numbers manually/ }).click();
  const inputs = page.locator('.import-review-board input');
  for (let index = 0; index < INITIAL_PUZZLE.length; index++) {
    if (INITIAL_PUZZLE[index]) await inputs.nth(index).fill(String(INITIAL_PUZZLE[index]));
  }
  await inputs.nth(0).fill('2');
  await page.getByRole('button', { name: 'Use this puzzle', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('repeat in a row, column or box');
  await expect(inputs.nth(0)).toHaveAttribute('aria-invalid', 'true');
  await inputs.nth(0).press('Delete');
  await expect(inputs.nth(0)).toHaveValue('');
  await page.getByRole('button', { name: 'Use this puzzle', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Your imported puzzle', { exact: true })).toBeVisible();
});

test('camera denial offers photo upload and dismissal preserves the current puzzle', async ({ page }) => {
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied for test', 'NotAllowedError'); };
  });
  await page.getByRole('button', { name: 'Scan with your camera' }).click();
  await expect(page.getByRole('alert')).toContainText('Camera access was not allowed');
  await expect(page.getByRole('button', { name: 'Choose or take a photo' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Capture puzzle' })).toBeDisabled();
  await page.getByRole('button', { name: 'Close import' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('[data-cell="3"]')).toHaveText('2');
});

test('closing the camera releases its media tracks', async ({ page }) => {
  await page.evaluate(() => {
    const camera = document.createElement('canvas');
    camera.width = 640;
    camera.height = 480;
    const context = camera.getContext('2d')!;
    context.fillStyle = '#eeeeee';
    context.fillRect(0, 0, 640, 480);
    const stream = camera.captureStream(10);
    (window as unknown as { testCameraStream: MediaStream }).testCameraStream = stream;
    navigator.mediaDevices.getUserMedia = async () => stream;
    // New frames ensure the video reaches a playable state in headless Chromium.
    const ticker = setInterval(() => context.fillRect(0, 0, 640, 480), 100);
    stream.getVideoTracks()[0].addEventListener('ended', () => clearInterval(ticker));
  });
  await page.getByRole('button', { name: 'Scan with your camera' }).click();
  await expect(page.getByRole('button', { name: 'Capture puzzle' })).toBeEnabled();
  await page.getByRole('button', { name: 'Close import' }).click();
  expect(await page.evaluate(() => (window as unknown as { testCameraStream: MediaStream })
    .testCameraStream.getTracks().every((track) => track.readyState === 'ended'))).toBe(true);
});
