#!/usr/bin/env node
/**
 * Skill-drift check for the public Pathmode plugin repository.
 *
 * `skills/` here is a MIRROR. The canonical source lives in the Pathmode monorepo at
 * packages/mcp-server/skills/, and it reaches this repo only through a labelled
 * `sync(skills):` pull request. A hand edit here, or a forgotten sync, silently ships skills that
 * disagree with the MCP server the plugin launches.
 *
 * This check has no access to the monorepo and needs none. The server package ships its own skills
 * (it installs them via `install-skills`), so the published tarball for the exact version pinned in
 * .mcp.json is a faithful stand-in for the canonical source. We download that tarball and compare.
 *
 * We compare against the PINNED version, never against `latest`. The pin is what a user's plugin
 * actually launches, so matching the pin is the property that matters; a deliberately older pin is a
 * consistent state, not a failure. Checking `latest` would turn every server release into an
 * instant red build here.
 *
 * Usage:  node scripts/check-skill-drift.mjs
 * Exit 0 when every skill matches, 1 on any mismatch, 2 when the check itself could not run.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE = '@pathmode/mcp-server';

/** Exit 2: the check could not run. Distinct from exit 1, which means it ran and found drift. */
function bail(message) {
    console.error(`skill-drift: ${message}`);
    process.exit(2);
}

/** The pinned version is the single source of truth for what to compare against. */
function readPinnedVersion() {
    const mcpPath = path.join(repoRoot, '.mcp.json');
    if (!existsSync(mcpPath)) bail(`.mcp.json not found at ${mcpPath}`);

    let config;
    try {
        config = JSON.parse(readFileSync(mcpPath, 'utf8'));
    } catch (error) {
        bail(`.mcp.json is not valid JSON: ${error.message}`);
    }

    const args = config?.mcpServers?.pathmode?.args;
    if (!Array.isArray(args)) bail('.mcp.json has no mcpServers.pathmode.args array');

    // The launcher is `npx -y @pathmode/mcp-server@<version>`; find that argument, not any other.
    const spec = args.find((arg) => typeof arg === 'string' && arg.startsWith(`${PACKAGE}@`));
    if (!spec) bail(`.mcp.json does not pin ${PACKAGE} to a version (found args: ${args.join(' ')})`);

    const version = spec.slice(PACKAGE.length + 1);
    if (!/^\d+\.\d+\.\d+/.test(version)) {
        bail(`${PACKAGE} is pinned to "${version}", which is not an exact version. Pin an exact version so this check is deterministic.`);
    }
    return version;
}

/** Download and unpack the published tarball. Returns the directory holding its skills/. */
function fetchPublishedSkills(version, workDir) {
    let packed;
    try {
        packed = execFileSync('npm', ['pack', `${PACKAGE}@${version}`, '--pack-destination', workDir], {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        }).trim().split('\n').pop().trim();
    } catch (error) {
        bail(`could not download ${PACKAGE}@${version} from npm: ${(error.stderr || error.message).toString().trim()}`);
    }

    try {
        execFileSync('tar', ['-xzf', path.join(workDir, packed), '-C', workDir], { stdio: 'ignore' });
    } catch (error) {
        bail(`could not unpack ${packed}: ${error.message}`);
    }

    const skillsDir = path.join(workDir, 'package', 'skills');
    if (!existsSync(skillsDir)) {
        bail(`${PACKAGE}@${version} ships no skills/ directory, so this check cannot verify anything against it`);
    }
    return skillsDir;
}

/**
 * A skill is a directory containing SKILL.md. The published package also carries a top-level
 * skills/README.md that the plugin deliberately does not copy, so only directories count.
 */
function readSkills(dir) {
    const skills = new Map();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const file = path.join(dir, entry.name, 'SKILL.md');
        if (!existsSync(file)) continue;
        skills.set(entry.name, readFileSync(file, 'utf8'));
    }
    return skills;
}

const version = readPinnedVersion();
const localSkillsDir = path.join(repoRoot, 'skills');
if (!existsSync(localSkillsDir)) bail(`skills/ not found at ${localSkillsDir}`);

const workDir = mkdtempSync(path.join(tmpdir(), 'pathmode-skill-drift-'));
let problems = [];
try {
    const published = readSkills(fetchPublishedSkills(version, workDir));
    const local = readSkills(localSkillsDir);

    if (published.size === 0) bail(`${PACKAGE}@${version} ships no <name>/SKILL.md directories`);
    if (local.size === 0) bail('skills/ contains no <name>/SKILL.md directories');

    for (const [name, text] of published) {
        if (!local.has(name)) problems.push(`missing: skills/${name}/SKILL.md is in ${PACKAGE}@${version} but not in this repo`);
        else if (local.get(name) !== text) problems.push(`changed: skills/${name}/SKILL.md differs from ${PACKAGE}@${version}`);
    }
    for (const name of local.keys()) {
        if (!published.has(name)) problems.push(`extra: skills/${name}/SKILL.md is in this repo but not in ${PACKAGE}@${version}`);
    }

    if (problems.length === 0) {
        console.log(`skill-drift: ${local.size} skills match ${PACKAGE}@${version}.`);
    }
} finally {
    rmSync(workDir, { recursive: true, force: true });
}

if (problems.length > 0) {
    console.error(`skill-drift: ${problems.length} skill(s) disagree with ${PACKAGE}@${version}, the version this plugin pins in .mcp.json.\n`);
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(`
skills/ in this repository is a mirror and is never edited here. Fix it at the source:

  1. Make the change in the Pathmode monorepo at packages/mcp-server/skills/.
  2. Publish an ${PACKAGE} version carrying it, and pin that version in .mcp.json.
  3. Run \`npm run plugin:sync\` in the monorepo to open the sync(skills): pull request.

If a skill file here was hand-edited, revert it and route the change through step 1.`);
    process.exit(1);
}
