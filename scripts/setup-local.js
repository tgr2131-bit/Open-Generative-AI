#!/usr/bin/env node
/**
 * Resilient one-command local setup for Open Generative AI.
 *
 * `npm run setup` assumes the submodule commits pinned in this repository still
 * exist upstream and that every download succeeds on the first try. Behind a
 * corporate proxy, in a container, or after an upstream force-push, that chain
 * breaks in three different places. This script runs the same steps in order but
 * degrades gracefully at each one:
 *
 *   1. init submodules      -> falls back to each submodule's default branch when
 *                              a pinned commit no longer exists upstream
 *   2. npm install          -> retries with the Electron binary download skipped
 *                              when the binary host is unreachable (the web app
 *                              does not need it)
 *   3. build:packages       -> builds studio/workflow/agents/design-agent
 *   4. reachability check   -> reports whether the hosts generation depends on
 *                              are actually reachable from this machine
 *
 * Usage:  npm run setup:local        (add --skip-check to skip the network probes)
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const SKIP_CHECK = process.argv.includes('--skip-check');

const SUBMODULE_PATHS = [
  'packages/Vibe-Workflow',
  'packages/Open-Poe-AI',
  'packages/Open-AI-Design-Agent',
];

// Hosts the app talks to. Used by the informational reachability probe.
const HOSTS = [
  { host: 'api.muapi.ai', purpose: 'cloud generation (Muapi API)' },
  { host: 'fonts.googleapis.com', purpose: 'Next.js Inter font (falls back to a system font)' },
  { host: 'github.com', purpose: 'release and asset downloads' },
];

const log = {
  step: (msg) => console.log(`\n\u25b6 ${msg}`),
  ok: (msg) => console.log(`  \u2713 ${msg}`),
  warn: (msg) => console.log(`  ! ${msg}`),
  info: (msg) => console.log(`    ${msg}`),
};

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: ROOT,
    stdio: options.capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
  });
}

function isDirEmpty(dir) {
  if (!fs.existsSync(dir)) return true;
  return fs.readdirSync(dir).filter((entry) => entry !== '.git').length === 0;
}

// The Electron npm package only writes path.txt once its prebuilt binary has
// actually been unpacked, so this is the authoritative check - `npm install`
// can exit 0 while the binary download was skipped.
function detectElectronBinary() {
  const packageDir = path.join(ROOT, 'node_modules', 'electron');
  const pathFile = path.join(packageDir, 'path.txt');

  if (!fs.existsSync(pathFile)) return false;

  const relativeBinary = fs.readFileSync(pathFile, 'utf8').trim();
  return fs.existsSync(path.join(packageDir, 'dist', relativeBinary));
}

// ---------------------------------------------------------------- step 1

function ensureSubmodules() {
  log.step('Initializing submodules (workflow, agents, design-agent)');

  const result = run('git', ['submodule', 'update', '--init', '--recursive'], { capture: true });

  if (result.status === 0) {
    log.ok('Submodules checked out at the pinned commits');
    return;
  }

  // Typical cause: the gitlink pinned in this repo points at a commit that no
  // longer exists upstream (force-push / history rewrite), so `git submodule
  // update` cannot resolve it.
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  const stalePin = /not our ref|did not contain|Direct fetching of that commit failed/i.test(output);

  log.warn('Pinned submodule commits could not be fetched - falling back to each submodule\'s default branch');
  if (!stalePin) log.info('(unexpected error - see git output above)');

  const problems = [];

  for (const relPath of SUBMODULE_PATHS) {
    const fullPath = path.join(ROOT, relPath);

    if (!fs.existsSync(path.join(fullPath, '.git'))) {
      run('git', ['submodule', 'update', '--init', '--force', relPath], { capture: true });
    }

    if (!fs.existsSync(path.join(fullPath, '.git'))) {
      problems.push(`${relPath} (not initialized - check network access to github.com)`);
      continue;
    }

    run('git', ['-C', fullPath, 'fetch', '--tags', 'origin'], { capture: true });

    const headRef = run('git', ['-C', fullPath, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { capture: true });
    const branch = headRef.status === 0 && headRef.stdout.trim()
      ? headRef.stdout.trim().replace('origin/', '')
      : 'main';

    const checkout = run('git', ['-C', fullPath, 'checkout', '--detach', `origin/${branch}`], { capture: true });

    if (checkout.status !== 0 || isDirEmpty(fullPath)) {
      problems.push(`${relPath} (could not check out origin/${branch})`);
      continue;
    }

    const sha = run('git', ['-C', fullPath, 'rev-parse', '--short', 'HEAD'], { capture: true });
    log.ok(`${relPath} -> origin/${branch} @ ${sha.stdout.trim()}`);
  }

  if (problems.length > 0) {
    console.error('\nSetup cannot continue: the following workspaces are missing:\n');
    for (const problem of problems) console.error(`  - ${problem}\n`);
    process.exit(1);
  }

  log.warn('Note: `git status` will show the three submodules as modified, because their');
  log.info('working trees are on newer commits than the stale pins recorded in this repo.');
}

// ---------------------------------------------------------------- step 2

function installDependencies() {
  log.step('Installing dependencies');

  const first = run(NPM, ['install', '--no-audit', '--no-fund']);

  if (first.status === 0) {
    log.ok('Dependencies installed');
    return { electronBinary: detectElectronBinary() };
  }

  log.warn('`npm install` failed - retrying with the Electron binary download skipped');
  log.info('The Electron package ships a ~100 MB prebuilt binary fetched from');
  log.info('github releases. If that host is blocked, the install itself fails');
  log.info('even though the web app does not need the binary at all.');

  const retry = run(NPM, ['install', '--no-audit', '--no-fund'], {
    env: { ELECTRON_SKIP_BINARY_DOWNLOAD: '1' },
  });

  if (retry.status !== 0) {
    console.error('\nDependency install failed on both attempts. Scroll up for the first error.\n');
    process.exit(1);
  }

  log.ok('Dependencies installed (without the Electron desktop binary)');
  log.warn('The web version works; `npm run electron:dev` / `electron:build*` will not');
  log.info('until the binary can be downloaded on a less restricted network.');
  return { electronBinary: false };
}

// ---------------------------------------------------------------- step 3

function buildPackages() {
  log.step('Building workspace packages (studio, workflow-builder, agents, design-agent)');

  const result = run(NPM, ['run', 'build:packages']);

  if (result.status !== 0) {
    console.error('\nWorkspace build failed. Re-run `npm run build:packages` to see the full output.\n');
    process.exit(1);
  }

  log.ok('Workspace packages built (dist/ for each package)');
}

// ---------------------------------------------------------------- step 4

function probeHost({ host, purpose }) {
  return new Promise((resolve) => {
    const request = https.request(
      { host, port: 443, method: 'HEAD', path: '/', timeout: 6000 },
      (response) => {
        response.resume();
        resolve({ host, purpose, reachable: true, detail: `HTTP ${response.statusCode}` });
      },
    );

    request.on('timeout', () => {
      request.destroy();
      resolve({ host, purpose, reachable: false, detail: 'timed out' });
    });

    request.on('error', (error) => {
      resolve({ host, purpose, reachable: false, detail: error.code || error.message });
    });

    request.end();
  });
}

async function checkReachability() {
  log.step('Checking network reachability (informational)');

  const results = await Promise.all(HOSTS.map(probeHost));

  // A proxy that re-signs TLS makes Node reject the certificate while git and
  // npm still work (they ship their own trust store). Don't report that as a
  // hard failure - it is a different problem with a different fix.
  const TLS_CODES = [
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'CERT_HAS_EXPIRED',
    'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  ];

  for (const result of results) {
    if (result.reachable) {
      log.ok(`${result.host} reachable (${result.detail}) - ${result.purpose}`);
    } else if (TLS_CODES.includes(result.detail)) {
      log.warn(`${result.host} TLS certificate not trusted by Node (${result.detail})`);
      log.info('A TLS-intercepting proxy is present. git and npm bundle their own CA');
      log.info('store and usually still work; only Node HTTPS may need NODE_EXTRA_CA_CERTS.');
    } else {
      log.warn(`${result.host} NOT reachable (${result.detail}) - ${result.purpose}`);
    }
  }

  if (results.some((result) => result.host === 'api.muapi.ai' && !result.reachable)) {
    log.info('');
    log.info('Without api.muapi.ai the UI loads but cloud generation returns an error:');
    log.info('the dev server proxies browser calls to /api/* through to that host, so a');
    log.info('sandbox, VPN, or firewall that blocks it breaks generation for every model.');
  }
}

// ---------------------------------------------------------------- main

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Usage: npm run setup:local [-- --skip-check] [--help]');
    console.log('  --skip-check   skip the network reachability probe');
    return;
  }

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < 18) {
    console.error(`Node.js 18+ is required, found ${process.versions.node}.`);
    process.exit(1);
  }
  console.log(`Open Generative AI - local setup (Node ${process.versions.node}, ${process.platform})`);

  ensureSubmodules();
  const { electronBinary } = installDependencies();
  buildPackages();

  if (!SKIP_CHECK) await checkReachability();

  console.log('\n\u2713 Setup complete.\n');
  console.log('Next steps:');
  console.log('  npm run dev            web app  -> http://localhost:3000 (redirects to /studio)');
  if (electronBinary) {
    console.log('  npm run electron:dev   desktop app (Electron + Vite)');
  } else {
    console.log('  npm run electron:dev   desktop app - unavailable, Electron binary missing');
    console.log('                         fix on an unrestricted network: npm rebuild electron');
  }
  console.log('\nOn first use the app asks for a Muapi access key:');
  console.log('  https://muapi.ai/access-keys  (paste the key value, not the key name)');
  console.log('No key is needed for local models, which are desktop-app only.\n');
}

main().catch((error) => {
  console.error('\nSetup failed:', error.message);
  process.exit(1);
});
