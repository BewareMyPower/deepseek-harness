/**
 * Viewport-fit hook for left-anchored overlays (popupSelect): the element's
 * left edge is laid out ahead of its width, so only its right edge can
 * collide with the viewport — clamp the design cap to the space between that
 * edge and the viewport's right edge. Symmetric to useAnchoredMaxHeight, which
 * does the same for the top edge of a bottom-anchored overlay.
 */
import { useLayoutEffect, useState } from 'react'
import type { RefObject } from 'react'

/** Safe distance kept between the overlay and the viewport right edge (mirrors the Menu portal margin). */
const MARGIN = 12

/**
 * Clamp a left-anchored overlay's max-width to the viewport.
 * @param ref - the overlay element; a null current (overlay closed) skips measuring.
 * @param cap - design max-width in px (the clamp never exceeds it).
 * @param signal - re-measure trigger: pass the overlay's render state so anchor
 *   moves or content growth re-fit; resize re-fits while mounted.
 * @returns the max-width to apply inline, in px.
 */
export function useAnchoredMaxWidth(ref: RefObject<HTMLElement>, cap: number, signal: unknown): number {
  const [maxWidth, setMaxWidth] = useState(cap)
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const fit = () => {
      setMaxWidth(Math.min(cap, Math.max(0, window.innerWidth - el.getBoundingClientRect().left - MARGIN)))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => {
      window.removeEventListener('resize', fit)
    }
  }, [ref, cap, signal])
  return maxWidth
}
