// Generates simple placeholder PWA icons (yellow tile, black ring + bolt) with no image libraries.
// Replace public/icons/*.png with real brand artwork when you have it.   node scripts/make-icons.mjs
import { deflateSync, crc32 } from 'node:zlib'
import fs from 'node:fs'

const BOLT = [[0.57, 0.27], [0.39, 0.55], [0.5, 0.55], [0.43, 0.75], [0.62, 0.46], [0.51, 0.46]]
const inPoly = (x, y, poly) => {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([len, body, crc])
}
const png = (size) => {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const nx = x / size, ny = y / size, d = Math.hypot(nx - 0.5, ny - 0.5)
      const black = (d > 0.3 && d < 0.355) || inPoly(nx, ny, BOLT)
      const o = y * (size * 4 + 1) + 1 + x * 4
      raw[o] = black ? 11 : 255; raw[o + 1] = black ? 11 : 214; raw[o + 2] = black ? 11 : 10; raw[o + 3] = 255
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
fs.mkdirSync('public/icons', { recursive: true })
for (const s of [192, 512]) fs.writeFileSync(`public/icons/icon-${s}.png`, png(s))
fs.writeFileSync('public/icons/apple-touch-icon.png', png(180))
console.log('icons written')
