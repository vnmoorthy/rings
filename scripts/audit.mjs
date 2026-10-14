#!/usr/bin/env node
// Lists the identities behind every coloured class, so false positives are easy to spot.
// Usage: node scripts/audit.mjs owner/name [owner/name ...]   (uses the cached clones)
import { resolveRepo, readCommits } from '../lib/git.mjs'
import { classifyCommit, agentOf } from '../lib/classify.mjs'

for (const target of process.argv.slice(2)) {
  const repo = resolveRepo(target, { refresh: false })
  const commits = readCommits(repo.dir)
  const ids = { trailer: new Map(), agent: new Map(), bot: new Map() }
  for (const c of commits) {
    const { cls } = classifyCommit(c)
    if (cls === 'trailer') {
      const t = (c.trailers || []).find((x) => /co-?authored|generated|assisted|made-with/.test(x.key) && agentOf(x.value))
      const key = t ? t.value.replace(/<([^>]{0,40})[^>]*>/, '<$1>') : `${c.name} (author suffix)`
      ids.trailer.set(key, (ids.trailer.get(key) || 0) + 1)
    } else if (cls === 'agent' || cls === 'bot') {
      const key = `${c.name} <${c.email}>`
      ids[cls].set(key, (ids[cls].get(key) || 0) + 1)
    }
  }
  console.log(`\n== ${repo.label} (${commits.length} commits)`)
  for (const [cls, m] of Object.entries(ids)) {
    const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    if (top.length) console.log(`  ${cls}: ` + top.map(([k, v]) => `${v}× ${k}`).join(' | '))
  }
}
