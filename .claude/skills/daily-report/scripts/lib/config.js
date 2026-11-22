'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  GITLAB_URL: 'http://192.168.5.160',
  PROJECT_ID: 'public_group%2Fdaily_report',
  BRANCH: 'dev',
  KANBAN_DIR: 'knowledge',
};

const DEFAULT_PROFILE = 'default';

function findProjectRoot() {
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    if (fs.existsSync(path.join(dir, '.gitlab-config'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const PROJECT_ROOT = findProjectRoot();
const CONFIG_FILE = path.join(PROJECT_ROOT, '.gitlab-config');
const PROFILE_DIR = path.join(PROJECT_ROOT, '.gitlab-config.d');

function parseConfigFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf-8');
  const result = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key && value) result[key] = value;
  }
  return result;
}

function resolveToken() {
  if (process.env.GITLAB_TOKEN) return process.env.GITLAB_TOKEN;
  if (fs.existsSync(CONFIG_FILE)) {
    const m = fs.readFileSync(CONFIG_FILE, 'utf-8').match(/^gitlab_token=(.+)$/m);
    if (m) return m[1].trim();
  }
  return '';
}

function getActiveProfile() {
  const defaultCfg = parseConfigFile(CONFIG_FILE);
  return defaultCfg.active_profile || DEFAULT_PROFILE;
}

function listProfiles() {
  const profiles = [DEFAULT_PROFILE];
  if (fs.existsSync(PROFILE_DIR)) {
    const files = fs.readdirSync(PROFILE_DIR)
      .filter((f) => f.endsWith('.conf'))
      .map((f) => f.replace(/\.conf$/, ''));
    profiles.push(...files);
  }
  return Array.from(new Set(profiles));
}

function resolveConfigFile(profile) {
  if (profile === DEFAULT_PROFILE) return CONFIG_FILE;
  return path.join(PROFILE_DIR, `${profile}.conf`);
}

function loadConfig() {
  const activeProfile = getActiveProfile();
  let configFile = resolveConfigFile(activeProfile);

  if (activeProfile !== DEFAULT_PROFILE && !fs.existsSync(configFile)) {
    process.stderr.write(`[config] WARN: active_profile="${activeProfile}" file not found at ${configFile}, falling back to default\n`);
    configFile = CONFIG_FILE;
  }

  const fileConfig = parseConfigFile(configFile);

  const gitlabUrl =
    process.env.DAILY_REPORT_GITLAB_URL ||
    fileConfig.DAILY_REPORT_GITLAB_URL ||
    DEFAULTS.GITLAB_URL;

  const projectId =
    process.env.DAILY_REPORT_PROJECT_ID ||
    fileConfig.DAILY_REPORT_PROJECT_ID ||
    DEFAULTS.PROJECT_ID;

  const branch =
    process.env.DAILY_REPORT_BRANCH ||
    fileConfig.DAILY_REPORT_BRANCH ||
    DEFAULTS.BRANCH;

  const kanbanDir =
    process.env.DAILY_REPORT_KANBAN_DIR ||
    fileConfig.KANBAN_DIR ||
    DEFAULTS.KANBAN_DIR;

  const token = resolveToken();

  return { gitlabUrl, projectId, branch, kanbanDir, token, activeProfile };
}

function shellQuote(value) {
  if (value === '' || value == null) return "''";
  if (/^[A-Za-z0-9_./%:-]+$/.test(value)) return value;
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function printAsShellVars() {
  const cfg = loadConfig();
  const lines = [
    `GITLAB_TOKEN=${shellQuote(cfg.token)}`,
    `DAILY_REPORT_GITLAB_URL=${shellQuote(cfg.gitlabUrl)}`,
    `DAILY_REPORT_PROJECT_ID=${shellQuote(cfg.projectId)}`,
    `DAILY_REPORT_BRANCH=${shellQuote(cfg.branch)}`,
    `DAILY_REPORT_KANBAN_DIR=${shellQuote(cfg.kanbanDir)}`,
    `DAILY_REPORT_ACTIVE_PROFILE=${shellQuote(cfg.activeProfile)}`,
  ];
  return lines.join('\n') + '\n';
}

if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'print') {
    process.stdout.write(printAsShellVars());
  } else if (cmd === 'profiles') {
    process.stdout.write(listProfiles().join('\n') + '\n');
  } else if (cmd === 'active') {
    process.stdout.write(getActiveProfile() + '\n');
  } else {
    process.stderr.write('Usage: node lib/config.js [print|profiles|active]\n');
    process.exit(1);
  }
}

module.exports = {
  loadConfig,
  getActiveProfile,
  listProfiles,
  printAsShellVars,
  CONFIG_FILE,
  PROFILE_DIR,
  DEFAULTS,
  DEFAULT_PROFILE,
  resolveToken,
  parseConfigFile,
};
