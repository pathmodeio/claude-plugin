# Pathmode plugin for Claude Code

Turn a vague feature idea into a spec your coding agent can build against. One install gives you the [@pathmode/mcp-server](https://www.npmjs.com/package/@pathmode/mcp-server) plus a skill pack for preflighting, compiling, grilling, verifying, and handing off [intent specs](https://intentspec.org/spec).

This repository dogfoods the same workflow: [read its intent.md](intent.md).

The plugin is free. It uses the models you already have access to in Claude Code, so there is nothing to configure and no key to paste. Run `/preflight` (or just ask Claude to run a preflight) for a deterministic verdict on whether your intent is ready for an agent: six calibrated gates, the exact blockers named, the same result every run. No spec yet? `/preflight` drafts a provisional one from your conversation, marks its assumptions, and preflights that — the first run always ends in a verdict. The same gate runs live in your browser at [preflight.pathmode.io](https://preflight.pathmode.io).

## Install

```
/plugin marketplace add pathmodeio/claude-plugin
/plugin install pathmode@pathmode
```

No API key needed. Keyless installs run in **local mode**: specs live in [`intent.md`](https://intentspec.org/intent-md) in your project, nothing leaves your machine, and 9 local MCP tools are available (including `check_intent_readiness`, the deterministic preflight, and `confirm_intent_dimension` to resolve a gate that read your text but could not confirm it).

To sync with a Pathmode workspace (30 tools: evidence queries, revision-bound PM requests, intent graph, verification recording), create an API key at [pathmode.io/settings](https://pathmode.io/settings) and enter it when the plugin prompts for configuration. The key is stored in your OS keychain, never in a config file.

## What's bundled

**MCP server** — `@pathmode/mcp-server@1.23.0`, pinned so the plugin skills and server tool contract update together. Local mode with no key; cloud mode with one.

**Command** — `/preflight` runs the deterministic six-gate readiness check and always ends in a verdict: on your `intent.md` if one exists, on a spec described in the conversation, or on a provisional draft it builds from context with assumptions marked.

**Skills** — auto-trigger from what you ask Claude, in rough lifecycle order:

| Skill | Use when |
|-------|----------|
| `setup-pathmode-workflow` | First-time setup — test commands, issue tracker, status conventions |
| `compile-intent` | Building a structured spec for what to ship |
| `preflight` | Deterministic readiness verdict before an agent builds — six gates, exact blockers |
| `implement-intent` | Implementing the repository intent only after Preflight and required human authorization |
| `verify-intent` | Designing the executable feedback loop for a spec |
| `grill-intent` | Stress-testing a spec for weaknesses before code is written |
| `split-intent-to-issues` | Breaking a spec into paste-ready Linear / Jira / GitHub tickets |
| `review-against-intent` | Checking code changes against the intent's outcomes and constraints |
| `handoff-intent` | Capturing decisions and discoveries at the end of a session |

**Session hook** — when a session starts in a repo that has an `intent.md` (root or
`.pathmode/intents/`), one line of state is added to Claude's context: the intent's title, its
status, and how far it has drifted from the work (days since it was edited, commits since). That
is all it does. It reads the file and your git log locally, never sends anything anywhere, works
without an API key, and stays completely silent in repos with no intent. If you would rather it
did not run, remove the `SessionStart` entry from `hooks/hooks.json`.

## The calibration corpus

`/preflight` is deterministic, which means its judgment is only as good as what it was tuned
against. That tuning set is in this repo, so you can check it rather than take the number on faith.

[`readiness-corpus.json`](./readiness-corpus.json) holds 98 hand-labeled spec fragments, 51 labeled
`good` and 47 labeled `vague`, spread across the gates: 24 objectives, 24 outcomes, 20 titles,
18 constraints, 12 verification checks. Each item carries the text, the label, and the tags that
explain the call:

```json
{ "kind": "objective",
  "text": "Make the dashboard better.",
  "label": "vague",
  "tags": ["genuinely-vague", "no-actor", "platitude"] }
```

Two things follow from publishing it. The gates are calibrated heuristics, not natural language
understanding, and the corpus makes the exact boundary visible instead of arguable in the abstract.
And if you think a label is wrong, that is a concrete disagreement about a specific line, which is
worth more to us than a general objection. Open an issue.

Pathmode's CI runs both implementations of the gate, the browser one and the one in the MCP server,
across this entire corpus and fails on any divergence, so the verdict you get in the terminal is the
verdict the demo page gives.

## Already ran `npx @pathmode/mcp-server setup`?

The plugin registers its own `pathmode` MCP server, so remove the older entry from your project `.mcp.json` (or `claude_desktop_config.json`) to avoid a duplicate. Skills previously copied into `.claude/skills/` via `install-skills` can also be deleted — the plugin's copies supersede them.

## Maintainer notes (monorepo)

- `skills/` is a synced copy of `packages/mcp-server/skills/` — edit there, then run `node scripts/sync-skills.mjs`. Never edit the copies. `commands/` is plugin-native and hand-authored here (sync-skills does not touch it); keep `/preflight` aligned with the `preflight` skill's invariants.
- Validate before release: `claude plugin validate packages/claude-plugin --strict`
- Distribution: this directory is published as the public `pathmodeio/claude-plugin` repo (plugin and marketplace in one, `source: "./"`). Bump `version` in `.claude-plugin/plugin.json` on every release — installed plugins auto-update.
- The server reads the key from `PATHMODE_API_KEY`, injected from the keychain-backed `${user_config.api_key}`. Blank or unsubstituted values fall through to keyless local mode (guarded in the server's `loadConfig`).
