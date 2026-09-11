import { DOMParser as ProseMirrorDOMParser, Schema } from '@tiptap/pm/model'
import {
  AlignmentType,
  BorderStyle,
  Document as WordDocument,
  ExternalHyperlink,
  Footer,
  FootnoteReferenceRun,
  Header,
  HeadingLevel,
  ImageRun,
  InternalHyperlink,
  LevelFormat,
  LineRuleType,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  SimpleField,
  Tab,
  Table,
  TableCell,
  TableLayoutType,
  TableOfContents,
  TableRow,
  TextRun,
  UnderlineType,
  VerticalAlign,
  WidthType,
} from 'docx'

import {
  getHeaderFooterDistance,
  getPageGeometry,
} from '@/extensions/pagination/layout'

import {
  cleanText,
  createColorResolver,
  fontFamily,
  points,
  positive,
  twips,
} from './format'
import { loadDocumentImages } from './images'

const HEADING_SCALES = [2.5, 2, 1.5, 1.25, 1, 0.85]
const LIST_TYPES = new Set(['orderedList', 'bulletList', 'taskList'])
const ALIGNMENTS = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
  distributed: AlignmentType.DISTRIBUTE,
  'flex-start': AlignmentType.LEFT,
  'flex-end': AlignmentType.RIGHT,
}
const NUMBER_FORMATS = {
  decimal: LevelFormat.DECIMAL,
  'decimal-leading-zero': LevelFormat.DECIMAL_ZERO,
  'lower-roman': LevelFormat.LOWER_ROMAN,
  'upper-roman': LevelFormat.UPPER_ROMAN,
  'lower-alpha': LevelFormat.LOWER_LETTER,
  'lower-latin': LevelFormat.LOWER_LETTER,
  'upper-alpha': LevelFormat.UPPER_LETTER,
  'upper-latin': LevelFormat.UPPER_LETTER,
  'trad-chinese-informal': LevelFormat.TAIWANESE_COUNTING,
  'simp-chinese-informal': LevelFormat.CHINESE_COUNTING,
  'simp-chinese-formal': LevelFormat.CHINESE_LEGAL_SIMPLIFIED,
}
const FIELD_FORMATS = {
  decimal: 'Arabic',
  lowerRoman: 'roman',
  upperRoman: 'ROMAN',
  lowerAlpha: 'alphabetic',
  upperAlpha: 'ALPHABETIC',
  chinese: 'CHINESENUM1',
}

function headerFooterDocument(snapshot, kind) {
  if (snapshot.page[kind]?.show === false) return null
  // Use the live editor: its last keystroke may not yet have reached the
  // debounced HTML stored in page options.
  if (snapshot[kind]) return snapshot[kind]
  const html = snapshot.page[kind]?.content
  if (!html) return null
  // Header/footer editors are unmounted in web view. Parse their saved HTML
  // with the same schema plus page fields and an unrestricted document root.
  const field = (name) => ({
    inline: true,
    group: 'inline',
    atom: true,
    attrs: { format: { default: 'decimal' } },
    parseDOM: [
      {
        tag: `span[data-type="${name}"]`,
        getAttrs: (element) => ({
          format: element.getAttribute('data-format') || 'decimal',
        }),
      },
    ],
  })
  const schema = new Schema({
    nodes: snapshot.schema.spec.nodes
      .update('doc', { content: 'block+' })
      .append({
        pageNumber: field('pageNumber'),
        pageCount: field('pageCount'),
      }),
    marks: snapshot.schema.spec.marks,
  })
  const element = document.createElement('div')
  element.innerHTML = html
  return ProseMirrorDOMParser.fromSchema(schema)
    .parse(element, { preserveWhitespace: 'full' })
    .toJSON()
}

function textRuns(text, style = {}) {
  return cleanText(text)
    .split(/(\r\n|\n|\r|\t)/)
    .filter(Boolean)
    .map((part) => {
      if (part === '\t') return new TextRun({ ...style, children: [new Tab()] })
      if (/^[\r\n]+$/.test(part)) return new TextRun({ ...style, break: 1 })
      return new TextRun({ ...style, text: part })
    })
}

function fallbackText(node) {
  if (node.text !== undefined) return node.text
  if (node.type === 'hardBreak') return '\n'
  if (node.content?.length) return node.content.map(fallbackText).join('')
  const attrs = node.attrs || {}
  return (
    attrs.text ||
    attrs.label ||
    attrs.latex ||
    attrs.title ||
    attrs.name ||
    attrs.src ||
    attrs.url ||
    `[${node.type}]`
  )
}

function hyperlink(href, children) {
  if (!href) return children
  if (href.startsWith('#'))
    return [new InternalHyperlink({ anchor: href.slice(1), children })]
  try {
    const url = new URL(href, document.baseURI)
    if (['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) {
      return [new ExternalHyperlink({ link: url.href, children })]
    }
  } catch {
    /* Preserve the label of invalid links as text. */
  }
  return children
}

function lineSpacing(value, fontSize) {
  const input = String(value ?? '1.75').trim()
  const multiple = input.match(/^([\d.]+)(em|%)?$/)
  if (multiple) {
    const factor = positive(multiple[1], 1.75) / (multiple[2] === '%' ? 100 : 1)
    return { line: Math.round(factor * 240), lineRule: LineRuleType.AUTO }
  }
  const line = twips(input, fontSize)
  return line > 0
    ? { line, lineRule: LineRuleType.EXACT }
    : { line: 420, lineRule: LineRuleType.AUTO }
}

// Serialize schema content rather than the editor DOM, which contains page
// spacers, resize handles, placeholders and other transient editing controls.
export async function createDocx(snapshot) {
  const header = headerFooterDocument(snapshot, 'header')
  const footer = headerFooterDocument(snapshot, 'footer')
  const images = await loadDocumentImages([snapshot.content, header, footer])
  const color = createColorResolver()
  const geometry = getPageGeometry(snapshot.page)
  const baseSize = positive(points(snapshot.styles.fontSize), 10.5)
  const numbering = []
  const footnoteIds = new Map()
  const footnoteNodes = []
  const collectFootnotes = (node) => {
    if (node.type === 'footnote') {
      footnoteIds.set(node.attrs?.['data-fn-id'], footnoteNodes.length + 1)
      footnoteNodes.push(node)
    } else node.content?.forEach(collectFootnotes)
  }
  collectFootnotes(snapshot.content)
  const baseContext = {
    fontSize: baseSize,
    maxWidth: Math.max(
      1,
      geometry.width - geometry.margin.left - geometry.margin.right,
    ),
    maxHeight: geometry.bodyHeight,
    listDepth: 0,
  }
  const shading = (value) => {
    const fill = color(value)
    return fill ? { type: ShadingType.CLEAR, fill } : undefined
  }

  function runStyle(marks = [], context = baseContext) {
    const style = { ...context.run }
    for (const mark of marks) {
      const attrs = mark.attrs || {}
      switch (mark.type) {
        case 'bold':
          style.bold = true
          break
        case 'italic':
          style.italics = true
          break
        case 'underline':
          style.underline = { type: UnderlineType.SINGLE }
          break
        case 'strike':
          style.strike = true
          break
        case 'subscript':
          style.subScript = true
          break
        case 'superscript':
          style.superScript = true
          break
        case 'code':
          style.font = fontFamily(snapshot.styles.codeFont || 'Consolas')
          style.shading = shading('#f1f3f5')
          break
        case 'link':
          style.style = 'Hyperlink'
          break
        case 'textStyle': {
          if (attrs.fontFamily) style.font = fontFamily(attrs.fontFamily)
          const size = points(attrs.fontSize, context.fontSize)
          if (size > 0)
            style.size = style.sizeComplexScript = Math.max(
              1,
              Math.round(size * 2),
            )
          if (color(attrs.color)) style.color = color(attrs.color)
          if (shading(attrs.backgroundColor))
            style.shading = shading(attrs.backgroundColor)
          break
        }
        case 'highlight':
          style.shading = shading(attrs.color || '#ffff00')
          break
        case 'letterSpacing':
          style.characterSpacing = twips(attrs.spacing, context.fontSize)
          break
        default:
          break
      }
    }
    return style
  }

  function imageRun(node, context) {
    const attrs = node.attrs || {}
    const image = images.get(attrs.src)
    let width = positive(parseFloat(attrs.width), image.width)
    let height = positive(
      parseFloat(attrs.height),
      (image.height * width) / image.width,
    )
    if (
      !positive(parseFloat(attrs.width), 0) &&
      positive(parseFloat(attrs.height), 0)
    ) {
      width = (image.width * height) / image.height
    }
    const scale = Math.min(
      1,
      context.maxWidth / width,
      context.maxHeight / height,
    )
    return new ImageRun({
      data: image.data,
      type: image.type,
      transformation: {
        width: width * scale,
        height: height * scale,
        rotation: Number(attrs.angle) || 0,
        flip: { horizontal: !!attrs.flipX, vertical: !!attrs.flipY },
      },
      altText: {
        name: cleanText(attrs.name || attrs.alt || 'Image'),
        title: cleanText(attrs.title || attrs.alt),
        description: cleanText(attrs.alt || attrs.title),
      },
    })
  }

  function inline(nodes = [], context = baseContext) {
    return nodes.flatMap((node) => {
      const attrs = node.attrs || {}
      const style = runStyle(node.marks, context)
      let children
      switch (node.type) {
        case 'text':
          children = textRuns(node.text, style)
          break
        case 'hardBreak':
          children = [new TextRun({ ...style, break: 1 })]
          break
        case 'inlineImage':
        case 'image':
          children = [imageRun(node, context)]
          break
        case 'pageNumber':
        case 'pageCount': {
          const instruction = node.type === 'pageNumber' ? 'PAGE' : 'NUMPAGES'
          const field = new SimpleField(
            `${instruction} \\* ${FIELD_FORMATS[attrs.format] || 'Arabic'}`,
          )
          field.addChildElement(new TextRun({ ...style, text: '1' }))
          children = [field]
          break
        }
        case 'footnoteReference': {
          const id = footnoteIds.get(attrs['data-fn-id'])
          children = id
            ? [new FootnoteReferenceRun(id)]
            : textRuns(attrs.caption || fallbackText(node), {
                ...style,
                superScript: true,
              })
          break
        }
        case 'mention':
          children = textRuns(
            `${attrs.mentionSuggestionChar || '@'}${attrs.label || attrs.id || ''}`,
            style,
          )
          break
        case 'tag':
          children = textRuns(attrs.text, {
            ...style,
            color: color(attrs.color),
            shading: shading(attrs.backgroundColor),
          })
          break
        case 'optionBox':
          children = textRuns(
            (attrs.items || [])
              .map((item) => `${item.checked ? '☑' : '☐'} ${item.label || ''}`)
              .join('  '),
            style,
          )
          break
        default:
          children = node.content?.length
            ? inline(node.content, { ...context, run: style })
            : textRuns(fallbackText(node), style)
      }
      const link = node.marks?.find((mark) => mark.type === 'link')
      return link ? hyperlink(link.attrs?.href, children) : children
    })
  }

  function paragraph(node, context = baseContext, extra = {}) {
    const attrs = node.attrs || {}
    const level =
      node.type === 'heading'
        ? Math.min(6, Math.max(1, Number(attrs.level) || 1))
        : 0
    const fontSize = level
      ? baseSize * HEADING_SCALES[level - 1]
      : context.fontSize
    const paragraphStyle = context.paragraph || {}
    const spacing = {
      before: 0,
      after: twips(snapshot.styles.nodeSpacing || '0.75em', fontSize),
      ...lineSpacing(attrs.lineHeight, fontSize),
      ...paragraphStyle.spacing,
    }
    if (attrs.margin?.top !== undefined && attrs.margin.top !== null)
      spacing.before = Math.max(0, twips(attrs.margin.top, fontSize) || 0)
    if (attrs.margin?.bottom !== undefined && attrs.margin.bottom !== null)
      spacing.after = Math.max(0, twips(attrs.margin.bottom, fontSize) || 0)
    const indent = { ...paragraphStyle.indent }
    if (attrs.indent > 0) {
      const size = positive(parseFloat(snapshot.indentSize), 2) * attrs.indent
      indent.firstLine = Math.max(
        0,
        twips(
          `${size}${attrs.indentUnit || snapshot.indentUnit || 'em'}`,
          fontSize,
        ) || 0,
      )
    }
    return new Paragraph({
      ...paragraphStyle,
      heading: level ? HeadingLevel[`HEADING_${level}`] : undefined,
      alignment:
        ALIGNMENTS[attrs.textAlign || attrs.nodeAlign] ||
        paragraphStyle.alignment,
      spacing,
      indent,
      numbering: context.numbering,
      ...extra,
      children: [
        ...(context.prefix || []),
        ...(extra.children || inline(node.content, { ...context, fontSize })),
      ],
    })
  }

  function list(node, context) {
    const depth = Math.min(8, context.listDepth || 0)
    const attrs = node.attrs || {}
    const task = node.type === 'taskList'
    const ordered = node.type === 'orderedList'
    const reference = `umo-list-${numbering.length + 1}`
    if (!task) {
      const bullet =
        { disc: '•', circle: '○', square: '▪' }[attrs.listType] || '•'
      const format = ordered
        ? NUMBER_FORMATS[attrs.listType] || LevelFormat.DECIMAL
        : LevelFormat.BULLET
      numbering.push({
        reference,
        levels: Array.from({ length: 9 }, (_, level) => ({
          level,
          format,
          text: ordered ? `%${level + 1}.` : bullet,
          start:
            level === depth
              ? Math.max(0, Math.floor(Number(attrs.start) || 1))
              : 1,
          alignment: AlignmentType.LEFT,
          style: {
            paragraph: { indent: { left: (level + 1) * 360, hanging: 360 } },
          },
        })),
      })
    }
    return (node.content || []).flatMap((item) => {
      let first = true
      return (item.content || []).flatMap((child) => {
        const itemContext = {
          ...context,
          listDepth: depth + 1,
          paragraph: {
            ...context.paragraph,
            indent: {
              left: (depth + 1) * 360,
              ...(first ? { hanging: 360 } : {}),
            },
          },
          numbering: first && !task ? { reference, level: depth } : undefined,
          prefix:
            first && task
              ? textRuns(`${item.attrs?.checked ? '☑' : '☐'} `)
              : undefined,
        }
        if (LIST_TYPES.has(child.type)) {
          return block(child, { ...context, listDepth: depth + 1 })
        }
        first = false
        return block(child, itemContext)
      })
    })
  }

  function table(node, context, borderless = false) {
    if (!node.content?.length) return [new Paragraph('')]
    const occupied = []
    const widths = []
    let columnCount = 0
    const rows = node.content.map((row, rowIndex) => {
      let column = 0
      return (row.content || []).map((cell) => {
        while (occupied[column] > rowIndex) column++
        const span = Math.max(1, Math.floor(Number(cell.attrs?.colspan) || 1))
        const rowSpan = Math.min(
          node.content.length - rowIndex,
          Math.max(1, Math.floor(Number(cell.attrs?.rowspan) || 1)),
        )
        const start = column
        for (let index = 0; index < span; index++) {
          occupied[column] = rowIndex + rowSpan
          widths[column] = positive(
            cell.attrs?.colwidth?.[index],
            widths[column] || 0,
          )
          column++
        }
        columnCount = Math.max(columnCount, column)
        return { cell, start, span, rowSpan }
      })
    })
    if (!columnCount) return [new Paragraph('')]
    const knownWidth = widths.reduce((sum, width) => sum + (width || 0), 0)
    const missing = columnCount - widths.filter(Boolean).length
    const fallback = Math.max(
      20,
      (context.maxWidth - knownWidth) / (missing || 1),
    )
    const columnWidths = Array.from(
      { length: columnCount },
      (_, index) => widths[index] || fallback,
    )
    const total = columnWidths.reduce((sum, width) => sum + width, 0)
    const scale = Math.min(1, context.maxWidth / total)
    const grid = columnWidths.map((width) =>
      Math.max(1, Math.round(width * scale * 15)),
    )
    const border = {
      style: borderless ? BorderStyle.NONE : BorderStyle.SINGLE,
      size: 6,
      color: color(snapshot.styles.tableBorder) || '333333',
    }
    const borders = Object.fromEntries(
      [
        'top',
        'bottom',
        'left',
        'right',
        'insideHorizontal',
        'insideVertical',
      ].map((side) => [side, border]),
    )
    let inHeader = true
    return [
      new Table({
        layout: TableLayoutType.FIXED,
        width: {
          size: grid.reduce((sum, width) => sum + width, 0),
          type: WidthType.DXA,
        },
        columnWidths: grid,
        borders,
        rows: rows.map((cells) => {
          inHeader =
            inHeader &&
            cells.length > 0 &&
            cells.every(({ cell }) => cell.type === 'tableHeader')
          return new TableRow({
            tableHeader: !borderless && inHeader,
            children: cells.map(({ cell, start, span, rowSpan }) => {
              const attrs = cell.attrs || {}
              const width = grid
                .slice(start, start + span)
                .reduce((sum, size) => sum + size, 0)
              const [horizontal, vertical] = String(attrs.align || '').split(
                '-',
              )
              const isHeader = cell.type === 'tableHeader'
              const children = blocks(cell.content, {
                ...context,
                maxWidth: Math.max(1, width / 15 - 10),
                run: {
                  ...context.run,
                  ...(isHeader ? { bold: true } : {}),
                  ...(color(attrs.color) ? { color: color(attrs.color) } : {}),
                },
                paragraph: {
                  alignment: ALIGNMENTS[horizontal],
                  spacing: { after: 0 },
                },
                numbering: undefined,
                prefix: undefined,
              })
              // OOXML requires a final paragraph, including after nested tables.
              if (!(children.at(-1) instanceof Paragraph))
                children.push(new Paragraph(''))
              return new TableCell({
                columnSpan: span,
                rowSpan,
                width: { size: width, type: WidthType.DXA },
                margins: { top: 45, bottom: 45, left: 75, right: 75 },
                borders: {
                  top: border,
                  bottom: border,
                  left: border,
                  right: border,
                },
                verticalAlign:
                  { top: VerticalAlign.TOP, bottom: VerticalAlign.BOTTOM }[
                    vertical
                  ] || VerticalAlign.CENTER,
                shading: shading(
                  attrs.background ||
                    (isHeader
                      ? snapshot.styles.tableHeaderBackground || '#f1f3f5'
                      : null),
                ),
                children,
              })
            }),
          })
        }),
      }),
    ]
  }

  function block(node, context = baseContext) {
    const attrs = node.attrs || {}
    if (LIST_TYPES.has(node.type)) return list(node, context)
    switch (node.type) {
      case 'doc':
      case 'details':
      case 'detailsContent':
      case 'column':
        return blocks(node.content, context)
      case 'paragraph':
      case 'heading':
      case 'textBox':
        return [paragraph(node, context)]
      case 'detailsSummary':
        return [
          paragraph(node, { ...context, run: { ...context.run, bold: true } }),
        ]
      case 'image': {
        const result = [
          paragraph(node, context, { children: [imageRun(node, context)] }),
        ]
        if (attrs.showTitle && node.content?.length)
          result.push(paragraph(node, context))
        return result
      }
      case 'pageBreak':
        return [
          new Paragraph({
            children: [new PageBreak()],
            spacing: {
              before: 0,
              after: 0,
              line: 1,
              lineRule: LineRuleType.EXACT,
            },
          }),
        ]
      case 'horizontalRule':
        return [
          paragraph(node, context, {
            border: {
              bottom: {
                style:
                  {
                    double: BorderStyle.DOUBLE,
                    dashed: BorderStyle.DASHED,
                    dotted: BorderStyle.DOTTED,
                  }[attrs['data-type']] || BorderStyle.SINGLE,
                color: color(attrs.color) || '333333',
                size: 6,
              },
            },
          }),
        ]
      case 'codeBlock':
        return [
          paragraph(node, context, {
            shading: shading('#f1f3f5'),
            spacing: {
              before: 0,
              after: 160,
              line: 240,
              lineRule: LineRuleType.AUTO,
            },
            children: inline(node.content, {
              ...context,
              run: {
                ...context.run,
                font: fontFamily(snapshot.styles.codeFont || 'Consolas'),
              },
            }),
          }),
        ]
      case 'blockquote':
        return blocks(node.content, {
          ...context,
          paragraph: {
            ...context.paragraph,
            indent: { left: 360, right: 180 },
            border: {
              left: {
                style: BorderStyle.SINGLE,
                size: 18,
                color: 'CCCCCC',
                space: 8,
              },
            },
          },
        })
      case 'callout':
        return blocks(node.content, {
          ...context,
          paragraph: {
            ...context.paragraph,
            shading: shading(attrs.backgroundColor),
          },
        })
      case 'table':
        return table(node, context)
      case 'columnContainer':
        return table(
          {
            content: [
              {
                content: (node.content || []).map((column) => ({
                  type: 'tableCell',
                  attrs: { colwidth: [positive(column.attrs?.colWidth, 200)] },
                  content: column.content,
                })),
              },
            ],
          },
          context,
          true,
        )
      case 'footnotes':
        return []
      case 'toc':
        return [
          new TableOfContents('', {
            hyperlink: true,
            headingStyleRange: '1-6',
          }),
        ]
      case 'video':
      case 'audio':
      case 'file':
      case 'iframe':
        return [
          paragraph(node, context, {
            children: hyperlink(
              attrs.src || attrs.url,
              textRuns(fallbackText(node), {
                ...context.run,
                style: 'Hyperlink',
              }),
            ),
          }),
        ]
      default:
        if (node.content?.length) {
          return node.content.every(
            (child) => snapshot.schema.nodes[child.type]?.isInline,
          )
            ? [paragraph(node, context)]
            : blocks(node.content, context)
        }
        return [paragraph(node, context, { children: inline([node], context) })]
    }
  }

  function blocks(nodes = [], context = baseContext) {
    return nodes.flatMap((node) => block(node, context))
  }

  const children = blocks(snapshot.content.content)
  if (!children.length) children.push(new Paragraph(''))
  const headers = header
    ? { default: new Header({ children: blocks(header.content) }) }
    : undefined
  const footers = footer
    ? { default: new Footer({ children: blocks(footer.content) }) }
    : undefined
  const footnotes = Object.fromEntries(
    footnoteNodes.map((node, index) => [
      index + 1,
      { children: blocks(node.content) },
    ]),
  )
  const defaultStyles = {
    document: {
      run: {
        font: fontFamily(snapshot.styles.fontFamily),
        size: Math.round(baseSize * 2),
        sizeComplexScript: Math.round(baseSize * 2),
        color: color(snapshot.styles.color) || '333333',
      },
      paragraph: { spacing: lineSpacing('1.75', baseSize) },
    },
    ...Object.fromEntries(
      HEADING_SCALES.map((scale, index) => [
        `heading${index + 1}`,
        {
          run: {
            font: fontFamily(snapshot.styles.fontFamily),
            size: Math.round(baseSize * scale * 2),
            sizeComplexScript: Math.round(baseSize * scale * 2),
            bold: true,
            color: color(snapshot.styles.color) || '333333',
          },
          paragraph: { keepNext: true, keepLines: true },
        },
      ]),
    ),
  }
  const doc = new WordDocument({
    title: cleanText(snapshot.title),
    creator: 'Umo Editor',
    styles: { default: defaultStyles },
    numbering: { config: numbering },
    footnotes,
    features: { updateFields: true },
    background: color(snapshot.page.background)
      ? { color: color(snapshot.page.background) }
      : undefined,
    sections: [
      {
        properties: {
          page: {
            size: {
              width: twips(`${positive(snapshot.page.size?.width, 21)}cm`),
              height: twips(`${positive(snapshot.page.size?.height, 29.7)}cm`),
              orientation:
                snapshot.page.orientation === 'landscape'
                  ? 'landscape'
                  : 'portrait',
            },
            margin: {
              top: Math.round(geometry.inset.top * 15),
              bottom: Math.round(geometry.inset.bottom * 15),
              left: Math.round(geometry.margin.left * 15),
              right: Math.round(geometry.margin.right * 15),
              header: twips(
                `${getHeaderFooterDistance(snapshot.page.margin?.top)}cm`,
              ),
              footer: twips(
                `${getHeaderFooterDistance(snapshot.page.margin?.bottom)}cm`,
              ),
            },
          },
        },
        headers,
        footers,
        children,
      },
    ],
  })
  return Packer.toBlob(doc)
}
