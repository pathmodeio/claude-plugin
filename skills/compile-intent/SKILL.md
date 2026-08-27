---
name: compile-intent
description: Build a structured intent spec through Socratic conversation. Use when the user wants to define what to build, sharpen a vague idea into a testable spec, or capture product intent before writing code. Compiles to intent.md in the project root and (if an API key is set) syncs to a Pathmode workspace.
---

<what-to-do>

Invoke the `compile-intent` MCP prompt from the @pathmode/mcp-server. This starts a Socratic conversation that turns a vague problem into a structured intent spec.

For each question you ask, propose your best-guess answer based on the conversation so far. Don't make the user generate from a blank page.

Before the spec is finished, gather implementation context. You are already sitting in the repo, so read it: which files and modules this change lands in, what already exists there, what it would touch, and how it could be verified. Pass it to `intent_save` as `implementationContext` — in both modes. A brand-new spec has no intent id yet, so there is nothing to address a separate call to; `intent_save` carries the context through as part of the save. Use `record_implementation_context` only to update the context on an intent that already exists. It is free text, sub-headings welcome, and it is advisory — it never changes the readiness verdict. Its job is to stop the implementing agent from rediscovering the codebase from scratch, and to catch the case where the thing being specified half-exists already.

When the spec is ready, call the `intent_save` MCP tool to write `intent.md` to the project root.

</what-to-do>

<supporting-info>

## Why Socratic, not template

The compile-intent prompt is interrogative on purpose. It pushes back on vague language, challenges unmeasurable outcomes, and forces concrete constraints before moving on. Specs written in one shot tend to be wishful; specs that survive grilling are agent-ready.

## Output shape

`intent.md` at the project root:

```markdown
---
id: "intent_..."
version: 1
status: "draft"
---
# [Title]

## Objective
[What needs to change and for whom]

## Implementation Context
[What the repo actually looks like where this lands — read from the working tree, not guessed]

## Outcomes
- [ ] [Observable state change, testable in under 5 minutes]

## Edge Cases
- **[Scenario]**: [Expected behavior]

## Constraints
- [Hard limit — what must never happen]
```

If `PATHMODE_API_KEY` is set, the spec also syncs to the user's Pathmode workspace and becomes visible to other team members and other agents.

## Downstream skills

After compiling, these skills consume the spec:

- `grill-intent` — re-enter the Socratic loop to find weaknesses before code gets written
- `review-against-intent` — check code changes against outcomes and constraints
- `handoff-intent` — capture decisions and discoveries back to the spec at end of session

</supporting-info>
