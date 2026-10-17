#!/usr/bin/env node
// Builds the public gallery: one page, square PNG and social card per repo, plus an index.
// Usage: node scripts/gallery.mjs [gallery/repos.txt] [--site site] [--base https://vnmoorthy.github.io/rings]
import fs from 'node:fs'
import path from 'node:path'
import { resolveRepo, readCommits } from '../lib/git.mjs'
import { buildRings, facts } from '../lib/rings.mjs'
import { renderHTML, COLORS } from '../lib/render.mjs'
import { shot } from './shot.mjs'
import { spawnSync } from 'node:child_process'

// PNG -> JPEG with ffmpeg when available (keeps the site small); otherwise keep the PNG.
function toJpeg(png, width) {
  const jpg = png.replace(/\.png$/, '.jpg')
  const vf = width ? ['-vf', `scale=${width}:-1:flags=lanczos`] : []
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, ...vf, '-q:v', '3', jpg])
  if (r.status === 0 && fs.existsSync(jpg)) fs.rmSync(png)
  else fs.copyFileSync(png, jpg)
}

const args = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const listFile = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--')) || 'gallery/repos.txt'
const site = path.resolve(flag('--site', 'site'))
const base = flag('--base', 'https://vnmoorthy.github.io/rings').replace(/\/$/, '')
const only = flag('--only', null)
const skipShots = args.includes('--no-shots')

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const lines = fs.readFileSync(listFile, 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean)
const entries = lines.map((l) => { const [repo, ...opts] = l.split(/\s+/); const o = {}; for (const x of opts) { const [k, v] = x.split('='); o[k] = v } return { repo, bots: (o.bots || '').split(',').filter(Boolean), humans: (o.humans || '').split(',').filter(Boolean) } })
fs.mkdirSync(path.join(site, 'r'), { recursive: true })

const results = []
for (const e of entries) {
  if (only && !only.split(',').includes(e.repo)) continue
  const slug = e.repo.replace('/', '--')
  try {
    const t0 = Date.now()
    const repo = resolveRepo(e.repo, { log: (m) => console.error(`  ${m}`) })
    const commits = readCommits(repo.dir)
    const model = buildRings(commits, { bots: e.bots, humans: e.humans })
    const f = facts(model)
    const html = renderHTML(model, f, { label: repo.label, remoteUrl: repo.remoteUrl, backLink: '../', ogImage: `${base}/r/${slug}-card.jpg`, pageUrl: `${base}/r/${slug}.html` })
    const file = path.join(site, 'r', `${slug}.html`)
    fs.writeFileSync(file, html)
    if (!skipShots) {
      const sq = path.join(site, 'r', `${slug}.png`), cd = path.join(site, 'r', `${slug}-card.png`)
      shot(file, sq, { view: 'square' })
      shot(file, cd, { view: 'card' })
      toJpeg(sq, 720); toJpeg(cd, null)
    }
    const r = { repo: repo.label, slug, commits: model.total, unit: model.unit, rings: model.rings.length, first: new Date(model.firstT * 1000).toISOString().slice(0, 10), shares: f.shares, lines: f.lines, agents: model.agentTotals, topBots: Object.entries(model.botTotals).sort((a, b) => b[1] - a[1]).slice(0, 3), ms: Date.now() - t0 }
    results.push(r)
    console.log(`${repo.label}: ${model.total} commits, ${f.lines[0]} (${r.ms} ms)`)
  } catch (err) {
    console.error(`${e.repo}: FAILED ${err.message}`)
    results.push({ repo: e.repo, slug, error: err.message })
  }
}

// merge with any earlier results so --only runs keep the rest of the gallery
const dataFile = path.join(site, 'gallery.json')
let prev = []
try { prev = JSON.parse(fs.readFileSync(dataFile, 'utf8')) } catch { /* first run */ }
const bySlug = new Map(prev.map((r) => [r.slug, r]))
for (const r of results) bySlug.set(r.slug, r)
const order = entries.map((e) => e.repo.replace('/', '--'))
const all = order.map((s) => bySlug.get(s)).filter((r) => r && !r.error)
fs.writeFileSync(dataFile, JSON.stringify(all, null, 1))
fs.writeFileSync(path.join(site, 'index.html'), indexHTML(all))
fs.writeFileSync(path.join(site, '.nojekyll'), '')
console.log(`\n${all.length} repos in ${site}/index.html`)

function indexHTML(rows) {
  const cards = rows.map((r) => `<a class="card" href="r/${r.slug}.html"><img src="r/${r.slug}.jpg" alt="Tree rings of ${esc(r.repo)}" loading="lazy" width="720" height="720"><div class="meta"><b>${esc(r.repo)}</b><span>${esc(r.lines[0])}</span></div></a>`).join('\n')
  const sw = (c, t) => `<span class="lg"><i style="background:${c}"></i>${t}</span>`
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rings · tree rings for Git repos</title>
<meta name="description" content="Famous repositories cut open like tree trunks: one ring per month, coloured where the history discloses AI co-authors, AI agent accounts or bot-named accounts.">
<meta property="og:title" content="Rings · tree rings for Git repos"><meta property="og:description" content="Famous codebases cut open like tree trunks, coloured where their commit history discloses AI co-authors, agent accounts or bots. Disclosure is not usage.">
<meta property="og:image" content="${base}/r/${rows[0] ? rows[0].slug : 'oven-sh--bun'}-card.jpg"><meta name="twitter:card" content="summary_large_image">
<style>
  :root { color-scheme: dark; --bg:#090706; --ink:#f3e6d3; --muted:#a8998a; }
  * { box-sizing:border-box } html,body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.55 ui-sans-serif,system-ui,-apple-system,sans-serif }
  header, section, footer { max-width:1180px; margin:0 auto; padding:0 16px }
  header { padding-top:56px; padding-bottom:12px }
  h1 { font:600 clamp(34px,5vw,56px)/1.05 ui-serif,Georgia,'Iowan Old Style',serif; margin:0 0 12px }
  .lede { color:#e2d3bf; font-size:clamp(16px,2vw,19px); max-width:760px; margin:0 0 18px }
  pre { background:#15100b; border:1px solid #33261b; border-radius:12px; padding:12px 14px; overflow:auto; font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; color:#e8c9a0; margin:0 0 10px; max-width:760px }
  .legend { display:flex; flex-wrap:wrap; gap:8px 18px; color:var(--muted); font-size:14px; margin:18px 0 0 }
  .lg i { display:inline-block; width:12px; height:12px; border-radius:3px; margin-right:7px; vertical-align:-1px }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:14px; padding-top:22px; padding-bottom:30px }
  .card { display:block; background:#120d09; border:1px solid #2a1f16; border-radius:14px; overflow:hidden; color:inherit; text-decoration:none; transition:border-color .15s, transform .15s }
  .card:hover { border-color:#7a5a3e; transform:translateY(-2px) }
  .card img { display:block; width:100%; height:auto; aspect-ratio:1; background:#0d0a07 }
  .meta { padding:10px 12px 13px; display:flex; flex-direction:column; gap:3px }
  .meta b { font-weight:650 } .meta span { color:var(--muted); font-size:13.5px; line-height:1.4 }
  h2 { font:600 22px/1.2 ui-serif,Georgia,serif; margin:28px 0 8px }
  .method p, .method li { color:#d8c9b5; max-width:820px } .method li { margin:4px 0 }
  a { color:#f0c38f }
  footer { color:var(--muted); font-size:13.5px; padding-top:20px; padding-bottom:48px }
</style></head>
<body>
<header>
  <h1>Rings</h1>
  <p class="lede">Famous codebases cut open like tree trunks. One ring per month since the first commit (one per week for repos under two years old), ring width from that period's commits, and colour where the history itself discloses an AI co-author, an AI agent's own account, or a bot-named account.</p>
  <pre>npx skills add vnmoorthy/rings -g     # then ask your agent: /rings</pre>
  <pre>npx github:vnmoorthy/rings .          # or any owner/name</pre>
  <div class="legend">${sw(COLORS.trailer, 'AI co-author / assisted-by trailer')}${sw(COLORS.agent, 'AI agent account')}${sw(COLORS.bot, 'bot-named account')}${sw('#dcb07a', 'no AI signal (not "human-written")')}</div>
</header>
<section class="grid">
${cards}
</section>
<section class="method">
  <h2>How to read it</h2>
  <ul>
    <li><b>Disclosure is not usage.</b> Rings only sees what commits say. Many people use AI without a trailer, and a trailer can be added or removed by settings. A ring with no colour means no signal, never "written by a human".</li>
    <li><b>AI co-author / assisted-by trailer:</b> a <code>Co-authored-by</code> line naming a coding agent by its own display name or no-reply address (for example <code>Claude &lt;noreply@anthropic.com&gt;</code>), or an <code>Assisted-by</code>, <code>AI-assisted</code> or <code>Generated with …</code> line naming a tool. Lines that GitHub squash merges push out of the trailer block are read too. Company email domains and people's full names (Claude Paroz, Devin Weaver) are not counted.</li>
    <li><b>AI agent account:</b> the commit author is an agent's own account, such as <code>copilot-swe-agent[bot]</code>, <code>devin-ai-integration[bot]</code> or <code>google-labs-jules[bot]</code>.</li>
    <li><b>Bot-named account:</b> an author whose name or address marks it as automation (<code>[bot]</code>, <code>*-bot</code>, <code>… Bot</code>, <code>github-actions</code>, <code>robobun@oven.sh</code> ...), plus routine chores (generated files, lockfiles, formatting) pushed by an agent's account. Rings does not know what runs behind such an account.</li>
    <li>Non-merge commits reachable from the default branch, grouped by author date in UTC. Ring width is the square root of the month's commits, capped at 2.5 times the median so one burst cannot flatten the rest.</li>
    <li>Maintainers: if you would like your repo removed or a bot list corrected, <a href="https://github.com/vnmoorthy/rings/issues">open an issue</a> and it will be done.</li>
  </ul>
</section>
<footer>Built with <a href="https://github.com/vnmoorthy/rings">rings</a>, MIT. Data read from public commit history on ${new Date().toISOString().slice(0, 10)}.</footer>
</body></html>`
}
