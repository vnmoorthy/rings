import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildRings, chooseUnit, assignWidths, facts } from '../lib/rings.mjs'
import { renderHTML } from '../lib/render.mjs'
import { readCommits, parseTarget } from '../lib/git.mjs'

const DAY = 86400
const T0 = Date.UTC(2023, 0, 15) / 1000
const mk = (t, name = 'Ana', email = 'ana@x.dev', trailers = []) => ({ hash: Math.random().toString(16).slice(2, 12).padEnd(10, '0'), t, name, email, trailers })

test('unit adapts to repo age', () => {
  assert.equal(chooseUnit(T0, T0 + 3 * 365 * DAY), 'month')
  assert.equal(chooseUnit(T0, T0 + 200 * DAY), 'week')
  assert.equal(chooseUnit(T0, T0 + 20 * DAY), 'day')
  assert.equal(chooseUnit(T0, T0 + 2 * DAY), 'commit')
  assert.equal(chooseUnit(T0, T0 + 40 * 365 * DAY), 'quarter')
})

test('monthly rings are contiguous and include dormant months', () => {
  const commits = [mk(T0), mk(T0 + 100 * DAY), mk(T0 + 800 * DAY)]
  const m = buildRings(commits)
  assert.equal(m.unit, 'month')
  assert.equal(m.rings[0].label, 'Jan 2023')
  assert.equal(m.rings.length, 27) // Jan 2023 .. Mar 2025
  assert.equal(m.rings.filter((r) => r.n === 0).length, 24)
  assert.equal(m.total, 3)
})

test('widths sum to 1, are capped, and dormant rings stay thin', () => {
  const rings = [{ n: 4 }, { n: 4 }, { n: 4 }, { n: 4 }, { n: 4 }, { n: 4 }, { n: 4 }, { n: 4 }, { n: 4 }, { n: 10000 }, { n: 0 }]
  assignWidths(rings)
  const sum = rings.reduce((a, r) => a + r.w, 0)
  assert.ok(Math.abs(sum - 1) < 1e-9)
  assert.ok(rings[9].w <= rings[0].w * 2.5 + 1e-9, 'burst is capped')
  assert.ok(rings[10].w < rings[0].w, 'dormant ring is thinner')
})

test('captions state counts and never say human-written', () => {
  const commits = []
  for (let i = 0; i < 60; i++) commits.push(mk(T0 + i * DAY))
  for (let i = 0; i < 40; i++) commits.push(mk(T0 + (400 + i) * DAY, 'Ana', 'ana@x.dev', [{ key: 'co-authored-by', value: 'Claude <noreply@anthropic.com>' }]))
  for (let i = 0; i < 40; i++) commits.push(mk(T0 + (800 + i) * DAY, 'robobun', 'robobun@oven.sh'))
  const m = buildRings(commits)
  const f = facts(m)
  assert.match(f.lines[0], /Claude co-author trailers peaked at 100% of commits/)
  assert.ok(f.lines.some((l) => /One account, robobun, authored 100% of commits/.test(l)))
  assert.ok(f.lines.every((l) => !/human/i.test(l)))
})

test('a repo with no signal says so plainly', () => {
  const m = buildRings([mk(T0), mk(T0 + 40 * DAY), mk(T0 + 900 * DAY)])
  assert.match(facts(m).lines[0], /No disclosed AI in 3 commits/)
})

test('target parsing', () => {
  assert.equal(parseTarget('oven-sh/bun').url, 'https://github.com/oven-sh/bun.git')
  assert.equal(parseTarget('https://github.com/oven-sh/bun').owner, 'oven-sh')
  assert.equal(parseTarget('git@github.com:oven-sh/bun.git').name, 'bun')
  assert.throws(() => parseTarget('not a repo at all'))
})

test('end to end on a temporary git repo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rings-test-'))
  const g = (args, env = {}) => { const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, ...env } }); assert.equal(r.status, 0, r.stderr); return r.stdout }
  g(['init', '-q', '-b', 'main'])
  const commit = (msg, date, name = 'Ana', email = 'ana@x.dev') => g(['commit', '-q', '--allow-empty', '-m', msg], { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: date, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email, GIT_COMMITTER_DATE: date })
  commit('first', '2024-01-02T10:00:00Z')
  commit('second\n\nCo-authored-by: Claude <noreply@anthropic.com>', '2024-03-05T10:00:00Z')
  commit('bump deps', '2024-06-07T10:00:00Z', 'dependabot[bot]', '49699333+dependabot[bot]@users.noreply.github.com')
  commit('third', '2024-06-08T10:00:00Z')
  const commits = readCommits(dir)
  assert.equal(commits.length, 4)
  assert.deepEqual(commits[1].trailers, [{ key: 'co-authored-by', value: 'Claude <noreply@anthropic.com>' }])
  const m = buildRings(commits)
  assert.equal(m.unit, 'week')
  assert.equal(m.totals.trailer, 1)
  assert.equal(m.totals.bot, 1)
  const html = renderHTML(m, facts(m), { label: 'test/repo' })
  assert.match(html, /<svg[^>]+id="sq"/)
  assert.match(html, /id="cardtpl"/)
  assert.match(html, /no AI signal \(not "human-written"\)/)
  const cli = spawnSync(process.execPath, [path.resolve('bin/rings.mjs'), dir, '--json', '-o', path.join(dir, 'out.html')], { encoding: 'utf8' })
  assert.equal(cli.status, 0, cli.stderr)
  const sum = JSON.parse(cli.stdout)
  assert.equal(sum.commits, 4)
  assert.ok(fs.existsSync(path.join(dir, 'out.html')))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('author names from history cannot inject HTML into the page', () => {
  const evil = '<img src=x onerror=alert(1)>[bot]'
  const commits = [mk(T0, evil, 'x@y.z'), mk(T0 + 40 * DAY), mk(T0 + 900 * DAY, evil, 'x@y.z')]
  const m = buildRings(commits)
  const html = renderHTML(m, facts(m), { label: '<script>alert(1)</script>/repo' })
  assert.ok(!html.includes('<img src=x onerror'), 'raw author name must not appear')
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw label must not appear')
  assert.match(html, /const h = \(x\) =>/, 'tooltip escapes values')
})

test('a commit with a wrong clock does not add decades of empty rings', () => {
  const bad = mk(Date.UTC(2001, 0, 25) / 1000); bad.ct = Date.UTC(2022, 5, 1) / 1000 // author clock wrong, committed in 2022
  const commits = [bad]
  for (let i = 0; i < 300; i++) commits.push(mk(Date.UTC(2022, 2, 29) / 1000 + i * 4 * DAY))
  commits.push(mk(Date.UTC(2049, 0, 1) / 1000))
  const m = buildRings(commits, { now: Date.UTC(2026, 9, 17) / 1000 })
  assert.equal(m.rings[0].label, 'Mar 2022')
  assert.equal(m.total, 300)
  assert.deepEqual(m.outliers.map((o) => o.date).sort(), ['2001-01-25', '2049-01-01'])
})

test('a real early history is kept when it is more than 1% of commits', () => {
  const commits = []
  for (let i = 0; i < 20; i++) commits.push(mk(Date.UTC(2010, 0, 1) / 1000 + i * DAY))
  for (let i = 0; i < 100; i++) commits.push(mk(Date.UTC(2015, 0, 1) / 1000 + i * DAY))
  const m = buildRings(commits, { now: Date.UTC(2026, 9, 17) / 1000 })
  assert.equal(m.outliers.length, 0)
  assert.equal(m.rings[0].label, 'Jan 2010')
})

test('small histories keep every commit even with long gaps', () => {
  const m = buildRings([mk(T0), mk(T0 + 500 * DAY), mk(T0 + 1300 * DAY)], { now: Date.UTC(2026, 9, 17) / 1000 })
  assert.equal(m.total, 3)
  assert.equal(m.outliers.length, 0)
})

import { spawnSync as run } from 'node:child_process'

function tempRepo(commits) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rings-body-'))
  const g = (args, env = {}) => { const r = run('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, ...env } }); assert.equal(r.status, 0, r.stderr); return r.stdout }
  g(['init', '-q', '-b', 'main'])
  for (const [msg, date, name = 'Ana', email = 'ana@x.dev'] of commits) g(['commit', '-q', '--allow-empty', '-m', msg], { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: date, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email, GIT_COMMITTER_DATE: date })
  return dir
}

test('disclosures outside the trailer block are read (squash merges, neovim, Claude Code footer)', () => {
  const dir = tempRepo([
    ['fix a (#1)\n\nCo-authored-by: Claude <noreply@anthropic.com>\n\n---------\n\nCo-authored-by: Bob <bob@x.dev>', '2024-01-02T10:00:00Z'],
    ['fix b\n\nSome detail.\n\nAI-assisted', '2024-01-03T10:00:00Z'],
    ['fix c\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)', '2024-01-04T10:00:00Z'],
    ['fix d', '2024-01-05T10:00:00Z'],
  ])
  const m = buildRings(readCommits(dir))
  assert.equal(m.totals.trailer, 3)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('captions name only tools from trailer commits, and say "the week of"', () => {
  const commits = []
  const W = Date.UTC(2025, 6, 7) / 1000 // a Monday
  for (let i = 0; i < 200; i++) commits.push(mk(W - 300 * DAY + i * DAY))
  for (let i = 0; i < 10; i++) commits.push(mk(W + i * 3600, 'Ana', 'ana@x.dev', [{ key: 'co-authored-by', value: 'Claude <noreply@anthropic.com>' }]))
  for (let i = 0; i < 5; i++) commits.push(mk(W + 20 * 3600 + i * 60, 'Copilot', '198982749+Copilot@users.noreply.github.com'))
  const m = buildRings(commits, { now: Date.UTC(2026, 9, 17) / 1000 })
  assert.equal(m.unit, 'week')
  const line = facts(m).lines[0]
  assert.match(line, /^Claude co-author trailers peaked at 67% of commits in the week of 7 Jul 2025\.$/)
})

test('a revival commit after a long pause is kept, a wrong clock is set aside', () => {
  const commits = []
  for (let i = 0; i < 150; i++) commits.push(mk(Date.UTC(2020, 0, 1) / 1000 + i * DAY))
  const revival = mk(Date.UTC(2023, 0, 1) / 1000); revival.ct = revival.t
  commits.push(revival)
  const m = buildRings(commits, { now: Date.UTC(2026, 9, 17) / 1000 })
  assert.equal(m.outliers.length, 0)
  assert.equal(m.total, 151)
})

test('singular counts read correctly', () => {
  const commits = []
  for (let i = 0; i < 120; i++) commits.push(mk(T0 + i * 10 * DAY))
  commits.push(mk(T0 + 500 * DAY, 'Ana', 'ana@x.dev', [{ key: 'co-authored-by', value: 'Claude <noreply@anthropic.com>' }]))
  const m = buildRings(commits, { now: Date.UTC(2026, 9, 17) / 1000 })
  assert.match(facts(m).lines[0], /^1 of 121 commits discloses AI/)
})

test('the repo-rings bin works through a symlink, and an empty repo gets a clear message', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rings-bin-'))
  const link = path.join(dir, 'repo-rings')
  fs.symlinkSync(path.resolve('bin/rings.mjs'), link)
  const help = run(process.execPath, [link, '--help'], { encoding: 'utf8' })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /tree rings for a Git repo/)
  const empty = path.join(dir, 'empty'); fs.mkdirSync(empty)
  run('git', ['-C', empty, 'init', '-q'])
  const r = run(process.execPath, [link, empty], { encoding: 'utf8' })
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /no commits yet/)
  fs.rmSync(dir, { recursive: true, force: true })
})
