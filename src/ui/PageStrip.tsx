import { UnstyledButton } from '@mantine/core'
import type { Page } from '../types'
import { bestImageFile } from './page-image'
import { useObjectUrl } from './useObjectUrl'

/**
 * The page strip — one thumbnail per Page, the way to pick which page the
 * Document view shows. Each thumbnail reflects its page's best available image
 * (enhanced, else flat, else source) and stays live as those materialise.
 */
interface PageStripProps {
  readonly pages: readonly Page[]
  readonly selectedPageId: string | undefined
  readonly onSelect: (pageId: string) => void
}

export function PageStrip({ pages, selectedPageId, onSelect }: PageStripProps) {
  return (
    <div className="page-strip" role="tablist" aria-label="Страницы документа">
      {pages.map((page, index) => (
        <Thumbnail
          key={page.id}
          page={page}
          index={index + 1}
          selected={page.id === selectedPageId}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

/**
 * One page's thumbnail. Loads its best-available OPFS image into an object URL
 * and revokes it when that image changes (enhanced materialises over flat over
 * source) or the strip unmounts — no leaks across page state changes.
 */
interface ThumbnailProps {
  readonly page: Page
  readonly index: number
  readonly selected: boolean
  readonly onSelect: (pageId: string) => void
}

function Thumbnail({ page, index, selected, onSelect }: ThumbnailProps) {
  const file = bestImageFile(page)
  const url = useObjectUrl(file)
  const label = `Страница ${index}`

  return (
    <UnstyledButton
      type="button"
      role="tab"
      aria-selected={selected}
      aria-label={label}
      className={`page-strip__thumb${selected ? ' page-strip__thumb--selected' : ''}`}
      onClick={() => onSelect(page.id)}
    >
      {url ? (
        <img className="page-strip__img" src={url} alt="" />
      ) : (
        <div className="page-strip__placeholder" />
      )}
      <span className="page-strip__num">{index}</span>
    </UnstyledButton>
  )
}
