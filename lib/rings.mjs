// Turning a commit list into growth rings.
import { classifyCommit, aiDisclosure, isAgentAccount, CLASSES, agentLabel } from './classify.mjs'

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
  if (unit === 'week') return `week of ${d.getUTCDate()} ${mon} ${y}`
  return `${d.getUTCDate()} ${mon} ${y}`
}

function emptyRing(start, label) {
  const counts = Object.fromEntries(CLASSES.map((c) => [c, 0]))
  return { start, label, n: 0, counts, agents: {}, trailerAgents: {}, botNames: {}, sample: {}, via: {}, ai: 0 }
}

// Main entry: commits (oldest first) -> ring model.
// Commits with impossible or isolated dates (a wrong system clock: 1970, 2001, 2048 ...) would
// stretch the log by decades of empty rings. Set aside commits dated in the future, and runs of
// early or late commits that are under 1% of the history and more than a year from the rest.
export function splitOutliers(sorted, { now = Date.now() / 1000, gap = 365 * DAY, share = 0.01 } = {}) {
  const ai = (c) => isAgentAccount(c.name, c.email) || !!aiDisclosure(c)
  // a wrong clock shows up as an author date far from the committer date
  const clockError = (c) => c.t <= 0 || (Number.isFinite(c.ct) && c.ct > 0 && Math.abs(c.ct - c.t) > gap)
  const list = sorted.filter((c) => c.t <= now + DAY || ai(c))
  const future = sorted.filter((c) => c.t > now + DAY && !ai(c))
  const limit = list.length >= 100 ? Math.max(1, Math.floor(list.length * share)) : 0 // small histories are left alone
  let lo = 0
  for (let i = 0; i < Math.min(limit, list.length - 1); i++) if (list[i + 1].t - list[i].t > gap) lo = i + 1
  let hi = list.length
  for (let i = list.length - 1; limit && i > Math.max(0, list.length - 1 - limit); i--) if (list[i].t - list[i - 1].t > gap) hi = i
  const edge = [...list.slice(0, lo), ...list.slice(hi)]
  const drop = new Set(edge.filter((c) => clockError(c) && !ai(c)))
  const kept = list.filter((c) => !drop.has(c))
  return { kept, outliers: [...drop, ...future] }
}

export function buildRings(allCommits, { unit = 'auto', bots = [], humans = [], inSession = null, ringCap = 360, now } = {}) {
  if (!allCommits.length) throw new Error('No commits found on this branch.')
  const { kept: commits, outliers } = splitOutliers([...allCommits].sort((a, b) => a.t - b.t), now ? { now } : {})
  if (!commits.length) throw new Error('No commits with usable dates found on this branch.')
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
  let aiTotal = 0
  const agentTotals = {}
  const botTotals = {}
  for (const r of rings) {
    for (const c of CLASSES) totals[c] += r.counts[c]
    aiTotal += r.ai
    for (const [a, k] of Object.entries(r.agents)) agentTotals[a] = (agentTotals[a] || 0) + k
    for (const [b, k] of Object.entries(r.botNames)) botTotals[b] = (botTotals[b] || 0) + k
  }
  if (u !== 'commit') {
    const last = rings[rings.length - 1]
    last.partial = nextStart(last.start, u) > (Date.now() / 1000)
  }
  assignWidths(rings)
  return { unit: u, firstT, lastT, total: commits.length, rings, totals, aiTotal, agentTotals, botTotals, outliers: outliers.map((c) => ({ hash: c.hash.slice(0, 10), date: new Date(c.t * 1000).toISOString().slice(0, 10), name: c.name })) }
}

function addCommit(r, c, opts) {
  const { cls, agent, via } = classifyCommit(c, opts)
  if (via) r.via[via] = (r.via[via] || 0) + 1
  r.n++
  r.counts[cls]++
  if (agent) r.agents[agent] = (r.agents[agent] || 0) + 1
  if (cls === 'trailer' && agent) r.trailerAgents[agent] = (r.trailerAgents[agent] || 0) + 1
  if (cls === 'trailer' || cls === 'agent' || aiDisclosure(c)) r.ai++
  if (cls === 'bot' || cls === 'agent') r.botNames[c.name] = (r.botNames[c.name] || 0) + 1
  if (cls !== 'none' && !r.sample[cls]) r.sample[cls] = c.hash.slice(0, 10)
  if (!r.sample.any) r.sample.any = c.hash.slice(0, 10)
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

const num = (n) => n.toLocaleString('en-US')
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`

// Tools named in a ring's trailer line: the top tool, plus a second only if it carries 20%+ of the trailers.
function trailerTools(r) {
  const e = Object.entries(r.trailerAgents).filter(([a]) => a !== 'ai').sort((a, b) => b[1] - a[1])
  const total = Object.values(r.trailerAgents).reduce((a, b) => a + b, 0) || 1
  return e.filter(([, k], i) => i === 0 || (i === 1 && k / total >= 0.2)).slice(0, 2).map(([a]) => agentLabel(a))
}

function captionLines(model, f) {
  const lines = []
  const unit = model.unit
  const at = (r, partial = true) => `${unit === 'day' || unit === 'commit' ? 'on' : 'in'} ${unit === 'week' ? 'the ' : ''}${r.label}${partial && r.partial ? ' (so far)' : ''}`
  const { total } = model
  const s = (r, c) => pct(r.counts[c], r.n)

  if (f.peakTrailer && s(f.peakTrailer, 'trailer') >= 5) {
    const r = f.peakTrailer
    const who = trailerTools(r).join(' and ')
    const via = Object.entries(r.via).sort((a, b) => b[1] - a[1])[0]?.[0]
    const share = `${s(r, 'trailer')}% of commits ${at(r)}`
    lines.push(via === 'author' ? `${who || 'AI'}-marked authors peaked at ${share}.`
      : via === 'assisted' || via === 'generated' ? (who ? `AI disclosures naming ${who} peaked at ${share}.` : `"AI-assisted" disclosures peaked at ${share}.`)
        : `${who ? who + ' co-author' : 'AI co-author'} trailers peaked at ${share}.`)
  } else if (model.aiTotal > 0) {
    const r = model.rings.find((x) => x.ai > 0)
    lines.push(`${num(model.aiTotal)} of ${plural(total, 'commit', 'commits')} ${model.aiTotal === 1 ? 'discloses' : 'disclose'} AI (a trailer or an agent account), the first ${at(r, false)}.`)
  }
  if (f.peakAgent && s(f.peakAgent, 'agent') >= 5) {
    const r = f.peakAgent
    lines.push(`AI agent accounts authored ${s(r, 'agent')}% of commits ${at(r)}.`)
  }
  if (f.peakBot && s(f.peakBot, 'bot') >= 25) {
    const r = f.peakBot
    const top = Object.entries(r.botNames).sort((a, b) => b[1] - a[1])[0]
    const one = top && top[1] / Math.max(1, r.counts.bot) > 0.8
    lines.push(one
      ? `One account, ${top[0]}, authored ${pct(top[1], r.n)}% of commits ${at(r)}.`
      : `Bot-named accounts authored ${s(r, 'bot')}% of commits ${at(r)}.`)
  }
  if (f.firstTrailer && f.firstTrailer === model.rings[0] && s(model.rings[0], 'trailer') >= 50) lines.unshift('AI disclosed from the first ring.')
  if (!lines.length) lines.push(`No disclosed AI in ${plural(total, 'commit', 'commits')}.`)
  if (f.busiest.n > 1 && unit !== 'commit') lines.push(`Busiest ${f.unit}: ${unit === 'week' ? 'the ' : ''}${f.busiest.label}${f.busiest.partial ? ' (so far)' : ''}, ${plural(f.busiest.n, 'commit', 'commits')}.`)
  return lines
}
