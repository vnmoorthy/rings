// Drawing a ring model as a cut log: one self-contained HTML page with inline SVG.
import { CLASS_LABELS, agentLabel } from './classify.mjs'

export const COLORS = { trailer: '#ff7a2f', agent: '#a07cff', bot: '#1fb7a5', session: '#8fd14f' }
const STAIN_ORDER = ['trailer', 'agent', 'bot', 'session']
const TAU = Math.PI * 2

// ---------- deterministic randomness ----------
function hashStr(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Shape parameters for one log. Shared by Node and the page (serialised into the HTML).
export function shapeParams(seedText) {
  const rnd = mulberry32(hashStr(seedText || 'rings'))
  const S = [0.03, 0.02, 0.011, 0.007, 0.005].map((a, k) => ({ k: k + 1, a: a * (0.6 + 0.8 * rnd()), p: rnd() * TAU }))
  const Q = [3, 4, 5, 6, 7, 9, 11].map((k) => ({ k, a: 0.0055 / Math.sqrt(k), p: rnd() * TAU, c: (rnd() - 0.5) * 9 }))
  const B = Array.from({ length: 14 }, (_, i) => ({ k: 17 + i * 5 + Math.floor(rnd() * 4), a: 0.18 + 0.4 * rnd(), p: rnd() * TAU }))
  const cracks = Array.from({ length: 2 + Math.floor(rnd() * 3) }, () => ({ th: 0.45 + rnd() * (TAU - 0.9), depth: 0.42 + rnd() * 0.33, w: 2.5 + rnd() * 3.5, seed: rnd() }))
  return { S, Q, B, cracks, seed: hashStr(seedText || 'rings') }
}

// Radius of the boundary with base radius rho at angle th (clockwise from 12 o'clock).
// R is the wood radius. Kept free of closures so it can be serialised into the page.
export function wobble(th, rho, R, P) {
  let s = 0
  for (const h of P.S) s += h.a * Math.sin(h.k * th + h.p)
  let q = 0
  const f = rho / R
  for (const h of P.Q) q += h.a * Math.sin(h.k * th + h.p + h.c * f)
  const g = Math.min(1, f / 0.35)
  return rho * (1 + g * s + g * q)
}

function pt(cx, cy, r, th) { return [cx + r * Math.sin(th), cy - r * Math.cos(th)] }
const f1 = (n) => (Math.round(n * 10) / 10).toString()

// Catmull-Rom spline through points, as cubic Bezier path data.
function spline(pts, closed) {
  const n = pts.length
  if (n < 2) return ''
  const get = (i) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))])
  let d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`
  const last = closed ? n : n - 1
  for (let i = 0; i < last; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2)
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += `C${f1(c1[0])} ${f1(c1[1])} ${f1(c2[0])} ${f1(c2[1])} ${f1(p2[0])} ${f1(p2[1])}`
  }
  return closed ? d + 'Z' : d
}

function samplesFor(r) { return Math.max(40, Math.min(150, Math.round(r / 3.2))) }

function boundaryPts(cx, cy, rho, R, P, n = samplesFor(rho)) {
  const out = []
  for (let i = 0; i < n; i++) { const th = (i / n) * TAU; out.push(pt(cx, cy, wobble(th, rho, R, P), th)) }
  return out
}

function arcPts(cx, cy, rho, R, P, a0, a1) {
  const steps = Math.max(2, Math.ceil(((a1 - a0) / TAU) * samplesFor(rho) * 1.5))
  const out = []
  for (let i = 0; i <= steps; i++) { const th = a0 + ((a1 - a0) * i) / steps; out.push(pt(cx, cy, wobble(th, rho, R, P), th)) }
  return out
}

function sectorPath(cx, cy, r0, r1, R, P, a0, a1) {
  const outer = arcPts(cx, cy, r1, R, P, a0, a1)
  const inner = r0 > 0.5 ? arcPts(cx, cy, r0, R, P, a0, a1).reverse() : [[cx, cy]]
  const o = spline(outer, false)
  const i = inner.length > 1 ? spline(inner, false).replace(/^M/, 'L') : `L${f1(cx)} ${f1(cy)}`
  return `${o}${i}Z`
}

function mix(a, b, t) {
  const pa = a.match(/\w\w/g).map((h) => parseInt(h, 16))
  const pb = b.match(/\w\w/g).map((h) => parseInt(h, 16))
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('')
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// Geometry of the log (base radii of every ring boundary).
export function layoutLog(model, R) {
  const pith = Math.max(3, R * 0.012)
  const radii = [pith]
  let acc = pith
  for (const r of model.rings) { acc += r.w * (R - pith); radii.push(acc) }
  return { pith, radii }
}

// The log alone, centred at (cx, cy) with wood radius R. Returns SVG markup.
export function logSVG(model, P, { cx, cy, R, id = 'log', animate = false, ticks = true }) {
  const { radii, pith } = layoutLog(model, R)
  const n = model.rings.length
  const barkW = Math.max(7, R * 0.045)
  const parts = []

  // bark
  const bark = []
  const bn = 220
  for (let i = 0; i < bn; i++) {
    const th = (i / bn) * TAU
    let rough = 0
    for (const h of P.B) rough += (h.a / P.B.length) * Math.sin(h.k * th + h.p)
    bark.push(pt(cx, cy, wobble(th, R, R, P) + barkW * (0.9 + 0.55 * rough), th))
  }
  parts.push(`<path d="${spline(bark, true)}" fill="#3a2516" stroke="#1d120a" stroke-width="2"/>`)
  parts.push(`<path d="${spline(boundaryPts(cx, cy, R + barkW * 0.38, R, P), true)}" fill="none" stroke="#5a3a23" stroke-width="${f1(barkW * 0.35)}" stroke-dasharray="2 5 1 7" opacity=".7"/>`)
  parts.push(`<path d="${spline(boundaryPts(cx, cy, R + barkW * 0.1, R, P), true)}" fill="#a8743f"/>`)

  // wood discs, outermost first; each disc's colour shows as one ring
  const heart = '#b98352', mid = '#d6a872', sap = '#ecd2a6'
  for (let i = n; i >= 1; i--) {
    const ring = model.rings[i - 1]
    const f = radii[i] / R
    let col = f < 0.72 ? mix(heart, mid, Math.pow(f / 0.72, 1.4)) : mix(mid, sap, (f - 0.72) / 0.28)
    const jr = mulberry32(P.seed + i * 7919)()
    col = mix(col, jr < 0.5 ? '#9c6a3e' : '#f3dcb4', Math.abs(jr - 0.5) * 0.22)
    if (ring.n === 0) col = mix(col, '#8a5a34', 0.35)
    parts.push(`<path d="${spline(boundaryPts(cx, cy, radii[i], R, P), true)}" fill="${col}"/>`)
  }
  parts.push(`<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(pith * 1.8)}" fill="${heart}"/>`)

  // stains: one fan of coloured sectors per ring, clockwise from 12 o'clock
  const stains = []
  for (let i = 0; i < n; i++) {
    const ring = model.rings[i]
    if (!ring.n) continue
    let a = 0
    for (const c of STAIN_ORDER) {
      const k = ring.counts[c]
      if (!k) continue
      const span = (k / ring.n) * TAU
      stains.push(`<path class="st st-${c}" d="${sectorPath(cx, cy, radii[i], radii[i + 1], R, P, a, a + span)}" fill="${COLORS[c]}"/>`)
      a += span
    }
  }
  parts.push(`<g opacity=".9" style="mix-blend-mode:multiply">${stains.join('')}</g>`)
  parts.push(`<g opacity=".5">${stains.join('')}</g>`)

  // latewood lines
  const lines = []
  for (let i = 1; i <= n; i++) {
    const wpx = radii[i] - radii[i - 1]
    const sw = Math.max(0.45, Math.min(4.5, wpx * 0.34))
    const op = model.rings[i - 1].n === 0 ? 0.8 : 0.42 + 0.12 * Math.min(1, wpx / 8)
    lines.push(`<path d="${spline(boundaryPts(cx, cy, radii[i], R, P), true)}" stroke-width="${f1(sw)}" stroke-opacity="${op}"/>`)
  }
  parts.push(`<g fill="none" stroke="#7a4522">${lines.join('')}</g>`)

  // rays and grain
  const rays = []
  const rr = mulberry32(P.seed ^ 0x9e3779b9)
  for (let i = 0; i < 90; i++) {
    const th = rr() * TAU
    const r0 = R * (0.08 + 0.5 * rr()), r1 = Math.min(R, r0 + R * (0.1 + 0.4 * rr()))
    const [x0, y0] = pt(cx, cy, wobble(th, r0, R, P), th), [x1, y1] = pt(cx, cy, wobble(th, r1, R, P), th)
    rays.push(`M${f1(x0)} ${f1(y0)}L${f1(x1)} ${f1(y1)}`)
  }
  parts.push(`<path d="${rays.join('')}" stroke="#5b3518" stroke-width=".6" opacity=".18"/>`)
  parts.push(`<path d="${spline(boundaryPts(cx, cy, R, R, P), true)}" fill="#7a4a24" filter="url(#${id}-grain)" opacity=".5"/>`)

  // drying checks (cracks)
  for (const c of P.cracks) {
    const cr = mulberry32(Math.floor(c.seed * 1e9))
    const segs = 9
    const left = [], right = []
    for (let s = 0; s <= segs; s++) {
      const f = s / segs
      const rho = R * (1 - c.depth * f)
      const th = c.th + (cr() - 0.5) * 0.02
      const half = (c.w * (1 - f) ** 1.3) / 2 / Math.max(rho, 1)
      left.push(pt(cx, cy, wobble(th - half, rho, R, P), th - half))
      right.push(pt(cx, cy, wobble(th + half, rho, R, P), th + half))
    }
    const outer = pt(cx, cy, wobble(c.th, R + barkW * 0.6, R, P), c.th)
    const poly = [outer, ...left, ...right.reverse()]
    parts.push(`<path d="M${poly.map((p) => `${f1(p[0])} ${f1(p[1])}`).join('L')}Z" fill="#1c110a" opacity=".85"/>`)
  }
  parts.push(`<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(pith)}" fill="#4a2a14"/>`)

  // year ticks along the 9 o'clock radius
  if (ticks) parts.push(yearTicks(model, P, { cx, cy, R, radii }))

  const defs = `<defs>
    <filter id="${id}-grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9 .25" numOctaves="2" seed="${P.seed % 1000}"/><feColorMatrix values="0 0 0 0 .2  0 0 0 0 .1  0 0 0 0 .04  0 0 0 -1.6 1.05"/><feComposite in2="SourceGraphic" operator="in"/></filter>
    <clipPath id="${id}-grow"><circle id="${id}-grow-c" cx="${f1(cx)}" cy="${f1(cy)}" r="${animate ? 0 : f1(R * 1.2)}"/></clipPath>
  </defs>`
  return `${defs}<g id="${id}" clip-path="url(#${id}-grow)">${parts.join('\n')}</g>`
}

function yearTicks(model, P, { cx, cy, R, radii }) {
  const { rings, unit } = model
  if (unit === 'commit' || unit === 'day') return ''
  const th = (3 * TAU) / 4
  const marks = []
  for (let i = 1; i < rings.length; i++) {
    const d0 = new Date(rings[i - 1].start * 1000), d1 = new Date(rings[i].start * 1000)
    if (d1.getUTCFullYear() !== d0.getUTCFullYear()) marks.push({ i, year: d1.getUTCFullYear() })
  }
  const out = []
  let lastX = Infinity
  for (const m of marks.reverse()) { // outermost first so recent years always show
    const [x, y] = pt(cx, cy, wobble(th, radii[m.i], R, P), th)
    if (lastX !== Infinity && x - lastX < 46) continue
    if (x > cx - 30) continue
    lastX = x
    out.push(`<g><line x1="${f1(x)}" y1="${f1(y - 7)}" x2="${f1(x)}" y2="${f1(y + 7)}" stroke="#fff6e6" stroke-width="1.2" opacity=".85"/><rect x="${f1(x - 19)}" y="${f1(y + 9)}" width="38" height="16" rx="8" fill="#140d08" opacity=".72"/><text x="${f1(x)}" y="${f1(y + 21)}" text-anchor="middle" font-size="11" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" fill="#f5e7d2">${m.year}</text></g>`)
  }
  return out.join('')
}

function legendSVG(x, y, totals, { gap = 26, size = 13 } = {}) {
  const items = STAIN_ORDER.filter((c) => totals[c] > 0 || c === 'trailer' || c === 'bot')
  const out = []
  items.forEach((c, i) => {
    const yy = y + i * gap
    out.push(`<rect x="${x}" y="${yy - 10}" width="14" height="14" rx="3" fill="${COLORS[c]}"/><text x="${x + 22}" y="${yy + 1}" font-size="${size}" fill="#e9dccb" font-family="ui-sans-serif,system-ui,-apple-system,sans-serif">${esc(c === 'bot' ? 'bot-named account' : CLASS_LABELS[c])}</text>`)
  })
  const yy = y + items.length * gap
  out.push(`<rect x="${x}" y="${yy - 10}" width="14" height="14" rx="3" fill="#dcb07a"/><text x="${x + 22}" y="${yy + 1}" font-size="${size}" fill="#e9dccb" font-family="ui-sans-serif,system-ui,-apple-system,sans-serif">no AI signal (not "human-written")</text>`)
  return out.join('')
}

function fmtRange(model) {
  const a = new Date(model.firstT * 1000), b = new Date(model.lastT * 1000)
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${M[a.getUTCMonth()]} ${a.getUTCFullYear()} – ${M[b.getUTCMonth()]} ${b.getUTCFullYear()}`
}

const UNIT_PHRASE = { month: 'one ring per month', quarter: 'one ring per quarter', week: 'one ring per week', day: 'one ring per day', commit: 'one ring per commit' }

function captionSVG(lines, x, y, { size = 19, lh = 28, max = 62 } = {}) {
  return wrapLines(lines, max).slice(0, 4).map((l, i) => `<text x="${x}" y="${y + i * lh}" font-size="${l.first ? size + 1 : size}" font-weight="${l.first ? 650 : 400}" fill="${l.first ? '#fff4e4' : '#d9cab6'}" font-family="ui-sans-serif,system-ui,-apple-system,sans-serif">${esc(l.text)}</text>`).join('')
}

// Square composition (1080 x 1080): what the page shows and the PNG export uses.
export function squareSVG(model, f, P, { label, animate = false } = {}) {
  const W = 1080, H = 1080, cx = 540, cy = 548, R = 352
  const lines = f.lines.slice(0, 3)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" id="sq">
  <defs><radialGradient id="bgv" cx="50%" cy="52%" r="70%"><stop offset="0" stop-color="#1d1611"/><stop offset="1" stop-color="#090706"/></radialGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#bgv)"/>
  <text x="56" y="78" font-size="34" font-weight="600" fill="#fff4e4" font-family="ui-serif,Georgia,'Iowan Old Style',serif">${esc(label)}</text>
  <text x="56" y="110" font-size="16" fill="#b9a893" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">${model.total.toLocaleString('en-US')} commits · ${fmtRange(model)} · ${UNIT_PHRASE[model.unit]}</text>
  <text x="${W - 56}" y="78" text-anchor="end" font-size="15" fill="#8c7c69" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">rings</text>
  <text id="front" x="${W - 56}" y="110" text-anchor="end" font-size="16" fill="#e8c9a0" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" opacity="0"></text>
  ${logSVG(model, P, { cx, cy, R, id: 'sqlog', animate })}
  <g id="cap" opacity="${animate ? 0 : 1}">${captionSVG(lines, 56, 952, { max: 60 })}</g>
  <g id="leg" opacity="${animate ? 0 : 1}">${legendSVG(W - 330, 940, model.totals, { gap: 24 })}</g>
</svg>`
}

// Social card (1200 x 630).
export function cardSVG(model, f, P, { label } = {}) {
  const W = 1200, H = 630, cx = 318, cy = 318, R = 262
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" id="card">
  <defs><radialGradient id="bgc" cx="27%" cy="50%" r="80%"><stop offset="0" stop-color="#1d1611"/><stop offset="1" stop-color="#090706"/></radialGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#bgc)"/>
  ${logSVG(model, P, { cx, cy, R, id: 'cdlog', ticks: true })}
  <text x="640" y="104" font-size="40" font-weight="600" fill="#fff4e4" font-family="ui-serif,Georgia,'Iowan Old Style',serif">${esc(label)}</text>
  <text x="640" y="140" font-size="16" fill="#b9a893" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">${model.total.toLocaleString('en-US')} commits · ${fmtRange(model)}</text>
  ${wrapLines(f.lines.slice(0, 3), 46).map((l, i) => `<text x="640" y="${206 + i * 30}" font-size="${l.first ? 21 : 19}" font-weight="${l.first ? 650 : 400}" fill="${l.first ? '#fff4e4' : '#d9cab6'}" font-family="ui-sans-serif,system-ui,-apple-system,sans-serif">${esc(l.text)}</text>`).join('')}
  ${legendSVG(640, 470, model.totals, { gap: 24, size: 14 })}
  <text x="${W - 40}" y="${H - 28}" text-anchor="end" font-size="14" fill="#8c7c69" font-family="ui-monospace,SFMono-Regular,Menlo,monospace">rings · github.com/vnmoorthy/rings</text>
</svg>`
}

function wrapLines(lines, max) {
  const out = []
  lines.forEach((line, li) => {
    let cur = ''
    for (const w of line.split(' ')) {
      if ((cur + ' ' + w).trim().length > max) { out.push({ text: cur.trim(), first: li === 0 }); cur = w } else cur += ' ' + w
    }
    if (cur.trim()) out.push({ text: cur.trim(), first: li === 0 })
  })
  return out.slice(0, 7)
}

// Compact per-ring data for the page's hover readout.
function ringData(model) {
  return model.rings.map((r) => ({
    l: r.label, n: r.n, c: [r.counts.trailer, r.counts.agent, r.counts.bot, r.counts.session],
    a: Object.entries(r.agents).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([k, v]) => [agentLabel(k), v]),
    b: Object.entries(r.botNames).sort((x, y) => y[1] - x[1]).slice(0, 2),
    h: r.sample,
  }))
}

export function renderHTML(model, f, { label, remoteUrl = null, generatedAt = new Date().toISOString(), backLink = null, ogImage = null, pageUrl = null } = {}) {
  const P = shapeParams(label)
  const sq = squareSVG(model, f, P, { label, animate: true })
  const card = cardSVG(model, f, P, { label })
  const { radii } = layoutLog(model, 352)
  const data = { label, unit: model.unit, radii: radii.map((r) => Math.round(r * 100) / 100), rings: ringData(model), lines: f.lines, P, R: 352, cx: 540, cy: 548, remoteUrl }
  const title = `${label} · rings`
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(f.lines.join(' '))}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(f.lines[0] || '')}">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(ogImage)}">` : ''}${pageUrl ? `<link rel="canonical" href="${esc(pageUrl)}"><meta property="og:url" content="${esc(pageUrl)}">` : ''}
<style>
  :root { color-scheme: dark; --bg:#090706; --ink:#f3e6d3; --muted:#a8998a; --line:#2a211a; }
  * { box-sizing: border-box; }
  html, body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif; }
  main { min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:16px; gap:14px; }
  .stage { position:relative; width:min(92vw, calc(100vh - 120px), 1080px); aspect-ratio:1; }
  .stage svg { width:100%; height:100%; display:block; border-radius:14px; }
  .tip { position:absolute; pointer-events:none; background:#120c08ee; border:1px solid #4a3627; border-radius:10px; padding:8px 11px; font:12.5px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace; color:#f3e6d3; white-space:nowrap; transform:translate(14px,14px); display:none; z-index:2; }
  .tip b { font-weight:650; color:#fff; }
  .tip .sw { display:inline-block; width:9px; height:9px; border-radius:2px; margin-right:6px; vertical-align:-1px; }
  .bar { display:flex; gap:10px; flex-wrap:wrap; justify-content:center; align-items:center; color:var(--muted); font-size:13px; }
  button, a.btn { appearance:none; background:#1a130e; color:var(--ink); border:1px solid #3a2b1f; border-radius:999px; padding:7px 14px; font:inherit; font-size:13px; cursor:pointer; text-decoration:none; }
  button:hover, a.btn:hover { border-color:#7a5a3e; }
  code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; color:#e8c9a0; }
  .note { color:var(--muted); font-size:12.5px; max-width:780px; text-align:center; }
  body.export main { padding:0; gap:0; } body.export .bar, body.export .note { display:none; }
  body.export .stage { width:1080px; height:1080px; } body.export .stage svg { border-radius:0; }
  body.card .stage { width:1200px; height:630px; aspect-ratio:auto; }
</style></head>
<body><main>
  <div class="stage" id="stage">${sq}<div class="tip" id="tip"></div></div>
  <template id="cardtpl">${card}</template>
  <div class="bar">
    ${backLink ? `<a class="btn" href="${esc(backLink)}">← All repos</a>` : ''}
    <button id="replay">Replay</button>
    <button id="png">Download PNG</button>
    <button id="cardpng">Download social card</button>
    ${remoteUrl ? `<a class="btn" href="${esc(remoteUrl)}">${esc(label)} on GitHub</a>` : ''}
    <span>Ring your own repo: <code>npx skills add vnmoorthy/rings -g</code></span>
  </div>
  <p class="note">Colours show what the commit history discloses: an AI co-author or Assisted-by trailer, an AI agent's own account, or a bot-named account. Uncoloured wood means no signal, not "written by a human". Non-merge commits on the default branch, grouped by author date (UTC).</p>
</main>
<script id="data" type="application/json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
<script>
(() => {
  const D = JSON.parse(document.getElementById('data').textContent)
  const TAU = Math.PI * 2
  ${wobble.toString()}
  const q = new URLSearchParams(location.search)
  const view = q.get('view')
  if (view === 'square' || view === 'card') document.body.classList.add('export')
  if (view === 'card') { document.body.classList.add('card'); const st = document.getElementById('stage'); st.innerHTML = document.getElementById('cardtpl').innerHTML }
  const svg = document.querySelector('#stage svg')
  const grow = document.getElementById('sqlog-grow-c')
  const cap = document.getElementById('cap'), leg = document.getElementById('leg'), front = document.getElementById('front')
  const Rmax = D.R * 1.2
  const ease = (x) => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
  const GROW = 3.6, HOLD = 0.7
  function ringAtRadius(r) { let lo = 0, hi = D.radii.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (D.radii[m + 1] < r) lo = m + 1; else hi = m } return Math.min(lo, D.rings.length - 1) }
  function frame(t) {
    if (!grow) return
    const g = ease(Math.min(1, t / GROW))
    const r = g * Rmax
    grow.setAttribute('r', r.toFixed(1))
    if (front) {
      const rr = Math.min(r, D.radii[D.radii.length - 1] - 0.01)
      const i = ringAtRadius(rr)
      front.textContent = t < GROW ? (D.rings[i] ? D.rings[i].l : '') : ''
      front.setAttribute('opacity', t > 0.15 && t < GROW ? 1 : 0)
    }
    const o = Math.max(0, Math.min(1, (t - GROW - 0.1) / HOLD))
    if (cap) cap.setAttribute('opacity', o.toFixed(2))
    if (leg) leg.setAttribute('opacity', o.toFixed(2))
  }
  let raf = 0
  function play() { cancelAnimationFrame(raf); const t0 = performance.now(); const step = (now) => { const t = (now - t0) / 1000; frame(t); if (t < GROW + HOLD + 0.2) raf = requestAnimationFrame(step) }; raf = requestAnimationFrame(step) }
  if (q.has('t')) frame(parseFloat(q.get('t')) || 0)
  else if (q.has('static') || view === 'card') frame(99)
  else play()
  document.getElementById('replay').onclick = play

  // hover readout
  const tip = document.getElementById('tip')
  const h = (x) => String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const names = ['AI co-author trailer', 'AI agent account', 'bot account', 'during an agent session']
  const cols = ${JSON.stringify(STAIN_ORDER.map((c) => COLORS[c]))}
  if (view !== 'card') svg.addEventListener('mousemove', (e) => {
    const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY
    const u = p.matrixTransform(svg.getScreenCTM().inverse())
    const dx = u.x - D.cx, dy = u.y - D.cy
    const r = Math.hypot(dx, dy)
    const th = (Math.atan2(dx, -dy) + TAU) % TAU
    let base = r
    for (let k = 0; k < 4; k++) base = r / (wobble(th, Math.max(base, 1), D.R, D.P) / Math.max(base, 1))
    if (base > D.radii[D.radii.length - 1] || base < D.radii[0]) { tip.style.display = 'none'; return }
    const ring = D.rings[ringAtRadius(base)]
    const rows = ring.c.map((k, j) => k ? '<div><span class="sw" style="background:' + cols[j] + '"></span>' + names[j] + ': ' + k + ' (' + Math.round(100 * k / ring.n) + '%)</div>' : '').join('')
    const ag = ring.a.length ? '<div>agents: ' + ring.a.map(([n, k]) => h(n) + ' ' + Number(k)).join(', ') + '</div>' : ''
    const bt = ring.b.length ? '<div>accounts: ' + ring.b.map(([n, k]) => h(n) + ' ' + Number(k)).join(', ') + '</div>' : ''
    const hs = Object.values(ring.h || {})[0] ? '<div style="opacity:.7">e.g. ' + h(Object.values(ring.h)[0]) + '</div>' : ''
    tip.innerHTML = '<b>' + h(ring.l) + '</b> · ' + Number(ring.n).toLocaleString('en-US') + ' commits' + (ring.n ? rows + ag + bt + hs : '<div>dormant</div>')
    const box = document.getElementById('stage').getBoundingClientRect()
    tip.style.left = (e.clientX - box.left) + 'px'; tip.style.top = (e.clientY - box.top) + 'px'; tip.style.display = 'block'
  })
  svg.addEventListener('mouseleave', () => { tip.style.display = 'none' })

  // export
  async function savePNG(el, w, h, name) {
    const clone = el.cloneNode(true)
    clone.querySelectorAll('[id$="-grow-c"]').forEach((c) => c.setAttribute('r', '9999'))
    clone.querySelectorAll('#cap,#leg').forEach((c) => c.setAttribute('opacity', '1'))
    const fr = clone.querySelector('#front'); if (fr) fr.setAttribute('opacity', '0')
    const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone))
    const img = new Image(); img.src = src; await img.decode()
    const c = document.createElement('canvas'); c.width = w; c.height = h
    c.getContext('2d').drawImage(img, 0, 0, w, h)
    const a = document.createElement('a'); a.download = name; a.href = c.toDataURL('image/png'); a.click()
  }
  const slug = D.label.replace(/[^\\w.-]+/g, '-')
  document.getElementById('png').onclick = () => savePNG(document.getElementById('sq'), 1080, 1080, slug + '-rings.png')
  document.getElementById('cardpng').onclick = () => { const t = document.createElement('div'); t.innerHTML = document.getElementById('cardtpl').innerHTML; savePNG(t.querySelector('svg'), 1200, 630, slug + '-rings-card.png') }
})()
</script>
<!-- generated ${esc(generatedAt)} by rings -->
</body></html>`
}
