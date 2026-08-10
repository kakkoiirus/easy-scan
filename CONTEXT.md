# Easy-scan

A client-side PWA that turns phone-camera photos into clean, flat document scans. A capture session produces a multi-page **Document**; each **Page** is a single sheet that has been detected, straightened, and enhanced in the browser, then stored locally and exported.

## Language

**Document**:
An ordered collection of Pages the user captures in one session — the unit a person thinks of as "the scan" (e.g. a contract, a multi-page form, a set of receipts). Exports as a single file.
_Avoid_: scan (as a noun), file, item

**Page**:
A single captured sheet within a Document. Each Page keeps its source photo and the detected boundary so it can be re-adjusted or re-exported, plus the enhanced result.
_Avoid_: image, sheet, picture, scan (as a noun)

**Quad**:
The four corners that mark a Page's boundary on its source photo — ordered top-left, top-right, bottom-right, bottom-left — in source-pixel coordinates. Used to crop and perspective-correct ("flatten") the page.
_Avoid_: polygon, outline, contour, bounding box

## Enhancement

The look applied to a Page after flattening — chosen per page, in the browser.

Each Page's flattened image is derived from its source photo and its **Quad**; its
enhanced image is derived from the flat and the chosen look below. Changing the
**Quad** invalidates both the flat and the enhanced; changing only the look
invalidates the enhanced — so the Page re-flattens and/or re-enhances on the next
view.

**Color**:
The page kept as a faithful colour photograph — only flattened, with a mild, global white-balance and contrast cleanup. Not vivid or "enhanced"; the default look.
_Avoid_: original, photo (as a mode name), vivid, enhanced

**Grayscale**:
The page desaturated to a clean, legible grey.
_Avoid_: mono, black and white, greyscale (variant spelling)

**Black & White**:
The page thresholded to crisp ink on paper — the "scanned document" look.
_Avoid_: binary, mono, threshold, B&W (ambiguous with Grayscale)
