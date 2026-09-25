// @vitest-environment node
/**
 * The hook's contract is mostly about what it REFUSES to say. A SessionStart hook runs in every
 * session in every repo where the plugin is installed, so a false positive is worse than silence:
 * it trains people to ignore the line, and then to uninstall the plugin.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    readFrontmatterScalars,
    resolveTitle,
    formatStateLine,
    describeStaleness,
    findIntentFile,
    formatSeveralLine,
    resolveHookEvent,
    buildHookOutput,
    HOOK_EVENTS,
} from './session-start.mjs';

const HOOK = fileURLToPath(new URL('./session-start.mjs', import.meta.url));
const HOOKS_JSON = fileURLToPath(new URL('./hooks.json', import.meta.url));

/** Run the hook exactly as Claude Code does: event JSON on stdin, JSON (or nothing) on stdout. */
function runHook(stdin) {
    const stdout = execFileSync(process.execPath, [HOOK], {
        input: stdin, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: '' }, timeout: 10000,
    });
    return stdout.trim() ? JSON.parse(stdout) : null;
}

const INTENT = `---
id: checkout-latency
status: draft
version: 3
---

# Cut checkout latency

## Objective
Users abandon at payment.
`;

describe('readFrontmatterScalars', () => {
    it('reads scalars and strips quotes', () => {
        const fm = readFrontmatterScalars('---\nstatus: "draft"\nversion: 3\n---\nbody');
        expect(fm).toEqual({ status: 'draft', version: '3' });
    });

    it('returns empty when there is no frontmatter', () => {
        expect(readFrontmatterScalars('# Just a heading\n')).toEqual({});
    });

    it('skips block and collection openers rather than capturing their punctuation', () => {
        const fm = readFrontmatterScalars('---\nnotes: |\noutcomes: []\nstatus: draft\n---\n');
        expect(fm).toEqual({ status: 'draft' });
    });

    it('does not throw on ragged frontmatter', () => {
        expect(() => readFrontmatterScalars('---\n:::\n\t\nstatus\n---\n')).not.toThrow();
    });
});

describe('resolveTitle (IntentSpec §2 title rule only)', () => {
    it('prefers frontmatter title', () => {
        expect(resolveTitle('# H1 Title', { title: 'FM Title' })).toBe('FM Title');
    });

    it('accepts userGoal as the frontmatter form', () => {
        expect(resolveTitle('# H1 Title', { userGoal: 'Goal' })).toBe('Goal');
    });

    it('falls back to the first H1', () => {
        expect(resolveTitle('# Cut checkout latency\n# Later', {})).toBe('Cut checkout latency');
    });

    it('is null when neither exists, which keeps the hook silent', () => {
        expect(resolveTitle('## Not an H1\nbody', {})).toBeNull();
    });
});

describe('formatStateLine', () => {
    it('names the file, the title and the frontmatter state', () => {
        const line = formatStateLine({ relPath: 'intent.md', content: INTENT, staleness: '' });
        expect(line).toContain('intent.md');
        expect(line).toContain('"Cut checkout latency"');
        expect(line).toContain('status: draft');
        expect(line).toContain('v3');
    });

    it('appends staleness when given', () => {
        const line = formatStateLine({
            relPath: 'intent.md', content: INTENT, staleness: 'Last edited 12 days ago, 8 commits since.',
        });
        expect(line).toContain('8 commits since');
    });

    it('says nothing for a file with no recognisable title', () => {
        expect(formatStateLine({ relPath: 'intent.md', content: 'notes to self', staleness: '' })).toBeNull();
    });

    it('never instructs the agent', () => {
        const line = formatStateLine({ relPath: 'intent.md', content: INTENT, staleness: '' });
        expect(line).not.toMatch(/\b(you should|please|run |remember to|make sure)\b/i);
    });

    it('does not throw on malformed content', () => {
        for (const bad of ['', '---\n', '---\n---\n', '\x00', '# '.repeat(5000)]) {
            expect(() => formatStateLine({ relPath: 'intent.md', content: bad, staleness: '' })).not.toThrow();
        }
    });
});

describe('describeStaleness', () => {
    it('is empty when nothing is known, so the line stays clean', () => {
        expect(describeStaleness(null, null)).toBe('');
    });

    it('reads naturally for today and yesterday', () => {
        expect(describeStaleness(0, 0)).toBe('Last edited today.');
        expect(describeStaleness(0, 1)).toBe('Last edited yesterday.');
    });

    it('singularises one commit', () => {
        expect(describeStaleness(1, 3)).toBe('Last edited 3 days ago, 1 commit since.');
        expect(describeStaleness(8, 12)).toBe('Last edited 12 days ago, 8 commits since.');
    });
});

describe('findIntentFile', () => {
    let dir;
    beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'pm-hook-')); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it('is null in a repo with no intent, which is the silent path', () => {
        expect(findIntentFile(dir)).toBeNull();
    });

    it('finds a root intent.md', () => {
        writeFileSync(path.join(dir, 'intent.md'), INTENT);
        expect(findIntentFile(dir)?.rel).toBe('intent.md');
    });

    it('falls back to .pathmode/intents and picks deterministically', () => {
        mkdirSync(path.join(dir, '.pathmode', 'intents'), { recursive: true });
        writeFileSync(path.join(dir, '.pathmode', 'intents', 'b.md'), INTENT);
        writeFileSync(path.join(dir, '.pathmode', 'intents', 'a.md'), INTENT);
        expect(findIntentFile(dir)?.rel).toBe(path.join('.pathmode', 'intents', 'a.md'));
    });

    it('prefers the root file over the directory', () => {
        mkdirSync(path.join(dir, '.pathmode', 'intents'), { recursive: true });
        writeFileSync(path.join(dir, '.pathmode', 'intents', 'a.md'), INTENT);
        writeFileSync(path.join(dir, 'intent.md'), INTENT);
        expect(findIntentFile(dir)?.rel).toBe('intent.md');
    });

    // Anthropic's AI-native SDLC playbook keeps intent.md in intent/, with spec.md beside it.
    it('finds intent/<feature>/intent.md and never takes spec.md for it', () => {
        mkdirSync(path.join(dir, 'intent', 'shipment'), { recursive: true });
        writeFileSync(path.join(dir, 'intent', 'shipment', 'spec.md'), INTENT);
        writeFileSync(path.join(dir, 'intent', 'shipment', 'intent.md'), INTENT);
        expect(findIntentFile(dir)?.rel).toBe(path.join('intent', 'shipment', 'intent.md'));
    });

    it('finds intent/intent.md', () => {
        mkdirSync(path.join(dir, 'intent'));
        writeFileSync(path.join(dir, 'intent', 'intent.md'), INTENT);
        expect(findIntentFile(dir)?.rel).toBe(path.join('intent', 'intent.md'));
    });

    it('prefers the root file over intent/', () => {
        mkdirSync(path.join(dir, 'intent'));
        writeFileSync(path.join(dir, 'intent', 'intent.md'), INTENT);
        writeFileSync(path.join(dir, 'intent.md'), INTENT);
        expect(findIntentFile(dir)?.rel).toBe('intent.md');
    });

    it('reports several intent/ features instead of picking one', () => {
        for (const feature of ['returns', 'checkout']) {
            mkdirSync(path.join(dir, 'intent', feature), { recursive: true });
            writeFileSync(path.join(dir, 'intent', feature, 'intent.md'), INTENT);
        }
        expect(findIntentFile(dir)).toEqual({
            several: [path.join('intent', 'checkout', 'intent.md'), path.join('intent', 'returns', 'intent.md')],
        });
    });

    it('stays silent for an intent/ folder with no file named intent.md', () => {
        mkdirSync(path.join(dir, 'intent'));
        writeFileSync(path.join(dir, 'intent', 'shipment.md'), INTENT);
        expect(findIntentFile(dir)).toBeNull();
    });

    it('ignores non-markdown files in the intents directory', () => {
        mkdirSync(path.join(dir, '.pathmode', 'intents'), { recursive: true });
        writeFileSync(path.join(dir, '.pathmode', 'intents', 'notes.txt'), 'x');
        expect(findIntentFile(dir)).toBeNull();
    });
});

describe('resolveHookEvent', () => {
    it('passes through the two events the script is registered for', () => {
        expect(resolveHookEvent({ hook_event_name: 'SessionStart' })).toBe('SessionStart');
        expect(resolveHookEvent({ hook_event_name: 'SubagentStart' })).toBe('SubagentStart');
    });

    it('falls back to SessionStart for anything it is not registered for', () => {
        for (const bad of [undefined, null, {}, { hook_event_name: 'PreToolUse' }, { hook_event_name: 42 }, 'x']) {
            expect(resolveHookEvent(bad)).toBe('SessionStart');
        }
    });

    it('is registered in hooks.json for exactly the events it accepts', () => {
        const registered = Object.keys(JSON.parse(readFileSync(HOOKS_JSON, 'utf8')).hooks);
        expect(new Set(registered)).toEqual(HOOK_EVENTS);
        for (const event of registered) {
            const commands = JSON.parse(readFileSync(HOOKS_JSON, 'utf8')).hooks[event].flatMap(g => g.hooks.map(h => h.command));
            expect(commands).toEqual(['${CLAUDE_PLUGIN_ROOT}/hooks/session-start.mjs']);
        }
    });
});

describe('buildHookOutput', () => {
    it('stamps the event that fired, never a hard-coded one', () => {
        expect(buildHookOutput('SubagentStart', 'line').hookSpecificOutput.hookEventName).toBe('SubagentStart');
        expect(buildHookOutput('SessionStart', 'line').hookSpecificOutput.hookEventName).toBe('SessionStart');
    });
});

describe('the hook as a process', () => {
    let dir;
    beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'pm-hook-proc-')); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it('SessionStart still emits the one line of state', () => {
        writeFileSync(path.join(dir, 'intent.md'), INTENT);
        const out = runHook(JSON.stringify({ hook_event_name: 'SessionStart', cwd: dir }));
        expect(out.hookSpecificOutput.hookEventName).toBe('SessionStart');
        expect(out.hookSpecificOutput.additionalContext).toContain('"Cut checkout latency"');
    });

    it('SubagentStart emits the same line under its own event name', () => {
        writeFileSync(path.join(dir, 'intent.md'), INTENT);
        const parent = runHook(JSON.stringify({ hook_event_name: 'SessionStart', cwd: dir }));
        const child = runHook(JSON.stringify({
            hook_event_name: 'SubagentStart', cwd: dir, agent_id: 'abc', agent_type: 'general-purpose',
        }));
        expect(child.hookSpecificOutput.hookEventName).toBe('SubagentStart');
        expect(child.hookSpecificOutput.additionalContext).toBe(parent.hookSpecificOutput.additionalContext);
    });

    it('reaches every agent type the same way, including the built-ins that skip CLAUDE.md', () => {
        writeFileSync(path.join(dir, 'intent.md'), INTENT);
        for (const agent_type of ['Explore', 'Plan', 'general-purpose', 'pathmode:reviewer']) {
            const out = runHook(JSON.stringify({ hook_event_name: 'SubagentStart', cwd: dir, agent_type }));
            expect(out.hookSpecificOutput.hookEventName).toBe('SubagentStart');
            expect(out.hookSpecificOutput.additionalContext).toContain('intent.md');
        }
    });

    it('emits the one line for an Anthropic-format intent/<feature>/intent.md with no frontmatter', () => {
        mkdirSync(path.join(dir, 'intent', 'shipment'), { recursive: true });
        writeFileSync(path.join(dir, 'intent', 'shipment', 'intent.md'),
            '# Intent: shipment status self-service\nAuthor: Sam. Status: draft.\n## Problem\nCustomers phone support.');
        const line = runHook(JSON.stringify({ hook_event_name: 'SessionStart', cwd: dir })).hookSpecificOutput.additionalContext;
        expect(line).toContain(path.join('intent', 'shipment', 'intent.md'));
        expect(line).toContain('"Intent: shipment status self-service"');
    });

    it('emits one line naming several intent/ features, and chooses none of them', () => {
        for (const feature of ['checkout', 'returns']) {
            mkdirSync(path.join(dir, 'intent', feature), { recursive: true });
            writeFileSync(path.join(dir, 'intent', feature, 'intent.md'), INTENT);
        }
        const line = runHook(JSON.stringify({ hook_event_name: 'SessionStart', cwd: dir })).hookSpecificOutput.additionalContext;
        expect(line).toBe(formatSeveralLine([path.join('intent', 'checkout', 'intent.md'), path.join('intent', 'returns', 'intent.md')]));
        expect(line).not.toContain('\n');
        expect(line).not.toContain('Cut checkout latency');
    });

    it('stays one line: it never pastes the intent body into a subagent', () => {
        writeFileSync(path.join(dir, 'intent.md'), INTENT + '\n## Outcomes\n' + '- outcome\n'.repeat(200));
        const out = runHook(JSON.stringify({ hook_event_name: 'SubagentStart', cwd: dir }));
        const line = out.hookSpecificOutput.additionalContext;
        expect(line).not.toContain('\n');
        expect(line).not.toContain('Users abandon at payment');
        expect(line).not.toContain('outcome');
        expect(line.length).toBeLessThan(400);
    });

    it('says nothing when there is no intent.md, on either event', () => {
        expect(runHook(JSON.stringify({ hook_event_name: 'SessionStart', cwd: dir }))).toBeNull();
        expect(runHook(JSON.stringify({ hook_event_name: 'SubagentStart', cwd: dir }))).toBeNull();
    });

    it('fails open on invalid input: exit 0, and nothing or a well-formed line, never a crash', () => {
        for (const stdin of ['', 'not json', '{"cwd": 7}', '{"hook_event_name": "SubagentStart", "cwd": "/nonexistent/dir"}']) {
            const out = runHook(stdin);
            if (out) expect(HOOK_EVENTS.has(out.hookSpecificOutput.hookEventName)).toBe(true);
        }
    });
});
