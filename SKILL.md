---
name: rings
description: Cut a Git repository open like a tree trunk and draw its growth rings as one self-contained HTML page (with PNG export). One ring per month (or week, day, commit for younger repos), ring width from that period's commits, and coloured arcs where the commit history itself discloses an AI co-author trailer (Claude, Codex, Copilot, Cursor, Gemini, Aider ...), an AI agent's own account (copilot-swe-agent, devin-ai-integration, google-labs-jules ...) or a bot-named account. Use this whenever someone asks to visualise a repo's history, show how a codebase grew, see when AI coding agents started showing up in a project, make "tree rings" or a "cross-section" of a repo, or wants a shareable picture of their project's history, for their own repo or any public GitHub repo, even if they never say "rings".
license: MIT
compatibility: Claude Code, Codex, OpenCode and other agents that run shell commands. Needs git and Node.js 18+. Uses only Node built-ins; no API keys, nothing uploaded.
metadata:
  opencode/slash: "true"
---

# Rings

Rings reads commit metadata (never file contents) and draws a cut log: pith at the first commit, bark at the latest. The page animates the growth, shows a readout when you hover a ring, and exports a 1080x1080 PNG and a 1200x630 social card.

## Run it

The script lives next to this file. From the user's working directory:

```bash
node <this skill's folder>/bin/rings.mjs <target> --json -o <out.html>
```

- `<target>` is `.` (the current repo, the default), any local path, `owner/name`, or a GitHub URL. Remote repos are cloned history-only (`--filter=tree:0`) into `~/.cache/rings`; even large repos take seconds to a couple of minutes.
- Pick `<out.html>` as `./<name>-rings.html` unless the user asked for a place.
- For the user's **own local repo**, add `--sessions`: commits made while a Claude Code or Codex session was running in that repo get a green "during an agent session" arc. It only reads `~/.claude/projects` and `~/.codex/sessions` locally (cwd and timestamps from the first and last lines of each transcript). Mention that older transcripts may have been cleaned up, so early rings can show no session signal.
- Useful options: `--unit month|week|day|commit|quarter` to override the automatic ring size, `--bots name1,name2` to mark extra automation accounts, `--humans name` to clear a false bot match, `--ref <branch>`.

`--json` prints a summary: commit count, ring unit, class shares, agents seen, top bot-named accounts, the generated caption lines and a `notable` list (first AI co-author trailer, peak trailer share, first agent account, peak bot share, busiest ring), each with a sample commit hash.

## Then

1. Open the HTML for the user (`open` on macOS, `xdg-open` on Linux, `start` on Windows).
2. Reply with a two-line caption built from the summary's `caption` lines, then up to three "notable rings", each tied to its sample commit hash so the user can check it (`git show <hash> --stat`).
3. Tell them the page has **Download PNG** and **Download social card** buttons, and that hovering a ring shows its counts.

## How to talk about the result

The colours describe what commits *disclose*, not who wrote the code. Keep every sentence to what the data says:

- Say "carried an AI co-author trailer", "authored by the Copilot agent account", "authored by a bot-named account".
- Never say a commit or ring is "human-written", "AI-written", "hidden", "secret" or "undisclosed". Uncoloured wood means no signal.
- A drop in trailers does not mean a team stopped using AI. Tools change defaults, teams squash-merge, and agents move to their own accounts. Say what changed in the history and stop there.
- Name an account (for example "robobun") only as the author field shows it; do not guess what runs behind it.

If the repo has no AI signal at all, say so plainly ("no disclosed AI co-authors in 12,345 commits") and point out what the rings do show: the busiest month, dormant stretches, when growth sped up.
