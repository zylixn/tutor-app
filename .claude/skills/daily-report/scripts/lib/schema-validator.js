'use strict';

// Centralized ajv schema loader for the daily-report skill.
//
// daily-report.schema.json references KanbanTask/KanbanStats/DeadlineCalendar
// via cross-file $ref into kanban-task.schema.json and kanban-source.schema.json.
// ajv does NOT auto-resolve external $ref — the referenced schemas must be
// registered with ajv.addSchema() BEFORE compiling the referencing schema.
//
// This module loads all three schemas once and exposes two validators:
//   validateDailyReport(json) — validates a daily-report JSON document
//   validateKanbanSource(json) — validates a kanban mirror JSON document
//
// Both kanban-update.js (generate-time gate) and submit-report.js
// (submit-time gate) require() this module so the load logic stays in one place.

const fs = require('node:fs');
const path = require('node:path');

let _ajv = null;
let _validateDaily = null;
let _validateKanbanSource = null;

function getSchemasDir() {
  return path.resolve(__dirname, '..', '..', 'schemas');
}

function loadAjv() {
  if (_ajv) return _ajv;
  const Ajv2020 = require('ajv/dist/2020');
  const addFormats = require('ajv-formats');
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);

  const schemasDir = getSchemasDir();
  const kanbanTask = JSON.parse(fs.readFileSync(path.join(schemasDir, 'kanban-task.schema.json'), 'utf-8'));
  const kanbanSource = JSON.parse(fs.readFileSync(path.join(schemasDir, 'kanban-source.schema.json'), 'utf-8'));
  const dailyReport = JSON.parse(fs.readFileSync(path.join(schemasDir, 'daily-report.schema.json'), 'utf-8'));

  // Register referenced schemas first, then the referencing ones.
  ajv.addSchema(kanbanTask);
  ajv.addSchema(kanbanSource);
  _validateDaily = ajv.compile(dailyReport);
  _validateKanbanSource = ajv.getSchema('https://rd-harness/schemas/kanban-source.schema.json');
  if (typeof _validateKanbanSource !== 'function') {
    // kanban-source.schema.json is its own root $id, so getSchema returns its validator.
    throw new Error('failed to resolve kanban-source.schema.json validator');
  }
  _ajv = ajv;
  return _ajv;
}

function formatErrors(errors) {
  return (errors || []).map((err) => {
    const loc = err.instancePath || '/';
    return `${loc}: ${err.message}${err.params ? ' (' + JSON.stringify(err.params) + ')' : ''}`;
  });
}

// Compress multi-line Node module load errors (which include Require stack)
// into a single line so downstream consumers writing errors to a target file
// (e.g. via shell 2>&1) cannot silently clobber it with N lines of stack trace.
function shortLoadError(e) {
  const firstLine = (e && e.message ? e.message : String(e)).split('\n')[0].trim();
  return `Failed to load schemas: ${firstLine}`;
}

function validateDailyReport(data) {
  try {
    loadAjv();
  } catch (e) {
    return { valid: false, errors: [shortLoadError(e)] };
  }
  const ok = _validateDaily(data);
  if (ok) return { valid: true, errors: [] };
  return { valid: false, errors: formatErrors(_validateDaily.errors) };
}

function validateKanbanSource(data) {
  try {
    loadAjv();
  } catch (e) {
    return { valid: false, errors: [shortLoadError(e)] };
  }
  const ok = _validateKanbanSource(data);
  if (ok) return { valid: true, errors: [] };
  return { valid: false, errors: formatErrors(_validateKanbanSource.errors) };
}

module.exports = { validateDailyReport, validateKanbanSource, loadAjv };
