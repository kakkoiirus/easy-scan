import type { Page } from '../types'

/**
 * The OPFS file that best represents a Page for a thumbnail/preview: the
 * enhanced result once it has materialised, else the flattened image, else the
 * source photo. Mirrors the "enhanced, else flat, else source" fallback the page
 * strip shows for each page — keep it the single source of that rule.
 */
export function bestImageFile(page: Page): string {
  return page.enhanced?.file ?? page.flat?.file ?? page.file
}
