'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const CONFIG_JS = path.resolve(__dirname, '..', 'lib', 'config.js');

const TMP_PREFIX = path.join(os.tmpdir(), 'config-profile-test-');

function makeTmpDir() {
  const dir = fs.mkdtempSync(TMP_PREFIX);
  fs.writeFileSync(path.join(dir, '.gitlab-config-init-marker'), '');
  return dir;
}

function rmTmpDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeConfig(dir, filename, lines) {
  fs.writeFileSync(path.join(dir, filename), lines.join('\n') + '\n');
}

function runConfigCmd(cwd, args) {
  return spawnSync('node', [CONFIG_JS, ...args], {
    cwd,
    encoding: 'utf-8',
    timeout: 10000,
  });
}

function parseShellVars(output) {
  const vars = {};
  for (const line of output.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (!m) continue;
    let val = m[2];
    if (val.startsWith("'") && val.endsWith("'")) {
      val = val.slice(1, -1).replace(/'\\''/g, "'");
    }
    vars[m[1]] = val;
  }
  return vars;
}

// ===== 测试用例 =====

function testDefaultProfileWhenNoProfileDir() {
  const tmpDir = makeTmpDir();
  try {
    writeConfig(tmpDir, '.gitlab-config', [
      'gitlab_token=default-token',
      'DAILY_REPORT_PROJECT_ID=group%2Fdefault',
      'DAILY_REPORT_BRANCH=main',
    ]);

    const result = runConfigCmd(tmpDir, ['print']);
    assert.equal(result.status, 0, `should exit 0, stderr: ${result.stderr}`);

    const vars = parseShellVars(result.stdout);
    assert.equal(vars.DAILY_REPORT_ACTIVE_PROFILE, 'default', 'should be default profile');
    assert.equal(vars.DAILY_REPORT_PROJECT_ID, 'group%2Fdefault');
    assert.equal(vars.DAILY_REPORT_BRANCH, 'main');
    assert.equal(vars.GITLAB_TOKEN, 'default-token');
  } finally {
    rmTmpDir(tmpDir);
  }
}

function testDefaultProfileWhenActiveProfileMissing() {
  const tmpDir = makeTmpDir();
  try {
    writeConfig(tmpDir, '.gitlab-config', [
      'gitlab_token=t',
      'DAILY_REPORT_PROJECT_ID=group%2Fx',
    ]);

    const result = runConfigCmd(tmpDir, ['active']);
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), 'default', 'missing active_profile should default to "default"');
  } finally {
    rmTmpDir(tmpDir);
  }
}

function testSwitchesToProfileWhenFileExists() {
  const tmpDir = makeTmpDir();
  try {
    writeConfig(tmpDir, '.gitlab-config', [
      'gitlab_token=default-token',
      'active_profile=team-b',
    ]);
    fs.mkdirSync(path.join(tmpDir, '.gitlab-config.d'));
    writeConfig(tmpDir, '.gitlab-config.d/team-b.conf', [
      'DAILY_REPORT_PROJECT_ID=group%2Fteam-b',
      'DAILY_REPORT_BRANCH=team-b-branch',
      'KANBAN_DIR=kanban-b',
    ]);

    const result = runConfigCmd(tmpDir, ['print']);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);

    const vars = parseShellVars(result.stdout);
    assert.equal(vars.DAILY_REPORT_ACTIVE_PROFILE, 'team-b');
    assert.equal(vars.DAILY_REPORT_PROJECT_ID, 'group%2Fteam-b');
    assert.equal(vars.DAILY_REPORT_BRANCH, 'team-b-branch');
    assert.equal(vars.DAILY_REPORT_KANBAN_DIR, 'kanban-b');
    assert.equal(vars.GITLAB_TOKEN, 'default-token', 'token should come from default file');
  } finally {
    rmTmpDir(tmpDir);
  }
}

function testFallsBackToDefaultWhenProfileMissing() {
  const tmpDir = makeTmpDir();
  try {
    writeConfig(tmpDir, '.gitlab-config', [
      'gitlab_token=default-token',
      'active_profile=nonexistent',
      'DAILY_REPORT_PROJECT_ID=group%2Fdefault',
      'DAILY_REPORT_BRANCH=main',
    ]);

    const result = runConfigCmd(tmpDir, ['print']);
    assert.equal(result.status, 0, 'should not hard fail on missing profile');

    assert.ok(
      (result.stderr || '').toLowerCase().includes('falling back to default'),
      `stderr should warn about fallback, got: ${result.stderr}`
    );

    const vars = parseShellVars(result.stdout);
    assert.equal(vars.DAILY_REPORT_PROJECT_ID, 'group%2Fdefault', 'should use default config values');
    assert.equal(vars.DAILY_REPORT_BRANCH, 'main');
  } finally {
    rmTmpDir(tmpDir);
  }
}

function testListProfiles() {
  const tmpDir = makeTmpDir();
  try {
    writeConfig(tmpDir, '.gitlab-config', ['gitlab_token=x']);
    fs.mkdirSync(path.join(tmpDir, '.gitlab-config.d'));
    writeConfig(tmpDir, '.gitlab-config.d/team-a.conf', ['x=1']);
    writeConfig(tmpDir, '.gitlab-config.d/team-b.conf', ['x=1']);
    writeConfig(tmpDir, '.gitlab-config.d/not-config.txt', ['should be ignored']);

    const result = runConfigCmd(tmpDir, ['profiles']);
    assert.equal(result.status, 0);

    const profiles = result.stdout.trim().split('\n');
    assert.ok(profiles.includes('default'), 'should always include default');
    assert.ok(profiles.includes('team-a'));
    assert.ok(profiles.includes('team-b'));
    assert.ok(!profiles.includes('not-config'), 'should ignore non-.conf files');
  } finally {
    rmTmpDir(tmpDir);
  }
}

function testEnvVarOverridesFile() {
  const tmpDir = makeTmpDir();
  try {
    writeConfig(tmpDir, '.gitlab-config', [
      'gitlab_token=file-token',
      'DAILY_REPORT_PROJECT_ID=group%2Ffile',
      'DAILY_REPORT_BRANCH=file-branch',
    ]);

    const result = spawnSync('node', [CONFIG_JS, 'print'], {
      cwd: tmpDir,
      encoding: 'utf-8',
      timeout: 10000,
      env: {
        ...process.env,
        DAILY_REPORT_PROJECT_ID: 'group%2Fenv-override',
        GITLAB_TOKEN: 'env-token',
      },
    });

    const vars = parseShellVars(result.stdout);
    assert.equal(vars.DAILY_REPORT_PROJECT_ID, 'group%2Fenv-override', 'env should override file');
    assert.equal(vars.GITLAB_TOKEN, 'env-token', 'env GITLAB_TOKEN should override file');
  } finally {
    rmTmpDir(tmpDir);
  }
}

function testRejectsUnknownCommand() {
  const tmpDir = makeTmpDir();
  try {
    writeConfig(tmpDir, '.gitlab-config', ['gitlab_token=x']);
    const result = runConfigCmd(tmpDir, ['unknown-command']);
    assert.notEqual(result.status, 0, 'should exit non-zero for unknown command');
    assert.ok((result.stderr || '').includes('Usage'), 'should print usage');
  } finally {
    rmTmpDir(tmpDir);
  }
}

// ===== Runner =====
const tests = [
  testDefaultProfileWhenNoProfileDir,
  testDefaultProfileWhenActiveProfileMissing,
  testSwitchesToProfileWhenFileExists,
  testFallsBackToDefaultWhenProfileMissing,
  testListProfiles,
  testEnvVarOverridesFile,
  testRejectsUnknownCommand,
];

let passed = 0;
let failed = 0;
for (const t of tests) {
  try {
    t();
    console.log(`PASS: ${t.name}`);
    passed++;
  } catch (e) {
    console.error(`FAIL: ${t.name}`);
    console.error(`  ${e.message}`);
    failed++;
  }
}

console.log(`\n${passed}/${tests.length} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
