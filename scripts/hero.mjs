#!/usr/bin/env node
// Records the growth animation of one rings page into MP4, GIF and animated WebP.
// Usage: node scripts/hero.mjs <page.html> <outDir> [--fps 15] [--width 720]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { shot } from './shot.mjs'

const [page, outDir = 'site/assets'] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? Number(process.argv[i + 1]) : d }
const fps = arg('--fps', 15)
const width = arg('--width', 720)
if (!page) { console.error('usage: node scripts/hero.mjs <page.html> <outDir>'); process.exit(2) }

const GROW = 3.6, HOLD = 0.8, END = 2.4 // seconds: growth, caption fade, hold on the finished log
const frames = Math.round((GROW + HOLD) * fps)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rings-hero-'))
fs.mkdirSync(outDir, { recursive: true })
console.error(`capturing ${frames} frames...`)
for (let i = 0; i <= frames; i++) {
  const t = Math.min(GROW + HOLD, i / fps)
  shot(path.resolve(page), path.join(tmp, `f${String(i).padStart(4, '0')}.png`), { view: 'square', t: t === 0 ? 0.001 : t })
}
const ff = (args) => { const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr) }
const input = ['-framerate', String(fps), '-i', path.join(tmp, 'f%04d.png')]
const hold = `tpad=stop_mode=clone:stop_duration=${END}`
ff([...input, '-vf', `${hold},format=yuv420p`, '-c:v', 'libx264', '-crf', '20', '-movflags', '+faststart', path.join(outDir, 'hero.mp4')])
ff([...input, '-vf', `${hold},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`, '-loop', '0', path.join(outDir, 'hero.gif')])
try { ff([...input, '-vf', `${hold},scale=${width}:-1:flags=lanczos`, '-c:v', 'libwebp', '-quality', '72', '-loop', '0', path.join(outDir, 'hero.webp')]) } catch (e) { console.error(`webp skipped: ${e.message.split('\n')[0]}`) }
fs.copyFileSync(path.join(tmp, `f${String(frames).padStart(4, '0')}.png`), path.join(outDir, 'hero.png'))
for (const f of ['hero.mp4', 'hero.gif', 'hero.webp', 'hero.png']) {
  const p = path.join(outDir, f)
  if (fs.existsSync(p)) console.log(`${p}  ${(fs.statSync(p).size / 1e6).toFixed(2)} MB`)
}
fs.rmSync(tmp, { recursive: true, force: true })
