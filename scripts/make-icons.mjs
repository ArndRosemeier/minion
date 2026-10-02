// Renders the Minion app icon (hexagon + triangle) to PNGs without dependencies.
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const BG = [0x1c, 0x17, 0x14], GOLD = [0xe0, 0xa5, 0x4b]
const hex = [[256, 70], [410, 160], [410, 352], [256, 442], [102, 352], [102, 160]]
const tri = [[256, 150], [340, 300], [172, 300]]

const inPoly = (x, y, p) => {
  let c = false
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}
const segDist = (x, y, [ax, ay], [bx, by]) => {
  const dx = bx - ax, dy = by - ay
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(x - ax - t * dx, y - ay - t * dy)
}
const edgeDist = (x, y, p) => Math.min(...p.map((a, i) => segDist(x, y, a, p[(i + 1) % p.length])))

function sample(x, y) {
  // coordinates in 512-space; returns coverage of gold
  if (inPoly(x, y, tri)) return 1
  if (edgeDist(x, y, hex) <= 11) return 1
  return 0
}

function render(size) {
  const ss = 3, s = 512 / size
  const raw = Buffer.alloc(size * (size * 3 + 1))
  for (let py = 0; py < size; py++) {
    raw[py * (size * 3 + 1)] = 0
    for (let px = 0; px < size; px++) {
      let cov = 0
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) cov += sample((px + (sx + 0.5) / ss) * s, (py + (sy + 0.5) / ss) * s)
      cov /= ss * ss
      const o = py * (size * 3 + 1) + 1 + px * 3
      for (let k = 0; k < 3; k++) raw[o + k] = Math.round(BG[k] + (GOLD[k] - BG[k]) * cov)
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

for (const [size, name] of [[180, 'apple-touch-icon.png'], [192, 'icon-192.png'], [512, 'icon-512.png']]) {
  writeFileSync(new URL(`../public/${name}`, import.meta.url), render(size))
  console.log('wrote', name)
}
