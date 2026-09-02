---
name: implement-intent
description: Implement the repository's active intent only after running its deterministic preflight. Use when the user asks to build, implement, fix, or change product code under an intent.md. Works in keyless local mode and connected team mode.
---

<what-to-do>

Read `intent.md` from the project root first. It is the repository-bound authority. Call `check_intent_readiness` before changing product code: with no arguments for that file, or with `intentId` only when the user explicitly selected a cloud-only intent.

If Preflight has unresolved blockers, show its exact verdict and work through the `preflight` repair loop one targeted question at a time. Do not silently begin implementation from a failing spec.

The user may explicitly accept named blockers and ask you to proceed. That is **accepted risk**, not a waiver: a waiver says a dimension does not apply, while accepted risk says the gap is real. Preserve the judgment by calling `intent_save` with the complete current spec and an added decision:

- `choice`: `Proceed despite preflight blockers: <exact gate names>`
- `ruledOut`: `Repair every blocker before implementation`
- `reason`: the user's stated reason, without embellishment

Re-run Preflight afterward and show the still-failing verdict. Never turn accepted risk into a green check. The acceptance authorizes only this implementation conversation; a later agent must ask again unless it has fresh human authorization for the exact revision.

In connected mode, a save changes the repository-body revision. Stop until a signed-in product owner authorizes that exact revision. Then call `get_agent_prompt`: use `mode: execute` when Preflight passes, or `mode: draft` when the user explicitly accepted still-visible blockers. Stop on an open change request or a pending, rejected, or stale authorization banner. Fetch `get_constitution` before implementation.

In keyless mode, do not call `get_agent_prompt`, `get_constitution`, or other cloud-only tools. Use `intent.md`, the repository instructions, and the codebase itself as the implementation context.

Create a small implementation plan mapped to the outcomes. Make only the changes needed for the authorized scope. Run the spec's verification checks, review the diff against outcomes, constraints, and edge cases, and finish with `handoff-intent` so material decisions and discoveries survive the session.

</what-to-do>

<supporting-info>

## Three independent judgments

- **Preflight** asks whether the spec is concrete enough to build and verify.
- **Accepted risk** records a human decision to proceed while a known gap remains. It never changes the Preflight verdict.
- **Authorization** confirms that a human permits an agent-originated repository revision to be implemented. It does not make a failing gate pass.

## Pull-request delivery

In connected mode, name the intent where the merge can find it: branch `intent/<intent-id>`, or `pathmode:<intent-id>` in the pull-request body. When a pull request is involved, do not call `update_intent_status`; the merge grades the real diff and owns the transition to Shipped. Without a pull request, mark Shipped only when the outcome is observable.

</supporting-info>
