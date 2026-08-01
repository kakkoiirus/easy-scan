# Fully client-side, no backend

Easy-scan is a personal, free, shareable document-scanner PWA. We decided it will be **100% client-side**: no server, no accounts, no database we control. All processing — camera capture, document-edge detection, perspective correction, enhancement, and PDF generation — runs in the browser. Scans are stored locally on the device (IndexedDB). Output leaves the device only when the user explicitly shares or downloads it.

**Why:** zero infrastructure cost, full privacy (documents never touch a server we own), and the simplest path to a shareable URL that friends can install as a PWA.

**Trade-off accepted:** no cross-device sync and no cloud backup — a scan captured on the phone is not available on the laptop unless the user manually moves the exported file. Storage is bounded by the device. This is acceptable for a personal tool; if sync ever becomes a requirement it will be a deliberate, separate decision.
