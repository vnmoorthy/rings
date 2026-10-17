// Classifying commits by the AI or automation signal they disclose.
// The classes describe what the history *says*, never who wrote the code:
//   trailer  a trailer or message line discloses AI help: a co-author that is a coding agent
//            (Co-authored-by: Claude <noreply@anthropic.com>), an Assisted-by / AI-assisted /
//            Generated-by line naming a tool, a bare "AI-assisted" line, or aider's "(aider)" author suffix
//   agent    the commit author is an AI coding agent's own account (copilot-swe-agent, devin-ai-integration ...)
//   bot      the commit author is a bot-named or automation account (dependabot, github-actions, *bot ...),
//            including CI chores pushed by an agent's account
//   session  (local repos, opt-in) made while a Claude Code or Codex session was running in this repo
//   none     no signal. This does NOT mean a human wrote it.

export const CLASSES = ['trailer', 'agent', 'bot', 'session', 'none']

export const CLASS_LABELS = {
  trailer: 'AI co-author / assisted-by trailer',
  agent: 'AI agent account',
  bot: 'bot-named account',
  session: 'during an agent session',
  none: 'no AI signal',
}

const PERSONAL_MAIL = /@(?:gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|proton|protonmail|qq|163|126|yandex|gmx|aol)\./i

// Co-author identities ("Name <email>"). Rules: match an agent's own display name or its no-reply
// address, never a company domain (Bun's engineers commit from anthropic.com, OpenAI's from
// openai.com) and never a person's full name ("Claude Paroz", "Devin Weaver"). A bare first name
// ("Claude", "Cursor", "Gemini") counts only when the address is not a personal mailbox.
const MODEL_WORDS = '(?:\\s+(?:code|cli|opus|sonnet|haiku|fable|mythos|agent|ai|bot|\\(?[\\w.[\\]-]*\\d[\\w.[\\]-]*\\)?|\\([^)]*\\)))*'
const bareName = (n) => new RegExp(`^${n}${MODEL_WORDS}\\s*(?:<(?![^>]*${PERSONAL_MAIL.source})|$)`, 'i')
export const AGENTS = [
  { id: 'claude', label: 'Claude', re: [/noreply@anthropic\.com/i, bareName('claude'), /^claude\[bot\]/i, /\+claude@users\.noreply\.github\.com/i, /anthropic-code-agent/i] },
  { id: 'codex', label: 'Codex', re: [/^codex\b/i, /codex@openai\.com/i, /noreply@openai\.com/i, /chatgpt-codex/i, /^chatgpt\b/i, /openai-code-agent/i, /\+codex@users\.noreply\.github\.com/i] },
  { id: 'copilot', label: 'Copilot', re: [/^copilot\b/i, /\+copilot@users\.noreply\.github\.com/i, /copilot-swe-agent/i, /copilot@github\.com/i, /copilot autofix/i] },
  { id: 'cursor', label: 'Cursor', re: [/cursoragent@/i, bareName('cursor'), /^cursor\[bot\]/i] },
  { id: 'gemini', label: 'Gemini', re: [/gemini-code-assist/i, bareName('gemini')] },
  { id: 'jules', label: 'Jules', re: [/google-labs-jules/i] },
  { id: 'aider', label: 'Aider', re: [/noreply@aider\.(?:chat|dev)/i, /aider@aider\.chat/i, /^aider\b/i] },
  { id: 'devin', label: 'Devin', re: [/devin-ai-integration/i, /^devin(?:\s+ai)?\s*<[^>]*devin-ai/i] },
  { id: 'amp', label: 'Amp', re: [/amp@ampcode\.com/i, /^amp\s*<[^>]*ampcode/i, /^amp\[bot\]/i] },
  { id: 'opencode', label: 'opencode', re: [/^opencode\b/i, /noreply@opencode\.ai/i] },
  { id: 'windsurf', label: 'Windsurf', re: [/^(?:windsurf|cascade)\b[^<]*<[^>]*(?:windsurf|codeium)/i] },
  { id: 'cline', label: 'Cline', re: [/^cline(?:\s+(?:bot|agent))?\s*<[^>]*cline/i] },
  { id: 'roo', label: 'Roo Code', re: [/^roo(?:[- ]?code)?\s*<[^>]*roo/i] },
  { id: 'junie', label: 'Junie', re: [/^junie\s*<[^>]*(?:jetbrains|junie)/i] },
  { id: 'qwen', label: 'Qwen Code', re: [/^qwen[- ]?code\b/i] },
  { id: 'openhands', label: 'OpenHands', re: [/^openhands\b/i, /openhands@all-hands\.dev/i, /openhands-agent/i] },
  { id: 'amazonq', label: 'Amazon Q', re: [/amazon-q-developer/i, /^amazon q\b/i] },
  { id: 'factory', label: 'Factory', re: [/factory-droid/i] },
  { id: 'kiro', label: 'Kiro', re: [/^kiro\s*<[^>]*kiro/i] },
  { id: 'codeflash', label: 'Codeflash', re: [/codeflash-ai/i] },
  { id: 'warp', label: 'Warp', re: [/oz-agent@warp\.dev/i] },
  { id: 'zed', label: 'Zed AI', re: [/^zed ai\s*<ai@zed\.dev>/i] },
  { id: 'opeswe', label: 'Open SWE', re: [/open-swe\[bot\]/i] },
]

// Disclosure keys that are about tools by convention (Assisted-by: Codex, AI-assisted: Claude Code,
// Generated-by: ...). Values are split on , ; / + and "vendor:model" forms are read by their first part.
const TOOL_KEYS = new Set(['assisted-by', 'ai-assisted', 'ai-assisted-by', 'generated-by', 'made-with', 'disclosure'])
const CO_AUTHOR_KEYS = new Set(['co-authored-by', 'coauthored-by', 'co-authored'])
const TOOL_WORDS = [
  ['claude', /\b(?:claude|sonnet|opus|haiku|fable|anthropic)\b/i],
  ['codex', /\b(?:codex|chatgpt)\b/i],
  ['openai', /\b(?:openai|gpt[-\s]?\d[\w.-]*|o\d(?:-mini)?)\b/i],
  ['copilot', /\bcopilot\b/i],
  ['cursor', /\bcursor\b/i],
  ['gemini', /\bgemini\b/i],
  ['opencode', /\bopencode\b/i],
  ['amp', /\bamp\b/i],
  ['aider', /\baider\b/i],
  ['devin', /\bdevin\b/i],
  ['grok', /\bgrok\b/i],
  ['deepseek', /\bdeepseek\b/i],
  ['qwen', /\bqwen/i],
  ['glm', /\bglm[-\s]?\d/i],
  ['kimi', /\bkimi\b/i],
  ['pi', /^pi\b|\bpi coding agent\b|:\s*local pi\b|\bpi:/i],
  ['ai', /\b(?:ai|llm|large language model|language model|reasoning model|coding agent|ai agent)\b/i],
]
const TOOL_LABELS = { openai: 'OpenAI models', grok: 'Grok', deepseek: 'DeepSeek', glm: 'GLM', kimi: 'Kimi', pi: 'pi', ai: 'an unnamed AI tool' }

// Author accounts that are AI coding agents acting on their own.
const AGENT_ACCOUNT_RE = [
  /copilot-swe-agent/i, /\+copilot@users\.noreply\.github\.com/i, /devin-ai-integration/i, /google-labs-jules/i,
  /^claude\[bot\]/i, /^claude(?:\s+code)?\s*<[^>]*@anthropic\.com/i, /\+claude@users\.noreply\.github\.com/i, /anthropic-code-agent/i,
  /^cursor\[bot\]/i, /cursoragent@cursor\.com/i, /chatgpt-codex-connector/i, /^codex\[bot\]/i, /openai-codex/i, /openai-code-agent/i,
  /openhands-agent/i, /gemini-code-assist/i, /amazon-q-developer/i, /factory-droid/i, /sweep-ai/i, /^amp\[bot\]/i,
  /opencode-agent\[bot\]/i, /^cline-cloud\[bot\]/i, /open-swe\[bot\]/i, /codeflash-ai\[bot\]/i,
]
// Automated chores pushed by an agent's account (code generation, lockfiles, formatting) are automation.
const CHORE = /^(?:chore|ci|build)(?:\([^)]*\))?!?:|^\[ci\]|^merge\b|\bnix\b.*\bhash|^(?:format|generate|regenerate|refresh|sync|bump|update (?:lockfile|deps|dependencies|snapshots?))\b/i

function identity(name, email) {
  return `${(name || '').trim()} <${(email || '').trim()}>`
}

export function agentOf(id) {
  for (const a of AGENTS) if (a.re.some((re) => re.test(id))) return a.id
  return null
}

// Tools named in an Assisted-by-style value: "Codex", "claude:opus-5.5", "Claude, Codex", "AI".
export function toolsIn(value) {
  const out = []
  for (const part of String(value).split(/[,;/+]|\band\b/i)) {
    const p = part.trim()
    if (!p) continue
    const head = p.split(':')[0]
    const id = agentOf(p) || agentOf(head) || (TOOL_WORDS.find(([, re]) => re.test(head)) || TOOL_WORDS.find(([, re]) => re.test(p)) || [])[0] || null
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}

export function isBotAccount(name, email, { bots = [], humans = [] } = {}) {
  const n = (name || '').trim()
  const e = (email || '').trim().toLowerCase()
  const nl = n.toLowerCase()
  if (humans.some((h) => h.toLowerCase() === nl || h.toLowerCase() === e)) return false
  if (bots.some((b) => b.toLowerCase() === nl || b.toLowerCase() === e)) return true
  if (/\[bot\]$/i.test(n) || /\[bot\]@/i.test(e)) return true
  if (/^[a-z0-9._-]*[-_.](?:bot|robot)$/.test(n)) return true // lowercase handles with a separator: k8s-ci-robot, mergify-bot
  // separator-less handles (denobot, zaniebot) only with a no-reply or bot-style address, so a person
  // whose handle happens to end in "bot" (lyonbot on outlook.com) is not counted
  if (/^[a-z0-9._-]+(?:bot|robot)$/.test(n) && (/noreply|\+bot@|bot@|robot@|@accounts\./.test(e) || e.split('@')[0].includes('bot')) && !PERSONAL_MAIL.test(e)) return true
  // robo-named service accounts whose email is their own name on an org domain (robobun <robobun@oven.sh>)
  if (/^robo[a-z-]+$/.test(n) && e.startsWith(`${nl}@`) && !PERSONAL_MAIL.test(e) && !/users\.noreply\.github\.com$/.test(e)) return true
  if (/[-_.](?:bot|robot|automation)$/i.test(n)) return true
  if (/(?:^|[\s(])bot\)?$/i.test(n)) return true // "TypeScript Bot", "Houston (Bot)", "Fred K. Bot"
  if (/^(?:github[- ]actions?|actions-user|dependabot|renovate|greenkeeper|semantic-release|allcontributors|imgbot|pre-commit-ci|mergify|kodiakhq|copybara|bors|homu)$/i.test(n)) return true
  if (/^actions?@github\.com$/.test(e)) return true
  const local = e.split('@')[0]
  if (/(?:^|[-_.+])(?:bot|robot)$/.test(local) && /noreply|bot|actions|automation/.test(e)) return true
  return false
}

export function isAgentAccount(name, email) {
  const id = identity(name, email)
  return AGENT_ACCOUNT_RE.some((re) => re.test(id))
}

// AI disclosed by a commit's trailers or message lines, whoever the author is. Returns { agent, via } or null.
export function aiDisclosure(c) {
  if (/\(aider\)\s*$/i.test(c.name || '')) return { agent: 'aider', via: 'author' }
  let toolHit = null
  for (const t of c.trailers || []) {
    if (CO_AUTHOR_KEYS.has(t.key)) {
      const a = agentOf(t.value)
      if (a) return { agent: a, via: 'co-author' }
    } else if (TOOL_KEYS.has(t.key) && !toolHit) {
      const tools = toolsIn(t.value)
      if (tools.length) toolHit = { agent: tools[0], agents: tools, via: t.key === 'generated-by' || t.key === 'made-with' ? 'generated' : 'assisted' }
    }
  }
  return toolHit
}

// Returns { cls, agent, via } for one commit.
export function classifyCommit(c, opts = {}) {
  if (isAgentAccount(c.name, c.email)) {
    if (CHORE.test(c.subject || '') && (!c.cname || c.cname === c.name)) return { cls: 'bot', agent: null }
    return { cls: 'agent', agent: agentOf(identity(c.name, c.email)) }
  }
  const d = aiDisclosure(c)
  if (d) return { cls: 'trailer', agent: d.agent, via: d.via }
  if (isBotAccount(c.name, c.email, opts)) return { cls: 'bot', agent: null }
  if (opts.inSession && opts.inSession(c.t)) return { cls: 'session', agent: null }
  return { cls: 'none', agent: null }
}

export function agentLabel(id) {
  const a = AGENTS.find((x) => x.id === id)
  return a ? a.label : TOOL_LABELS[id] || id
}
