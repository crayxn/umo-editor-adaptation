import { positive } from './format'

const IMAGE_TIMEOUT = 15000

function decodeImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const timer = setTimeout(
      () => finish(new Error('Image decoding timed out')),
      IMAGE_TIMEOUT,
    )
    const finish = (error) => {
      clearTimeout(timer)
      image.onload = image.onerror = null
      if (error) reject(error)
      else resolve(image)
    }
    image.onload = () => finish()
    image.onerror = () => finish(new Error('Image could not be decoded'))
    image.src = url
  })
}

function imageType(bytes) {
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return 'png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif'
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp'
  return null
}

async function loadImage(src) {
  const url = new URL(src, document.baseURI)
  if (!['http:', 'https:', 'blob:', 'data:'].includes(url.protocol)) {
    throw new Error('Unsupported image URL')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT)
  let objectURL
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok)
      throw new Error(`Image request failed (${response.status})`)
    const blob = await response.blob()
    objectURL = URL.createObjectURL(blob)
    const image = await decodeImage(objectURL)
    const width = positive(image.naturalWidth, 0)
    const height = positive(image.naturalHeight, 0)
    if (!width || !height) throw new Error('Image has no dimensions')
    let data = new Uint8Array(await blob.arrayBuffer())
    let type = imageType(data)
    // Word does not consistently support WebP/AVIF/SVG. Rasterize these while
    // retaining original JPEG/PNG/GIF/BMP data and image quality.
    if (!type) {
      const canvas = document.createElement('canvas')
      const scale = Math.min(1, 4096 / Math.max(width, height))
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      canvas
        .getContext('2d')
        .drawImage(image, 0, 0, canvas.width, canvas.height)
      const png = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/png'),
      )
      if (!png) throw new Error('Image conversion failed')
      data = new Uint8Array(await png.arrayBuffer())
      type = 'png'
    }
    return { data, type, width, height }
  } finally {
    clearTimeout(timer)
    if (objectURL) URL.revokeObjectURL(objectURL)
  }
}

export async function loadDocumentImages(documents) {
  const sources = new Map()
  const visit = (node) => {
    if (['image', 'inlineImage'].includes(node.type)) {
      if (!node.attrs?.src) throw new Error('Document image has no source')
      sources.set(node.attrs.src, null)
    }
    node.content?.forEach(visit)
  }
  documents.filter(Boolean).forEach(visit)
  const pending = [...sources.keys()]
  let next = 0
  // Limit concurrent requests and decode each distinct source only once.
  await Promise.all(
    Array.from({ length: Math.min(4, pending.length) }, async () => {
      while (next < pending.length) {
        const src = pending[next++]
        sources.set(src, await loadImage(src))
      }
    }),
  )
  return sources
}
