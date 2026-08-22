#!/usr/bin/env node
/**
 * Sync the plugin's skills/ from the canonical source in packages/mcp-server/skills/.
 *
 * The MCP server package is the source of truth for skill content (it also ships
 * them via `install-skills`). This script keeps the plugin's copies identical.
 * Run it from the monorepo before cutting a plugin release:
 *
 *   node packages/claude-plugin/scripts/sync-skills.mjs
 *
 * In the standalone public plugin repo the source dir doesn't exist and this
 * script exits with an explanation — the skills there are updated by re-syncing
 * in the monorepo and pushing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.resolve(pluginRoot, '..', 'mcp-server', 'skills');
const targetDir = path.join(pluginRoot, 'skills');

if (!fs.existsSync(sourceDir)) {
    console.error(`Source skills dir not found: ${sourceDir}`);
    console.error('This script only runs inside the Pathmode monorepo, where packages/mcp-server/skills/ is the source of truth.');
    process.exit(2);
}

const entries = fs.readdirSync(sourceDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && fs.existsSync(path.join(sourceDir, e.name, 'SKILL.md')));

if (entries.length === 0) {
    console.error(`No <name>/SKILL.md directories found in ${sourceDir}`);
    process.exit(2);
}

fs.rmSync(targetDir, { recursive: true, force: true });
fs.mkdirSync(targetDir, { recursive: true });

for (const entry of entries) {
    fs.cpSync(path.join(sourceDir, entry.name), path.join(targetDir, entry.name), { recursive: true });
    console.log(`  synced ${entry.name}`);
}
console.log(`${entries.length} skills synced to ${targetDir}`);
