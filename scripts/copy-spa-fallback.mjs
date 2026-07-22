import { copyFile, access } from 'node:fs/promises'
import { constants } from 'node:fs'

const src = 'dist/index.html'
const dest = 'dist/404.html'

try {
  await access(src, constants.F_OK)
  await copyFile(src, dest)
  console.log(`SPA fallback created: ${dest}`)
} catch (err) {
  if (err.code === 'ENOENT') {
    console.error(`Error: ${src} not found. Run "vite build" first.`)
  } else {
    console.error(`Error copying SPA fallback: ${err.message}`)
  }
  process.exit(1)
}
