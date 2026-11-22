'use strict';

const { getRaw } = require('./http');
const { loadConfig, resolveToken } = require('./config');

const TEAM_PATH = 'config/team.json';

let cachedTeam = null;

async function fetchTeam() {
  if (cachedTeam) return cachedTeam;
  const token = resolveToken();
  if (!token) {
    process.stderr.write('[person] WARNING: no GITLAB_TOKEN, team mapping unavailable\n');
    cachedTeam = { members: [] };
    return cachedTeam;
  }
  const { gitlabUrl, projectId, branch } = loadConfig();
  const encodedPath = encodeURIComponent(TEAM_PATH);
  const url = `${gitlabUrl}/api/v4/projects/${projectId}/repository/files/${encodedPath}/raw?ref=${branch}`;
  try {
    const raw = await getRaw(url, token);
    cachedTeam = JSON.parse(raw);
    return cachedTeam;
  } catch (e) {
    process.stderr.write(`[person] WARNING: failed to fetch team.json: ${e.message}\n`);
    cachedTeam = { members: [] };
    return cachedTeam;
  }
}

function findByUsername(team, username) {
  return team.members.find((m) => m.git_username === username) || null;
}

function findByGroup(team, group) {
  return team.members.filter((m) => m.group === group);
}

function resolve(team, input) {
  if (!input) return null;
  return findByUsername(team, input) || null;
}

module.exports = { fetchTeam, findByUsername, findByGroup, resolve };
