# OpenCV.js runs in a Web Worker

Document-edge detection, perspective correction, and enhancement all use OpenCV.js, and we run it inside a dedicated Web Worker — never on the main thread. The main thread captures the frame and posts the image data (as a transferable `ImageData`/`ArrayBuffer`) to the worker; the worker runs grayscale → blur → Canny → findContours → warpPerspective (and the enhancement passes) and posts back the detected quad and the corrected image.

**Why:** a single detection+correction pass on a camera frame takes on the order of 1–3s on weaker phones. Doing that on the main thread freezes the capture and adjust UI for the whole duration. Keeping the UI responsive during processing is non-negotiable for a scanner, so the work goes off-thread.

**Trade-off accepted:** extra complexity — message passing, transferring image buffers (no easy shared state), and loading the ~8–10MB OpenCV.js inside the worker via `importScripts`. Worth it for responsiveness.
