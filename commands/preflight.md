---
description: Run the deterministic six-gate preflight on the intent you are about to hand to an agent. Always ends in a verdict.
argument-hint: [path to an intent.md, or leave empty]
---

<!--
  Plugin-native command: hand-authored here, NOT synced by scripts/sync-skills.mjs.
  Its sibling is the ambient skill at skills/preflight/SKILL.md (synced from
  packages/mcp-server/skills/) — keep the shared invariants aligned when either
  changes: show the verdict block verbatim, repair one blocker at a time, never
  block on a failing verdict.
-->

Run a Pathmode preflight. Work through these branches in order and ALWAYS end with a verdict from the `check_intent_readiness` MCP tool (Pathmode). Never end with a request for more input instead of a verdict.

1. If the user passed a file path in $ARGUMENTS, read that exact file, extract its spec fields (title, objective, outcomes, constraints, edgeCases, verification), and call `check_intent_readiness` with the spec inline. Do not call the tool with no arguments for an explicit path: that would select the current intent and could score a different file. If no path was passed but an `intent.md` exists in the project root (or under `.pathmode/intents/`), call `check_intent_readiness` with no arguments (or with `intentId` for a specific saved intent). Show the verdict block exactly as returned. The blocker strings are calibrated gate output: do not paraphrase them.

   In connected mode, when the repo-bound file carries a cloud id, call `list_intent_change_requests` for that id before implementation. Read every open request with `get_intent_change_request`; deliberately apply it to `intent.md` and call `intent_save` with its exact `changeRequestId` and `baseRepoBodyRevision`, or reject an unworkable request with a concrete reason. After applying a request, re-run preflight and STOP until `get_agent_prompt` confirms that a signed-in product owner authorized the exact new repository revision.

2. Otherwise, if a spec or a concrete task has been described in this conversation, assemble a spec object from it (title, objective, outcomes, constraints, edgeCases, verification) and call `check_intent_readiness` with the spec inline.

3. Otherwise, draft a provisional spec from whatever context you have: the repo, recent changes, or the user's last request. Mark every inferred field as an assumption, and say plainly: "No user evidence was provided, so this objective is currently an assumption." Then preflight the draft inline. The first run must end in a verdict on SOMETHING concrete, because a verdict on a marked-assumption draft teaches more than a request for a spec.

After the verdict:

- **Failing:** name the single most important fix first (the first failing blocker). Ask ONE targeted question for it, and propose your best-guess answer from the spec and the codebase so the user corrects rather than composes. Apply the agreed fix, offer `intent_save` for drafts, then re-run the preflight. Never block work on a failing verdict: the gate reports, the user decides.
- **Passing:** say so and stop. Do not invent extra requirements beyond the six gates.
