'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('./lib/argv');
const http = require('./lib/http');
const { validateDailyReport, validateKanbanSource } = require('./lib/schema-validator');

const DEFAULT_SCHEMA_PATH = path.resolve(__dirname, '..', 'schemas', 'daily-report.schema.json');

/**
 * Validate that a raw string is parseable JSON.
 * @param {string} raw - Raw JSON string to validate
 * @returns {{ valid: boolean, error: string|null }}
 */
function validateJson(raw) {
  try {
    JSON.parse(raw);
    return { valid: true, error: null };
  } catch (e) {
    return { valid: false, error: `JSON parse error: ${e.message}` };
  }
}

/**
 * Validate a JSON object against the daily-report schema.
 * Delegates to lib/schema-validator.js which loads all three schemas
 * (daily-report + kanban-source + kanban-task) so cross-file $ref resolves.
 * @param {object} data - Parsed JSON object to validate
 * @param {string} [schemaPath] - Kept for backward compat with tests; ignored
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateSchema(data, schemaPath) {
  // schemaPath is accepted for backward compatibility (tests pass SCHEMA_FILE)
  // but the shared loader always reads from the canonical schemas/ directory.
  if (schemaPath && schemaPath !== DEFAULT_SCHEMA_PATH) {
    // Caller asked for a non-default schema path — fall back to direct file load
    // so the missing-schema-file test still works.
    let schema;
    try {
      schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
    } catch (e) {
      return { valid: false, errors: [`Failed to load schema from "${schemaPath}": ${e.message}`] };
    }
    const Ajv2020 = require('ajv/dist/2020');
    const addFormats = require('ajv-formats');
    const ajv = new Ajv2020({ allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    if (validate(data)) return { valid: true, errors: [] };
    const errors = (validate.errors || []).map((err) => {
      const loc = err.instancePath || '/';
      return `${loc}: ${err.message}${err.params ? ' (' + JSON.stringify(err.params) + ')' : ''}`;
    });
    return { valid: false, errors };
  }

  return validateDailyReport(data);
}

function checkFileExists(gitlabUrl, projectId, token, filePath, branch) {
  const encoded = encodeURIComponent(filePath);
  const url = `${gitlabUrl}/api/v4/projects/${projectId}/repository/files/${encoded}?ref=${branch}`;
  return http.getRaw(url, token)
    .then(() => true)
    .catch(() => false);
}

function buildActions(files, action) {
  return files.map((f) => ({
    action,
    file_path: f.remotePath,
    content: fs.readFileSync(f.localPath, 'utf-8'),
  }));
}

async function main() {
  const args = parseArgs(process.argv, {
    options: {
      'gitlab-url': '',
      'project-id': '',
      token: '',
      branch: 'dev',
      'commit-message': '',
      'md-file': '',
      'json-file': '',
      'remote-md-path': '',
      'remote-json-path': '',
      'kanban-md-file': '',
      'kanban-json-file': '',
      'remote-kanban-md-path': '',
      'remote-kanban-json-path': '',
    },
  });

  const opt = args.options;
  const required = ['gitlab-url', 'project-id', 'token', 'commit-message'];
  for (const key of required) {
    if (!opt[key]) {
      process.stderr.write(`Missing required option: --${key}\n`);
      process.exit(1);
    }
  }
  const hasReport = opt['md-file'] && opt['json-file'] && opt['remote-md-path'] && opt['remote-json-path'];
  const hasKanban = opt['kanban-md-file'] && opt['kanban-json-file'] && opt['remote-kanban-md-path'] && opt['remote-kanban-json-path'];
  if (!hasReport && !hasKanban) {
    process.stderr.write('Must provide either report files (--md-file/--json-file/--remote-md-path/--remote-json-path) or kanban files (--kanban-md-file/--kanban-json-file/--remote-kanban-md-path/--remote-kanban-json-path)\n');
    process.exit(1);
  }

  const gitlabUrl = opt['gitlab-url'].replace(/\/+$/, '');
  const projectId = opt['project-id'];
  const token = opt.token;
  const branch = opt.branch || 'dev';

  // --- Validation Gate: JSON pre-check + Schema validation ---
  const jsonFilesToValidate = [];
  if (opt['json-file']) {
    jsonFilesToValidate.push({ label: '--json-file', localPath: opt['json-file'] });
  }
  if (opt['kanban-json-file'] && opt['remote-kanban-json-path']) {
    jsonFilesToValidate.push({ label: '--kanban-json-file', localPath: opt['kanban-json-file'] });
  }

  for (const { label, localPath } of jsonFilesToValidate) {
    let raw;
    try {
      raw = fs.readFileSync(localPath, 'utf-8');
    } catch (e) {
      process.stderr.write(`[submit-report] cannot read ${label} "${localPath}": ${e.message}\n`);
      process.exit(1);
    }

    // Step 1: JSON.parse pre-check
    const jsonCheck = validateJson(raw);
    if (!jsonCheck.valid) {
      process.stderr.write(`[submit-report] invalid JSON in ${label} "${localPath}": ${jsonCheck.error}\n`);
      process.exit(1);
    }

    // Step 2: Schema validation. Both daily-report JSON and kanban JSON
    // must pass their respective schemas. Previously kanban JSON skipped
    // schema validation entirely (it "had its own structure"), which let
    // malformed mirrors slip through to the GitLab API.
    const data = JSON.parse(raw);
    let schemaCheck;
    if (label === '--json-file') {
      schemaCheck = validateDailyReport(data);
    } else if (label === '--kanban-json-file') {
      schemaCheck = validateKanbanSource(data);
    } else {
      schemaCheck = { valid: true, errors: [] };
    }
    if (!schemaCheck.valid) {
      process.stderr.write(`[submit-report] schema validation failed for ${label} "${localPath}":\n`);
      for (const err of schemaCheck.errors) {
        process.stderr.write(`  ${err}\n`);
      }
      process.exit(1);
    }

    process.stderr.write(`[submit-report] validation passed for ${label} "${localPath}"\n`);
  }

  const actions = [];

  // Report files (optional in kanban-only mode)
  if (hasReport) {
    const reportExists = await checkFileExists(gitlabUrl, projectId, token, opt['remote-md-path'], branch);
    const action = reportExists ? 'update' : 'create';
    const reportFiles = [
      { localPath: opt['md-file'], remotePath: opt['remote-md-path'] },
      { localPath: opt['json-file'], remotePath: opt['remote-json-path'] },
    ];
    actions.push(...buildActions(reportFiles, action));
  }

  // Kanban files (each detects create/update independently)
  if (opt['kanban-md-file'] && opt['remote-kanban-md-path']) {
    const kanbanMdExists = await checkFileExists(gitlabUrl, projectId, token, opt['remote-kanban-md-path'], branch);
    actions.push({
      action: kanbanMdExists ? 'update' : 'create',
      file_path: opt['remote-kanban-md-path'],
      content: fs.readFileSync(opt['kanban-md-file'], 'utf-8'),
    });
  }
  if (opt['kanban-json-file'] && opt['remote-kanban-json-path']) {
    const kanbanJsonExists = await checkFileExists(gitlabUrl, projectId, token, opt['remote-kanban-json-path'], branch);
    actions.push({
      action: kanbanJsonExists ? 'update' : 'create',
      file_path: opt['remote-kanban-json-path'],
      content: fs.readFileSync(opt['kanban-json-file'], 'utf-8'),
    });
  }

  const body = {
    branch,
    commit_message: opt['commit-message'],
    actions,
  };

  // Submit
  const url = `${gitlabUrl}/api/v4/projects/${projectId}/repository/commits`;
  const res = await http.request(url, {
    method: 'POST',
    headers: {
      'PRIVATE-TOKEN': token,
      'Content-Type': 'application/json',
    },
  }, JSON.stringify(body));

  if (res.status === 201) {
    process.stderr.write(`[submit-report] success: ${res.status}\n`);
    process.stdout.write(res.body);
  } else {
    process.stderr.write(`[submit-report] failed: ${res.status} ${res.body.slice(0, 500)}\n`);
    process.exit(1);
  }
}

// Only run main() when executed directly, not when required() for testing
if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[submit-report] error: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  checkFileExists,
  buildActions,
  validateJson,
  validateSchema,
  DEFAULT_SCHEMA_PATH,
};
