// Classifying commits by the AI or automation signal they disclose.
// The classes describe what the history *says*, never who wrote the code:
//   trailer  a trailer (or aider's "(aider)" author suffix) names an AI coding agent as co-author
//   agent    the commit author is a known AI coding agent account (copilot-swe-agent, devin-ai-integration ...)
//   bot      the commit author is some other bot or automation account (dependabot, github-actions, *bot ...)
//   session  (local repos, opt-in) made while a Claude Code or Codex session was running in this repo
//   none     no signal. This does NOT mean a human wrote it.

export const CLASSES = ['trailer', 'agent', 'bot', 'session', 'none']

export const CLASS_LABELS = {
  trailer: 'AI co-author / assisted-by trailer',
  agent: 'AI agent account',
  bot: 'bot account',
  session: 'during an agent session',
  none: 'no AI signal',
}

// Each pattern is matched against an identity string "Name <email>".
// Rules: match an agent's own display name or its no-reply address, never a company
// domain (Bun's engineers commit from anthropic.com, OpenAI's from openai.com), and
// never a bare first name (a human co-author "Claude Paroz <claude@...>" must not count).
const MODEL_WORDS = '(?:\\s+(?:code|opus|sonnet|haiku|agent|ai|\\d[\\w.]*))*'
export const AGENTS = [
  { id: 'claude', label: 'Claude', re: new RegExp(`noreply@anthropic\\.com|^claude${MODEL_WORDS}\\s*(?:<|$)|^claude\\[bot\\]`, 'i') },
  { id: 'codex', label: 'Codex', re: /^codex\b|codex@openai\.com|noreply@openai\.com|chatgpt-codex|^chatgpt\b/i },
  { id: 'copilot', label: 'Copilot', re: /copilot/i },
  { id: 'cursor', label: 'Cursor', re: /cursoragent@|^cursor(?:\s+agent)?\s*(?:<|$)|^cursor\[bot\]/i },
  { id: 'gemini', label: 'Gemini', re: /gemini-code-assist|^gemini(?:\s+(?:cli|code|\d[\w.]*))*\s*(?:<|$)/i },
  { id: 'jules', label: 'Jules', re: /google-labs-jules/i },
  { id: 'aider', label: 'Aider', re: /noreply@aider\.chat|^aider\b/i },
  { id: 'devin', label: 'Devin', re: /devin-ai-integration|^devin(?:\s+ai)?\s*<[^>]*devin-ai/i },
  { id: 'amp', label: 'Amp', re: /amp@ampcode\.com|^amp\s*<[^>]*ampcode|^amp\[bot\]/i },
  { id: 'opencode', label: 'opencode', re: /^opencode\b|noreply@opencode\.ai/i },
  { id: 'windsurf', label: 'Windsurf', re: /^(?:windsurf|cascade)\b[^<]*<[^>]*(?:windsurf|codeium)/i },
  { id: 'cline', label: 'Cline', re: /^cline\s*<[^>]*cline/i },
  { id: 'roo', label: 'Roo Code', re: /^roo(?:[- ]?code)?\s*<[^>]*roo/i },
  { id: 'junie', label: 'Junie', re: /^junie\s*<[^>]*(?:jetbrains|junie)/i },
  { id: 'qwen', label: 'Qwen Code', re: /^qwen[- ]?code\b/i },
  { id: 'openhands', label: 'OpenHands', re: /^openhands\b|openhands@all-hands\.dev|openhands-agent/i },
  { id: 'amazonq', label: 'Amazon Q', re: /amazon-q-developer|^amazon q\b/i },
  { id: 'factory', label: 'Factory', re: /factory-droid/i },
  { id: 'kiro', label: 'Kiro', re: /^kiro\s*<[^>]*kiro/i },
]

// Trailer keys that can carry an AI disclosure.
const AI_TRAILER_KEYS = new Set(['co-authored-by', 'coauthored-by', 'co-authored', 'generated-by', 'assisted-by', 'ai-assisted-by', 'ai-generated-by', 'made-with'])

// Author accounts that are AI coding agents acting on their own.
const AGENT_ACCOUNT_RE = [
  /copilot-swe-agent/i, /\+copilot@users\.noreply\.github\.com/i, /devin-ai-integration/i, /google-labs-jules/i,
  /^claude\[bot\]/i, /^claude(?:\s+code)?\s*<[^>]*@anthropic\.com/i, /^cursor\[bot\]/i, /cursoragent@cursor\.com/i,
  /chatgpt-codex-connector/i, /^codex\[bot\]/i, /openai-codex/i, /openhands-agent/i, /gemini-code-assist/i,
  /amazon-q-developer/i, /factory-droid/i, /sweep-ai/i, /^amp\[bot\]/i, /opencode-agent\[bot\]/i, /^cline-cloud\[bot\]/i,
]

function identity(name, email) {
  return `${(name || '').trim()} <${(email || '').trim()}>`
}

export function agentOf(id) {
  for (const a of AGENTS) if (a.re.test(id)) return a.id
  return null
}

export function isBotAccount(name, email, { bots = [], humans = [] } = {}) {
  const n = (name || '').trim()
  const e = (email || '').trim().toLowerCase()
  const nl = n.toLowerCase()
  if (humans.some((h) => h.toLowerCase() === nl || h.toLowerCase() === e)) return false
  if (bots.some((b) => b.toLowerCase() === nl || b.toLowerCase() === e)) return true
  if (/\[bot\]$/i.test(n) || /\[bot\]@/i.test(e)) return true
  if (/^[a-z0-9._-]*(?:bot|robot)$/.test(n)) return true // lowercase handle-like names: k8s-ci-robot, mergify-bot
  // robo-named service accounts whose email is their own name on an org domain (robobun <robobun@oven.sh>),
  // but not people with robo-ish handles (roboin, roboticsdude60 on gmail or GitHub noreply)
  if (/^robo[a-z-]+$/.test(n) && e.startsWith(`${nl}@`) && !/@(?:gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|proton|protonmail|qq|163)\.|users\.noreply\.github\.com$/.test(e)) return true
  if (/[-_.](?:bot|robot|automation)$/i.test(n)) return true
  if (/^(?:github-actions|actions-user|dependabot|renovate|greenkeeper|semantic-release|allcontributors|imgbot|pre-commit-ci|mergify|kodiakhq|copybara|bors|homu)$/i.test(n)) return true
  const local = e.split('@')[0]
  if (/(?:^|[-_.+])(?:bot|robot)$/.test(local) && /noreply|bot|actions|automation/.test(e)) return true
  return false
}

export function isAgentAccount(name, email) {
  const id = identity(name, email)
  return AGENT_ACCOUNT_RE.some((re) => re.test(id))
}

// Returns { cls, agent } for one commit.
export function classifyCommit(c, opts = {}) {
  const id = identity(c.name, c.email)
  if (isAgentAccount(c.name, c.email)) return { cls: 'agent', agent: agentOf(id) }
  if (/\(aider\)\s*$/i.test(c.name || '')) return { cls: 'trailer', agent: 'aider', via: 'author' }
  for (const t of c.trailers || []) {
    if (!AI_TRAILER_KEYS.has(t.key)) continue
    const a = agentOf(t.value)
    if (a) return { cls: 'trailer', agent: a, via: /assist/.test(t.key) ? 'assisted' : /generat|made-with/.test(t.key) ? 'generated' : 'co-author' }
  }
  if (isBotAccount(c.name, c.email, opts)) return { cls: 'bot', agent: null }
  if (opts.inSession && opts.inSession(c.t)) return { cls: 'session', agent: null }
  return { cls: 'none', agent: null }
}

export function agentLabel(id) {
  const a = AGENTS.find((x) => x.id === id)
  return a ? a.label : id
}
