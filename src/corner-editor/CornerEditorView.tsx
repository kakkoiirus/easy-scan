import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useSyncExternalStore,
} from 'react'
import type { Point, Quad } from '../types'
import { createCornerEditor, type CornerEditorController } from './corner-editor'
import type { CornerImageSize } from './geometry'

/**
 * The page/boundary editor: the source photo with four draggable corners over
 * it, all in one SVG whose user space IS source-image pixels (so the overlay
 * aligns with the photo for free, no measuring). Pointer dragging is owned by
 * the imperative `corner-editor` controller — off React's render path — and the
 * live Quad is read here through `useSyncExternalStore`.
 *
 * `initialQuad` null renders the photo with no overlay (e.g. while detection is
 * still running). Once non-null the corners become editable.
 */

export interface CornerEditorHandle {
  /** The current (possibly adjusted) Quad, or null if none is loaded. */
  readonly getQuad: () => Quad | null
  /** Restore the last Quad passed in as `initialQuad` (discard edits). */
  readonly reset: () => void
}

interface CornerEditorViewProps {
  /** Source-photo pixel dimensions. */
  readonly image: CornerImageSize
  /** Object URL (or data URL) of the source photo to display. */
  readonly src: string
  /** Boundary to start from; null shows the photo with no overlay. */
  readonly initialQuad: Quad | null
  /** Extra class for the `<svg>` (e.g. layout positioning). */
  readonly className?: string
}

export const CornerEditorView = forwardRef<CornerEditorHandle, CornerEditorViewProps>(
  function CornerEditorView({ image, src, initialQuad, className }, ref) {
    const svgRef = useRef<SVGSVGElement>(null)
    // One controller per mount; created once and kept across renders.
    const editorRef = useRef<CornerEditorController | null>(null)
    if (editorRef.current === null) editorRef.current = createCornerEditor()
    const editor = editorRef.current

    const quad = useSyncExternalStore(editor.subscribe, editor.getQuad, editor.getQuad)

    // The boundary to restore on `reset` — the last non-null initialQuad.
    const originalRef = useRef<Quad | null>(null)

    // Bind pointer handling to the svg ONCE. The dep is just the stable
    // controller — NOT the image — so a drag (which re-renders every move)
    // never tears down the listeners and drops the active corner mid-drag.
    useEffect(() => {
      if (!svgRef.current) return
      return editor.attach(svgRef.current)
    }, [editor])

    // Image dimensions are config for clamp + hit-radius, not a reason to
    // re-bind. Primitive deps so a new parent object (common each render) can't
    // trigger a re-attach.
    useEffect(() => {
      editor.setImage(image)
    }, [editor, image.width, image.height])

    // Seed/replace the Quad when the source boundary changes (e.g. detection
    // completes, or a different page is loaded).
    useEffect(() => {
      editor.setQuad(initialQuad)
      if (initialQuad) originalRef.current = initialQuad
    }, [editor, initialQuad])

    useImperativeHandle(
      ref,
      () => ({
        getQuad: () => editor.getQuad(),
        reset: () => {
          if (originalRef.current) editor.setQuad(originalRef.current)
        },
      }),
      [editor],
    )

    const dotRadius = Math.max(image.width, image.height) * 0.012
    const points = quad?.map((p) => `${p.x},${p.y}`).join(' ')

    return (
      <svg
        ref={svgRef}
        className={className ? `corner-editor__svg ${className}` : 'corner-editor__svg'}
        viewBox={`0 0 ${image.width} ${image.height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <image href={src} x={0} y={0} width={image.width} height={image.height} />
        {quad && points && (
          <g>
            <polygon points={points} className="corner-editor__shape" />
            {quad.map((p: Point, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={dotRadius} className="corner-editor__dot" />
            ))}
          </g>
        )}
      </svg>
    )
  },
)
