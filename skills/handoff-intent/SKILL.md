---
name: handoff-intent
description: Capture context at the end of an implementation session — decisions made, blockers hit, what's left. Use before ending a session or switching to a different intent. Ensures the next session (or the next person) doesn't lose context.
---

<what-to-do>

Load the active intent. If `PATHMODE_API_KEY` is set, call `get_current_intent` (Pathmode MCP). Otherwise read `intent.md` from the project root.

Summarize the session in four buckets:

- What outcomes are now delivered
- What technical decisions were made (and WHY — the "why" is what matters)
- What was discovered that wasn't in the spec (new edge case, hidden constraint, surprising interaction)
- What's blocked, and on what

For each decision and discovery, call `log_implementation_note` with a self-contained summary. Assume the next reader has none of this conversation's context.

If the work is going out as a pull request, name the intent where the merge can find it: branch `intent/<intent-id>`, or `pathmode:<intent-id>` anywhere in the PR body. Without that reference the merge cannot connect the code to the spec, and the whole delivery loop stays dark.

If outcomes are delivered, propose a status bump — but read "Status bumps" below first: when a PR is involved, the merge owns that transition, not you. If the spec needs amendments based on what was learned, propose them.

</what-to-do>

<supporting-info>

## What good handoff notes look like

Bad: "Fixed the timeout bug."

Good: "Reduced payment timeout from 30s to 3s by switching from polling to webhook callbacks. Webhook requires Stripe whitelist for the staging IP — see ticket OPS-1234 for the IP request. Tradeoff accepted: webhooks are async, so the success page now needs to handle the pending state for ~2s while waiting for confirmation."

The "why" and the "what's still implicit" are the parts that disappear if you don't capture them.

## Status bumps

- `shipped` — code is merged AND the outcome is observable in production
- `verified` — the outcome metric has held for at least one full cycle (e.g., one week, one release)

**When the change ships through a pull request, do NOT call `update_intent_status` yourself.** If the workspace has GitHub connected, the merge reads the real diff, grades it against the spec, moves the intent to Shipped, and records what the verdict rested on. The webhook skips intents that are already shipped, so flipping it early does not just duplicate that work — it suppresses it, replacing a diff-backed verdict with an unverified one. Stamp the reference, let the merge fire, and bump the status by hand only when the change will never appear in a PR.

Do NOT bump to `shipped` if outcomes are only partially delivered. Either leave the status and log the partial delivery as a note, or propose a spec amendment that scopes the outcome to what was actually shipped.

## Difference from a commit message

A commit message records what the code did.
A handoff note records what the engineer learned and decided.

Both matter. They live in different places. This skill writes to the intent layer; git keeps the code layer.

## What NOT to capture

Routine implementation details ("used a `for` loop instead of `map`") are not handoff material. Capture only what would surprise the next reader — non-obvious decisions, hidden constraints, accepted tradeoffs.

</supporting-info>
