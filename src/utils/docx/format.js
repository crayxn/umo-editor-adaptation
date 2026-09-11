// DOCX uses points for font sizes and twentieths of a point (twips) for layout.
export function points(value, fontSize = 10.5) {
  const match = String(value ?? '')
    .trim()
    .match(/^(-?[\d.]+)\s*(px|pt|cm|mm|in|em|rem|%)?$/i)
  if (!match) return undefined
  const number = Number(match[1])
  if (!Number.isFinite(number)) return undefined
  const scale = {
    px: 0.75,
    pt: 1,
    cm: 72 / 2.54,
    mm: 72 / 25.4,
    in: 72,
    em: fontSize,
    rem: fontSize,
    '%': fontSize / 100,
  }
  return number * scale[(match[2] || 'px').toLowerCase()]
}

export const twips = (value, fontSize) => {
  const size = points(value, fontSize)
  return size === undefined ? undefined : Math.round(size * 20)
}

export const positive = (value, fallback) =>
  Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback

export const cleanText = (value) =>
  String(value ?? '').replace(
    // eslint-disable-next-line no-control-regex -- XML 1.0 forbids these characters.
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,
    '',
  )

export function fontFamily(value) {
  const fonts = String(value || 'SimSun')
    .split(',')
    .map((font) => font.trim().replace(/^['"]|['"]$/g, ''))
  return {
    ascii: fonts[0],
    hAnsi: fonts[0],
    cs: fonts[0],
    eastAsia:
      fonts.find((font) =>
        /[\u3400-\u9fff]|simsun|simhei|yahei|pingfang|hiragino/i.test(font),
      ) || fonts[0],
  }
}

// Resolve CSS colors (including alpha and named colors) into OOXML RGB values.
// Transparent colors are omitted; translucent colors are blended onto paper.
export function createColorResolver() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const cache = new Map()
  return (value) => {
    if (!value || value === 'transparent') return undefined
    if (cache.has(value)) return cache.get(value)
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = 'rgba(0, 0, 0, 0)'
    context.fillStyle = value
    context.fillRect(0, 0, 1, 1)
    const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data
    const result =
      alpha === 0
        ? undefined
        : [red, green, blue]
            .map((channel) =>
              Math.round((channel * alpha) / 255 + 255 - alpha)
                .toString(16)
                .padStart(2, '0'),
            )
            .join('')
            .toUpperCase()
    cache.set(value, result)
    return result
  }
}

export function docxFilename(value, fallback = 'document') {
  const name = String(value || fallback)
    // eslint-disable-next-line no-control-regex -- Windows filenames forbid control characters.
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .trim()
    .replace(/[. ]+$/, '')
    .replace(/\.docx$/i, '')
    .replace(/[. ]+$/, '')
  return `${name || fallback}.docx`
}
