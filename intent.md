---
id: "INT-CLAUDE-PLUGIN-PREFLIGHT-001"
status: "approved"
userGoal: "Use product-intent checks inside Claude Code without manual setup"
objective: "Help Claude Code users turn a vague request into a checked intent.md before implementation begins"
evidence:
  - type: "observation"
    source: "Claude plugin command and session-hook behavior"
    excerpt: "The plugin bundles the local MCP server, readiness skills, and a session hook so intent can be checked in the workflow where implementation starts."
    anchors: ["objective", "outcome:0"]
outcomes:
  - "One plugin installation exposes 1 preflight command, 1 local MCP server, and the complete intent skill set in Claude Code"
  - "100% of preflight invocations end with a 6-of-6 gate verdict against an existing or provisional intent"
  - "A session in a repository with intent.md receives exactly 1 concise intent-state line, while a repository without one receives 0 lines"
constraints:
  - "Keyless use must not send the intent or repository contents to Pathmode"
  - "The session hook must remain silent when no intent file exists"
  - "The plugin must use the models and credentials already available in Claude Code"
edgeCases:
  - scenario: "No intent.md exists when the user invokes preflight"
    expectedBehavior: "The plugin drafts a provisional intent from conversation context, labels assumptions, and still returns a verdict"
  - scenario: "The repository has no intent file when a session starts"
    expectedBehavior: "The session hook adds no output and does not interrupt startup"
verification:
  - "Run the session-hook tests and confirm repositories with and without intent.md produce the expected output counts"
  - "Run the strict Claude plugin validator and confirm the package is valid"
  - "Install the plugin in a clean Claude Code profile and confirm preflight returns all six gate states"
healthMetrics:
  - "Plugin startup remains silent and fast in repositories without intent.md"
  - "The bundled skills stay synchronized with packages/mcp-server/skills"
---
