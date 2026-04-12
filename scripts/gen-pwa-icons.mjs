import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const projectRoot = path.resolve(process.cwd())
const publicDir = path.join(projectRoot, 'public')
const sourceSvgPath = path.join(publicDir, 'favicon.svg')
const icon192Path = path.join(publicDir, 'pwa-192.png')
const icon512Path = path.join(publicDir, 'pwa-512.png')

async function main() {
  const svg = await fs.readFile(sourceSvgPath)

  await sharp(svg, { density: 512 })
    .resize(192, 192, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(icon192Path)

  await sharp(svg, { density: 512 })
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(icon512Path)
}

await main()
