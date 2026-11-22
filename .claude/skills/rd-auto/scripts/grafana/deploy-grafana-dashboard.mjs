#!/usr/bin/env node
// deploy-grafana-dashboard.mjs — Deploy Grafana dashboard via HTTP API
// Zero-dependency Node.js ESM script (replaces bash+grep version for P1-03/P1-04 fix)
// Usage: node deploy-grafana-dashboard.mjs --dashboard-json <path> [--grafana-url <url>] [--username <user>] [--password <pass>]

import { readFileSync } from 'node:fs';
import http from 'node:http';

// --- Parse arguments ---
function parseArgs(argv) {
  const args = { grafanaUrl: '', username: '', password: '', dashboardJson: '' };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--grafana-url': args.grafanaUrl = argv[++i]; break;
      case '--username': args.username = argv[++i]; break;
      case '--password': args.password = argv[++i]; break;
      case '--dashboard-json': args.dashboardJson = argv[++i]; break;
      default: console.error(`Unknown argument: ${argv[i]}`); process.exit(1);
    }
  }
  return args;
}

// --- HTTP request helper ---
function httpJson(method, url, headers, body) {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method,
      headers: { ...headers, 'Content-Type': 'application/json' },
      timeout: 15000,
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data: {} }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

// --- Main ---
async function main() {
  const args = parseArgs(process.argv);

  const grafanaUrl = args.grafanaUrl || process.env.GRAFANA_URL || 'http://192.168.5.114:3000';
  const username = args.username || process.env.GRAFANA_USERNAME || 'admin';
  const password = args.password || process.env.GRAFANA_PASSWORD;

  if (!password) {
    console.error('Error: Grafana password required. Use --password or set GRAFANA_PASSWORD env var.');
    process.exit(1);
  }

  if (!args.dashboardJson) {
    console.error('Error: --dashboard-json is required');
    console.error('Usage: node deploy-grafana-dashboard.mjs --dashboard-json <path> [--grafana-url <url>] [--username <user>] [--password <pass>]');
    process.exit(1);
  }

  const auth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
  const headers = { Authorization: auth };

  // Step 1: Verify Grafana connectivity
  console.log(`[deploy] Checking Grafana connectivity at ${grafanaUrl}...`);
  try {
    const health = await httpJson('GET', `${grafanaUrl}/api/health`, headers);
    console.log(`[deploy] Grafana is reachable. commit: ${health.data.commit || 'unknown'}`);
  } catch {
    console.error(`Error: Cannot connect to Grafana at ${grafanaUrl}`);
    process.exit(1);
  }

  // Step 2: Verify Prometheus datasource
  console.log('[deploy] Verifying Prometheus datasource (uid: afkjudv6hmv40a)...');
  try {
    const ds = await httpJson('GET', `${grafanaUrl}/api/datasources/uid/afkjudv6hmv40a`, headers);
    console.log(`[deploy] Datasource found: ${ds.data.name || 'unknown'}`);
  } catch {
    console.error('Warning: Prometheus datasource (uid: afkjudv6hmv40a) not found. Dashboard may not display data.');
  }

  // Step 3: Create or find "AI Employee" folder
  console.log('[deploy] Looking for folder "AI Employee"...');
  let folderUid = 'ai-employee';
  try {
    const folders = await httpJson('GET', `${grafanaUrl}/api/folders`, headers);
    const existing = Array.isArray(folders.data) && folders.data.find((f) => f.title === 'AI Employee');
    if (existing) {
      folderUid = existing.uid;
      console.log(`[deploy] Folder "AI Employee" already exists (uid: ${folderUid})`);
    } else {
      const created = await httpJson('POST', `${grafanaUrl}/api/folders`, headers, JSON.stringify({ title: 'AI Employee', uid: 'ai-employee' }));
      folderUid = created.data.uid || 'ai-employee';
      console.log(`[deploy] Created folder "AI Employee" (uid: ${folderUid})`);
    }
  } catch (e) {
    console.log(`[deploy] Using default folder uid: ${folderUid}`);
  }

  // Step 4: Import dashboard
  console.log(`[deploy] Importing dashboard from ${args.dashboardJson}...`);
  const dashboardData = JSON.parse(readFileSync(args.dashboardJson, 'utf8'));
  const payload = JSON.stringify({ dashboard: dashboardData, overwrite: true, folderUid });

  try {
    const result = await httpJson('POST', `${grafanaUrl}/api/dashboards/db`, headers, payload);
    if (result.data.status === 'success') {
      console.log('[deploy] Dashboard imported successfully!');
      console.log(`[deploy] URL: ${grafanaUrl}${result.data.url || ''}`);
      console.log(`[deploy] UID: ${result.data.uid || 'unknown'}, Version: ${result.data.version || '?'}`);
    } else {
      console.error('Error: Dashboard import failed');
      console.error(JSON.stringify(result.data));
      process.exit(1);
    }
  } catch (e) {
    console.error(`Error: Dashboard import failed: ${e.message}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
