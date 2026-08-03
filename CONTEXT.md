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
