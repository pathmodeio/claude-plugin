#!/usr/bin/env node
/**
 * SessionStart hook: tell the agent, once, that this repo carries an intent.
 *
 * Experiment E1 (.claude/plans/deterministic-activation.md). The measured friction: a workspace
 * launched the MCP client 33 times in a week against 1 recorded tool call, on a current server.
 * The tools were installed and working; nothing ever caused the agent to reach for them. Skill
 * descriptions fire probabilistically, `/preflight` needs a human to type it. This fires every
 * time work begins.
 *
 * FOUR RULES, all load-bearing:
 *
 *   1. Silent when there is no intent.md. A hook that greets every repo with "you should write an
 *      intent" is spam, and spam gets the plugin uninstalled. First-run adoption is a different
 *      work item; this one is about the second run.
 *   2. State, never homework. It reports what is true and stops. No instructions to the agent —
 *      the skills already know what to do, what they lacked was the trigger. A hook that tells the
 *      agent what to do next produces an agent that performs Pathmode instead of using it.
 *   3. Never blocks, never slows. File reads and one `git log` only: no model call, no network, no
 *      MCP round-trip, no readiness computation. Every failure path exits 0 emitting nothing.
 *   4. Works with no API key. Keyless local mode is the surface under promise and the majority of
 *      installs; this must be fully functional there. It never reads a key and never phones home.
 *
 * NOT A FIFTH PARSER. IntentSpec §2 normalization has four implementations already, held in parity
 * by conformance/normalization-corpus.json (reference normalize.mjs, the validate Action, and both
 * Pathmode parsers). This hook deliberately reads ONLY frontmatter scalars plus the §2 title rule
 * (frontmatter `title`/`userGoal`, else the first H1) and never touches list normalization, which
 * is where the delimiter subtleties live. If this ever needs real parsing, shell out to the CLI
 * rather than growing a parser here — a fifth implementation outside the corpus is how the format
 * quietly forks.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Frontmatter scalars only. Deliberately not a YAML parser: quoted scalars and nothing else. */
export function readFrontmatterScalars(content) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
    if (!m) return {};
    const out = {};
    for (const line of m[1].split(/\r?\n/)) {
        const kv = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
        if (!kv) continue;
        let v = kv[2].trim();
        if (!v || v.startsWith('#')) continue;
        // A nested block or a list opens on the next line; scalars only.
        if (v === '|' || v === '>' || v === '[]' || v === '{}') continue;
        v = v.replace(/^['"]|['"]$/g, '').trim();
        if (v) out[kv[1]] = v;
    }
    return out;
}

/** IntentSpec §2 title rule, and only that rule: frontmatter title/userGoal, else the first H1. */
export function resolveTitle(content, fm) {
    const fromFm = fm.title || fm.userGoal;
    if (fromFm) return fromFm;
    const h1 = /^#\s+(.+)$/m.exec(content);
    return h1 ? h1[1].trim() : null;
}

/**
 * The one line the agent sees. Returns null when there is nothing worth saying, which is the
 * common case and must stay cheap and silent.
 */
export function formatStateLine({ relPath, content, staleness }) {
    const fm = readFrontmatterScalars(content);
    const title = resolveTitle(content, fm);
    if (!title) return null; // Not recognisably an intent; say nothing rather than guess.

    const bits = [];
    if (fm.status) bits.push(`status: ${fm.status}`);
    if (fm.version) bits.push(`v${fm.version}`);
    const meta = bits.length ? ` (${bits.join(', ')})` : '';

    let line = `Pathmode: this repo carries an intent at ${relPath} — "${title}"${meta}.`;
    if (staleness) line += ` ${staleness}`;
    return line;
}

/**
 * How far the intent has drifted from the work. Commits since the file last changed is the
 * cheapest honest staleness signal available without parsing or network, and it is the one that
 * matters: an intent untouched across thirty commits is not describing this codebase any more.
 */
export function describeStaleness(commitsSince, daysSince) {
    if (commitsSince == null && daysSince == null) return '';
    const parts = [];
    if (daysSince != null) {
        parts.push(daysSince === 0 ? 'edited today' : daysSince === 1 ? 'edited yesterday' : `edited ${daysSince} days ago`);
    }
    if (commitsSince != null && commitsSince > 0) {
        parts.push(`${commitsSince} commit${commitsSince === 1 ? '' : 's'} since`);
    }
    return parts.length ? `Last ${parts.join(', ')}.` : '';
}

/** Root intent.md first, then .pathmode/intents/*.md — mirrors readLocalIntents() ordering. */
export function findIntentFile(cwd) {
    const root = path.join(cwd, 'intent.md');
    if (existsSync(root)) return { abs: root, rel: 'intent.md' };
    const dir = path.join(cwd, '.pathmode', 'intents');
    if (!existsSync(dir)) return null;
    try {
        const first = readdirSync(dir).filter(f => f.endsWith('.md')).sort()[0];
        if (!first) return null;
        return { abs: path.join(dir, first), rel: path.join('.pathmode', 'intents', first) };
    } catch {
        return null;
    }
}

function gitStaleness(cwd, absPath) {
    try {
        // Commit sha AND date in one call. The sha matters: counting with `--since=<date>` would
        // include the intent's own commit, since that commit carries exactly that timestamp.
        const head = execFileSync(
            'git', ['log', '-1', '--format=%H %cI', '--', absPath],
            { cwd, encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] },
        ).trim();
        if (!head) return ''; // Untracked: real for a brand-new intent, and not worth a claim.
        const [sha, iso] = head.split(' ');
        if (!sha || !iso) return '';
        const since = execFileSync(
            'git', ['rev-list', '--count', `${sha}..HEAD`],
            { cwd, encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] },
        ).trim();
        const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
        return describeStaleness(Number(since) || 0, Number.isFinite(days) ? days : null);
    } catch {
        return ''; // No git, shallow clone, detached state: staleness is a bonus, never a blocker.
    }
}

/**
 * Claude Code pipes the event JSON on stdin, carrying `cwd`. Fall back to the environment and
 * then to the process cwd, because a hook that cannot find the project must still exit clean.
 */
function projectDir() {
    try {
        const raw = readFileSync(0, 'utf8');
        const cwd = raw && JSON.parse(raw)?.cwd;
        if (typeof cwd === 'string' && cwd) return cwd;
    } catch {
        /* no stdin, not JSON, or no `cwd`: fall through */
    }
    return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

function main() {
    const cwd = projectDir();
    const found = findIntentFile(cwd);
    if (!found) return; // Rule 1: silent.

    let content;
    try {
        content = readFileSync(found.abs, 'utf8');
    } catch {
        return;
    }
    if (content.length > 512 * 1024) return; // Implausible for an intent; do not spend time on it.

    const line = formatStateLine({
        relPath: found.rel,
        content,
        staleness: gitStaleness(cwd, found.abs),
    });
    if (!line) return;

    process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: line,
        },
    }));
}

// Rule 3: any unexpected throw exits 0 and says nothing. A hook is never a reason a session fails.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
    try {
        main();
    } catch {
        /* silent by contract */
    }
    process.exit(0);
}
