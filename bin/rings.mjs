#!/usr/bin/env node
// rings: tree rings for a Git repo, coloured by disclosed AI co-authors and bot accounts.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolveRepo, readCommits } from '../lib/git.mjs'
import { buildRings, facts } from '../lib/rings.mjs'
import { renderHTML } from '../lib/render.mjs'
import { sessionMatcher } from '../lib/sessions.mjs'
import { agentLabel } from '../lib/classify.mjs'

const HELP = `rings: tree rings for a Git repo, coloured by disclosed AI co-authors and bot accounts.

Usage
  rings [repo] [options]

  repo                 a local path (default: .), owner/name, or a GitHub URL.
                       Remote repos are cloned history-only (no file contents) into ~/.cache/rings.

Options
  -o, --out <file>     HTML file to write (default: ./<owner>-<name>-rings.html)
  --unit <u>           auto | month | quarter | week | day | commit (default: auto, by repo age)
  --ref <ref>          branch or ref to read (default: HEAD)
  --bots <a,b>         extra author names or emails to count as bot accounts
  --humans <a,b>       author names or emails that are never bot accounts
  --sessions           local repos only: mark commits made while a Claude Code or Codex
                       session was running in this repo (reads ~/.claude and ~/.codex locally)
  --json               print the summary as JSON
  --open               open the HTML when done
  --no-refresh         use the cached clone without fetching
  -h, --help           show this help

Nothing is uploaded. The page is one self-contained HTML file.`

function parseArgs(argv) {
  const o = { repo: '.', unit: 'auto', ref: 'HEAD', bots: [], humans: [], sessions: false, json: false, open: false, refresh: true, out: null }
  const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean)
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const val = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${a} needs a value`); return v }
    if (a === '-h' || a === '--help') o.help = true
    else if (a === '-o' || a === '--out') o.out = val()
    else if (a === '--unit') o.unit = val()
    else if (a === '--ref') o.ref = val()
    else if (a === '--bots') o.bots.push(...list(val()))
    else if (a === '--humans') o.humans.push(...list(val()))
    else if (a === '--sessions') o.sessions = true
    else if (a === '--json') o.json = true
    else if (a === '--open') o.open = true
    else if (a === '--no-refresh') o.refresh = false
    else if (a.startsWith('-')) throw new Error(`Unknown option ${a}`)
    else o.repo = a
  }
  if (!['auto', 'month', 'quarter', 'week', 'day', 'commit'].includes(o.unit)) throw new Error(`--unit must be auto, month, quarter, week, day or commit`)
  return o
}

function openFile(file) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', file] : [file]
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref() } catch { /* ignore */ }
}

export async function main(argv = process.argv.slice(2)) {
  let o
  try { o = parseArgs(argv) } catch (e) { console.error(`rings: ${e.message}\n\n${HELP}`); return 2 }
  if (o.help) { console.log(HELP); return 0 }
  const log = (m) => { if (!o.json) console.error(`rings: ${m}`) }
  const warn = (m) => console.error(`rings: warning: ${m}`)
  const repo = resolveRepo(o.repo, { refresh: o.refresh, log })
  for (const w of repo.warnings || []) warn(w)
  log(`reading history of ${repo.label}...`)
  const commits = readCommits(repo.dir, { ref: o.ref })
  let inSession = null, sessionNote = null
  if (o.sessions) {
    if (!repo.local) log('--sessions only applies to local repos; ignoring it')
    else { const m = sessionMatcher(repo.dir); inSession = m.inSession; sessionNote = m.note; log(m.note) }
  }
  const model = buildRings(commits, { unit: o.unit, bots: o.bots, humans: o.humans, inSession })
  const f = facts(model)
  const html = renderHTML(model, f, { label: repo.label, remoteUrl: repo.remoteUrl })
  const out = path.resolve(o.out || `${repo.label.replace(/[^\w.-]+/g, '-')}-rings.html`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, html)

  const notable = []
  // one sample commit hash per entry, matching its kind, so an agent can cite it (git show <hash> --stat)
  const add = (kind, r, cls, extra) => { if (r && !notable.some((x) => x.ring === r.label && x.kind === kind)) notable.push({ kind, ring: r.label, commits: r.n, ...extra, sample: (cls ? r.sample[cls] : r.sample.any) || null }) }
  add('first AI trailer', f.firstTrailer, 'trailer', { agents: f.firstTrailer && Object.keys(f.firstTrailer.trailerAgents).map(agentLabel) })
  add('peak AI trailers', f.peakTrailer, 'trailer', { share: f.peakTrailer && Math.round((100 * f.peakTrailer.counts.trailer) / f.peakTrailer.n) })
  add('first AI agent account', f.firstAgent, 'agent', {})
  add('peak bot-named accounts', f.peakBot, 'bot', { share: f.peakBot && Math.round((100 * f.peakBot.counts.bot) / f.peakBot.n), accounts: f.peakBot && Object.entries(f.peakBot.botNames).sort((a, b) => b[1] - a[1]).slice(0, 3) })
  add('busiest ring', f.busiest, null, {})

  const summary = {
    repo: repo.label, out, unit: model.unit, rings: model.rings.length, commits: model.total,
    first: new Date(model.firstT * 1000).toISOString().slice(0, 10), last: new Date(model.lastT * 1000).toISOString().slice(0, 10),
    shares: f.shares, agents: Object.fromEntries(Object.entries(model.agentTotals).map(([k, v]) => [agentLabel(k), v])),
    topBotAccounts: Object.entries(model.botTotals).sort((a, b) => b[1] - a[1]).slice(0, 5),
    caption: f.lines, notable, sessions: sessionNote, setAside: model.outliers, warnings: repo.warnings || [], shallow: !!repo.shallow,
  }
  if (o.json) console.log(JSON.stringify(summary, null, 2))
  else {
    console.log(`\n${repo.label}: ${model.total.toLocaleString('en-US')} commits, ${model.rings.length} rings (one per ${model.unit})`)
    for (const l of f.lines) console.log(`  ${l}`)
    if (model.outliers.length) console.log(`  (${model.outliers.length} commit${model.outliers.length > 1 ? 's' : ''} with out-of-range dates set aside: ${model.outliers.slice(0, 3).map((o) => `${o.hash} ${o.date}`).join(', ')}${model.outliers.length > 3 ? ' ...' : ''})`)
    console.log(`\nwrote ${out}`)
  }
  if (o.open) openFile(out)
  return 0
}

// run when executed directly, including through npm's symlinked bins (rings, repo-rings)
const isMain = (() => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)) } catch { return false } })()
if (isMain) {
  main().then((code) => process.exit(code), (e) => { console.error(`rings: ${e.message}`); process.exit(1) })
}
