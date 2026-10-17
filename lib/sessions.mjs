// Local-only: find when Claude Code or Codex sessions were running inside a repo,
// so commits made during them can be marked "during an agent session".
// Reads only the first and last few KB of each transcript (cwd + timestamps). Nothing leaves the machine.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const SLACK = 10 * 60 // seconds before/after a session that still count

// the last line of a long transcript can exceed the tail window; the file's mtime bounds the session end
function mtimeOf(file) { try { return fs.statSync(file).mtimeMs / 1000 } catch { return -Infinity } }

const real = (p) => { try { return fs.realpathSync.native(p) } catch { return p } }

function readEdges(file, bytes = 65536) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size
    const head = Buffer.alloc(Math.min(bytes, size))
    fs.readSync(fd, head, 0, head.length, 0)
    const tailLen = Math.min(bytes, size)
    const tail = Buffer.alloc(tailLen)
    fs.readSync(fd, tail, 0, tailLen, size - tailLen)
    return [head.toString('utf8'), tail.toString('utf8')]
  } catch { return ['', ''] } finally { if (fd !== undefined) try { fs.closeSync(fd) } catch { /* ignore */ } }
}

function linesOf(text) {
  const out = []
  for (const line of text.split('\n')) { const s = line.trim(); if (!s.startsWith('{')) continue; try { out.push(JSON.parse(s)) } catch { /* partial line */ } }
  return out
}

function walk(dir, pred, acc = [], depth = 0) {
  if (depth > 6) return acc
  let ents = []
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return acc }
  for (const e of ents) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'subagents') walk(p, pred, acc, depth + 1) } else if (pred(p)) acc.push(p)
  }
  return acc
}

function span(objs, cwdOf, tsOf) {
  let cwd = null, t0 = Infinity, t1 = -Infinity
  for (const o of objs) {
    if (!cwd) cwd = cwdOf(o)
    const ts = tsOf(o)
    if (ts) { const t = Date.parse(ts) / 1000; if (Number.isFinite(t)) { t0 = Math.min(t0, t); t1 = Math.max(t1, t) } }
  }
  return cwd && Number.isFinite(t0) ? { cwd, t0, t1 } : null
}

export function findSessions({ home = os.homedir() } = {}) {
  const sessions = []
  const claudeDir = path.join(home, '.claude', 'projects')
  for (const f of walk(claudeDir, (p) => p.endsWith('.jsonl'))) {
    const [h, t] = readEdges(f)
    const s = span([...linesOf(h), ...linesOf(t)], (o) => (o.isSidechain ? null : o.cwd), (o) => o.timestamp)
    if (s) sessions.push({ ...s, t1: Math.max(s.t1, mtimeOf(f)), tool: 'claude' })
  }
  const codexDir = path.join(home, '.codex', 'sessions')
  for (const f of walk(codexDir, (p) => /rollout-.*\.jsonl$/.test(p))) {
    const [h, t] = readEdges(f)
    const s = span([...linesOf(h), ...linesOf(t)], (o) => o.payload?.cwd || o.cwd, (o) => o.timestamp)
    if (s) sessions.push({ ...s, t1: Math.max(s.t1, mtimeOf(f)), tool: 'codex' })
  }
  return sessions
}

function inside(child, parent) {
  const rel = path.relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

export function sessionMatcher(repoDir, opts = {}) {
  const root = real(repoDir)
  const all = findSessions(opts)
  const mine = all.filter((s) => inside(real(s.cwd), root))
    .map((s) => [s.t0 - SLACK, s.t1 + SLACK]).sort((a, b) => a[0] - b[0])
  const oldest = mine.length ? new Date(mine[0][0] * 1000).toISOString().slice(0, 10) : null
  const note = mine.length
    ? `found ${mine.length} local agent sessions in this repo since ${oldest}; transcripts older than your tools' retention are not on disk, so earlier rings show no session signal`
    : 'found no local Claude Code or Codex sessions for this repo'
  return {
    count: mine.length,
    note,
    inSession: (t) => { for (const [a, b] of mine) { if (t < a) return false; if (t <= b) return true } return false },
  }
}
