import { Extension, mergeAttributes, Node } from '@tiptap/core'

export const PAGE_NUMBER_FORMATS = [
  'decimal',
  'lowerRoman',
  'upperRoman',
  'lowerAlpha',
  'upperAlpha',
  'chinese',
]

const ROMAN = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
]
const CHINESE_DIGITS = '零一二三四五六七八九'
const CHINESE_UNITS = ['', '十', '百', '千']

function toRoman(value) {
  let rest = value
  let result = ''
  for (const [number, letters] of ROMAN) {
    while (rest >= number) {
      result += letters
      rest -= number
    }
  }
  return result
}

function toAlpha(value) {
  let rest = value
  let result = ''
  while (rest > 0) {
    rest -= 1
    result = String.fromCharCode(97 + (rest % 26)) + result
    rest = Math.floor(rest / 26)
  }
  return result
}

function toChinese(value) {
  if (value >= 10000) return String(value)
  const digits = String(value).split('').map(Number)
  let result = ''
  digits.forEach((digit, index) => {
    const unit = CHINESE_UNITS[digits.length - index - 1]
    if (digit === 0) {
      if (!result.endsWith('零') && index < digits.length - 1) result += '零'
      return
    }
    // 10–19 read as 十, 十一 … rather than 一十.
    if (!(digit === 1 && unit === '十' && digits.length === 2)) {
      result += CHINESE_DIGITS[digit]
    }
    result += unit
  })
  return result.replace(/零+$/, '') || '零'
}

export function formatPageNumber(value, format = 'decimal') {
  const number = Math.max(0, Math.floor(Number(value) || 0))
  if (number === 0) return '0'
  switch (format) {
    case 'lowerRoman':
      return toRoman(number).toLowerCase()
    case 'upperRoman':
      return toRoman(number)
    case 'lowerAlpha':
      return toAlpha(number)
    case 'upperAlpha':
      return toAlpha(number).toUpperCase()
    case 'chinese':
      return toChinese(number)
    default:
      return String(number)
  }
}

export const PAGE_FIELD_SELECTOR =
  'span[data-type="pageNumber"], span[data-type="pageCount"]'

// Fill page fields in a rendered (non-live) copy of header or footer content.
export function applyPageFields(root, { page, total }) {
  root.querySelectorAll(PAGE_FIELD_SELECTOR).forEach((element) => {
    const format = element.getAttribute('data-format') || 'decimal'
    const value = element.getAttribute('data-type') === 'pageCount' ? total : page
    element.textContent = formatPageNumber(value, format)
  })
  return root
}

// Shared page context for every field node view of one editor. Header and
// footer editors are moved between pages, so the number is not part of the doc.
export const PageFields = Extension.create({
  name: 'pageFields',

  addStorage() {
    return {
      page: 1,
      total: 1,
      elements: new Set(),
      update: () => {},
    }
  },

  onBeforeCreate() {
    this.storage.update = (page, total) => {
      this.storage.page = page
      this.storage.total = total
      this.storage.elements.forEach((render) => render())
    }
  },

  addCommands() {
    return {
      // Changes every page field inside the selection. Without a selection the
      // field next to the cursor is used, which is what a toolbar click needs.
      setPageFieldFormat:
        (format) =>
        ({ state, tr, dispatch }) => {
          if (!PAGE_NUMBER_FORMATS.includes(format)) return false
          const { from, to, empty } = state.selection
          const start = empty ? Math.max(0, from - 1) : from
          const end = empty ? Math.min(state.doc.content.size, to + 1) : to
          let changed = false
          state.doc.nodesBetween(start, end, (child, pos) => {
            if (
              child.type.name === 'pageNumber' ||
              child.type.name === 'pageCount'
            ) {
              if (dispatch)
                tr.setNodeMarkup(pos, undefined, { ...child.attrs, format })
              changed = true
            }
          })
          return changed
        },
    }
  },
})

const createFieldNode = (name, valueOf, insertCommand) =>
  Node.create({
    name,
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    draggable: false,

    addAttributes() {
      return {
        format: {
          default: 'decimal',
          parseHTML: (element) =>
            element.getAttribute('data-format') || 'decimal',
          renderHTML: (attributes) => ({
            'data-format': attributes.format || 'decimal',
          }),
        },
      }
    },

    parseHTML() {
      return [{ tag: `span[data-type="${name}"]` }]
    },

    renderHTML({ HTMLAttributes, node }) {
      const fields = this.editor?.storage.pageFields
      return [
        'span',
        mergeAttributes(HTMLAttributes, {
          'data-type': name,
          class: 'umo-page-field',
        }),
        formatPageNumber(
          fields ? valueOf(fields) : 1,
          node.attrs.format || 'decimal',
        ),
      ]
    },

    addNodeView() {
      return ({ node, editor }) => {
        const dom = document.createElement('span')
        dom.className = 'umo-page-field'
        dom.setAttribute('data-type', name)
        dom.contentEditable = 'false'
        let current = node
        const render = () => {
          const fields = editor.storage.pageFields
          dom.setAttribute('data-format', current.attrs.format || 'decimal')
          dom.textContent = formatPageNumber(
            fields ? valueOf(fields) : 1,
            current.attrs.format || 'decimal',
          )
        }
        editor.storage.pageFields?.elements.add(render)
        render()
        return {
          dom,
          update(updated) {
            if (updated.type !== current.type) return false
            current = updated
            render()
            return true
          },
          selectNode() {
            dom.classList.add('ProseMirror-selectednode')
          },
          deselectNode() {
            dom.classList.remove('ProseMirror-selectednode')
          },
          ignoreMutation: () => true,
          destroy() {
            editor.storage.pageFields?.elements.delete(render)
          },
        }
      }
    },

    addCommands() {
      return {
        [insertCommand]:
          (attrs = {}) =>
          ({ chain }) =>
            chain()
              .insertContent({ type: name, attrs })
              .run(),
      }
    },
  })

export const PageNumber = createFieldNode(
  'pageNumber',
  (fields) => fields.page,
  'insertPageNumber',
)

export const PageCount = createFieldNode(
  'pageCount',
  (fields) => fields.total,
  'insertPageCount',
)

export default [PageFields, PageNumber, PageCount]
