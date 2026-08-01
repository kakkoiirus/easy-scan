# Camera capture (M1)

Status: ready-for-agent

## Problem Statement

The app is meant to be a document scanner, but today there is no camera — the Camera screen is a placeholder. I can't actually scan anything: I can't point my phone at a document, capture it, and get it into my library. The only way a Document appears right now is a synthetic "demo" button, not a real scan.

## Solution

From the library I open the camera; the app shows a live preview (preferring the back camera); I frame the document and tap a shutter to capture a full-resolution still; I review the shot and either retake or save it; saving creates a single-page Document in my library. Auto-cropping, perspective correction, and enhancement are intentionally not part of this — the saved Page is the raw captured photo with a placeholder boundary; real edge detection comes in the next milestone.

## User Stories

1. As a user, I want to open the camera from the library, so that I can start scanning.
2. As a user, I want a live video preview, so that I can frame the document.
3. As a user, I want the app to prefer the rear (back) camera, so that scanning on a phone feels natural.
4. As a user, I want the preview to fill the screen, so that framing is easy.
5. As a user, I want a shutter button to capture, so that I take the shot when the document is framed.
6. As a user, I want the captured frame to be high resolution, so that text stays legible.
7. As a user, I want to review the captured photo before saving, so that I can discard bad shots.
8. As a user, I want to retake the photo, so that a blurry or poorly framed shot isn't saved.
9. As a user, I want to save the captured photo as a Document, so that it lands in my library.
10. As a user, I want the saved Document to appear in my library immediately, so that I have confirmation it was saved.
11. As a user, I want to return to the library after saving, so that I can scan another or view the result.
12. As a user, I want to cancel and go back without saving, so that I'm never forced to keep a shot.
13. As a user, I want to be told when camera permission is denied, so that I understand why the preview is black.
14. As a user, I want a hint on how to re-enable camera permission, so that I can fix it myself.
15. As a user, I want to be told if no camera is available or it's in use, so that I'm not stuck on a blank screen.
16. As a user, I want a loading indicator while the camera starts, so that I know something is happening.
17. As a user, I want the camera to fully stop (light off, no battery drain) when I leave the screen, so that resources are released.
18. As a user, I want camera permission requested only when I open the camera screen, so that I'm not asked at app launch.
19. As a user, I want the captured photo to be right-side up, so that saved Documents aren't sideways or mirrored.
20. As a user, I want the saved Document to stay on my device and never be uploaded, so that my scans are private.
21. As a user, I want to scan and save multiple Documents in a row, so that I can batch-scan.
22. As a user (developing), I want the app to work with a desktop webcam, so that I can test without a phone.
23. As a developer, I want capture to run as an imperative service outside React's render cycle, so that the UI stays responsive.
24. As a developer, I want the camera lifecycle guarded against leaks, so that MediaStream tracks are always released even if I navigate away mid-permission.
25. As a developer, I want capture to prefer full-sensor resolution, so that later detection/OCR has the best input.
26. As a developer, I want a saved Page to keep its source photo and a boundary, so that later milestones can detect/crop without rescanning.

## Implementation Decisions

- **Modules built/modified:** a camera controller (imperative service in the services layer, outside React's render cycle); a status hook; the Camera screen (replacing the placeholder). Reuses the existing Storage port and the single-page save.
- **Camera controller interface** (type shape encodes the decision):
  - Status union: `idle | starting | streaming | denied | error`
  - Operations: `start(video)`, `stop()`, `capture() -> { bytes, width, height }`, `getStatus()`, `subscribe(cb)`
- **Capture strategy:** prefer `ImageCapture.takePhoto()` (full sensor resolution); fall back to canvas `drawImage` at the video's intrinsic size. Always return JPEG bytes plus the real decoded dimensions (via `createImageBitmap`), so the recorded width/height match what is displayed.
- **Orientation:** decode with `imageOrientation: 'from-image'` so the recorded dimensions and the displayed image are auto-oriented from EXIF (no sideways/mirrored saves).
- **Lifecycle safety (no leaks):** a generation token guards start/stop — if the user navigates away while `getUserMedia` is still resolving, the just-acquired stream is released immediately; `stop()` always stops all tracks, detaches the video element, and returns status to `idle`.
- **Permissions:** `getUserMedia` is called only when the Camera screen mounts (not at app load). `NotAllowedError` / `SecurityError` map to `denied`; everything else (no camera, in use, overconstrained) maps to `error`.
- **Camera constraints:** `facingMode: { ideal: 'environment' }` (ideal, not exact, so desktop webcams and phones without a back camera still work) plus a high `width` ideal for the fallback path.
- **Saving:** the captured frame's bytes are written to OPFS via the existing Storage port (`putPageImage`), and a single-page Document is created with one Page whose Quad is a placeholder (the four corners of the whole frame) and `enhanceMode = 'color'`. The reactive store notifies the library list. The existing demo save helper is generalized and reused for this real capture path.
- **Video element:** `autoPlay muted playsInline` (required for mobile autoplay).
- **UI (Mantine):** full-bleed `<video>`, a custom shutter button, a review overlay with Retake/Save, and status overlays for `starting` / `denied` / `error`. Back/Cancel buttons.
- **ADRs respected:** ADR-0001 (capture and storage are entirely client-side — nothing leaves the device), ADR-0003 (the saved Page lives in OPFS; metadata in `library.json`). ADR-0002 (the worker) is **not** used by this feature — detection/warp/enhance arrive in later milestones.

## Testing Decisions

- A good test exercises **external behavior, not implementation details** — assert what the feature does (a Document with the right shape is persisted and the store notifies), not how (no asserting internal controller variables or Mantine markup).
- **Single seam (the ideal): the document-creation/storage boundary.** Drive the single-page save against an in-memory fake of the Storage port and assert: one Document with one Page is persisted via `putDocument`; the Page's Quad is the placeholder full-frame corners; `enhanceMode` is `color`; the image bytes are written via `putPageImage`; the store notifies subscribers. This covers the decision-rich, behaviour-meaningful part with no camera and no browser APIs.
- The fake Storage implements the existing Storage port — **no new production seam is added**. The port already exists as the OPFS-vs-DB swap safeguard (ADR-0003), so testing against a fake reuses it rather than introducing test-only injection points.
- **Camera acquisition** (`getUserMedia`, `ImageCapture`, the `<video>`) is browser/hardware integration and is verified **manually** — localhost in dev is a secure context; HTTPS in production; a real device for phone behaviour. It is out of scope for automated tests.
- **Prior art:** none — this is the repo's first test, so it also establishes the in-memory Storage fake pattern for future storage-boundary tests.

## Out of Scope

- Edge detection / automatic Quad (M2).
- Manual corner adjustment and perspective correction / "flattening" (M3).
- Enhancement modes (color/grayscale/B&W) processing and UI (M4) — the saved Page is the raw photo.
- Multi-page capture sessions (M5) — this is one capture → one single-page Document.
- Live/continuous detection overlay and auto-capture.
- OCR (V2).
- Zoom, flash/torch, and focus controls.
- Front/back camera toggle (the back camera is hard-preferred).
- Post-save editing of Documents — rename, reorder (V2).
- PDF/image export (M7).

## Further Notes

- The placeholder Quad means saved Documents are not cropped yet — the whole photo is stored. M2 replaces the placeholder with a detected Quad; M3 lets the user adjust it. The Page already carries its source photo and Quad, so later steps don't require rescanning.
- Camera needs a secure context: localhost (dev) or HTTPS (production). For on-device testing, serve over HTTPS (e.g. `vite preview --https` or a tunnel).
- "Quad" is used here and in the codebase (types) as the four-corner page boundary, but is not yet in `CONTEXT.md`. It is a candidate to formalize via `/domain-modeling` alongside **Document** and **Page**.
