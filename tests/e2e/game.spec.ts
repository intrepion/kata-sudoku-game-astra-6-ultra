import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { INITIAL_PUZZLE, solve } from '../../src/lib/sudoku';

const cell = (page: Page, index: number) => page.locator(`[data-cell="${index}"]`);
const enter = (page: Page, value: number) => page.getByRole('button', { name: new RegExp(`^Enter ${value},`) }).click();
const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('sudoku-studio-game-v1') || 'null'));

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('group', { name: 'Sudoku board, 9 rows and 9 columns' })).toBeVisible();
});

test('enters and erases numbers while preserving starting clues', async ({ page }) => {
  await cell(page, 0).click();
  await enter(page, 4);
  await expect(cell(page, 0)).toHaveAttribute('aria-label', 'Row 1, column 1, 4');
  await cell(page, 3).click();
  await enter(page, 9);
  await expect(cell(page, 3)).toHaveText('2');
  await expect(page.getByRole('status')).toContainText('starting clue');
  await cell(page, 0).click();
  await page.getByRole('button', { name: 'Erase', exact: true }).click();
  await expect(cell(page, 0)).toHaveAttribute('aria-label', 'Row 1, column 1, empty');
  await expect.poll(async () => (await saved(page)).board[0]).toBe(0);
});

test('pencil marks toggle and undo restores notes as well as entries', async ({ page }) => {
  await cell(page, 0).click();
  await page.getByTitle('Notes (N)').click();
  await enter(page, 3);
  await enter(page, 4);
  await expect(cell(page, 0).locator('.cell-notes')).toHaveText('34');
  await enter(page, 3);
  await expect(cell(page, 0).locator('.cell-notes')).toHaveText('4');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(cell(page, 0).locator('.cell-notes')).toHaveText('34');
  await page.getByTitle('Notes (N)').click();
  await enter(page, 4);
  await expect(cell(page, 0)).toHaveText('4');
  await expect(cell(page, 0).locator('.cell-notes')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(cell(page, 0).locator('.cell-notes')).toHaveText('34');
});

test('manual check reveals mistakes when automatic checking is disabled', async ({ page }) => {
  await page.getByRole('button', { name: 'Game settings' }).click();
  await page.getByRole('checkbox', { name: /Check as you go/ }).uncheck();
  await page.getByRole('button', { name: 'All set' }).click();
  await cell(page, 0).click();
  await enter(page, 3);
  await expect(cell(page, 0)).not.toHaveClass(/incorrect/);
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(cell(page, 0)).toHaveClass(/incorrect/);
  await expect(page.getByRole('status')).toContainText('1 square needs another look');
  await page.getByRole('button', { name: 'Hint', exact: true }).click();
  await expect(cell(page, 0)).toHaveText('4');
  await expect(cell(page, 0)).not.toHaveClass(/incorrect/);
  await expect.poll(async () => (await saved(page)).hints).toBe(1);
  await page.getByRole('button', { name: 'Check', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Looking good');
});

test('erase clears pencil marks even after Notes mode is switched off', async ({ page }) => {
  await cell(page, 0).click();
  await page.keyboard.press('n');
  await page.keyboard.press('3');
  await expect(cell(page, 0).locator('.cell-notes')).toHaveText('3');
  await page.keyboard.press('n');
  await page.getByRole('button', { name: 'Erase', exact: true }).click();
  await expect(cell(page, 0)).toBeEmpty();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(cell(page, 0).locator('.cell-notes')).toHaveText('3');
});

test('attempting a note on a filled cell does not consume an undo step', async ({ page }) => {
  await cell(page, 0).click();
  await page.keyboard.press('4');
  await page.keyboard.press('n');
  await page.keyboard.press('3');
  await expect(cell(page, 0)).toHaveText('4');
  await page.keyboard.press('u');
  await expect(cell(page, 0)).toBeEmpty();
});

test('pencil marks are available in a cell’s accessible label', async ({ page }) => {
  await cell(page, 0).click();
  await page.keyboard.press('n');
  await page.keyboard.press('3');
  await page.keyboard.press('4');
  await expect(cell(page, 0)).toHaveAttribute('aria-label', /notes.*3.*4/i);
});

test('automatic checking counts a mistake and undo restores the count', async ({ page }) => {
  await cell(page, 0).click();
  await enter(page, 3);
  await expect(cell(page, 0)).toHaveClass(/incorrect/);
  await expect(page.locator('.mistakes')).toHaveText('Mistakes 1');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(cell(page, 0)).not.toHaveClass(/incorrect/);
  await expect(page.locator('.mistakes')).toHaveText('Mistakes 0');
});

test('keyboard supports navigation, notes, number entry, erase, and undo', async ({ page }) => {
  await cell(page, 0).click();
  await page.keyboard.press('ArrowRight');
  await expect(cell(page, 1)).toBeFocused();
  await page.keyboard.press('3');
  await expect(cell(page, 1)).toHaveText('3');
  await page.keyboard.press('Backspace');
  await expect(cell(page, 1)).toBeEmpty();
  await page.keyboard.press('u');
  await expect(cell(page, 1)).toHaveText('3');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('n');
  await page.keyboard.press('4');
  await expect(cell(page, 0).locator('.cell-notes')).toHaveText('4');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(cell(page, 0)).toBeEmpty();
});

test('pause hides the puzzle, stops its clock, and blocks input until resumed', async ({ page }) => {
  await cell(page, 0).click();
  await page.getByRole('button', { name: 'Pause game' }).click();
  const elapsed = (await saved(page)).elapsed;
  await expect(cell(page, 3)).toHaveAttribute('aria-label', 'Row 1, column 4, hidden');
  await expect(cell(page, 0)).toBeDisabled();
  await expect(page.getByRole('button', { name: /^Enter 4,/ })).toBeDisabled();
  await page.keyboard.press('4');
  await page.waitForTimeout(1_200);
  expect((await saved(page)).elapsed).toBe(elapsed);
  expect((await saved(page)).board[0]).toBe(0);
  await page.getByRole('button', { name: 'Back to the puzzle' }).click();
  await expect(cell(page, 3)).toHaveText('2');
  await expect(cell(page, 0)).toBeEnabled();
  await expect.poll(async () => (await saved(page)).elapsed).toBeGreaterThan(elapsed);
});

test('reload restores progress, pencil marks, and theme preferences', async ({ page }) => {
  await cell(page, 0).click();
  await enter(page, 4);
  await cell(page, 1).click();
  await page.getByTitle('Notes (N)').click();
  await enter(page, 3);
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect.poll(async () => (await saved(page)).notes[1]).toEqual([3]);
  await page.reload();
  await expect(cell(page, 0)).toHaveText('4');
  await expect(cell(page, 1).locator('.cell-notes')).toHaveText('3');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible();
});

test('restart requires confirmation and clears play state while retaining the puzzle', async ({ page }) => {
  await cell(page, 0).click();
  await enter(page, 4);
  const original = (await saved(page)).puzzle;
  await page.getByRole('button', { name: 'Restart puzzle', exact: true }).click();
  await page.getByRole('button', { name: 'Keep going' }).click();
  await expect(cell(page, 0)).toHaveText('4');
  await page.getByRole('button', { name: 'Restart puzzle', exact: true }).click();
  await page.getByRole('button', { name: 'Restart this puzzle' }).click();
  await expect(cell(page, 0)).toBeEmpty();
  const game = await saved(page);
  expect(game.puzzle).toEqual(original);
  expect(game.board).toEqual(original);
  expect(game.mistakes).toBe(0);
  expect(game.hints).toBe(0);
  expect(game.notes.every((notes: number[]) => notes.length === 0)).toBe(true);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

test('new puzzle and difficulty changes require confirmation', async ({ page }) => {
  await cell(page, 0).click();
  await enter(page, 4);
  await page.getByRole('button', { name: 'New puzzle', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'A fresh page awaits.' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep my current puzzle' }).click();
  await expect(cell(page, 0)).toHaveText('4');
  await page.getByRole('combobox', { name: 'Puzzle difficulty' }).selectOption('easy');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'A gentle start easy' })).toHaveClass(/chosen/);
  await page.getByRole('button', { name: 'Start a new puzzle' }).click();
  await expect(page.getByRole('combobox', { name: 'Puzzle difficulty' })).toHaveValue('easy');
  const game = await saved(page);
  expect(game.board).toEqual(game.puzzle);
  expect(game.puzzle).not.toEqual(INITIAL_PUZZLE);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});

test('help traps keyboard focus, closes with Escape, and restores its trigger', async ({ page }) => {
  const trigger = page.getByRole('button', { name: 'How to play' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'A little guidance goes a long way.' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Let’s play' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Close dialog' })).toBeFocused();
  await page.keyboard.press('4');
  expect((await saved(page)).board).toEqual(INITIAL_PUZZLE);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test('settings persist and disable unit highlighting', async ({ page }) => {
  await page.getByRole('button', { name: 'Game settings' }).click();
  await page.getByRole('checkbox', { name: /A little focus/ }).uncheck();
  await page.getByRole('checkbox', { name: /Evening mode/ }).check();
  await page.getByRole('button', { name: 'All set' }).click();
  await cell(page, 0).click();
  await expect(page.locator('.cell.related')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await page.getByRole('button', { name: 'Game settings' }).click();
  await expect(page.getByRole('checkbox', { name: /A little focus/ })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Evening mode/ })).toBeChecked();
});

test('completing a valid puzzle celebrates and stops additional entries', async ({ page }) => {
  const solution = solve(INITIAL_PUZZLE)!;
  const board = [...solution];
  board[0] = 0;
  await page.evaluate(({ puzzle, board }) => {
    localStorage.setItem('sudoku-studio-game-v1', JSON.stringify({
      puzzle, board, notes: Array.from({ length: 81 }, () => []), mistakes: 0,
      elapsed: 120, difficulty: 'medium', source: 'Classic puzzle', hints: 0,
    }));
  }, { puzzle: INITIAL_PUZZLE, board });
  await page.reload();
  await cell(page, 0).click();
  await enter(page, 4);
  await expect(page.getByRole('dialog', { name: 'Look what you figured out.' })).toBeVisible();
  await expect(page.getByText('81 squares. One lovely little victory.')).toBeVisible();
  await page.getByRole('button', { name: 'Enjoy the moment' }).click();
  await expect(page.getByRole('button', { name: /^Enter 1,/ })).toBeDisabled();
  expect((await saved(page)).board).toEqual(solution);
});

test('corrupted saved progress falls back to a playable fresh puzzle', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('sudoku-studio-game-v1', '{ broken json'));
  await page.reload();
  await expect(cell(page, 3)).toHaveText('2');
  expect((await saved(page)).board).toEqual(INITIAL_PUZZLE);
});

test('mobile and tablet layouts keep the board and controls inside the viewport', async ({ page }) => {
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('group', { name: 'Sudoku board, 9 rows and 9 columns' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const board = await page.locator('.sudoku-board').boundingBox();
    expect(board?.x).toBeGreaterThanOrEqual(0);
    expect(board!.x + board!.width).toBeLessThanOrEqual(width);
    await cell(page, 0).click();
    await enter(page, 4);
    await expect(cell(page, 0)).toHaveText('4');
  }
});

test('captures the final desktop and mobile layouts for visual review', async ({ page }) => {
  await page.evaluate(() => document.fonts.ready);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await cell(page, 40).click();
  await page.mouse.move(0, 0);
  await page.screenshot({ path: 'artifacts/sudoku-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'artifacts/sudoku-mobile.png', fullPage: true });
});
