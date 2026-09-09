import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import { getPageGeometry, paginateUnits } from './layout'
import { measureBreakTop, measureUnits } from './measure'

export const paginationKey = new PluginKey('umo-pagination')

function createDecorations(doc, layout) {
  const decorations = layout.scales.map(({ nodePos, nodeSize, scale }) =>
    Decoration.node(nodePos, nodePos + nodeSize, {
      class: 'umo-pagination-scaled',
      style: `zoom: ${scale};`,
    }),
  )
  for (const item of layout.breaks) {
    if (item.manual) {
      decorations.push(
        Decoration.node(item.pos, item.pos + item.nodeSize, {
          style: `--umo-pagination-break-height: ${item.height}px;`,
        }),
      )
      continue
    }
    decorations.push(
      Decoration.widget(
        item.pos,
        (view) => {
          const document = view.dom.ownerDocument
          const widget = document.createElement(
            item.kind === 'row' ? 'tr' : item.kind === 'list' ? 'li' : 'span',
          )
          widget.className = `umo-pagination-spacer umo-pagination-spacer-${item.kind}`
          widget.setAttribute('aria-hidden', 'true')
          widget.setAttribute('data-line-number', 'false')
          widget.setAttribute('contenteditable', 'false')
          widget.style.setProperty(
            '--umo-pagination-spacer-height',
            `${item.height}px`,
          )
          if (item.kind === 'row') {
            const cell = document.createElement('td')
            cell.colSpan = Math.max(1, item.columns || 1)
            widget.append(cell)
          }
          return widget
        },
        {
          side: -1,
          key: `page-${item.pageIndex}-${item.pos}-${item.height.toFixed(3)}`,
          ignoreSelection: true,
          stopEvent: () => true,
        },
      ),
    )
  }
  return DecorationSet.create(doc, decorations)
}

export default Extension.create({
  name: 'pagination',

  addOptions() {
    return { getPageOptions: () => ({}), onLayout: () => {} }
  },

  addStorage() {
    return { pageCount: 1, currentPage: 1, layout: null, refresh: () => {} }
  },

  addCommands() {
    return {
      repaginate: () => () => {
        this.storage.refresh()
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    const extension = this
    return [
      new Plugin({
        key: paginationKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, decorations) =>
            tr.getMeta(paginationKey) ?? decorations.map(tr.mapping, tr.doc),
        },
        props: {
          decorations: (state) => paginationKey.getState(state),
        },
        view(view) {
          let frame = 0
          let destroyed = false
          let composing = false
          let signature = ''
          let scrollToSelection = false
          const { dom } = view
          const document = dom.ownerDocument
          const win = document.defaultView

          const publish = (layout = extension.storage.layout) => {
            const pages = layout?.pages || [
              { from: 0, to: view.state.doc.content.size },
            ]
            let currentPage = 1
            pages.forEach((page, index) => {
              if (page.from <= view.state.selection.head)
                currentPage = index + 1
            })
            extension.storage.pageCount = pages.length
            extension.storage.currentPage = currentPage
            extension.storage.layout = layout
            extension.options.onLayout({ pageCount: pages.length, currentPage })
          }

          const apply = (layout) => {
            const tr = view.state.tr
              .setMeta(
                paginationKey,
                layout
                  ? createDecorations(view.state.doc, layout)
                  : DecorationSet.empty,
              )
              .setMeta('addToHistory', false)
            view.dispatch(tr)
          }

          const reflow = () => {
            frame = 0
            if (destroyed || composing || view.composing || !dom.isConnected)
              return
            const page = extension.options.getPageOptions()
            const enabled = page.layout === 'page'
            dom.classList.toggle('umo-pagination', enabled)
            if (!enabled) {
              if (paginationKey.getState(view.state).find().length) apply(null)
              signature = ''
              publish(null)
              return
            }
            if (!dom.offsetWidth || !dom.getClientRects().length) return
            const geometry = getPageGeometry(page)
            let units
            // Measure natural flow with the existing widgets hidden, then restore
            // it in the same frame. No DOM or selection replacement is needed.
            dom.classList.add('umo-pagination-measuring')
            try {
              units = measureUnits(view, geometry)
            } finally {
              dom.classList.remove('umo-pagination-measuring')
            }
            const layout = paginateUnits(
              units,
              geometry,
              view.state.doc.content.size,
            )
            const nextSignature = JSON.stringify([
              geometry,
              layout.breaks,
              layout.scales,
            ])
            const changed = signature !== nextSignature
            if (changed) {
              signature = nextSignature
              apply(layout)
              // Inline line boxes and collapsed block margins may contribute a
              // small extra offset. Align the first line on each new page exactly.
              let correction = 0
              let corrected = false
              for (const item of layout.breaks) {
                if (item.manual && !item.next) continue
                const top = measureBreakTop(
                  view,
                  item.manual ? item.next : item,
                )
                if (top === null) continue
                const delta = item.target - top - correction
                if (Math.abs(delta) > 0.25) {
                  const nextHeight = Math.max(0, item.height + delta)
                  correction += nextHeight - item.height
                  item.height = nextHeight
                  corrected = true
                }
              }
              if (corrected) apply(layout)
              if (scrollToSelection && view.hasFocus()) {
                view.dispatch(
                  view.state.tr.setMeta('addToHistory', false).scrollIntoView(),
                )
              }
            }
            scrollToSelection = false
            publish(changed ? layout : extension.storage.layout || layout)
          }

          const schedule = () => {
            if (!destroyed && !frame) frame = win.requestAnimationFrame(reflow)
          }
          const compositionStart = () => {
            composing = true
          }
          const compositionEnd = () => {
            composing = false
            schedule()
          }
          const observer = new win.ResizeObserver(schedule)
          observer.observe(dom)
          dom.addEventListener('load', schedule, true)
          dom.addEventListener('compositionstart', compositionStart)
          dom.addEventListener('compositionend', compositionEnd)
          document.fonts?.addEventListener('loadingdone', schedule)
          document.fonts?.ready.then(schedule)
          extension.storage.refresh = schedule
          schedule()

          return {
            update(updatedView, previousState) {
              if (previousState.doc !== updatedView.state.doc) {
                scrollToSelection = true
                signature = ''
                schedule()
              } else if (
                !previousState.selection.eq(updatedView.state.selection)
              ) {
                publish()
              }
            },
            destroy() {
              destroyed = true
              win.cancelAnimationFrame(frame)
              observer.disconnect()
              dom.removeEventListener('load', schedule, true)
              dom.removeEventListener('compositionstart', compositionStart)
              dom.removeEventListener('compositionend', compositionEnd)
              document.fonts?.removeEventListener('loadingdone', schedule)
              dom.classList.remove('umo-pagination', 'umo-pagination-measuring')
              extension.storage.refresh = () => {}
            },
          }
        },
      }),
    ]
  },
})
