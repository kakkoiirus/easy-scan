// Characters that must not appear in a filename: path separators plus the
// Windows-invalid set, and C0 control bytes.
const INVALID_CHARS = /[\\/:*?"<>|\x00-\x1f]/g
const WHITESPACE_RUN = /\s+/g

/** Cap the base name so very long titles can't overflow filesystem limits; the
 *  `.pdf` extension is added on top of this. */
const MAX_BASE_LENGTH = 120
const DEFAULT_NAME = 'document'

/**
 * Derive a safe PDF filename from a Document title: strip path separators and
 * invalid filename characters, collapse whitespace, fall back to a default when
 * nothing usable remains, cap the length, and append `.pdf`. Pure — no DOM, no
 * storage — so the same rule is easy to test and reuse.
 */
export function pdfFilename(title: string): string {
  const cleaned = title
    .replace(INVALID_CHARS, '')
    .replace(WHITESPACE_RUN, ' ')
    .trim()
  const base = cleaned.length > 0 ? cleaned.slice(0, MAX_BASE_LENGTH).trim() : DEFAULT_NAME
  return `${base}.pdf`
}
