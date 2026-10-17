// Reading commit history. Node built-ins only.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const FS = '\x1f' // field separator
const RS = '\x1e' // record separator
const TS = '\x1d' // trailer separator

function git(args, opts = {}) {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 30, ...opts })
  if (r.error) throw r.error
  if (r.status !== 0) {
    const msg = (r.stderr || '').trim().split('\n').slice(-3).join(' ')
    throw new Error(`git ${args[0]} failed: ${msg}`)
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

// Returns { dir, label, remoteUrl, local } where dir is something `git -C` accepts.
export function resolveRepo(input, { cacheDir = defaultCacheDir(), refresh = true, log = () => {} } = {}) {
  const t = parseTarget(input)
  if (t.kind === 'local') {
    const bare = git(['-C', t.path, 'rev-parse', '--is-bare-repository']).trim() === 'true'
    if (bare) {
      const base = path.basename(t.path).replace(/\.git$/, '')
      const m = base.match(/^(?:[^_]+__)?([^_]+)__(.+)$/)
      return { dir: t.path, label: m ? `${m[1]}/${m[2]}` : base, remoteUrl: null, local: false }
    }
    const top = git(['-C', t.path, 'rev-parse', '--show-toplevel']).trim()
    let label = path.basename(top)
    try {
      const origin = git(['-C', top, 'remote', 'get-url', 'origin']).trim()
      const m = origin.match(/[/:]([^/:]+)\/([^/]+?)(?:\.git)?$/)
      if (m) label = `${m[1]}/${m[2]}`
    } catch { /* no origin */ }
    return { dir: top, label, remoteUrl: null, local: true }
  }
  fs.mkdirSync(cacheDir, { recursive: true })
  const dir = path.join(cacheDir, `${t.host}__${t.owner}__${t.name}.git`)
  if (!fs.existsSync(dir)) {
    log(`cloning ${t.url} (commit history only, no file contents)...`)
    git(['clone', '--quiet', '--bare', '--filter=tree:0', t.url, dir])
  } else if (refresh) {
    log(`updating ${t.owner}/${t.name}...`)
    try {
      // update the default branch itself (fetching into "HEAD" would create a stray branch named HEAD)
      const head = git(['-C', dir, 'symbolic-ref', 'HEAD']).trim() // refs/heads/main
      git(['-C', dir, 'fetch', '--quiet', '--filter=tree:0', 'origin', `+${head}:${head}`])
    } catch (e) { log(`fetch failed, using cached history (${e.message})`) }
  }
  return { dir, label: `${t.owner}/${t.name}`, remoteUrl: `https://${t.host}/${t.owner}/${t.name}`, local: false }
}

// Non-merge commits reachable from ref, oldest first.
export function readCommits(dir, { ref = 'HEAD' } = {}) {
  const fmt = ['%H', '%at', '%an', '%ae', `%(trailers:unfold,separator=${TS})`].join(FS) + RS
  const out = git(['-C', dir, 'log', '--no-merges', '--reverse', `--format=${fmt}`, ref])
  const commits = []
  for (const rec of out.split(RS)) {
    const s = rec.replace(/^\n+/, '')
    if (!s) continue
    const [hash, at, name, email, trailerBlob = ''] = s.split(FS)
    if (!hash || !at) continue
    const trailers = []
    for (const line of trailerBlob.split(TS)) {
      const i = line.indexOf(':')
      if (i > 0) trailers.push({ key: line.slice(0, i).trim().toLowerCase(), value: line.slice(i + 1).trim() })
    }
    commits.push({ hash, t: Number(at), name: name || '', email: email || '', trailers })
  }
  commits.sort((a, b) => a.t - b.t)
  return commits
}
