# Pathmode plugin for Claude Code

Turn a vague feature idea into a spec your coding agent can build against. One install gives you the [@pathmode/mcp-server](https://www.npmjs.com/package/@pathmode/mcp-server) plus a skill pack for preflighting, compiling, grilling, verifying, and handing off [intent specs](https://intentspec.org/spec).

This repository carries its own spec in the same format the plugin produces: [read its intent.md](intent.md). Product decisions about the plugin are made here, in pull requests, and this is where its history will show whether the workflow holds.

The plugin is free. It uses the models you already have access to in Claude Code, so there is nothing to configure and no key to paste. Run `/preflight` (or just ask Claude to run a preflight) for a deterministic verdict on whether your intent is ready for an agent: six calibrated gates, the exact blockers named, the same result every run. No spec yet? `/preflight` drafts a provisional one from your conversation, marks its assumptions, and preflights that — the first run always ends in a verdict. The same gate runs live in your browser at [preflight.pathmode.io](https://preflight.pathmode.io).

## Install

```
/plugin marketplace add pathmodeio/claude-plugin
/plugin install pathmode@pathmode
```

No API key needed. Keyless installs run in **local mode**: specs live in [`intent.md`](https://intentspec.org/intent-md) in your project, nothing leaves your machine, and 9 local MCP tools are available (including `check_intent_readiness`, the deterministic preflight, and `confirm_intent_dimension` to resolve a gate that read your text but could not confirm it).

To sync with a Pathmode workspace (33 tools: evidence queries, revision-bound PM requests, agent-proposed corrections, intent graph, verification recording), create an API key at [pathmode.io/settings](https://pathmode.io/settings) and enter it when the plugin prompts for configuration. The key is stored in your OS keychain, never in a config file.

## What's bundled

**MCP server** — `@pathmode/mcp-server@1.33.0`, pinned so the plugin skills and server tool contract update together. Local mode with no key; cloud mode with one.

**Check the gate yourself** — `node scripts/readiness-suite.mjs` runs the pinned server's preflight over 111 labelled field fixtures and a set of whole `intent.md` documents, and prints where it disagrees. Read [CALIBRATION.md](CALIBRATION.md) first: the field score is a regression baseline, not an accuracy claim.

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
status, and how far it has drifted from the work (days since it was edited, commits since). The
same line is given to every subagent Claude delegates to, because a subagent starts from its own
context and never sees what the parent session was told. That is all it does. It reads the file
and your git log locally, never sends anything anywhere, works without an API key, and stays
completely silent in repos with no intent. If you would rather it did not run, remove the
`SessionStart` and `SubagentStart` entries from `hooks/hooks.json`.

## The calibration corpus

`/preflight` is deterministic, which means its judgment is only as good as what it was tuned
against. That tuning set is in this repo, mirrored from the monorepo that owns it, so you can check
it rather than take the number on faith.

[`readiness-corpus.json`](./readiness-corpus.json) holds 111 hand-labeled spec fragments, 58 labeled
`good` and 53 labeled `vague`, spread across the gates: 24 objectives, 37 outcomes, 20 titles,
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

## Developing

Everything runs from this repository. Nothing here needs the Pathmode monorepo, an account, or a key.

```
git clone https://github.com/pathmodeio/claude-plugin
cd claude-plugin
npm ci
npm test                # the session hook's tests
npm run validate        # claude plugin validate . --strict
npm run check:skills    # skills/ against the pinned server version
```

`hooks/` and `commands/` are authored here. Change them, add a test, open a pull request. CI runs
the three commands above on every pull request.

**Releasing.** Bump `version` in `.claude-plugin/plugin.json`, merge, and tag. Installed plugins
auto-update. There is no publish step and no monorepo step.

**What is mirrored, and why you should not edit it here.** `skills/` and `readiness-corpus.json`
are copies. They are owned by the Pathmode monorepo, where `skills/` is the source the MCP server
itself ships and the corpus is what Pathmode's cross-implementation parity tests run against. They
arrive here only through pull requests titled `sync(skills):`. A hand edit to `skills/` fails CI:
`npm run check:skills` compares every skill against the skills inside the exact
`@pathmode/mcp-server` version pinned in [`.mcp.json`](.mcp.json), so a copy that has drifted from
the server the plugin actually launches is caught before it ships. The corpus has no equivalent
automatic check, because the server package does not ship it; treat it as read-only and report
problems as issues.

Because the check compares against the pinned version, a skill change reaches this repo only after
a server release carrying it has been published and pinned. That ordering is deliberate: the skills
you get and the tools they call are always from the same server build.

**Configuration.** The server reads the key from `PATHMODE_API_KEY`, injected from the
keychain-backed `${user_config.api_key}`. Blank or unsubstituted values fall through to keyless
local mode (guarded in the server's `loadConfig`).
