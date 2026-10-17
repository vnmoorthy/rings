import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyCommit, isBotAccount, isAgentAccount, agentOf } from '../lib/classify.mjs'

const c = (name, email, trailers = []) => ({ hash: 'abc1234567', t: 0, name, email, trailers: trailers.map(([key, value]) => ({ key: key.toLowerCase(), value })) })

test('Claude Code trailer is a disclosed AI co-author', () => {
  assert.deepEqual(classifyCommit(c('Ana', 'ana@x.dev', [['Co-Authored-By', 'Claude <noreply@anthropic.com>']])), { cls: 'trailer', agent: 'claude', via: 'co-author' })
  assert.equal(classifyCommit(c('Ana', 'ana@x.dev', [['Co-authored-by', 'Claude Opus 4.6 <noreply@anthropic.com>']])).agent, 'claude')
})

test('human co-authors with agent-like names or company domains are not AI', () => {
  // a human named Claude
  assert.equal(classifyCommit(c('Ana', 'ana@x.dev', [['Co-authored-by', 'Claude Paroz <claude@2xlibre.net>']])).cls, 'none')
  // Bun engineers commit from anthropic.com; OpenAI engineers from openai.com
  assert.equal(classifyCommit(c('Ana', 'ana@x.dev', [['Co-authored-by', 'Ciro Spaciari <ciro@anthropic.com>']])).cls, 'none')
  assert.equal(classifyCommit(c('Ana', 'ana@x.dev', [['Co-authored-by', 'Some Engineer <eng@openai.com>']])).cls, 'none')
  assert.equal(classifyCommit(c('Ana', 'ana@x.dev', [['Co-authored-by', 'Devin Smith <devin@smith.io>']])).cls, 'none')
  assert.equal(classifyCommit(c('Ana', 'ana@x.dev', [['Co-authored-by', 'Jules Verne <jules@nautilus.fr>']])).cls, 'none')
  assert.equal(classifyCommit(c('Ana', 'ana@x.dev', [['Co-authored-by', 'Patsy Cline <patsy@cline.example>']])).cls, 'none')
  assert.equal(classifyCommit(c('Ana', 'ana@x.dev', [['Co-authored-by', 'Pat <pat@cursor.com>']])).cls, 'none')
})

test('Signed-off-by and other trailer keys do not count', () => {
  assert.equal(classifyCommit(c('Ana', 'ana@x.dev', [['Signed-off-by', 'Claude <noreply@anthropic.com>']])).cls, 'none')
  assert.equal(classifyCommit(c('Ana', 'ana@x.dev', [['Reviewed-by', 'Copilot <copilot@github.com>']])).cls, 'none')
})

test('agent accounts as authors', () => {
  assert.deepEqual(classifyCommit(c('Copilot', '198982749+Copilot@users.noreply.github.com')), { cls: 'agent', agent: 'copilot' })
  assert.equal(classifyCommit(c('copilot-swe-agent[bot]', '198982749+Copilot@users.noreply.github.com')).cls, 'agent')
  assert.equal(classifyCommit(c('devin-ai-integration[bot]', '158243242+devin-ai-integration[bot]@users.noreply.github.com')).cls, 'agent')
  assert.equal(classifyCommit(c('google-labs-jules[bot]', '161369871+google-labs-jules[bot]@users.noreply.github.com')).cls, 'agent')
  assert.equal(classifyCommit(c('claude[bot]', '209825114+claude[bot]@users.noreply.github.com')).cls, 'agent')
  assert.equal(classifyCommit(c('Cursor Agent', 'cursoragent@cursor.com')).cls, 'agent')
  assert.ok(isAgentAccount('Claude', 'noreply@anthropic.com'))
  assert.ok(!isAgentAccount('Claude Paroz', 'claude@2xlibre.net'))
})

test("aider's author suffix is a disclosure", () => {
  assert.deepEqual(classifyCommit(c('Paul Gauthier (aider)', 'paul@aider.chat')), { cls: 'trailer', agent: 'aider', via: 'author' })
})

test('bot-named accounts', () => {
  assert.ok(isBotAccount('dependabot[bot]', '49699333+dependabot[bot]@users.noreply.github.com'))
  assert.ok(isBotAccount('github-actions[bot]', 'x'))
  assert.ok(isBotAccount('renovate', 'bot@renovateapp.com'))
  assert.ok(isBotAccount('robobun', 'robobun@oven.sh'))
  assert.ok(isBotAccount('k8s-ci-robot', 'k8s-ci-robot@users.noreply.github.com'))
  assert.ok(!isBotAccount('Talbot Smith', 'talbot@smith.io'))
  assert.ok(!isBotAccount('Abbott', 'abbott@x.io'))
  assert.ok(!isBotAccount('Robert', 'robert@x.io'))
  assert.ok(!isBotAccount('Roboto Font Team', 'fonts@x.io'))
  assert.ok(isBotAccount('Jane', 'jane@x.io', { bots: ['jane@x.io'] }))
  assert.ok(!isBotAccount('robobun', 'robobun@oven.sh', { humans: ['robobun'] }))
})

test('agent account outranks a trailer, trailer outranks bot', () => {
  assert.equal(classifyCommit(c('copilot-swe-agent[bot]', 'x', [['Co-authored-by', 'Claude <noreply@anthropic.com>']])).cls, 'agent')
  assert.equal(classifyCommit(c('robobun', 'robobun@oven.sh', [['Co-authored-by', 'Claude <noreply@anthropic.com>']])).cls, 'trailer')
})

test('session class only applies when nothing else does', () => {
  const inSession = () => true
  assert.equal(classifyCommit(c('Ana', 'ana@x.dev'), { inSession }).cls, 'session')
  assert.equal(classifyCommit(c('dependabot[bot]', 'x'), { inSession }).cls, 'bot')
})

test('agentOf recognises common agent identities', () => {
  assert.equal(agentOf('Codex <codex@openai.com>'), 'codex')
  assert.equal(agentOf('opencode <noreply@opencode.ai>'), 'opencode')
  assert.equal(agentOf('Amp <amp@ampcode.com>'), 'amp')
  assert.equal(agentOf('Gemini CLI <gemini@x>'), 'gemini')
  assert.equal(agentOf('Jane <jane@x.dev>'), null)
})

test('robo-named humans are not bots; robo service accounts are', () => {
  assert.ok(isBotAccount('robobun', 'robobun@oven.sh'))
  assert.ok(!isBotAccount('roboin', '50550561+Robot-Inventor@users.noreply.github.com'))
  assert.ok(!isBotAccount('roboticsdude60', 'jschollreads@gmail.com'))
  assert.ok(!isBotAccount('robocop', 'robocop@gmail.com'))
})

test("opencode's agent account is an AI agent account", () => {
  assert.equal(classifyCommit(c('opencode-agent[bot]', '219766164+opencode-agent[bot]@users.noreply.github.com')).cls, 'agent')
})

test('Assisted-by trailers (Node.js policy) count, and remember how they were disclosed', () => {
  assert.deepEqual(classifyCommit(c('Ana', 'ana@x.dev', [['Assisted-by', 'Codex']])), { cls: 'trailer', agent: 'codex', via: 'assisted' })
  assert.equal(classifyCommit(c('Ana', 'ana@x.dev', [['Assisted-by', 'Opencode:Opus 4.6']])).agent, 'opencode')
  assert.equal(classifyCommit(c('Ana', 'ana@x.dev', [['Assisted-by', 'Claude Code']])).agent, 'claude')
  assert.equal(classifyCommit(c('Ana', 'ana@x.dev', [['Co-authored-by', 'Claude <noreply@anthropic.com>']])).via, 'co-author')
})
