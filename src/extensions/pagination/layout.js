export const PAGE_GAP = 24
export const CM_TO_PX = 96 / 2.54

const positive = (value, fallback) =>
  Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback

export function getPageGeometry(page = {}) {
  const width = positive(page.size?.width, 21) * CM_TO_PX
  const height = positive(page.size?.height, 29.7) * CM_TO_PX
  const landscape = page.orientation === 'landscape'
  const margin = Object.fromEntries(
    ['top', 'bottom', 'left', 'right'].map((side) => [
      side,
      Math.max(0, Number(page.margin?.[side]) || 0) * CM_TO_PX,
    ]),
  )
  const pageHeight = landscape ? width : height
  return {
    width: landscape ? height : width,
    height: pageHeight,
    margin,
    gap: PAGE_GAP,
    bodyHeight: Math.max(1, pageHeight - margin.top - margin.bottom),
    stride: pageHeight + PAGE_GAP,
  }
}

// Positions always refer to the original document. Pagination never adds nodes
// to the schema or content to undo history / collaboration updates.
export function paginateUnits(units, geometry, documentSize) {
  const { bodyHeight, stride } = geometry
  const breaks = []
  const scales = []
  const pages = [{ from: 0 }]
  let offset = 0
  let pageIndex = 0

  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index]
    if (unit.manual) {
      pageIndex += 1
      const nextTop = units[index + 1]?.top ?? unit.top
      const height = Math.max(0, pageIndex * stride - nextTop - offset)
      breaks.push({
        ...unit,
        height,
        pageIndex,
        target: pageIndex * stride,
        next: units[index + 1],
      })
      offset += height
      pages.push({ from: unit.pos + unit.nodeSize })
      continue
    }

    const originalHeight = unit.bottom - unit.top
    const heightLimit = Math.max(1, bodyHeight - (index === 0 ? unit.top : 0))
    const scale =
      unit.atomic && originalHeight > heightLimit
        ? heightLimit / originalHeight
        : 1
    const height = originalHeight * scale
    if (scale < 1) scales.push({ ...unit, scale })

    const top = unit.top + offset
    const bottom = top + height
    const pageStart = pageIndex * stride
    if (bottom > pageStart + bodyHeight + 0.5 && top > pageStart + 0.5) {
      pageIndex += 1
      const gapHeight = Math.max(0, pageIndex * stride - top)
      breaks.push({
        ...unit,
        height: gapHeight,
        pageIndex,
        target: pageIndex * stride,
      })
      offset += gapHeight
      pages.push({ from: unit.pos })
    }
    offset -= originalHeight - height
  }

  return {
    breaks,
    scales,
    pages: pages.map((page, index) => ({
      ...page,
      to: pages[index + 1]?.from ?? documentSize,
    })),
    geometry,
  }
}
