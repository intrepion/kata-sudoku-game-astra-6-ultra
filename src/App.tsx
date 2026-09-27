import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ArrowRight,
  Camera,
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  Clock3,
  Eraser,
  Heart,
  Keyboard,
  Leaf,
  Lightbulb,
  Moon,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Trophy,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import {
  INITIAL_PUZZLE,
  generatePuzzle,
  getConflicts,
  isComplete,
  solve,
} from "./lib/sudoku";
import type { Difficulty } from "./lib/sudoku";
import { ImportModal } from "./components/ImportModal";
import "./import.css";

type Notes = number[][];
type Snapshot = { board: number[]; notes: Notes; mistakes: number };
type Game = Snapshot & {
  puzzle: number[];
  difficulty: Difficulty;
  elapsed: number;
  source: string;
  hints: number;
};
type Preferences = { autoCheck: boolean; highlight: boolean; dark: boolean };
const STORAGE_KEY = "sudoku-studio-game-v1";
const emptyNotes = () => Array.from({ length: 81 }, () => [] as number[]);
const newInitialGame = (): Game => ({
  puzzle: [...INITIAL_PUZZLE],
  board: [...INITIAL_PUZZLE],
  notes: emptyNotes(),
  mistakes: 0,
  elapsed: 0,
  difficulty: "medium",
  source: "Classic puzzle",
  hints: 0,
});
const isBoard = (value: unknown): value is number[] =>
  Array.isArray(value) &&
  value.length === 81 &&
  value.every((n) => Number.isInteger(n) && n >= 0 && n <= 9);
function loadGame(): Game {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (
      data &&
      isBoard(data.puzzle) &&
      isBoard(data.board) &&
      data.puzzle.every((n: number, i: number) => !n || data.board[i] === n) &&
      Array.isArray(data.notes) &&
      data.notes.length === 81 &&
      data.notes.every(
        (n: unknown) =>
          Array.isArray(n) &&
          n.every((v) => Number.isInteger(v) && v >= 1 && v <= 9),
      ) &&
      ["easy", "medium", "hard"].includes(data.difficulty) &&
      typeof data.source === "string" &&
      [data.elapsed, data.mistakes, data.hints].every(
        (n) => Number.isFinite(n) && n >= 0,
      ) &&
      solve(data.puzzle)
    )
      return data;
  } catch {
    /* An unavailable or invalid saved game starts a fresh puzzle. */
  }
  return newInitialGame();
}
function loadPreferences(): Preferences {
  try {
    const data = JSON.parse(
      localStorage.getItem("sudoku-preferences") || "null",
    );
    return {
      autoCheck: data?.autoCheck ?? true,
      highlight: data?.highlight ?? true,
      dark: data?.dark ?? false,
    };
  } catch {
    return { autoCheck: true, highlight: true, dark: false };
  }
}
const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
const sameUnit = (a: number, b: number) =>
  Math.floor(a / 9) === Math.floor(b / 9) ||
  a % 9 === b % 9 ||
  (Math.floor(a / 27) === Math.floor(b / 27) &&
    Math.floor((a % 9) / 3) === Math.floor((b % 9) / 3));

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const elements = ref.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]',
        );
        if (!elements?.length) return;
        const first = elements[0],
          last = elements[elements.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.body.style.overflow = priorOverflow;
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <div className="dialog-heading">
          <h2>{title}</h2>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PhotoIllustration() {
  return (
    <div className="photo-illustration" aria-hidden="true">
      <div className="photo-shadow" />
      <div className="photo-paper">
        <div className="mini-sudoku">
          {[0, 3, 0, 7, 0, 0, 0, 0, 6, 0, 0, 2, 0, 1, 0, 0].map((n, i) => (
            <span key={i}>{n || ""}</span>
          ))}
        </div>
      </div>
      <div className="photo-camera">
        <Camera size={21} strokeWidth={1.7} />
      </div>
      <Sparkles className="photo-sparkle" size={24} strokeWidth={1.5} />
    </div>
  );
}

export default function App() {
  const [game, setGame] = useState<Game>(loadGame);
  const [preferences, setPreferences] = useState<Preferences>(loadPreferences);
  const [selected, setSelected] = useState<number | null>(null);
  const [notesMode, setNotesMode] = useState(false);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [paused, setPaused] = useState(false);
  const [notice, setNotice] = useState("");
  const [checked, setChecked] = useState(false);
  const [importState, setImportState] = useState<{
    file: File | null;
    mode: "upload" | "camera";
  } | null>(null);
  const [dialog, setDialog] = useState<
    "help" | "settings" | "new" | "restart" | null
  >(null);
  const [nextDifficulty, setNextDifficulty] = useState<Difficulty>(
    game.difficulty,
  );
  const [dragging, setDragging] = useState(false);
  const [celebrated, setCelebrated] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const solution = useMemo(() => solve(game.puzzle), [game.puzzle]);
  const complete = isComplete(game.board);
  const completedCount = game.board.filter(Boolean).length;
  const conflicts = getConflicts(game.board);
  const selectedValue = selected !== null ? game.board[selected] : 0;
  const wrong = new Set<number>();
  if ((preferences.autoCheck || checked) && solution)
    game.board.forEach((n, i) => {
      if (n && !game.puzzle[i] && n !== solution![i]) wrong.add(i);
    });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(game));
      setStorageFailed(false);
    } catch {
      setStorageFailed(true);
    }
  }, [game]);
  useEffect(() => {
    document.documentElement.dataset.theme = preferences.dark
      ? "dark"
      : "light";
    try {
      localStorage.setItem("sudoku-preferences", JSON.stringify(preferences));
    } catch {
      /* Preferences remain available for this session. */
    }
  }, [preferences]);
  useEffect(() => {
    if (paused || complete || importState || dialog) return;
    const timer = window.setInterval(() => {
      if (!document.hidden)
        setGame((current) => ({ ...current, elapsed: current.elapsed + 1 }));
    }, 1000);
    return () => clearInterval(timer);
  }, [paused, complete, importState, dialog]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (importState || dialog) return;
      const file = Array.from(event.clipboardData?.files || []).find((f) =>
        f.type.startsWith("image/"),
      );
      if (file) {
        event.preventDefault();
        setImportState({ file, mode: "upload" });
      }
    };
    document.addEventListener("paste", paste);
    return () => document.removeEventListener("paste", paste);
  }, [importState, dialog]);

  const remember = () =>
    setHistory((current) => [
      ...current.slice(-99),
      {
        board: [...game.board],
        notes: game.notes.map((n) => [...n]),
        mistakes: game.mistakes,
      },
    ]);
  const enterNumber = (value: number) => {
    if (paused || complete) return;
    if (selected === null) {
      setNotice("Choose an empty square first.");
      return;
    }
    if (game.puzzle[selected]) {
      setNotice("That number is a starting clue. Try an empty square.");
      return;
    }
    if (notesMode && value && game.board[selected]) {
      setNotice("Erase this entry first to add pencil notes.");
      return;
    }
    if (!value && !game.board[selected] && !game.notes[selected].length) return;
    if (!notesMode && value && game.board[selected] === value) return;
    remember();
    setChecked(false);
    setGame((current) => {
      const board = [...current.board],
        notes = current.notes.map((n) => [...n]);
      let mistakes = current.mistakes;
      if (notesMode && value) {
        if (board[selected]) return current;
        notes[selected] = notes[selected].includes(value)
          ? notes[selected].filter((n) => n !== value)
          : [...notes[selected], value].sort();
      } else {
        board[selected] = value;
        notes[selected] = [];
        if (value && value === solution?.[selected])
          notes.forEach((n, i) => {
            if (sameUnit(i, selected)) notes[i] = n.filter((v) => v !== value);
          });
        if (preferences.autoCheck && value && value !== solution?.[selected])
          mistakes++;
      }
      return { ...current, board, notes, mistakes };
    });
  };
  const undo = () => {
    if (!history.length || paused) return;
    const last = history[history.length - 1];
    setGame((current) => ({ ...current, ...last }));
    setHistory((current) => current.slice(0, -1));
    setChecked(false);
    setCelebrated(false);
  };
  const hint = () => {
    if (paused || complete) return;
    const answer = solution;
    if (!answer) return;
    const index =
      selected !== null &&
      !game.puzzle[selected] &&
      game.board[selected] !== answer[selected]
        ? selected
        : game.board.findIndex((n, i) => n !== answer[i]);
    if (index < 0) return;
    remember();
    setSelected(index);
    setGame((current) => {
      const board = [...current.board],
        notes = current.notes.map((n) => [...n]);
      board[index] = answer[index];
      notes[index] = [];
      notes.forEach((n, i) => {
        if (sameUnit(i, index)) notes[i] = n.filter((v) => v !== answer[index]);
      });
      return { ...current, board, notes, hints: current.hints + 1 };
    });
    setNotice(
      `A little nudge: row ${Math.floor(index / 9) + 1}, column ${(index % 9) + 1} is ${answer[index]}.`,
    );
  };
  const checkBoard = () => {
    setChecked(true);
    const errors = game.board.filter((n, i) => n && n !== solution?.[i]).length;
    setNotice(
      errors
        ? `${errors} ${errors === 1 ? "square needs" : "squares need"} another look. Highlighted in coral.`
        : "Looking good. Every number so far is in the right place.",
    );
  };
  const handleKeyboard = useRef<(event: KeyboardEvent) => void>(() => {});
  handleKeyboard.current = (event) => {
    if (
      importState ||
      dialog ||
      paused ||
      (complete && !celebrated) ||
      (event.target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName))
    )
      return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      undo();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (/^[1-9]$/.test(event.key)) {
      event.preventDefault();
      enterNumber(Number(event.key));
    } else if (["Backspace", "Delete", "0"].includes(event.key)) {
      event.preventDefault();
      enterNumber(0);
    } else if (event.key.toLowerCase() === "n") {
      event.preventDefault();
      setNotesMode((current) => !current);
    } else if (event.key.toLowerCase() === "u") {
      event.preventDefault();
      undo();
    } else if (event.key.startsWith("Arrow")) {
      event.preventDefault();
      const index = selected ?? 40,
        row = Math.floor(index / 9),
        column = index % 9;
      const next =
        event.key === "ArrowRight"
          ? row * 9 + ((column + 1) % 9)
          : event.key === "ArrowLeft"
            ? row * 9 + ((column + 8) % 9)
            : event.key === "ArrowDown"
              ? ((row + 1) % 9) * 9 + column
              : ((row + 8) % 9) * 9 + column;
      setSelected(next);
      boardRef.current
        ?.querySelector<HTMLButtonElement>(`[data-cell="${next}"]`)
        ?.focus();
    }
  };
  useEffect(() => {
    const handler = (e: KeyboardEvent) => handleKeyboard.current(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const startGame = (difficulty: Difficulty) => {
    const { puzzle } = generatePuzzle(difficulty);
    setGame({
      puzzle,
      board: [...puzzle],
      notes: emptyNotes(),
      mistakes: 0,
      elapsed: 0,
      difficulty,
      source: "Classic puzzle",
      hints: 0,
    });
    setHistory([]);
    setSelected(null);
    setPaused(false);
    setChecked(false);
    setCelebrated(false);
    setDialog(null);
    setNotesMode(false);
    setNotice("A fresh puzzle. A fresh perspective.");
  };
  const askNewGame = (difficulty = game.difficulty) => {
    setNextDifficulty(difficulty);
    setDialog("new");
  };
  const importPuzzle = (puzzle: number[]) => {
    setGame({
      puzzle: [...puzzle],
      board: [...puzzle],
      notes: emptyNotes(),
      mistakes: 0,
      elapsed: 0,
      difficulty: "medium",
      source: "Your imported puzzle",
      hints: 0,
    });
    setHistory([]);
    setSelected(null);
    setPaused(false);
    setChecked(false);
    setCelebrated(false);
    setImportState(null);
    setNotesMode(false);
    setNotice("Your puzzle is ready. Pick up where you left off.");
  };
  const closeDialog = useCallback(() => setDialog(null), []);
  const closeImport = useCallback(() => setImportState(null), []);

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#" aria-label="Sudoku home">
          <span className="brand-mark">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>
            sudoku<span className="brand-dot">.</span>
          </span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#puzzle" className="nav-link active">
            Play
          </a>
          <button className="nav-link" onClick={() => setDialog("help")}>
            How to play <CircleHelp size={15} />
          </button>
        </nav>
        <div className="header-right">
          <span>A little space to think.</span>
          <button
            className="theme-button"
            onClick={() => setPreferences((p) => ({ ...p, dark: !p.dark }))}
            aria-label={
              preferences.dark
                ? "Switch to light theme"
                : "Switch to dark theme"
            }
          >
            {preferences.dark ? <Moon size={19} /> : <Sun size={19} />}
          </button>
        </div>
      </header>
      <main className="main-container">
        <section className="intro">
          <div>
            <div className="eyebrow">
              <span /> LESS SCROLLING. MORE SOLVING.
            </div>
            <h1>
              Find your little moment of <span>clarity.</span>
            </h1>
            <p>
              One square at a time. Settle in, slow down, and let your mind
              play.
            </p>
            <button
              className="mobile-import-link"
              onClick={() => setImportState({ file: null, mode: "upload" })}
            >
              <Camera size={14} /> Bring your own puzzle{" "}
              <ArrowRight size={13} />
            </button>
          </div>
          <div className="intro-decoration" aria-hidden="true">
            <Leaf size={33} strokeWidth={1.2} />
            <span>
              A daily dose of
              <br />a clearer mind.
            </span>
          </div>
        </section>
        <div className="workspace">
          <section className="game-card" id="puzzle" aria-label="Sudoku game">
            <div className="game-heading">
              <div className="game-title">
                <span className="small-grid-icon">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                <h2>{game.source}</h2>
              </div>
              <div className="difficulty-picker">
                <span className={`difficulty-dot ${game.difficulty}`} />
                <select
                  aria-label="Puzzle difficulty"
                  value={game.difficulty}
                  onChange={(e) => askNewGame(e.target.value as Difficulty)}
                >
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                </select>
                <ChevronDown size={14} />
              </div>
            </div>
            <div className="game-meta">
              <div className="timer">
                <Clock3 size={15} />
                <span>{formatTime(game.elapsed)}</span>
                <button
                  className="pause-button"
                  aria-label={paused ? "Resume game" : "Pause game"}
                  onClick={() => setPaused((p) => !p)}
                  disabled={complete}
                >
                  {paused ? <Play size={12} /> : <Pause size={12} />}
                </button>
              </div>
              <div className="mistakes">
                Mistakes <strong>{game.mistakes}</strong>
              </div>
              <div className="filled">
                <span>
                  {completedCount}
                  <span className="muted"> / 81</span>
                </span>
                <div className="mini-progress">
                  <span style={{ width: `${(completedCount / 81) * 100}%` }} />
                </div>
              </div>
              <button
                className="icon-button board-settings"
                onClick={() => setDialog("settings")}
                aria-label="Game settings"
              >
                <Settings2 size={17} />
              </button>
            </div>
            <div className="board-wrap">
              <div
                className={`sudoku-board ${paused ? "board-paused" : ""}`}
                ref={boardRef}
                role="group"
                aria-label="Sudoku board, 9 rows and 9 columns"
              >
                {game.board.map((value, index) => {
                  const row = Math.floor(index / 9),
                    column = index % 9;
                  const isSelected = selected === index;
                  const related =
                    preferences.highlight &&
                    selected !== null &&
                    sameUnit(selected, index);
                  const sameNumber = selectedValue && value === selectedValue;
                  const error =
                    wrong.has(index) ||
                    ((preferences.autoCheck || checked) &&
                      conflicts.has(index));
                  return (
                    <button
                      key={index}
                      data-cell={index}
                      aria-label={`Row ${row + 1}, column ${column + 1}, ${paused ? "hidden" : value ? `${value}${game.puzzle[index] ? ", starting clue" : ""}` : `empty${game.notes[index].length ? `, notes ${game.notes[index].join(", ")}` : ""}`}${error && !paused ? ", incorrect" : ""}`}
                      aria-pressed={isSelected}
                      tabIndex={
                        paused
                          ? -1
                          : isSelected || (selected === null && index === 0)
                            ? 0
                            : -1
                      }
                      onClick={() => {
                        if (!paused) setSelected(index);
                      }}
                      className={`cell ${game.puzzle[index] ? "given" : "entered"} ${column === 2 || column === 5 ? "box-right" : ""} ${row === 2 || row === 5 ? "box-bottom" : ""} ${related ? "related" : ""} ${sameNumber ? "same-number" : ""} ${isSelected ? "selected" : ""} ${error ? "incorrect" : ""}`}
                      disabled={paused}
                    >
                      {!paused &&
                        (value ||
                          (game.notes[index].length > 0 ? (
                            <span className="cell-notes">
                              {Array.from({ length: 9 }, (_, n) => (
                                <span key={n}>
                                  {game.notes[index].includes(n + 1)
                                    ? n + 1
                                    : ""}
                                </span>
                              ))}
                            </span>
                          ) : (
                            ""
                          )))}
                    </button>
                  );
                })}
              </div>
              {paused && (
                <div className="pause-overlay">
                  <span className="pause-leaf">
                    <Leaf size={28} />
                  </span>
                  <h3>Take a little breather.</h3>
                  <p>Your puzzle will be right here.</p>
                  <button
                    className="primary-button"
                    onClick={() => setPaused(false)}
                  >
                    <Play size={16} /> Back to the puzzle
                  </button>
                </div>
              )}
            </div>
            <div className="game-tools">
              <button
                onClick={undo}
                disabled={!history.length || paused}
                title="Undo (U)"
              >
                <Undo2 size={20} />
                <span>Undo</span>
              </button>
              <button
                onClick={() => enterNumber(0)}
                disabled={paused || complete}
                title="Erase (Backspace)"
              >
                <Eraser size={20} />
                <span>Erase</span>
              </button>
              <button
                className={notesMode ? "tool-active" : ""}
                onClick={() => setNotesMode((n) => !n)}
                aria-pressed={notesMode}
                disabled={paused || complete}
                title="Notes (N)"
              >
                <span className="notes-icon">
                  <Pencil size={20} />
                  <small>{notesMode ? "ON" : "OFF"}</small>
                </span>
                <span>Notes</span>
              </button>
              <button onClick={checkBoard} disabled={paused || complete}>
                <CheckCheck size={21} />
                <span>Check</span>
              </button>
              <button onClick={hint} disabled={paused || complete}>
                <Lightbulb size={21} />
                <span>Hint</span>
              </button>
            </div>
            <div
              className={`number-pad ${notesMode ? "notes-enabled" : ""}`}
              aria-label="Number pad"
            >
              {Array.from({ length: 9 }, (_, i) => {
                const n = i + 1;
                const remaining = Math.max(
                  0,
                  9 - game.board.filter((v) => v === n).length,
                );
                return (
                  <button
                    key={n}
                    onClick={() => enterNumber(n)}
                    disabled={paused || complete}
                    aria-label={`Enter ${n}, ${remaining} remaining`}
                    className={remaining === 0 ? "number-complete" : ""}
                  >
                    <span>{n}</span>
                    <small>
                      {remaining === 0 ? <Check size={10} /> : remaining}
                    </small>
                  </button>
                );
              })}
            </div>
            <div className="game-bottom">
              <span>
                <span
                  className={`save-dot ${storageFailed ? "save-warning" : ""}`}
                />
                {storageFailed
                  ? "Progress saved for this session"
                  : "Your progress is saved automatically"}
              </span>
              <button
                onClick={() => setDialog("restart")}
                aria-label="Restart puzzle"
                title="Restart puzzle"
              >
                <RotateCcw size={14} />
              </button>
            </div>
          </section>
          <aside className="sidebar">
            <section className="import-card">
              <div className="section-label">
                <Sparkles size={15} />
                <span>FROM PAPER TO PLAY</span>
              </div>
              <h2>
                Your puzzle.
                <br /> A fresh perspective.
              </h2>
              <p>
                Found a good one in the newspaper?
                <br className="desktop-break" /> Bring it here and make it your
                own.
              </p>
              <div
                className={`drop-zone ${dragging ? "dragging" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node))
                    setDragging(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const file = e.dataTransfer.files[0];
                  if (file) setImportState({ file, mode: "upload" });
                }}
                onClick={() => uploadRef.current?.click()}
                role="button"
                tabIndex={0}
                aria-label="Drop a puzzle image or click to browse"
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    uploadRef.current?.click();
                  }
                }}
              >
                <PhotoIllustration />
                <strong>
                  {dragging ? "Let’s see your puzzle" : "Drop your puzzle here"}
                </strong>
                <span>or click to browse your files</span>
                <small>JPG, PNG or WEBP · up to 20 MB</small>
              </div>
              <input
                className="visually-hidden"
                ref={uploadRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label="Upload a puzzle image"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) setImportState({ file, mode: "upload" });
                  e.target.value = "";
                }}
              />
              <button
                className="primary-button upload-button"
                onClick={() => uploadRef.current?.click()}
              >
                <Upload size={17} /> Upload a puzzle <ArrowRight size={17} />
              </button>
              <button
                className="camera-button"
                onClick={() => setImportState({ file: null, mode: "camera" })}
              >
                <Camera size={17} /> Scan with your camera
              </button>
              <div className="privacy-note">
                <ShieldCheck size={13} />
                <span>Your photo stays on your device.</span>
              </div>
            </section>
            <section className="new-puzzle-card">
              <div className="new-puzzle-icon">
                <Plus size={22} />
              </div>
              <div>
                <h3>A fresh start feels good.</h3>
                <p>A new challenge, whenever you’re ready.</p>
              </div>
              <button onClick={() => askNewGame()}>
                New puzzle <ArrowRight size={16} />
              </button>
            </section>
            <section className="tip-card">
              <div>
                <Lightbulb size={17} />
                <span>A LITTLE SOLVING WISDOM</span>
              </div>
              <p>
                Look for the almost-full rows, columns, and boxes. Sometimes,
                the missing piece is closer than you think.
              </p>
            </section>
          </aside>
        </div>
        <div className="below-game">
          <span>
            <Keyboard size={15} /> Keyboard friendly <i /> <kbd>1–9</kbd> to
            fill <kbd>N</kbd> for notes <kbd>↑↓←→</kbd> to move
          </span>
          <button onClick={() => setDialog("help")}>
            New to Sudoku?{" "}
            <span>
              Let’s get you started <ArrowRight size={13} />
            </span>
          </button>
        </div>
      </main>
      <footer className="site-footer">
        <span>A small challenge. A calmer mind.</span>
        <span>
          Made for the joy of figuring it out. <Heart size={12} />
        </span>
      </footer>
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{notice}</span>
          <button
            onClick={() => setNotice("")}
            aria-label="Dismiss notification"
          >
            <X size={15} />
          </button>
        </div>
      )}
      {importState && (
        <ImportModal
          initialFile={importState.file}
          initialMode={importState.mode}
          onClose={closeImport}
          onImport={importPuzzle}
        />
      )}
      {dialog === "help" && (
        <Modal title="A little guidance goes a long way." onClose={closeDialog}>
          <p className="dialog-intro">
            Fill the grid with the numbers 1 through 9. There’s just one simple
            rule, in three places.
          </p>
          <div className="rules">
            <div>
              <span>01</span>
              <p>
                <strong>Every row.</strong> Each number appears once across.
              </p>
            </div>
            <div>
              <span>02</span>
              <p>
                <strong>Every column.</strong> Each number appears once down.
              </p>
            </div>
            <div>
              <span>03</span>
              <p>
                <strong>Every box.</strong> Each 3 × 3 box contains all nine
                numbers.
              </p>
            </div>
          </div>
          <div className="help-note">
            <Pencil size={20} />
            <p>
              Not quite sure? Switch on <strong>Notes</strong> to pencil in
              possibilities. Use <strong>Hint</strong> when you need a little
              nudge.
            </p>
          </div>
          <p className="dialog-small">
            To bring a paper puzzle along, upload a clear photo, align the crop
            with its grid, and review the scanned numbers before playing. You
            can erase any handwritten guesses during review.
          </p>
          <button className="primary-button full-width" onClick={closeDialog}>
            Let’s play <ArrowRight size={16} />
          </button>
        </Modal>
      )}
      {dialog === "settings" && (
        <Modal title="Make yourself comfortable." onClose={closeDialog}>
          <p className="dialog-intro">
            A few little things to make this space your own.
          </p>
          <label className="setting-row">
            <span>
              <strong>Check as you go</strong>
              <small>Highlight incorrect entries and count mistakes.</small>
            </span>
            <input
              type="checkbox"
              checked={preferences.autoCheck}
              onChange={(e) => {
                setPreferences((p) => ({ ...p, autoCheck: e.target.checked }));
                setChecked(false);
              }}
            />
          </label>
          <label className="setting-row">
            <span>
              <strong>A little focus</strong>
              <small>Highlight the selected row, column, and box.</small>
            </span>
            <input
              type="checkbox"
              checked={preferences.highlight}
              onChange={(e) =>
                setPreferences((p) => ({ ...p, highlight: e.target.checked }))
              }
            />
          </label>
          <label className="setting-row">
            <span>
              <strong>Evening mode</strong>
              <small>A softer, darker space for late-night solving.</small>
            </span>
            <input
              type="checkbox"
              checked={preferences.dark}
              onChange={(e) =>
                setPreferences((p) => ({ ...p, dark: e.target.checked }))
              }
            />
          </label>
          <button className="primary-button full-width" onClick={closeDialog}>
            All set <Check size={17} />
          </button>
        </Modal>
      )}
      {dialog === "new" && (
        <Modal title="A fresh page awaits." onClose={closeDialog}>
          <p className="dialog-intro">
            Choose your pace. Starting a new puzzle will replace your current
            progress.
          </p>
          <div className="difficulty-options">
            {(["easy", "medium", "hard"] as const).map((d) => (
              <button
                key={d}
                className={nextDifficulty === d ? "chosen" : ""}
                onClick={() => setNextDifficulty(d)}
              >
                <span>
                  {d === "easy"
                    ? "A gentle start"
                    : d === "medium"
                      ? "A little challenge"
                      : "A deeper focus"}
                </span>
                <strong>{d}</strong>
                {nextDifficulty === d && <Check size={17} />}
              </button>
            ))}
          </div>
          <button
            className="primary-button full-width"
            onClick={() => startGame(nextDifficulty)}
          >
            Start a new puzzle <ArrowRight size={17} />
          </button>
          <button className="text-button full-width" onClick={closeDialog}>
            Keep my current puzzle
          </button>
        </Modal>
      )}
      {dialog === "restart" && (
        <Modal title="Begin again, with fresh eyes." onClose={closeDialog}>
          <p className="dialog-intro">
            Keep this puzzle and clear your entries, notes, and timer.
          </p>
          <button
            className="primary-button full-width"
            onClick={() => {
              setGame((g) => ({
                ...g,
                board: [...g.puzzle],
                notes: emptyNotes(),
                mistakes: 0,
                elapsed: 0,
                hints: 0,
              }));
              setHistory([]);
              setPaused(false);
              setChecked(false);
              setCelebrated(false);
              setDialog(null);
            }}
          >
            Restart this puzzle <RotateCcw size={16} />
          </button>
          <button className="text-button full-width" onClick={closeDialog}>
            Keep going
          </button>
        </Modal>
      )}
      {complete && !celebrated && (
        <Modal
          title="Look what you figured out."
          onClose={() => setCelebrated(true)}
        >
          <div className="victory">
            <div>
              <Trophy size={40} />
            </div>
            <p>81 squares. One lovely little victory.</p>
            <span>
              {formatTime(game.elapsed)} <i>·</i> {game.mistakes} mistakes{" "}
              <i>·</i> {game.hints} hints
            </span>
          </div>
          <button
            className="primary-button full-width"
            onClick={() => {
              setCelebrated(true);
              askNewGame();
            }}
          >
            One more little challenge <ArrowRight size={17} />
          </button>
          <button
            className="text-button full-width"
            onClick={() => setCelebrated(true)}
          >
            Enjoy the moment
          </button>
        </Modal>
      )}
    </div>
  );
}
