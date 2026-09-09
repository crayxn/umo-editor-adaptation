const CONTAINERS = new Set([
  'blockquote',
  'bulletList',
  'orderedList',
  'taskList',
  'listItem',
  'taskItem',
  'details',
  'detailsContent',
  'callout',
  'footnotes',
  'footnote',
])
const LISTS = new Set(['bulletList', 'orderedList', 'taskList'])

export function getMeasurementContext(view) {
  const rect = view.dom.getBoundingClientRect()
  const width = Number.parseFloat(
    view.dom.ownerDocument.defaultView.getComputedStyle(view.dom).width,
  )
  const scale = rect.width / width || 1
  return { origin: rect.top, scale }
}

function lineBox(view, pos, element, context) {
  const rect = view.coordsAtPos(pos, 1)
  const styles = element.ownerDocument.defaultView.getComputedStyle(element)
  const lineHeight =
    Number.parseFloat(styles.lineHeight) || rect.bottom - rect.top
  const leading =
    Math.max(0, lineHeight - (rect.bottom - rect.top) / context.scale) / 2
  return {
    top: (rect.top - context.origin) / context.scale - leading,
    bottom: (rect.bottom - context.origin) / context.scale + leading,
    rect,
  }
}

export function measureBreakTop(view, unit) {
  const context = getMeasurementContext(view)
  if (unit.textPos !== undefined) {
    const element = view.nodeDOM(unit.textBlockPos)
    if (element instanceof HTMLElement) {
      return lineBox(view, unit.textPos, element, context).top
    }
  }
  const element = view.nodeDOM(unit.nodePos ?? unit.pos)
  return element instanceof HTMLElement
    ? (element.getBoundingClientRect().top - context.origin) / context.scale
    : null
}

export function measureUnits(view, geometry) {
  const units = []
  const context = getMeasurementContext(view)
  const box = (element) => {
    const rect = element.getBoundingClientRect()
    return {
      top: (rect.top - context.origin) / context.scale,
      bottom: (rect.bottom - context.origin) / context.scale,
    }
  }

  const textLines = (node, pos, element, before) => {
    const start = pos + 1
    const end = start + node.content.size
    let cursor = start
    do {
      const line = lineBox(view, cursor, element, context)
      let low = cursor + 1
      let high = end
      // Find the first character on the following visual line. This avoids a
      // DOM measurement for every character in long paragraphs.
      while (low < high) {
        const middle = Math.floor((low + high) / 2)
        const rect = view.coordsAtPos(middle, 1)
        if (rect.top >= line.rect.bottom - 1) high = middle
        else low = middle + 1
      }
      let next = Math.min(low, end)
      if (next < end) {
        const character = view.state.doc.textBetween(next, next + 1)
        if (/^[\uDC00-\uDFFF]/.test(character)) next += 1
      }

      // Include tall inline images and mixed font sizes in the line's bounds.
      if (cursor < next) {
        const range = element.ownerDocument.createRange()
        const from = view.domAtPos(cursor, 1)
        const to = view.domAtPos(next, -1)
        range.setStart(from.node, from.offset)
        range.setEnd(to.node, to.offset)
        for (const rect of range.getClientRects()) {
          if (
            rect.height &&
            rect.top < line.rect.bottom &&
            rect.bottom > line.rect.top
          ) {
            line.top = Math.min(
              line.top,
              (rect.top - context.origin) / context.scale,
            )
            line.bottom = Math.max(
              line.bottom,
              (rect.bottom - context.origin) / context.scale,
            )
          }
        }
      }

      units.push({
        ...(cursor === start ? before : { pos: cursor, kind: 'inline' }),
        top: line.top,
        bottom: line.bottom,
        textPos: cursor,
        textBlockPos: pos,
      })
      if (next >= end) break
      cursor = next
    } while (cursor <= end)
  }

  const visit = (node, pos, before) => {
    const element = view.nodeDOM(pos)
    if (!(element instanceof HTMLElement) || !element.getClientRects().length)
      return
    const styles = element.ownerDocument.defaultView.getComputedStyle(element)
    if (styles.position === 'absolute' || styles.position === 'fixed') return
    const bounds = box(element)

    if (node.type.name === 'pageBreak') {
      units.push({
        ...before,
        ...bounds,
        pos,
        nodeSize: node.nodeSize,
        manual: true,
      })
    } else if (node.type.name === 'table') {
      const rows = []
      node.forEach((row, offset, index) => {
        const rowPos = pos + 1 + offset
        const rowDOM = view.nodeDOM(rowPos)
        if (!(rowDOM instanceof HTMLElement)) return
        let endRow = index + 1
        row.forEach((cell) => {
          endRow = Math.max(endRow, index + (cell.attrs.rowspan || 1))
        })
        rows.push({
          ...box(rowDOM),
          pos: rowPos,
          nodePos: rowPos,
          kind: 'row',
          columns: rowDOM.children.length,
          endRow,
        })
      })
      const groups = []
      for (let index = 0; index < rows.length; ) {
        const first = rows[index]
        let end = first.endRow
        for (let row = index + 1; row < Math.min(end, rows.length); row += 1) {
          end = Math.max(end, rows[row].endRow)
        }
        end = Math.min(end, rows.length)
        groups.push({ ...first, bottom: rows[end - 1].bottom })
        index = end
      }
      // A row-spanning group cannot be safely split. Fit that table as a unit.
      if (
        groups.some((group) => group.bottom - group.top > geometry.bodyHeight)
      ) {
        units.push({
          ...before,
          ...bounds,
          atomic: true,
          nodePos: pos,
          nodeSize: node.nodeSize,
        })
      } else {
        groups.forEach((group, index) =>
          units.push(index === 0 ? { ...group, ...before } : group),
        )
      }
    } else if (node.isTextblock && !node.isAtom && !node.type.spec.isolating) {
      textLines(node, pos, element, before)
    } else if (CONTAINERS.has(node.type.name) && !node.isAtom) {
      node.forEach((child, offset, index) => {
        const childPos = pos + 1 + offset
        visit(
          child,
          childPos,
          index === 0
            ? before
            : {
                pos: childPos,
                kind: LISTS.has(node.type.name) ? 'list' : 'block',
              },
        )
      })
    } else if (bounds.bottom > bounds.top) {
      units.push({
        ...before,
        ...bounds,
        atomic: true,
        nodePos: pos,
        nodeSize: node.nodeSize,
      })
    }
  }

  view.state.doc.forEach((node, pos) =>
    visit(node, pos, { pos, kind: 'block' }),
  )
  return units
}
