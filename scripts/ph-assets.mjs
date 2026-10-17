#!/usr/bin/env node
// Product Hunt gallery images (1270x760) composed from the gallery's own renders.
// Usage: node scripts/ph-assets.mjs <site dir> <out dir>
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { findChrome } from './shot.mjs'
import { COLORS } from '../lib/render.mjs'

const [siteDir, outDir] = process.argv.slice(2).map((p) => path.resolve(p))
if (!siteDir || !outDir) { console.error('usage: node scripts/ph-assets.mjs <site> <out>'); process.exit(2) }
fs.mkdirSync(outDir, { recursive: true })
const data = JSON.parse(fs.readFileSync(path.join(siteDir, 'gallery.json'), 'utf8'))
const by = Object.fromEntries(data.map((r) => [r.repo, r]))
const img = (slug) => pathToFileURL(path.join(siteDir, 'r', `${slug}.jpg`)).href
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

const css = `*{box-sizing:border-box}html,body{margin:0;width:1270px;height:760px;overflow:hidden;background:radial-gradient(120% 120% at 30% 40%,#1d1611,#090706);color:#f3e6d3;font:20px/1.45 ui-sans-serif,system-ui,-apple-system,sans-serif}
h1{font:600 52px/1.05 ui-serif,Georgia,'Iowan Old Style',serif;margin:0 0 14px}h2{font:600 34px/1.1 ui-serif,Georgia,serif;margin:0 0 10px}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.muted{color:#b9a893}.k{color:#e8c9a0}
.lg{display:flex;gap:18px;flex-wrap:wrap;font-size:17px;color:#d9cab6}.lg i{display:inline-block;width:14px;height:14px;border-radius:3px;margin-right:8px;vertical-align:-1px}`
const legend = `<div class="lg"><span><i style="background:${COLORS.trailer}"></i>AI co-author / assisted-by trailer</span><span><i style="background:${COLORS.agent}"></i>AI agent account</span><span><i style="background:${COLORS.bot}"></i>bot-named account</span><span><i style="background:#dcb07a"></i>no AI signal</span></div>`

const pages = {
  '1-hero': () => {
    const r = by['microsoft/vscode']
    return `<div style="display:flex;height:760px;align-items:center;padding:0 56px;gap:44px">
      <img src="${img(r.slug)}" style="width:640px;height:640px;border-radius:18px">
      <div style="flex:1"><h1>Tree rings for your codebase</h1>
      <p class="muted" style="margin:0 0 26px;font-size:22px">One ring per month since the first commit. Colour wherever the history discloses an AI co-author, an agent account or a bot. Disclosure is not usage.</p>
      ${r.lines.slice(0, 3).map((l, i) => `<p style="margin:0 0 10px;font-size:${i ? 19 : 21}px;${i ? 'color:#d9cab6' : 'font-weight:650'}">${esc(l)}</p>`).join('')}
      <p class="mono k" style="margin-top:28px;font-size:18px">npx skills add vnmoorthy/rings -g</p></div></div>`
  },
  '2-gallery': () => {
    const picks = ['oven-sh/bun', 'nodejs/node', 'denoland/deno', 'Aider-AI/aider', 'n8n-io/n8n', 'microsoft/TypeScript', 'tldraw/tldraw', 'sst/opencode'].filter((x) => by[x]).slice(0, 8)
    return `<div style="padding:24px 120px"><h2 style="margin-bottom:6px">Famous repos, cut open</h2><p class="muted" style="margin:0 0 14px;font-size:18px">Read from each project's public commit history. Hover any ring for its counts.</p>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px 16px">${picks.map((p) => `<div><img src="${img(by[p].slug)}" style="width:100%;border-radius:12px;display:block"><div class="mono" style="font-size:13px;margin-top:4px;color:#e9dccb">${esc(p)}</div></div>`).join('')}</div></div>`
  },
  '3-read': () => {
    const r = by['denoland/deno'] || data[0]
    return `<div style="display:flex;height:760px;align-items:center;padding:0 56px;gap:48px">
      <div style="flex:1"><h2>How to read a cut log</h2>
      <p>The <b>pith</b> is the first commit, the <b>bark</b> is today.</p>
      <p>Each <b>ring</b> is one month (week, day or commit for young repos). Wider ring, more commits.</p>
      <p>Coloured arcs show the share of that month's commits whose history <b>discloses</b> an AI co-author, an agent's own account, or a bot-named account.</p>
      <p class="muted">Uncoloured wood means no signal, never "written by a human". Disclosure is not usage.</p>
      <div style="margin-top:22px">${legend}</div></div>
      <img src="${img(r.slug)}" style="width:600px;height:600px;border-radius:18px"></div>`
  },
  '4-install': () => `<div style="display:flex;flex-direction:column;justify-content:center;height:760px;padding:0 90px">
      <h2>Ring your own repo in one line</h2><p class="muted" style="margin:0 0 26px">An open-source Agent Skill for Claude Code, Codex and OpenCode, and a plain CLI. Node built-ins only, no API keys, nothing uploaded.</p>
      <pre class="mono" style="background:#120c08;border:1px solid #3a2b1f;border-radius:16px;padding:26px 30px;font-size:21px;line-height:1.7;margin:0;color:#e9dccb"><span class="muted">$</span> <span class="k">npx skills add vnmoorthy/rings -g</span>
<span class="muted">› /rings</span>

<span class="muted">$</span> <span class="k">npx github:vnmoorthy/rings vercel/next.js</span>
<span class="muted">rings: cloning history only (no file contents)...</span>
vercel/next.js: ${by['vercel/next.js'] ? by['vercel/next.js'].commits.toLocaleString('en-US') : '36,000'} commits, ${by['vercel/next.js'] ? by['vercel/next.js'].rings : 120} rings (one per month)
  ${esc(by['vercel/next.js'] ? by['vercel/next.js'].lines[0] : '')}
<span class="muted">wrote vercel-next.js-rings.html</span></pre>
      <p class="muted" style="margin-top:22px">Gallery: <span class="k">vnmoorthy.github.io/rings</span> · Code: <span class="k">github.com/vnmoorthy/rings</span> · MIT</p></div>`,
}

const chrome = findChrome()
for (const [name, body] of Object.entries(pages)) {
  const html = path.join(outDir, `${name}.html`)
  fs.writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body()}</body></html>`)
  const png = path.join(outDir, `${name}.png`)
  spawnSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--allow-file-access-from-files', '--window-size=1270,760', `--screenshot=${png}`, pathToFileURL(html).href], { timeout: 60000 })
  console.log(fs.existsSync(png) ? `${png}` : `FAILED ${name}`)
}
