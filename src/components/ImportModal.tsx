import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  Crop,
  ImagePlus,
  LoaderCircle,
  LockKeyhole,
  RotateCcw,
  ScanLine,
  Upload,
  X,
} from "lucide-react";
import { getConflicts, validatePuzzle } from "../lib/sudoku";
import { croppedImage, recognizeSudoku, suggestGridCrop } from "../lib/ocr";
import type { GridCrop, ScanProgress } from "../lib/ocr";
import "../import.css";

interface ImportModalProps {
  initialFile: File | null;
  initialMode: "upload" | "camera";
  onClose: () => void;
  onImport: (board: number[]) => void;
}

type Stage = "upload" | "crop" | "reading" | "review";
interface Photo {
  image: HTMLImageElement;
  url: string;
  name: string;
}

const emptyBoard = () => Array<number>(81).fill(0);
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function ImportModal({
  initialFile,
  initialMode,
  onClose,
  onImport,
}: ImportModalProps) {
  const [stage, setStage] = useState<Stage>("upload");
  const [mode, setMode] = useState(initialMode);
  const [file, setFile] = useState<File | null>(initialFile);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [crop, setCrop] = useState<GridCrop>({
    x: 0.05,
    y: 0.05,
    width: 0.9,
    height: 0.9,
  });
  const [cropPreview, setCropPreview] = useState("");
  const [board, setBoard] = useState<number[]>(emptyBoard);
  const [uncertain, setUncertain] = useState<number[]>([]);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [progress, setProgress] = useState<ScanProgress>({
    progress: 0,
    message: "Preparing your photo…",
  });
  const [validating, setValidating] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const cellsRef = useRef<(HTMLInputElement | null)[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const closeRef = useRef(onClose);
  const mountedRef = useRef(true);
  const validationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cropDrag = useRef<{
    x: number;
    y: number;
    crop: GridCrop;
    resize: boolean;
  } | null>(null);
  closeRef.current = onClose;
  const conflicts = useMemo(() => new Set(getConflicts(board)), [board]);
  const clueCount = board.filter(Boolean).length;
  const step =
    stage === "upload" ? 1 : stage === "crop" || stage === "reading" ? 2 : 3;

  useEffect(() => {
    mountedRef.current = true;
    const priorFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modalRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
      if (event.key !== "Tab") return;
      const items = Array.from(
        modalRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select, [tabindex="0"]',
        ) ?? [],
      ).filter((item) => item.getClientRects().length > 0);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !modalRef.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      mountedRef.current = false;
      document.body.style.overflow = priorOverflow;
      document.removeEventListener("keydown", keydown);
      abortRef.current?.abort();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (validationTimer.current) clearTimeout(validationTimer.current);
      priorFocus?.focus();
    };
  }, []);

  useEffect(() => {
    if (!file) return;
    setError("");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError(
        "Choose a JPG, PNG or WebP image. Other formats, including HEIC and SVG, are not supported.",
      );
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError(
        "This photo is larger than 20 MB. Choose a smaller image and try again.",
      );
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    let active = true;
    image.onload = () => {
      if (!active) return;
      if (image.naturalWidth < 180 || image.naturalHeight < 180) {
        setError(
          "This image is too small to read clearly. Choose a photo at least 180 × 180 pixels.",
        );
        return;
      }
      if (image.naturalWidth * image.naturalHeight > 50_000_000) {
        setError(
          "This image is very large. Resize it to under 50 megapixels and try again.",
        );
        return;
      }
      setPhoto({ image, url, name: file.name });
      setCrop(suggestGridCrop(image));
      setStage("crop");
      setMode("upload");
      setNotice("");
    };
    image.onerror = () => {
      if (active)
        setError("We could not open this image. Try another JPG, PNG or WebP.");
    };
    image.src = url;
    return () => {
      active = false;
      image.onload = null;
      image.onerror = null;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  useEffect(() => {
    if (mode !== "camera" || stage !== "upload") return;
    let active = true;
    let localStream: MediaStream | null = null;
    setCameraReady(false);
    setError("");
    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            "The camera is unavailable here. Use “Choose or take a photo” below, or open this page over HTTPS.",
          );
        }
        localStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1920 },
          },
          audio: false,
        });
        if (!active) {
          localStream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = localStream;
        if (videoRef.current) {
          videoRef.current.srcObject = localStream;
          await videoRef.current.play();
          if (active) setCameraReady(true);
        }
      } catch (reason) {
        localStream?.getTracks().forEach((track) => track.stop());
        if (!active) return;
        if (
          reason instanceof DOMException &&
          reason.name === "NotAllowedError"
        ) {
          setError(
            "Camera access was not allowed. You can still choose a photo from your device.",
          );
        } else if (
          reason instanceof DOMException &&
          reason.name === "NotFoundError"
        ) {
          setError(
            "No camera was found. Choose a photo from your device instead.",
          );
        } else {
          setError(
            reason instanceof Error
              ? reason.message
              : "The camera could not start. Choose a photo instead.",
          );
        }
      }
    };
    void start();
    return () => {
      active = false;
      localStream?.getTracks().forEach((track) => track.stop());
      if (streamRef.current === localStream) streamRef.current = null;
    };
  }, [mode, stage]);

  useEffect(() => {
    if (stage === "review") {
      cellsRef.current[0]?.focus();
    }
  }, [stage]);

  function chooseFile(next: File | undefined) {
    if (!next) return;
    setPhoto(null);
    setStage("upload");
    setMode("upload");
    setFile(next);
    setNotice("");
    setError("");
  }

  function fileChanged(event: ChangeEvent<HTMLInputElement>) {
    chooseFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function capture() {
    const video = videoRef.current;
    if (!video?.videoWidth || !cameraReady) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setError("Could not capture this photo. Please choose an image instead.");
      return;
    }
    context.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob && mountedRef.current)
          chooseFile(
            new File([blob], "Camera puzzle.jpg", { type: "image/jpeg" }),
          );
      },
      "image/jpeg",
      0.95,
    );
  }

  function updateCrop(key: keyof GridCrop, value: number) {
    setCrop((current) => {
      const next = { ...current, [key]: value };
      next.width = clamp(next.width, 0.12, 1);
      next.height = clamp(next.height, 0.12, 1);
      next.x = clamp(next.x, 0, 1 - next.width);
      next.y = clamp(next.y, 0, 1 - next.height);
      return next;
    });
  }

  function startCropDrag(
    event: ReactPointerEvent<HTMLDivElement>,
    resize = false,
  ) {
    if (stage !== "crop") return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    cropDrag.current = {
      x: event.clientX,
      y: event.clientY,
      crop: { ...crop },
      resize,
    };
  }

  function moveCrop(event: ReactPointerEvent<HTMLDivElement>) {
    const start = cropDrag.current;
    const bounds = previewRef.current?.getBoundingClientRect();
    if (!start || !bounds) return;
    const dx = (event.clientX - start.x) / bounds.width;
    const dy = (event.clientY - start.y) / bounds.height;
    if (start.resize) {
      setCrop({
        ...start.crop,
        width: clamp(start.crop.width + dx, 0.12, 1 - start.crop.x),
        height: clamp(start.crop.height + dy, 0.12, 1 - start.crop.y),
      });
    } else {
      setCrop({
        ...start.crop,
        x: clamp(start.crop.x + dx, 0, 1 - start.crop.width),
        y: clamp(start.crop.y + dy, 0, 1 - start.crop.height),
      });
    }
  }

  function enterManually() {
    setError("");
    setBoard(emptyBoard());
    setUncertain([]);
    setSelected(0);
    setCropPreview(photo ? croppedImage(photo.image, crop).toDataURL() : "");
    setNotice(
      "Enter the large numbers from your puzzle. Leave empty cells and pencil notes blank.",
    );
    setStage("review");
  }

  async function scan() {
    if (!photo) return;
    setError("");
    setNotice("");
    setStage("reading");
    setProgress({ progress: 0, message: "Preparing your photo…" });
    setCropPreview(croppedImage(photo.image, crop).toDataURL());
    const controller = new AbortController();
    abortRef.current = controller;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 120_000);
    try {
      const result = await recognizeSudoku(
        photo.image,
        crop,
        (next) => {
          if (mountedRef.current && !controller.signal.aborted)
            setProgress(next);
        },
        controller.signal,
      );
      if (!mountedRef.current || controller.signal.aborted) return;
      setBoard(result.board);
      setUncertain(result.uncertain);
      const found = result.board.filter(Boolean).length;
      setNotice(
        found === 0
          ? "No numbers were recognized. Try a closer, sharper crop, or enter the numbers below."
          : `${found} numbers found. Compare every number with the photo; correct any mistakes before playing.`,
      );
      setStage("review");
    } catch (reason) {
      if (!mountedRef.current) return;
      setStage("crop");
      if (timedOut) {
        setError(
          "The reader took too long to load. Check your connection and try again, or enter the numbers yourself.",
        );
      } else if (!controller.signal.aborted) {
        setError(
          "The number reader could not finish. Check your connection for the first download, retry, or enter the numbers yourself.",
        );
        console.warn(
          "Puzzle recognition failed:",
          reason instanceof Error ? reason.message : String(reason),
        );
      }
    } finally {
      clearTimeout(timeout);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function changeCell(index: number, value: number) {
    setBoard((current) =>
      current.map((number, i) => (i === index ? value : number)),
    );
    setUncertain((current) => current.filter((cell) => cell !== index));
    setError("");
  }

  function reviewKey(
    event: ReactKeyboardEvent<HTMLInputElement>,
    index: number,
  ) {
    let destination = index;
    if (event.key === "ArrowLeft") destination = Math.max(0, index - 1);
    else if (event.key === "ArrowRight") destination = Math.min(80, index + 1);
    else if (event.key === "ArrowUp") destination = Math.max(0, index - 9);
    else if (event.key === "ArrowDown") destination = Math.min(80, index + 9);
    else if (
      event.key === "Backspace" ||
      event.key === "Delete" ||
      event.key === "0"
    ) {
      event.preventDefault();
      changeCell(index, 0);
      return;
    } else if (/^[1-9]$/.test(event.key)) {
      event.preventDefault();
      changeCell(index, Number(event.key));
      return;
    } else return;
    event.preventDefault();
    setSelected(destination);
    cellsRef.current[destination]?.focus();
  }

  function usePuzzle() {
    setError("");
    if (clueCount < 17) {
      setError(
        `Add at least ${17 - clueCount} more ${17 - clueCount === 1 ? "number" : "numbers"}. A standard Sudoku needs at least 17 clues for a unique solution.`,
      );
      return;
    }
    if (clueCount === 81) {
      setError(
        "This puzzle is already filled in. Clear the cells you would like to solve.",
      );
      return;
    }
    if (conflicts.size) {
      setError(
        "Some numbers repeat in a row, column or box. Correct the red cells before playing.",
      );
      return;
    }
    setValidating(true);
    // Yield a paint before validating so slower devices can display the status.
    validationTimer.current = setTimeout(() => {
      const result = validatePuzzle(board);
      if (!mountedRef.current) return;
      setValidating(false);
      if (!result.valid) {
        setError(result.message);
        return;
      }
      onImport([...board]);
    }, 30);
  }

  return (
    <div
      className="import-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="import-dialog"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        aria-describedby="import-description"
      >
        <div className="import-heading">
          <div className="import-heading-icon">
            <ScanLine size={23} strokeWidth={1.7} />
          </div>
          <div>
            <div className="import-eyebrow">FROM PAPER TO PLAY</div>
            <h2 id="import-title">Bring your puzzle along.</h2>
          </div>
          <button
            className="import-close"
            aria-label="Close import"
            onClick={onClose}
          >
            <X size={22} />
          </button>
        </div>
        <p id="import-description" className="import-intro">
          A puzzle from the newspaper, your favorite book, or anywhere
          inspiration finds you.
        </p>
        <ol className="import-steps" aria-label="Import progress">
          {["Add a photo", "Frame the grid", "Review & play"].map(
            (label, index) => (
              <li
                key={label}
                className={
                  step === index + 1
                    ? "active"
                    : step > index + 1
                      ? "complete"
                      : ""
                }
                aria-current={step === index + 1 ? "step" : undefined}
              >
                <span>
                  {step > index + 1 ? <Check size={13} /> : index + 1}
                </span>
                {label}
              </li>
            ),
          )}
        </ol>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={fileChanged}
          hidden
          aria-label="Choose a puzzle image"
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          onChange={fileChanged}
          hidden
          aria-label="Take a puzzle photo"
        />

        <div className="import-content">
          {stage === "upload" && (
            <>
              <div
                className="import-source-tabs"
                role="group"
                aria-label="Image source"
              >
                <button
                  className={mode === "upload" ? "active" : ""}
                  onClick={() => {
                    setMode("upload");
                    setError("");
                  }}
                >
                  <Upload size={16} /> Upload a photo
                </button>
                <button
                  className={mode === "camera" ? "active" : ""}
                  onClick={() => setMode("camera")}
                >
                  <Camera size={17} /> Use your camera
                </button>
              </div>
              {mode === "upload" ? (
                <div
                  className={`import-dropzone ${dragging ? "is-dragging" : ""}`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={(event) => {
                    if (
                      !event.currentTarget.contains(event.relatedTarget as Node)
                    )
                      setDragging(false);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    chooseFile(event.dataTransfer.files[0]);
                  }}
                >
                  <div className="import-upload-art">
                    <ImagePlus size={39} strokeWidth={1.3} />
                    <span>
                      <Upload size={15} />
                    </span>
                  </div>
                  <h3>Every puzzle deserves a fresh start.</h3>
                  <p>
                    Drag your puzzle photo here, or choose one from your device.
                  </p>
                  <button
                    className="import-primary"
                    onClick={() => inputRef.current?.click()}
                  >
                    <Upload size={17} /> Choose a photo
                  </button>
                  <small>JPG, PNG or WebP · up to 20 MB</small>
                </div>
              ) : (
                <div className="import-camera-panel">
                  <div className="import-camera-preview">
                    <video
                      ref={videoRef}
                      playsInline
                      muted
                      aria-label="Live camera preview"
                    />
                    {!cameraReady && (
                      <div className="import-camera-pending">
                        <Camera size={30} />
                        <span>
                          {error
                            ? "Choose a photo below to continue"
                            : "Starting your camera…"}
                        </span>
                      </div>
                    )}
                    {cameraReady && (
                      <div className="import-camera-frame">
                        <span>Keep the whole grid inside the frame</span>
                      </div>
                    )}
                  </div>
                  <div className="import-camera-actions">
                    <button
                      className="import-primary"
                      onClick={capture}
                      disabled={!cameraReady}
                    >
                      <Camera size={17} /> Capture puzzle
                    </button>
                    <button
                      className="import-text-button"
                      onClick={() => cameraInputRef.current?.click()}
                    >
                      Choose or take a photo
                    </button>
                  </div>
                </div>
              )}
              <div className="import-tip">
                <ScanLine size={19} />
                <p>
                  <strong>A little framing goes a long way.</strong> Take a
                  sharp, straight-on photo with all nine rows visible. Printed
                  digits work best; handwriting and pencil notes may need
                  corrections.
                </p>
              </div>
            </>
          )}

          {(stage === "crop" || stage === "reading") && photo && (
            <div className="import-crop-layout">
              <div className="import-image-wrap">
                <div className="import-photo-preview" ref={previewRef}>
                  <img
                    src={photo.url}
                    alt="Your uploaded Sudoku puzzle"
                    draggable={false}
                  />
                  <div
                    className={`import-crop-box ${stage === "reading" ? "scanning" : ""}`}
                    style={{
                      left: `${crop.x * 100}%`,
                      top: `${crop.y * 100}%`,
                      width: `${crop.width * 100}%`,
                      height: `${crop.height * 100}%`,
                    }}
                    onPointerDown={(event) => startCropDrag(event)}
                    onPointerMove={moveCrop}
                    onPointerUp={() => {
                      cropDrag.current = null;
                    }}
                    onPointerCancel={() => {
                      cropDrag.current = null;
                    }}
                  >
                    <div className="import-crop-grid">
                      {Array.from({ length: 9 }, (_, i) => (
                        <span key={i} />
                      ))}
                    </div>
                    {stage === "reading" ? (
                      <div className="import-scan-beam" />
                    ) : (
                      <div
                        className="import-crop-handle"
                        onPointerDown={(event) => startCropDrag(event, true)}
                        aria-hidden="true"
                      />
                    )}
                  </div>
                </div>
                <span className="import-file-name">{photo.name}</span>
              </div>
              <div className="import-crop-guide">
                {stage === "reading" ? (
                  <>
                    <div className="import-guide-icon">
                      <LoaderCircle className="import-spinning" size={25} />
                    </div>
                    <h3>A little image magic.</h3>
                    <p>
                      We’re reading your puzzle, one cell at a time. You’ll get
                      to check every number next.
                    </p>
                    <div
                      className="import-progress"
                      role="progressbar"
                      aria-label="Reading puzzle"
                      aria-valuenow={Math.round(progress.progress * 100)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <span style={{ width: `${progress.progress * 100}%` }} />
                    </div>
                    <p className="import-progress-text" role="status">
                      {progress.message}
                    </p>
                    <button
                      className="import-secondary"
                      onClick={() => {
                        abortRef.current?.abort();
                        setStage("crop");
                      }}
                    >
                      Cancel scan
                    </button>
                  </>
                ) : (
                  <>
                    <div className="import-guide-icon">
                      <Crop size={25} strokeWidth={1.6} />
                    </div>
                    <h3>Just the nine-by-nine.</h3>
                    <p>
                      Align the green frame with the{" "}
                      <strong>outside edges of the puzzle grid</strong>. Leave
                      titles and margins outside.
                    </p>
                    <p className="import-small">
                      Drag the frame to move it. Drag its bottom-right corner to
                      resize, or use the controls below.
                    </p>
                    <details className="import-crop-controls" open>
                      <summary>
                        Fine-tune the frame <ChevronDown size={15} />
                      </summary>
                      {(
                        [
                          ["x", "Horizontal position", 0, 1 - crop.width],
                          ["y", "Vertical position", 0, 1 - crop.height],
                          ["width", "Width", 0.12, 1 - crop.x],
                          ["height", "Height", 0.12, 1 - crop.y],
                        ] as [keyof GridCrop, string, number, number][]
                      ).map(([key, label, min, max]) => (
                        <label key={key}>
                          {label}
                          <input
                            type="range"
                            min={min}
                            max={Math.max(min, max)}
                            step="0.001"
                            value={crop[key]}
                            onChange={(event) =>
                              updateCrop(key, Number(event.target.value))
                            }
                          />
                        </label>
                      ))}
                    </details>
                    <button
                      className="import-text-button"
                      onClick={() => setCrop(suggestGridCrop(photo.image))}
                    >
                      <RotateCcw size={14} /> Reset frame
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {stage === "review" && (
            <>
              <div className="import-review-heading">
                <h3>A quick double-check.</h3>
                <p>{notice}</p>
              </div>
              <div
                className={`import-review-layout ${cropPreview ? "" : "manual"}`}
              >
                {cropPreview && (
                  <div className="import-review-photo">
                    <span className="import-section-label">YOUR PHOTO</span>
                    <img
                      src={cropPreview}
                      alt="Cropped original puzzle for comparison"
                    />
                  </div>
                )}
                <div className="import-review-board-wrap">
                  <div className="import-section-label">
                    YOUR PUZZLE <span>{clueCount} numbers</span>
                  </div>
                  <div
                    className="import-review-board"
                    role="group"
                    aria-label="Review recognized puzzle numbers"
                  >
                    {board.map((value, index) => (
                      <input
                        key={index}
                        ref={(element) => {
                          cellsRef.current[index] = element;
                        }}
                        type="text"
                        inputMode="numeric"
                        pattern="[1-9]"
                        maxLength={1}
                        value={value || ""}
                        aria-label={`Row ${Math.floor(index / 9) + 1}, column ${(index % 9) + 1}${conflicts.has(index) ? ", conflicting number" : uncertain.includes(index) ? ", please check this number" : ""}`}
                        aria-invalid={conflicts.has(index) || undefined}
                        className={`${conflicts.has(index) ? "conflict " : ""}${uncertain.includes(index) ? "uncertain " : ""}${selected === index ? "selected " : ""}${index % 9 === 2 || index % 9 === 5 ? "box-right " : ""}${Math.floor(index / 9) === 2 || Math.floor(index / 9) === 5 ? "box-bottom" : ""}`}
                        onFocus={(event) => {
                          setSelected(index);
                          event.currentTarget.select();
                        }}
                        onKeyDown={(event) => reviewKey(event, index)}
                        onChange={(event) => {
                          const digit = event.target.value
                            .replace(/[^1-9]/g, "")
                            .slice(-1);
                          changeCell(index, digit ? Number(digit) : 0);
                        }}
                      />
                    ))}
                  </div>
                  <p className="import-edit-help">
                    Click a cell to edit. Use 1–9 for numbers and Delete to
                    clear.
                  </p>
                  {uncertain.length > 0 && (
                    <p className="import-uncertain-note">
                      <span /> Amber cells need a closer look.
                    </p>
                  )}
                </div>
              </div>
              <div className="import-review-note">
                <CheckCircle2 size={18} />
                <p>
                  Keep the large numbers, leave pencil marks out. We’ll check
                  for one solution. Starting this puzzle replaces your current
                  game.
                </p>
              </div>
            </>
          )}

          {error && (
            <div className="import-error" role="alert">
              {error}
            </div>
          )}
        </div>

        <div className="import-footer">
          <div className="import-privacy">
            <LockKeyhole size={14} />
            <span>Your photo stays on your device.</span>
          </div>
          <div className="import-footer-actions">
            {stage === "upload" && (
              <button className="import-text-button" onClick={enterManually}>
                Enter numbers manually <ArrowRight size={15} />
              </button>
            )}
            {stage === "crop" && (
              <>
                <button
                  className="import-secondary"
                  onClick={() => {
                    setStage("upload");
                    setError("");
                    setFile(null);
                    setPhoto(null);
                  }}
                >
                  <ArrowLeft size={15} /> New photo
                </button>
                <button
                  className="import-text-button import-manual-option"
                  onClick={enterManually}
                >
                  Enter manually
                </button>
                <button className="import-primary" onClick={() => void scan()}>
                  <ScanLine size={17} /> Read puzzle
                </button>
              </>
            )}
            {stage === "review" && (
              <>
                <button
                  className="import-secondary"
                  disabled={validating}
                  onClick={() => {
                    setStage(photo ? "crop" : "upload");
                    setError("");
                  }}
                >
                  <ArrowLeft size={15} /> {photo ? "Adjust photo" : "Back"}
                </button>
                <button
                  className="import-primary"
                  onClick={usePuzzle}
                  disabled={validating}
                >
                  {validating ? (
                    <LoaderCircle className="import-spinning" size={17} />
                  ) : (
                    <Check size={17} />
                  )}
                  {validating ? "Checking puzzle…" : "Use this puzzle"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
