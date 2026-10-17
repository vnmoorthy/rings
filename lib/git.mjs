// Reading commit history. Node built-ins only.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const FS = '\x1f' // field separator
const RS = '\x1e' // record separator
const TS = '\x1d' // trailer separator

function git(args, opts = {}) {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, ...opts })
  if (r.error) throw r.error
  if (r.status !== 0) {
    const sub = args[0] === '-C' ? args[2] : args[0]
    const msg = (r.stderr || '').trim().split('\n').slice(-3).join(' ')
    throw new Error(`git ${sub} failed: ${msg}`)
  }
  return r.stdout
}

// Accepts owner/name, a GitHub/GitLab URL, or a local path.
export function parseTarget(input) {
  const raw = (input || '.').trim()
  if (fs.existsSync(raw)) return { kind: 'local', path: path.resolve(raw) }
  const url = raw.match(/^(?:https?:\/\/|git@)([^/:]+)[/:]([^/]+)\/([^/#?]+?)(?:\.git)?\/?(?:[#?].*)?$/)
  if (url) return { kind: 'remote', host: url[1], owner: url[2], name: url[3], url: `https://${url[1]}/${url[2]}/${url[3]}.git` }
  const short = raw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/)
  if (short) return { kind: 'remote', host: 'github.com', owner: short[1], name: short[2], url: `https://github.com/${short[1]}/${short[2]}.git` }
  throw new Error(`Not a local path, owner/name or repository URL: ${raw}`)
}

export function defaultCacheDir() {
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache')
  return path.join(base, 'rings')
}

// Keep a cached bare clone on the remote's current default branch (repos rename master -> main).
function refreshClone(dir, log) {
  const warnings = []
  try {
    const sym = git(['-C', dir, 'ls-remote', '--symref', 'origin', 'HEAD'])
    const m = sym.match(/^ref:\s+(refs\/heads\/\S+)\s+HEAD/m)
    let head = git(['-C', dir, 'symbolic-ref', 'HEAD']).trim()
    if (m && m[1] !== head) { git(['-C', dir, 'symbolic-ref', 'HEAD', m[1]]); log(`default branch moved: ${head} -> ${m[1]}`); head = m[1] }
    // fetch the default branch itself (fetching into "HEAD" would create a stray branch named HEAD)
    git(['-C', dir, 'fetch', '--quiet', '--filter=tree:0', 'origin', `+${head}:${head}`])
  } catch (e) {
    warnings.push(`could not update the cached clone, so this uses history as of the last fetch (${e.message})`)
    log(warnings[warnings.length - 1])
  }
  return warnings
}

// Returns { dir, label, remoteUrl, local, warnings, shallow } where dir is something `git -C` accepts.
export function resolveRepo(input, { cacheDir = defaultCacheDir(), refresh = true, log = () => {} } = {}) {
  const t = parseTarget(input)
  let out
  if (t.kind === 'local') {
    const bare = git(['-C', t.path, 'rev-parse', '--is-bare-repository']).trim() === 'true'
    if (bare) {
      const base = path.basename(t.path).replace(/\.git$/, '')
      const m = base.match(/^(?:[^_]+__)?([^_]+)__(.+)$/)
      out = { dir: t.path, label: m ? `${m[1]}/${m[2]}` : base, remoteUrl: null, local: false, warnings: [] }
    } else {
      const top = git(['-C', t.path, 'rev-parse', '--show-toplevel']).trim()
      let label = path.basename(top)
      try {
        const origin = git(['-C', top, 'remote', 'get-url', 'origin']).trim()
        const m = origin.match(/[/:]([^/:]+)\/([^/]+?)(?:\.git)?$/)
        if (m) label = `${m[1]}/${m[2]}`
      } catch { /* no origin */ }
      out = { dir: top, label, remoteUrl: null, local: true, warnings: [] }
    }
  } else {
    fs.mkdirSync(cacheDir, { recursive: true })
    const dir = path.join(cacheDir, `${t.host}__${t.owner}__${t.name}.git`)
    let warnings = []
    if (!fs.existsSync(dir)) {
      log(`cloning ${t.url} (commit history only, no file contents)...`)
      git(['clone', '--quiet', '--bare', '--filter=tree:0', t.url, dir])
    } else if (refresh) {
      log(`updating ${t.owner}/${t.name}...`)
      warnings = refreshClone(dir, log)
    }
    out = { dir, label: `${t.owner}/${t.name}`, remoteUrl: `https://${t.host}/${t.owner}/${t.name}`, local: false, warnings }
  }
  out.shallow = git(['-C', out.dir, 'rev-parse', '--is-shallow-repository']).trim() === 'true'
  if (out.shallow) out.warnings.push('this is a shallow clone, so only part of the history is drawn; run `git fetch --unshallow --filter=tree:0` for all of it')
  return out
}

// Lines in a message body that disclose AI help outside git's trailer block: GitHub squash merges
// append "---------" and human co-authors after them, so an AI line above ends up in the body.
const BODY_GREP = [
  '^(co-?authored-by|assisted-by|ai-assisted(-by)?|generated-by|made-with|disclosure)[[:space:]]*:',
  '^ai[- ]assisted',
  'generated with \\[?(claude code|codex|cursor|opencode|gemini|amp|aider)',
]
const BODY_LINE = /^(co-?authored-by|assisted-by|ai-assisted(?:-by)?|generated-by|made-with|disclosure)\s*:\s*(.+)$/i
const BARE_AI = /^ai[- ]assisted\.?\s*$/i
const GENERATED_WITH = /generated with \[?(claude code|codex|cursor|opencode|gemini|amp|aider)\b/i

function bodyTrailers(dir, ref) {
  const args = ['-C', dir, 'log', '--no-merges', '-E', '-i', `--format=%H${FS}%B${RS}`]
  for (const g of BODY_GREP) args.push(`--grep=${g}`)
  args.push(ref)
  const out = git(args)
  const map = new Map()
  for (const rec of out.split(RS)) {
    const s = rec.replace(/^\n+/, '')
    const i = s.indexOf(FS)
    if (i < 0) continue
    const hash = s.slice(0, i)
    const found = []
    for (const raw of s.slice(i + 1).split('\n')) {
      const line = raw.trim()
      let m
      if ((m = line.match(BODY_LINE))) found.push({ key: m[1].toLowerCase().replace(/^coauthored/, 'co-authored'), value: m[2].trim() })
      else if (BARE_AI.test(line)) found.push({ key: 'ai-assisted', value: 'AI' })
      else if ((m = line.match(GENERATED_WITH))) found.push({ key: 'generated-by', value: m[1] })
    }
    if (found.length) map.set(hash, found)
  }
  return map
}

// Non-merge commits reachable from ref, oldest first.
export function readCommits(dir, { ref = 'HEAD' } = {}) {
  const ok = spawnSync('git', ['-C', dir, 'rev-parse', '--verify', '-q', `${ref}^{commit}`], { encoding: 'utf8' })
  if (ok.status !== 0) throw new Error(ref === 'HEAD' ? 'This repository has no commits yet.' : `Unknown ref ${ref}`)
  const fmt = ['%H', '%at', '%ct', '%an', '%ae', '%cn', '%s', `%(trailers:unfold,separator=${TS})`].join(FS) + RS
  const out = git(['-C', dir, 'log', '--no-merges', `--format=${fmt}`, ref])
  const extra = bodyTrailers(dir, ref)
  const commits = []
  for (const rec of out.split(RS)) {
    const s = rec.replace(/^\n+/, '')
    if (!s) continue
    const [hash, at, ct, name, email, cname, subject, trailerBlob = ''] = s.split(FS)
    if (!hash || !at) continue
    const trailers = []
    const seen = new Set()
    const add = (key, value) => { const k = `${key}\n${value.toLowerCase()}`; if (!seen.has(k)) { seen.add(k); trailers.push({ key, value }) } }
    for (const line of trailerBlob.split(TS)) {
      const i = line.indexOf(':')
      if (i > 0) add(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim())
    }
    for (const t of extra.get(hash) || []) add(t.key, t.value)
    commits.push({ hash, t: Number(at), ct: Number(ct), name: name || '', email: email || '', cname: cname || '', subject: subject || '', trailers })
  }
  commits.sort((a, b) => a.t - b.t)
  return commits
}
