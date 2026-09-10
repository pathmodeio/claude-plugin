#!/usr/bin/env node
/**
 * Pathmode readiness calibration and regression suite.
 *
 * Runs the preflight gate that ships inside the EXACT `@pathmode/mcp-server` version pinned in
 * `.mcp.json`, over its real MCP interface, and reports two independent things:
 *
 *   Part A, field-label agreement. For each item in `readiness-corpus.json`, does the gate's
 *   verdict for one dimension match the label a human wrote for that phrasing?
 *
 *   Part B, document behaviour. For each fixture in `fixtures/documents.json`, does the gate
 *   read a whole intent.md the way the fixture says it must?
 *
 * They are reported separately because they answer different questions and have different
 * standing. Read CALIBRATION.md before quoting any number from Part A: the corpus helped shape
 * the rules it scores, so a high score there is a REGRESSION result, not evidence of accuracy.
 *
 * Usage:
 *   node scripts/readiness-suite.mjs                     both parts, pinned version
 *   node scripts/readiness-suite.mjs --part a            field agreement only
 *   node scripts/readiness-suite.mjs --part b            document behaviour only
 *   node scripts/readiness-suite.mjs --fixtures mine.json  your own field fixtures
 *   node scripts/readiness-suite.mjs --version 1.27.0    override the pinned version
 *   node scripts/readiness-suite.mjs --verbose           print every case, not just failures
 *
 * Exit code is non-zero when anything fails, so this works as a CI gate.
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE = '@pathmode/mcp-server';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const flag = name => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
};
const has = name => argv.includes(`--${name}`);

const only = (flag('part') || 'ab').toLowerCase();
const verbose = has('verbose');

function bail(message) {
    console.error(`readiness-suite: ${message}`);
    process.exit(1);
}

/**
 * The pinned version is the single source of truth for what to grade.
 *
 * Never `latest`: the pin is what a user's plugin actually launches, so the pin is the thing
 * whose behaviour matters. Mirrors readPinnedVersion() in check-skill-drift.mjs.
 */
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

    const spec = args.find(arg => typeof arg === 'string' && arg.startsWith(`${PACKAGE}@`));
    if (!spec) bail(`.mcp.json does not pin ${PACKAGE} to a version (found args: ${args.join(' ')})`);

    const version = spec.slice(PACKAGE.length + 1);
    if (!/^\d+\.\d+\.\d+/.test(version)) {
        bail(`${PACKAGE} is pinned to "${version}", which is not an exact version. Pin an exact version so this suite is deterministic.`);
    }
    return version;
}

/** Download and unpack the pinned version. The graded artifact is the published tarball. */
function fetchServer(version, workDir) {
    let packed;
    try {
        packed = execFileSync('npm', ['pack', `${PACKAGE}@${version}`, '--pack-destination', workDir], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        }).trim().split('\n').pop().trim();
    } catch (error) {
        bail(`could not download ${PACKAGE}@${version} from npm: ${(error.stderr || error.message).toString().trim()}`);
    }
    execFileSync('tar', ['xzf', path.join(workDir, packed), '-C', workDir]);
    const bin = path.join(workDir, 'package', 'dist', 'index.js');
    if (!existsSync(bin)) bail(`${PACKAGE}@${version} ships no dist/index.js, so there is nothing to grade`);
    return bin;
}

/**
 * Minimal MCP stdio client. Deliberately hand-rolled and dependency-free: this suite is meant to
 * be readable and runnable by someone who does not trust us, so it should not ask them to install
 * an SDK to find out what the gate does.
 */
class McpServer {
    constructor(bin, cwd) {
        this.nextId = 1;
        this.pending = new Map();
        this.buffer = '';
        this.proc = spawn('node', [bin], {
            cwd,
            stdio: ['pipe', 'pipe', 'pipe'],
            // Keyless on purpose: an inherited PATHMODE_API_KEY would send fixtures to a
            // workspace and grade a different code path than the one users get for free.
            env: { ...process.env, PATHMODE_API_KEY: '', PATHMODE_MCP_QUIET: '1' },
        });
        this.stderr = '';
        this.proc.stderr.on('data', d => { this.stderr += d.toString(); });
        this.proc.stdout.on('data', chunk => {
            this.buffer += chunk.toString();
            let cut;
            while ((cut = this.buffer.indexOf('\n')) !== -1) {
                const line = this.buffer.slice(0, cut).trim();
                this.buffer = this.buffer.slice(cut + 1);
                if (!line) continue;
                let msg;
                try { msg = JSON.parse(line); } catch { continue; }
                const resolver = this.pending.get(msg.id);
                if (resolver) {
                    this.pending.delete(msg.id);
                    resolver(msg);
                }
            }
        });
    }

    send(method, params) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error(`${method} timed out after 30s. stderr: ${this.stderr.slice(0, 400)}`)),
                30_000,
            );
            this.pending.set(id, msg => { clearTimeout(timer); resolve(msg); });
            this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
        });
    }

    async start() {
        await this.send('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'pathmode-readiness-suite', version: '1' },
        });
        this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    }

    async preflight(args) {
        const res = await this.send('tools/call', { name: 'check_intent_readiness', arguments: args });
        const text = (res.result?.content || []).map(c => c.text || '').join('\n');
        if (!text) throw new Error(`check_intent_readiness returned no text: ${JSON.stringify(res).slice(0, 300)}`);
        return text;
    }

    stop() { this.proc.kill(); }
}

/** Summary-strip label -> the gate key this suite reports. */
const LABEL_TO_GATE = {
    Title: 'goal',
    Objective: 'objective',
    Outcomes: 'outcomes',
    Constraints: 'constraints',
    'Edge cases': 'edgeCases',
    Verification: 'verification',
};

/**
 * Blocker sentence -> gate, so a quoted extraction can be attributed to the dimension it came
 * from. Best-effort by design: the strip is the authoritative source of STATE, and this only
 * decides which failure a quote is printed under. `outcomes` has two sentences because the gate
 * fails two ways, on count and on measurability.
 */
const BLOCKER_TO_GATE = [
    [/^Title is missing or generic/, 'goal'],
    [/^Objective is too vague/, 'objective'],
    [/^Outcomes are not all measurable/, 'outcomes'],
    [/^Fewer than two outcomes/, 'outcomes'],
    [/^No hard constraint/, 'constraints'],
    [/^No edge case/, 'edgeCases'],
    [/^No concrete verification/, 'verification'],
];

/**
 * Parse the MCP verdict into { gate: { state, read } }.
 *
 * Grading the printed verdict rather than an internal API is the point: it is what an agent and
 * a user actually receive. Two surfaces are parsed. The summary strip
 * (`✓ Title  ? Objective  · Outcomes ...`) carries the per-dimension state, where `✓` passed,
 * `?` means text was read and the word lists could not confirm it, and `·` means nothing was
 * read. The blocker block above it carries the quoted extraction, which is what makes a
 * disagreement reproducible instead of just reported.
 *
 * Note the MCP verdict differs from the CLI's: it has no per-line `  ✓ goal` block, so the strip
 * is the only place the six states appear.
 */
function parseVerdict(text) {
    const states = { '✓': 'pass', '?': 'unconfirmed', '·': 'absent' };
    const labels = Object.keys(LABEL_TO_GATE).join('|');
    const tokenRe = new RegExp(`([✓?·])\\s+(${labels})(?![a-z])`, 'g');

    const out = {};
    for (const line of text.split('\n')) {
        const tokens = [...line.matchAll(tokenRe)];
        // The strip names every dimension on one line; a blocker sentence never will.
        if (tokens.length < 4) continue;
        for (const t of tokens) out[LABEL_TO_GATE[t[2]]] = { state: states[t[1]] };
        break;
    }

    // Attach quoted extractions to the blocker they sit under.
    let current;
    for (const line of text.split('\n')) {
        const blocker = line.match(/^\s{2}✗\s+(.*)$/);
        if (blocker) {
            current = BLOCKER_TO_GATE.find(([re]) => re.test(blocker[1]))?.[1];
            continue;
        }
        const quote = line.match(/^\s{4,}"(.*)"$/);
        if (quote && current && out[current]) out[current].read = quote[1];
    }

    return out;
}

// ── Part A: field-label agreement ───────────────────────────────────────────

/** Corpus kind -> the gate it is a fixture for. */
const KIND_TO_GATE = {
    title: 'goal',
    objective: 'objective',
    outcome: 'outcomes',
    constraint: 'constraints',
    verification: 'verification',
};

/**
 * Filler that passes every gate on its own, so a constructed spec isolates ONE dimension.
 * Changing any of these changes what Part A measures; they are content, not decoration.
 */
const FILLER = {
    title: 'Search relevance for inflected queries',
    objective: 'Shoppers cannot find products that exist, because search does not match inflected forms of the words they type.',
    outcomes: [
        'Click-through rate on search results rises from 4% to 6%',
        'Zero-result searches fall from 18% to under 8%',
    ],
    constraints: ['Must not slow the search response above 200ms at p95'],
    edgeCases: [{ scenario: 'Empty query', expectedBehavior: 'show popular products instead of an error' }],
    verification: { manualChecks: ['Run `npm test search` and confirm the inflection cases pass'] },
};

/**
 * Build a spec in which only `kind` is under test.
 *
 * THE TRAP, documented because it is easy to get wrong and produces a plausible-looking wrong
 * number: a field fixture is not a whole-spec pass/fail test. The outcomes gate is
 * `count >= 2 AND at least two thirds measurable`, so a single good outcome FAILS on the count
 * and would score as a false negative that is really a fixture-construction error. An outcome
 * fixture is therefore paired with one known-measurable outcome, which makes the gate track the
 * fixture: good gives 2 of 2, vague gives 1 of 2, which is below the threshold.
 *
 * Every other gate is `some(...)` over its field, so one item isolates cleanly.
 */
function buildFieldSpec(kind, text) {
    const spec = {
        title: FILLER.title,
        objective: FILLER.objective,
        outcomes: [...FILLER.outcomes],
        constraints: [...FILLER.constraints],
        edgeCases: FILLER.edgeCases.map(e => ({ ...e })),
        verification: { manualChecks: [...FILLER.verification.manualChecks] },
    };
    if (kind === 'title') spec.title = text;
    else if (kind === 'objective') spec.objective = text;
    else if (kind === 'outcome') spec.outcomes = [text, FILLER.outcomes[0]];
    else if (kind === 'constraint') spec.constraints = [text];
    else if (kind === 'verification') spec.verification = { manualChecks: [text] };
    else bail(`unknown fixture kind "${kind}". Known kinds: ${Object.keys(KIND_TO_GATE).join(', ')}`);
    return spec;
}

async function runPartA(server, fixtures) {
    const byKind = new Map();
    const constructionErrors = [];

    for (const item of fixtures) {
        const gate = KIND_TO_GATE[item.kind];
        if (!gate) bail(`fixture kind "${item.kind}" has no gate mapping`);
        if (item.label !== 'good' && item.label !== 'vague') {
            bail(`fixture label must be "good" or "vague", got "${item.label}" for: ${item.text}`);
        }

        const verdict = parseVerdict(await server.preflight({ spec: buildFieldSpec(item.kind, item.text) }));
        const under = verdict[gate];
        if (!under) {
            constructionErrors.push({ item, reason: `the verdict named no ${gate} dimension` });
            continue;
        }

        // Any OTHER failing gate means the constructed spec, not the fixture, is at fault. Counting
        // that as a classification error is how a suite reports a number about itself.
        const collateral = Object.entries(verdict)
            .filter(([g, d]) => g !== gate && d.state !== 'pass')
            .map(([g, d]) => `${g}=${d.state}`);
        if (collateral.length) {
            constructionErrors.push({ item, reason: `unrelated gates did not pass: ${collateral.join(', ')}` });
            continue;
        }

        const predicted = under.state === 'pass';
        const expected = item.label === 'good';
        if (!byKind.has(item.kind)) byKind.set(item.kind, { n: 0, correct: 0, falseNeg: [], falsePos: [] });
        const bucket = byKind.get(item.kind);
        bucket.n += 1;
        if (predicted === expected) bucket.correct += 1;
        else if (expected) bucket.falseNeg.push({ item, under });
        else bucket.falsePos.push({ item, under });
    }

    return { byKind, constructionErrors };
}

// ── Part B: document behaviour ──────────────────────────────────────────────

async function runPartB(bin, manifest, fixtureDir) {
    const results = [];
    for (const fixture of manifest) {
        const file = path.join(fixtureDir, fixture.file);
        if (!existsSync(file)) bail(`document fixture "${fixture.file}" not found at ${file}`);

        // The tool resolves the repo-bound intent.md from the launch directory, so each document
        // gets its own server in its own directory. One process per fixture, deliberately: it is
        // the only way to grade file resolution rather than bypass it with an inline spec.
        const dir = mkdtempSync(path.join(tmpdir(), 'readiness-doc-'));
        writeFileSync(path.join(dir, 'intent.md'), readFileSync(file, 'utf8'));
        const server = new McpServer(bin, dir);
        let verdict;
        try {
            await server.start();
            verdict = parseVerdict(await server.preflight({}));
        } finally {
            server.stop();
            rmSync(dir, { recursive: true, force: true });
        }

        const failures = [];
        for (const [gate, expected] of Object.entries(fixture.expect)) {
            const actual = verdict[gate]?.state ?? '(no such dimension in the verdict)';
            if (actual !== expected) {
                failures.push({ gate, expected, actual, read: verdict[gate]?.read });
            }
        }
        results.push({ fixture, failures, verdict });
    }
    return results;
}

// ── Report ──────────────────────────────────────────────────────────────────

function pct(n, d) { return d === 0 ? 'n/a' : (n / d).toFixed(3); }

function reportPartA({ byKind, constructionErrors }) {
    console.log('\nPART A  field-label agreement');
    console.log('  Agreement between the gate and the label a human wrote for that phrasing.');
    console.log('  NOT an accuracy claim. See CALIBRATION.md: these fixtures helped shape the');
    console.log('  rules they score, so this is a regression baseline.\n');
    console.log('  kind          n  correct  agreement  false-neg  false-pos');
    let n = 0, correct = 0;
    for (const kind of Object.keys(KIND_TO_GATE)) {
        const b = byKind.get(kind);
        if (!b) continue;
        n += b.n; correct += b.correct;
        console.log(
            `  ${kind.padEnd(12)} ${String(b.n).padStart(2)} ${String(b.correct).padStart(8)} ${pct(b.correct, b.n).padStart(10)} ${String(b.falseNeg.length).padStart(10)} ${String(b.falsePos.length).padStart(10)}`,
        );
    }
    console.log(`  ${'TOTAL'.padEnd(12)} ${String(n).padStart(2)} ${String(correct).padStart(8)} ${pct(correct, n).padStart(10)}`);

    let failed = false;
    for (const kind of Object.keys(KIND_TO_GATE)) {
        const b = byKind.get(kind);
        if (!b) continue;
        for (const kindOf of ['falseNeg', 'falsePos']) {
            for (const { item, under } of b[kindOf]) {
                failed = true;
                console.log(`\n  ${kindOf === 'falseNeg' ? 'FALSE NEGATIVE' : 'FALSE POSITIVE'}  ${kind}`);
                console.log(`    labelled: ${item.label}`);
                console.log(`    gate said: ${under.state}`);
                console.log(`    text:     ${JSON.stringify(item.text)}`);
                if (under.read) console.log(`    it read:  ${JSON.stringify(under.read)}`);
                if (item.tags?.length) console.log(`    tags:     ${item.tags.join(', ')}`);
            }
        }
    }

    if (constructionErrors.length) {
        failed = true;
        console.log(`\n  ${constructionErrors.length} FIXTURE CONSTRUCTION ERROR(S). These are faults in this suite, not`);
        console.log('  in the gate, and are excluded from the counts above rather than reported as');
        console.log('  disagreements:');
        for (const { item, reason } of constructionErrors) {
            console.log(`    - ${item.kind} / ${JSON.stringify(item.text.slice(0, 60))}: ${reason}`);
        }
    }
    return !failed;
}

function reportPartB(results) {
    console.log('\nPART B  document behaviour');
    console.log('  Whole intent.md files through the same gate. Each case names the defect it');
    console.log('  guards, and where that defect actually shipped.\n');
    let ok = true;
    for (const { fixture, failures } of results) {
        const mark = failures.length ? '✗' : '✓';
        console.log(`  ${mark} ${fixture.name}`);
        if (verbose || failures.length) console.log(`      why: ${fixture.why}`);
        for (const f of failures) {
            ok = false;
            console.log(`      ${f.gate}: expected ${f.expected}, got ${f.actual}`);
            if (f.read) console.log(`        it read: ${JSON.stringify(f.read)}`);
        }
    }
    return ok;
}

// ── Main ────────────────────────────────────────────────────────────────────

const version = flag('version') || readPinnedVersion();
const workDir = mkdtempSync(path.join(tmpdir(), 'readiness-suite-'));

try {
    console.log(`readiness-suite: grading ${PACKAGE}@${version} through its MCP interface`);
    const bin = fetchServer(version, workDir);

    let passA = true;
    let passB = true;

    if (only.includes('a')) {
        const fixturePath = flag('fixtures')
            ? path.resolve(flag('fixtures'))
            : path.join(repoRoot, 'readiness-corpus.json');
        if (!existsSync(fixturePath)) bail(`fixtures not found at ${fixturePath}`);
        const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8'));
        if (!Array.isArray(fixtures) || !fixtures.length) {
            bail(`${fixturePath} is not a non-empty array of {kind, text, label} fixtures`);
        }
        console.log(`readiness-suite: ${fixtures.length} field fixtures from ${path.relative(repoRoot, fixturePath) || fixturePath}`);
        // Empty cwd on purpose: an inline spec always wins over file resolution, but grading
        // must not depend on that ordering, and this repo has an intent.md of its own.
        const isolated = mkdtempSync(path.join(tmpdir(), 'readiness-fieldrun-'));
        const server = new McpServer(bin, isolated);
        try {
            await server.start();
            passA = reportPartA(await runPartA(server, fixtures));
        } finally {
            server.stop();
            rmSync(isolated, { recursive: true, force: true });
        }
    }

    if (only.includes('b')) {
        const dir = path.join(repoRoot, 'fixtures', 'documents');
        const manifestPath = path.join(repoRoot, 'fixtures', 'documents.json');
        if (!existsSync(manifestPath)) bail(`document manifest not found at ${manifestPath}`);
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        passB = reportPartB(await runPartB(bin, manifest, dir));
    }

    console.log('');
    if (passA && passB) {
        console.log(`readiness-suite: PASS against ${PACKAGE}@${version}`);
    } else {
        console.log(`readiness-suite: FAIL against ${PACKAGE}@${version}`);
        console.log('If you think a verdict above is wrong, that is worth telling us: open an issue');
        console.log('with the fixture and the verdict at https://github.com/pathmodeio/claude-plugin/issues');
        process.exitCode = 1;
    }
} finally {
    rmSync(workDir, { recursive: true, force: true });
}
