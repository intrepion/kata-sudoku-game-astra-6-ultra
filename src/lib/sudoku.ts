export type Difficulty = "easy" | "medium" | "hard";
export type Board = number[];

export const INITIAL_PUZZLE: Board = [
  0, 0, 0, 2, 6, 0, 7, 0, 1, 6, 8, 0, 0, 7, 0, 0, 9, 0, 1, 9, 0, 0, 0, 4, 5, 0,
  0, 8, 2, 0, 1, 0, 0, 0, 4, 0, 0, 0, 4, 6, 0, 2, 9, 0, 0, 0, 5, 0, 0, 0, 3, 0,
  2, 8, 0, 0, 9, 3, 0, 0, 0, 7, 4, 0, 4, 0, 0, 5, 0, 0, 3, 6, 7, 0, 3, 0, 1, 8,
  0, 0, 0,
];

const ALL_DIGITS = 0b1111111110;
const boxOf = (row: number, column: number) =>
  Math.floor(row / 3) * 3 + Math.floor(column / 3);
const isBoard = (board: Board) =>
  Array.isArray(board) &&
  board.length === 81 &&
  Array.from(board).every(
    (value) => Number.isInteger(value) && value >= 0 && value <= 9,
  );

const units: number[][] = [
  ...Array.from({ length: 9 }, (_, row) =>
    Array.from({ length: 9 }, (_, column) => row * 9 + column),
  ),
  ...Array.from({ length: 9 }, (_, column) =>
    Array.from({ length: 9 }, (_, row) => row * 9 + column),
  ),
  ...Array.from({ length: 9 }, (_, box) =>
    Array.from(
      { length: 9 },
      (_, cell) =>
        (Math.floor(box / 3) * 3 + Math.floor(cell / 3)) * 9 +
        (box % 3) * 3 +
        (cell % 3),
    ),
  ),
];

/** Return every involved cell, so both sides of a duplicate can be highlighted. */
export function getConflicts(board: Board): Set<number> {
  const conflicts = new Set<number>();
  for (const unit of units) {
    const seen = new Map<number, number>();
    for (const index of unit) {
      const value = board[index];
      if (value === 0 || value === undefined) continue;
      if (!Number.isInteger(value) || value < 1 || value > 9) {
        conflicts.add(index);
        continue;
      }
      const previous = seen.get(value);
      if (previous !== undefined) {
        conflicts.add(previous);
        conflicts.add(index);
      } else {
        seen.set(value, index);
      }
    }
  }
  return conflicts;
}

export function getCandidates(board: Board, index: number): number[] {
  if (
    !isBoard(board) ||
    !Number.isInteger(index) ||
    index < 0 ||
    index > 80 ||
    board[index] !== 0
  )
    return [];
  const row = Math.floor(index / 9);
  const column = index % 9;
  let used = 0;
  for (let offset = 0; offset < 9; offset++) {
    used |= 1 << board[row * 9 + offset];
    used |= 1 << board[offset * 9 + column];
    const boxRow = Math.floor(row / 3) * 3 + Math.floor(offset / 3);
    const boxColumn = Math.floor(column / 3) * 3 + (offset % 3);
    used |= 1 << board[boxRow * 9 + boxColumn];
  }
  return Array.from({ length: 9 }, (_, digit) => digit + 1).filter(
    (digit) => !(used & (1 << digit)),
  );
}

type SearchResult = {
  count: number;
  solution: Board | null;
  exhausted: boolean;
};

/** Search copies its input. The generation budget rejects uncertain removals. */
function search(
  board: Board,
  limit: number,
  nodeBudget = Number.POSITIVE_INFINITY,
): SearchResult {
  const result: SearchResult = { count: 0, solution: null, exhausted: true };
  if (!isBoard(board)) return result;

  const cells = [...board];
  const rows = new Uint16Array(9);
  const columns = new Uint16Array(9);
  const boxes = new Uint16Array(9);
  for (let index = 0; index < 81; index++) {
    const value = cells[index];
    if (value === 0) continue;
    const row = Math.floor(index / 9);
    const column = index % 9;
    const box = boxOf(row, column);
    const bit = 1 << value;
    if ((rows[row] | columns[column] | boxes[box]) & bit) return result;
    rows[row] |= bit;
    columns[column] |= bit;
    boxes[box] |= bit;
  }

  let nodes = 0;
  function visit(): void {
    if (result.count >= limit || !result.exhausted) return;
    if (++nodes > nodeBudget) {
      result.exhausted = false;
      return;
    }

    let selected = -1;
    let selectedMask = 0;
    let smallestCount = 10;
    for (let index = 0; index < 81; index++) {
      if (cells[index] !== 0) continue;
      const row = Math.floor(index / 9);
      const column = index % 9;
      const mask =
        ALL_DIGITS & ~(rows[row] | columns[column] | boxes[boxOf(row, column)]);
      if (mask === 0) return;
      let count = 0;
      for (let bits = mask; bits; bits &= bits - 1) count++;
      if (count < smallestCount) {
        selected = index;
        selectedMask = mask;
        smallestCount = count;
        if (count === 1) break;
      }
    }

    if (selected === -1) {
      result.count++;
      result.solution ??= [...cells];
      return;
    }

    const row = Math.floor(selected / 9);
    const column = selected % 9;
    const box = boxOf(row, column);
    for (let mask = selectedMask; mask; mask &= mask - 1) {
      const bit = mask & -mask;
      cells[selected] = 31 - Math.clz32(bit);
      rows[row] |= bit;
      columns[column] |= bit;
      boxes[box] |= bit;
      visit();
      rows[row] ^= bit;
      columns[column] ^= bit;
      boxes[box] ^= bit;
      cells[selected] = 0;
      if (result.count >= limit || !result.exhausted) return;
    }
  }

  visit();
  return result;
}

export function solve(board: Board): Board | null {
  return search(board, 1).solution;
}

export function countSolutions(board: Board, limit = 2): number {
  const boundedLimit = Number.isFinite(limit)
    ? Math.max(1, Math.floor(limit))
    : 2;
  return search(board, boundedLimit).count;
}

export function isComplete(board: Board): boolean {
  return isBoard(board) && !board.includes(0) && getConflicts(board).size === 0;
}

export function validatePuzzle(board: Board): {
  valid: boolean;
  message: string;
  solution: Board | null;
} {
  if (!isBoard(board)) {
    return {
      valid: false,
      message: "Use a 9 × 9 grid with digits from 1 to 9 and empty cells.",
      solution: null,
    };
  }
  if (getConflicts(board).size > 0) {
    return {
      valid: false,
      message:
        "Some digits repeat in a row, column, or box. Check the highlighted cells.",
      solution: null,
    };
  }
  if (board.filter(Boolean).length < 17) {
    return {
      valid: false,
      message:
        "Add more clues. A Sudoku needs at least 17 given digits to have one solution.",
      solution: null,
    };
  }
  const result = search(board, 2);
  if (result.count === 0) {
    return {
      valid: false,
      message:
        "This grid has no solution. Check the scanned digits against your picture.",
      solution: null,
    };
  }
  if (result.count > 1) {
    return {
      valid: false,
      message:
        "This grid has more than one solution. Check for missing or misread digits.",
      solution: null,
    };
  }
  return {
    valid: true,
    message: "Your puzzle is ready. One unique solution found.",
    solution: result.solution,
  };
}

function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

/** Difficulty controls clue density. Every returned puzzle has one solution. */
export function generatePuzzle(difficulty: Difficulty): {
  puzzle: Board;
  solution: Board;
} {
  const digits = shuffled([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const axis = () =>
    shuffled([0, 1, 2]).flatMap((group) =>
      shuffled([0, 1, 2]).map((offset) => group * 3 + offset),
    );
  const rows = axis();
  const columns = axis();
  const transpose = Math.random() < 0.5;
  const solution = Array.from({ length: 81 }, (_, index) => {
    const row = rows[transpose ? index % 9 : Math.floor(index / 9)];
    const column = columns[transpose ? Math.floor(index / 9) : index % 9];
    return digits[(row * 3 + Math.floor(row / 3) + column) % 9];
  });
  const puzzle = [...solution];
  const targetClues = { easy: 42, medium: 34, hard: 28 }[difficulty] ?? 34;
  let clues = 81;
  for (const index of shuffled(
    Array.from({ length: 81 }, (_, value) => value),
  )) {
    if (clues <= targetClues) break;
    const previous = puzzle[index];
    puzzle[index] = 0;
    const result = search(puzzle, 2, 30_000);
    if (result.exhausted && result.count === 1) {
      clues--;
    } else {
      puzzle[index] = previous;
    }
  }
  return { puzzle, solution };
}
