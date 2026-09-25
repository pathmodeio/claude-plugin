# Pathmode plugin for Claude Code

Turn a vague feature idea into a spec your coding agent can build against. One install gives you the [@pathmode/mcp-server](https://www.npmjs.com/package/@pathmode/mcp-server) plus a skill pack for preflighting, compiling, grilling, verifying, and handing off [intent specs](https://intentspec.org/spec).

This repository carries its own spec in the same format the plugin produces: [read its intent.md](intent.md). Product decisions about the plugin are made here, in pull requests, and this is where its history will show whether the workflow holds.

The plugin is free. It uses the models you already have access to in Claude Code, so there is nothing to configure and no key to paste. Run `/preflight` (or just ask Claude to run a preflight) for a deterministic verdict on whether your intent is ready for an agent: six calibrated gates, the exact blockers named, the same result every run. No spec yet? `/preflight` drafts a provisional one from your conversation, marks its assumptions, and preflights that — the first run always ends in a verdict. The same gate, product choices included, runs live in your browser at [preflight.pathmode.io](https://preflight.pathmode.io).

## See it work

[Fieldnote](https://github.com/pathmodeio/fieldnote) is a small fictional billing app whose ticket
FN-412 asks for a `Cancel plan` button. Given one instruction, `implement FN-412`, Claude Code with
this plugin changed no product code. It drafted an `intent.md` and stopped:

> FN-412 reads like a one-button change, but it leaves one billing decision open that I don't
> think I should make for you.
>
> **The catch:** the only code that cancels a subscription today is `revokeAccess`
> (`src/billing/access.ts:13`). It was written for refunds, and it ends access the moment it's
> called. If the new button calls it, anyone who cancels loses the rest of a month they've already
> paid for, with no refund.

The preflight on the file it wrote:

```text
✓ Preflight passed. 6/6 checks.
⛔ Not ready to hand to an agent: 4 product choices still unresolved in Pathmode.
  ⛔ When a customer cancels, does access end immediately or at the end of the period they have already paid for?
  ⛔ Does cancelling refund any unused part of the current period?
  ⛔ Can a customer undo a scheduled cancellation before the period ends?
  ⛔ What happens when a past-due (payment failed) customer cancels?
```

Recorded 2026-09-25 with plugin 0.1.35 and server 1.34.0, no API key, in 61 seconds. Another run
may word it differently or find different choices; [RUN.md](https://github.com/pathmodeio/fieldnote/blob/run-4/fn-412-keyless-proposal/RUN.md)
lists every tool call. The verdict is deterministic, so running `npx -y @pathmode/cli preflight` on
that branch reproduces it.

**Three names, one check.** `/preflight` is what you type in Claude Code's chat.
`check_intent_readiness` is the MCP tool the agent calls on its own. `npx @pathmode/cli preflight`
runs the same gate in a terminal or in CI. All three grade with the same code.

**What a pass means.** The six checks read your text against a fixed vocabulary: a specific
title, an objective with an actor and a concrete problem, observable outcomes, a hard constraint,
an edge case with its expected behavior, and a runnable check. A pass says the spec is complete
enough to build from. It cannot say the decision is right, and an open product choice still blocks
it, because a recommendation is an assumption until a person decides. Schema validation (the
[IntentSpec Action](https://github.com/pathmodeio/validate-intentspec-action)) checks only
structure, and whether the outcomes happened is for verification after the build.

## Install

```
/plugin marketplace add pathmodeio/claude-plugin
/plugin install pathmode@pathmode
```

No API key needed. Keyless installs run in **local mode**: specs live in [`intent.md`](https://intentspec.org/intent-md) in your project, nothing leaves your machine, and 9 local MCP tools are available (including `check_intent_readiness`, the deterministic preflight, and `confirm_intent_dimension` to resolve a gate that read your text but could not confirm it).

To sync with a Pathmode workspace (33 tools: evidence queries, revision-bound PM requests, agent-proposed corrections, intent graph, verification recording), create an API key at [pathmode.io/settings](https://pathmode.io/settings) and enter it when the plugin prompts for configuration. The key is stored in your OS keychain, never in a config file.

## What's bundled

**MCP server** — `@pathmode/mcp-server@1.34.0`, pinned so the plugin skills and server tool contract update together. Local mode with no key; cloud mode with one.

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

**Session hook** — when a session starts in a repo that has an `intent.md` (at the root, in an
`intent/` folder as Anthropic's AI-native SDLC playbook lays it out, or in `.pathmode/intents/`),
one line of state is added to Claude's context: the intent's title, its status, and how far it
has drifted from the work (days since it was edited, commits since). When `intent/` holds several,
the line names them and picks none. The
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
across this entire corpus and fails on any divergence, so on these six checks the terminal and the demo
page agree. Product choices are not in the corpus; the browser and the terminal read them with the same
shared code, and Pathmode's tests hold both to the same verdict on the same files.

## Already ran `npx @pathmode/mcp-server setup`?

The plugin registers its own `pathmode` MCP server, so remove the older entry from your project `.mcp.json` (or `claude_desktop_config.json`) to avoid a duplicate. Skills previously copied into `.claude/skills/` via `install-skills` can also be deleted — the plugin's copies supersede them.

## Contributing

Hooks and commands are developed in this repository; `skills/` and the calibration corpus are
mirrored from the Pathmode monorepo and must not be edited here. [CONTRIBUTING.md](CONTRIBUTING.md)
covers the checks CI runs, releasing, and what is mirrored.
