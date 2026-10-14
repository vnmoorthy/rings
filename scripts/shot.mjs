// Screenshots of a rings page with headless Chrome (square, card, or an animation frame).
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'

const CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean)

export function findChrome() {
  for (const c of CANDIDATES) if (fs.existsSync(c)) return c
  return null
}

// view: 'square' (1080x1080) or 'card' (1200x630). t: animation time in seconds, or null for the final state.
export function shot(htmlFile, pngFile, { view = 'square', t = null, chrome = findChrome() } = {}) {
  if (!chrome) throw new Error('Chrome or Chromium not found; set CHROME=/path/to/chrome')
  const size = view === 'card' ? '1200,630' : '1080,1080'
  const q = new URLSearchParams({ view })
  if (t === null) q.set('static', '1'); else q.set('t', String(t))
  const url = `${pathToFileURL(htmlFile).href}?${q}`
  const r = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${size}`, `--screenshot=${pngFile}`, url], { encoding: 'utf8', timeout: 60000 })
  if (!fs.existsSync(pngFile)) throw new Error(`screenshot failed: ${(r.stderr || '').slice(-300)}`)
  return pngFile
}
