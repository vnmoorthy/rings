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
  assert.match(facts(m).lines[0], /No disclosed AI co-authors in 3 commits/)
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
