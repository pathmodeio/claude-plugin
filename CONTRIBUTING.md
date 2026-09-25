# Contributing

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

## Releasing

Bump `version` in `.claude-plugin/plugin.json`, merge, and tag. Installed plugins auto-update.
There is no publish step and no monorepo step.

## What is mirrored, and why you should not edit it here

`skills/` and `readiness-corpus.json` are copies. They are owned by the Pathmode monorepo, where `skills/` is the source the MCP server
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

## Configuration

The server reads the key from `PATHMODE_API_KEY`, injected from the keychain-backed
`${user_config.api_key}`. Blank or unsubstituted values fall through to keyless local mode
(guarded in the server's `loadConfig`).
