// Turning a commit list into growth rings.
import { classifyCommit, CLASSES, agentLabel } from './classify.mjs'

const DAY = 86400
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Ring size adapts to the repo's age so a young repo still gets visible rings.
export function chooseUnit(firstT, lastT, ringCap = 360) {
  const span = Math.max(0, lastT - firstT)
  if (span > 2 * 365 * DAY) return span / (30.44 * DAY) > ringCap ? 'quarter' : 'month'
  if (span > 90 * DAY) return 'week'
  if (span > 7 * DAY) return 'day'
  return 'commit'
}

// Period key and label for a unix time in UTC.
function periodOf(t, unit) {
  const d = new Date(t * 1000)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth()
  if (unit === 'quarter') { const q = Math.floor(m / 3); return { key: y * 4 + q, start: Date.UTC(y, q * 3, 1) / 1000 } }
  if (unit === 'month') return { key: y * 12 + m, start: Date.UTC(y, m, 1) / 1000 }
  if (unit === 'week') {
    const day0 = Math.floor(t / DAY)
    const monday = day0 - ((new Date(day0 * DAY * 1000).getUTCDay() + 6) % 7)
    return { key: monday, start: monday * DAY }
  }
  const day0 = Math.floor(t / DAY)
  return { key: day0, start: day0 * DAY }
}

function nextStart(start, unit) {
  const d = new Date(start * 1000)
  if (unit === 'quarter') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1) / 1000
  if (unit === 'month') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000
  if (unit === 'week') return start + 7 * DAY
  return start + DAY
}

export function formatPeriod(start, unit) {
  const d = new Date(start * 1000)
  const y = d.getUTCFullYear()
  const mon = MONTHS[d.getUTCMonth()]
  if (unit === 'quarter') return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${y}`
  if (unit === 'month') return `${mon} ${y}`
  return `${d.getUTCDate()} ${mon} ${y}`
}

function emptyRing(start, label) {
  const counts = Object.fromEntries(CLASSES.map((c) => [c, 0]))
  return { start, label, n: 0, counts, agents: {}, botNames: {}, sample: {}, via: {} }
}

// Main entry: commits (oldest first) -> ring model.
export function buildRings(commits, { unit = 'auto', bots = [], humans = [], inSession = null, ringCap = 360 } = {}) {
  if (!commits.length) throw new Error('No commits found on this branch.')
  const firstT = commits[0].t
  const lastT = commits[commits.length - 1].t
  const u = unit === 'auto' ? chooseUnit(firstT, lastT, ringCap) : unit
  const rings = []

  if (u === 'commit') {
    for (const c of commits) {
      const r = emptyRing(c.t, formatPeriod(c.t, 'day'))
      addCommit(r, c, { bots, humans, inSession })
      rings.push(r)
    }
  } else {
    const byKey = new Map()
    let p = periodOf(firstT, u)
    const lastKey = periodOf(lastT, u).key
    // contiguous periods, including empty (dormant) ones
    for (let guard = 0; guard < 100000; guard++) {
      const r = emptyRing(p.start, formatPeriod(p.start, u))
      rings.push(r)
      byKey.set(p.key, r)
      if (p.key >= lastKey) break
      p = periodOf(nextStart(p.start, u) + 1, u)
    }
    for (const c of commits) addCommit(byKey.get(periodOf(c.t, u).key), c, { bots, humans, inSession })
  }

  const totals = Object.fromEntries(CLASSES.map((c) => [c, 0]))
  const agentTotals = {}
  const botTotals = {}
  for (const r of rings) {
    for (const c of CLASSES) totals[c] += r.counts[c]
    for (const [a, k] of Object.entries(r.agents)) agentTotals[a] = (agentTotals[a] || 0) + k
    for (const [b, k] of Object.entries(r.botNames)) botTotals[b] = (botTotals[b] || 0) + k
  }
  if (u !== 'commit') {
    const last = rings[rings.length - 1]
    last.partial = nextStart(last.start, u) > (Date.now() / 1000)
  }
  assignWidths(rings)
  return { unit: u, firstT, lastT, total: commits.length, rings, totals, agentTotals, botTotals }
}

function addCommit(r, c, opts) {
  const { cls, agent, via } = classifyCommit(c, opts)
  if (via) r.via[via] = (r.via[via] || 0) + 1
  r.n++
  r.counts[cls]++
  if (agent) r.agents[agent] = (r.agents[agent] || 0) + 1
  if (cls === 'bot' || cls === 'agent') r.botNames[c.name] = (r.botNames[c.name] || 0) + 1
  if (cls !== 'none' && !r.sample[cls]) r.sample[cls] = c.hash.slice(0, 10)
}

// Ring width is the square root of the commit count, capped so one burst cannot flatten
// the rest; empty periods still get a thin dormant line. Widths are relative (sum = 1).
export function assignWidths(rings) {
  const s = rings.map((r) => Math.sqrt(r.n))
  const nz = s.filter((x) => x > 0).sort((a, b) => a - b)
  const med = nz.length ? nz[Math.floor(nz.length / 2)] : 1
  const cap = 2.5 * med
  const w = s.map((x) => (x === 0 ? 0.18 * med : Math.min(Math.max(x, 0.35 * med), cap)))
  const sum = w.reduce((a, b) => a + b, 0) || 1
  rings.forEach((r, i) => { r.w = w[i] / sum })
  return rings
}

const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0)

// Neutral, checkable facts for captions. Every sentence states a count from the history.
export function facts(model, { minN = 0 } = {}) {
  const { rings, totals, total, unit } = model
  const unitWord = { month: 'month', quarter: 'quarter', week: 'week', day: 'day', commit: 'commit' }[unit]
  const floor = minN || Math.max(10, Math.round(0.25 * median(rings.filter((r) => r.n).map((r) => r.n))))
  const solid = rings.filter((r) => r.n >= floor)
  const share = (r, c) => (r.n ? r.counts[c] / r.n : 0)
  const peak = (c) => solid.reduce((best, r) => (share(r, c) > (best ? share(best, c) : 0) ? r : best), null)
  const first = (c) => rings.find((r) => r.counts[c] > 0) || null
  const busiest = rings.reduce((a, b) => (b.n > a.n ? b : a), rings[0])
  const recent = [...rings].reverse().find((r) => r.n >= floor && !r.partial) || rings[rings.length - 1]

  const out = {
    unit: unitWord,
    ringCount: rings.length,
    total,
    shares: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, pct(v, total)])),
    firstTrailer: first('trailer'),
    firstAgent: first('agent'),
    firstBot: first('bot'),
    peakTrailer: peak('trailer'),
    peakAgent: peak('agent'),
    peakBot: peak('bot'),
    busiest,
    recent,
    floor,
  }
  out.lines = captionLines(model, out)
  out.headline = out.lines[0]
  return out
}

function median(xs) {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

function topAgents(r, k = 2) {
  return Object.entries(r.agents).sort((a, b) => b[1] - a[1]).slice(0, k).map(([a]) => agentLabel(a))
}

function captionLines(model, f) {
  const lines = []
  const L = (r) => r.label + (r.partial ? ' (so far)' : '')
  const { total } = model
  const s = (r, c) => pct(r.counts[c], r.n)
  const anyAI = model.totals.trailer + model.totals.agent > 0

  if (f.peakTrailer && s(f.peakTrailer, 'trailer') >= 5) {
    const r = f.peakTrailer
    const who = topAgents(r).join(' and ')
    const via = Object.entries(r.via).sort((a, b) => b[1] - a[1])[0]?.[0]
    lines.push(via === 'assisted'
      ? `Assisted-by trailers naming ${who || 'an AI tool'} peaked at ${s(r, 'trailer')}% of commits in ${L(r)}.`
      : via === 'author'
        ? `${who || 'AI'}-marked authors peaked at ${s(r, 'trailer')}% of commits in ${L(r)}.`
        : `${who ? who + ' co-author' : 'AI co-author'} trailers peaked at ${s(r, 'trailer')}% of commits in ${L(r)}.`)
    const rec = f.recent
    if (rec !== r && rec.start > r.start && s(rec, 'trailer') < s(r, 'trailer') / 2) lines.push(`By ${L(rec)}: ${s(rec, 'trailer')}% of ${rec.n.toLocaleString('en-US')} commits.`)
  } else if (model.totals.trailer > 0) {
    const r = f.firstTrailer
    lines.push(`${model.totals.trailer.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} commits carry an AI co-author or assisted-by trailer, the first in ${L(r)}.`)
  }
  if (f.peakAgent && s(f.peakAgent, 'agent') >= 5) {
    const r = f.peakAgent
    lines.push(`AI agent accounts authored ${s(r, 'agent')}% of commits in ${L(r)}.`)
  }
  if (f.peakBot && s(f.peakBot, 'bot') >= 25) {
    const r = f.peakBot
    const top = Object.entries(r.botNames).sort((a, b) => b[1] - a[1])[0]
    const one = top && top[1] / Math.max(1, r.counts.bot) > 0.8
    lines.push(one
      ? `One account, ${top[0]}, authored ${pct(top[1], r.n)}% of commits in ${L(r)}.`
      : `Bot-named accounts authored ${s(r, 'bot')}% of commits in ${L(r)}.`)
  }
  if (f.firstTrailer && f.firstTrailer === model.rings[0] && s(model.rings[0], 'trailer') >= 50) lines.unshift('AI co-authors from the first ring.')
  if (!lines.length) {
    lines.push(anyAI
      ? `${(model.totals.trailer + model.totals.agent).toLocaleString('en-US')} of ${total.toLocaleString('en-US')} commits disclose an AI agent.`
      : `No disclosed AI co-authors in ${total.toLocaleString('en-US')} commits.`)
  }
  if (f.busiest.n > 0) lines.push(`Busiest ${f.unit}: ${L(f.busiest)}, ${f.busiest.n.toLocaleString('en-US')} commits.`)
  return lines
}
