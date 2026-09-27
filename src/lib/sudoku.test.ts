import { describe, expect, it } from "vitest";
import {
  countSolutions,
  generatePuzzle,
  getCandidates,
  getConflicts,
  INITIAL_PUZZLE,
  isComplete,
  solve,
  validatePuzzle,
} from "./sudoku";
import type { Board, Difficulty } from "./sudoku";

const expectedSolution: Board = [
  4, 3, 5, 2, 6, 9, 7, 8, 1, 6, 8, 2, 5, 7, 1, 4, 9, 3, 1, 9, 7, 8, 3, 4, 5, 6,
  2, 8, 2, 6, 1, 9, 5, 3, 4, 7, 3, 7, 4, 6, 8, 2, 9, 1, 5, 9, 5, 1, 7, 4, 3, 6,
  2, 8, 5, 1, 9, 3, 2, 6, 8, 7, 4, 2, 4, 8, 9, 5, 7, 1, 3, 6, 7, 6, 3, 4, 1, 8,
  2, 5, 9,
];

describe("Sudoku rules and solving", () => {
  it("solves a known puzzle without mutating the givens", () => {
    const puzzle = [...INITIAL_PUZZLE];
    expect(solve(puzzle)).toEqual(expectedSolution);
    expect(puzzle).toEqual(INITIAL_PUZZLE);
    expect(countSolutions(puzzle)).toBe(1);
    expect(isComplete(expectedSolution)).toBe(true);
    expect(isComplete(puzzle)).toBe(false);
  });

  it("highlights every duplicate across rows, columns, and boxes", () => {
    const board = Array<number>(81).fill(0);
    board[0] = board[1] = board[9] = board[10] = 5;
    expect([...getConflicts(board)].sort((a, b) => a - b)).toEqual([
      0, 1, 9, 10,
    ]);
    expect(solve(board)).toBeNull();
    expect(countSolutions(board)).toBe(0);
  });

  it("returns legal pencil marks only for empty in-range cells", () => {
    expect(getCandidates(INITIAL_PUZZLE, 0)).toEqual([3, 4, 5]);
    expect(getCandidates(INITIAL_PUZZLE, 3)).toEqual([]);
    expect(getCandidates(INITIAL_PUZZLE, 81)).toEqual([]);
  });

  it("caps solution counting for ambiguous puzzles", () => {
    const empty = Array<number>(81).fill(0);
    expect(countSolutions(empty)).toBe(2);
    expect(countSolutions(empty, 3)).toBe(3);
    expect(countSolutions(empty, 1)).toBe(1);
  });

  it("rejects malformed and incomplete boards as completed puzzles", () => {
    expect(solve([1, 2, 3])).toBeNull();
    expect(solve(Array<number>(81).fill(-1))).toBeNull();
    expect(solve(new Array<number>(81))).toBeNull();
    expect(isComplete(Array<number>(81).fill(1))).toBe(false);
    expect(isComplete(expectedSolution.slice(1))).toBe(false);
  });
});

describe("import validation", () => {
  it("accepts a uniquely solvable scanned grid", () => {
    expect(validatePuzzle(INITIAL_PUZZLE)).toMatchObject({
      valid: true,
      solution: expectedSolution,
    });
  });

  it("asks for missing clues rather than accepting an empty grid", () => {
    expect(validatePuzzle(Array<number>(81).fill(0))).toMatchObject({
      valid: false,
      solution: null,
    });
    expect(validatePuzzle(Array<number>(81).fill(0)).message).toContain("17");
  });

  it("rejects contradictions with actionable guidance", () => {
    const board = [...INITIAL_PUZZLE];
    board[0] = 2;
    expect(validatePuzzle(board).message).toContain("repeat");
    expect(validatePuzzle(board).valid).toBe(false);
  });

  it("rejects a noncontradictory grid that cannot be solved", () => {
    const board = [...INITIAL_PUZZLE];
    board[0] = 3;
    expect(getConflicts(board).size).toBe(0);
    expect(validatePuzzle(board)).toMatchObject({
      valid: false,
      solution: null,
    });
    expect(validatePuzzle(board).message).toContain("no solution");
  });

  it("rejects ambiguous grids even when they have many clues", () => {
    const board = expectedSolution.map((value) =>
      value === 1 || value === 2 ? 0 : value,
    );
    expect(board.filter(Boolean).length).toBe(63);
    expect(validatePuzzle(board)).toMatchObject({
      valid: false,
      solution: null,
    });
    expect(validatePuzzle(board).message).toContain("more than one solution");
  });
});

describe("puzzle generation", () => {
  it.each<Difficulty>(["easy", "medium", "hard"])(
    "generates uniquely solvable %s puzzles with intact clues",
    (difficulty) => {
      const { puzzle, solution } = generatePuzzle(difficulty);
      expect(isComplete(solution)).toBe(true);
      expect(countSolutions(puzzle)).toBe(1);
      expect(solve(puzzle)).toEqual(solution);
      expect(puzzle.filter(Boolean).length).toBeGreaterThanOrEqual(
        { easy: 42, medium: 34, hard: 28 }[difficulty],
      );
      expect(puzzle.filter(Boolean).length).toBeLessThanOrEqual(45);
      expect(
        puzzle.every(
          (value, index) => value === 0 || value === solution[index],
        ),
      ).toBe(true);
      expect(puzzle).not.toBe(solution);
    },
  );
});
