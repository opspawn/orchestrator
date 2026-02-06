/**
 * OpSpawn Orchestrator
 *
 * Lightweight agent coordination system. Manages shared state, task assignment,
 * event logging, and resource locking across multiple sub-agents.
 *
 * Usage:
 *   const orc = require('./orchestrator');
 *
 *   // Create a workstream
 *   orc.createWorkstream('bounty', { description: 'Bounty hunting', priority: 1 });
 *
 *   // Add tasks
 *   orc.addTask('bounty', { title: 'Research Archestra', estimate: '2h' });
 *
 *   // Register agent and claim work
 *   orc.registerAgent('agent-1', { type: 'research' });
 *   orc.claimTask('bounty', taskId, 'agent-1');
 *
 *   // Log events
 *   orc.logEvent('agent-1', 'completed', { task: taskId, result: '...' });
 *
 *   // View status
 *   orc.status();
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Data directory: ORCHESTRATOR_DIR env var, or .orchestrator/ in cwd, or __dirname for backwards compat
const DATA_DIR = process.env.ORCHESTRATOR_DIR || (
  fs.existsSync(path.join(__dirname, 'state.json')) ? __dirname :
  path.join(process.cwd(), '.orchestrator')
);

const STATE_PATH = path.join(DATA_DIR, 'state.json');
const EVENTS_PATH = path.join(DATA_DIR, 'events.jsonl');
const KNOWLEDGE_DIR = path.join(DATA_DIR, 'knowledge');

// Ensure data directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(KNOWLEDGE_DIR)) {
  fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
}

// Initialize state file if it doesn't exist
if (!fs.existsSync(STATE_PATH)) {
  fs.writeFileSync(STATE_PATH, JSON.stringify({
    version: 0,
    updated_at: new Date().toISOString(),
    workstreams: {},
    agents: {},
    locks: {}
  }, null, 2) + '\n');
}

// Initialize events file if it doesn't exist
if (!fs.existsSync(EVENTS_PATH)) {
  fs.writeFileSync(EVENTS_PATH, '');
}

function loadState() {
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
}

function saveState(state) {
  state.updated_at = new Date().toISOString();
  state.version++;
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

function genId() {
  return crypto.randomBytes(4).toString('hex');
}

// --- Event Log ---

function logEvent(agentId, action, data = {}) {
  const event = {
    ts: new Date().toISOString(),
    agent: agentId,
    action,
    ...data
  };
  fs.appendFileSync(EVENTS_PATH, JSON.stringify(event) + '\n');
  return event;
}

function getEvents(opts = {}) {
  const raw = fs.readFileSync(EVENTS_PATH, 'utf8').trim();
  if (!raw) return [];
  let events = raw.split('\n').map(line => JSON.parse(line));

  if (opts.agent) events = events.filter(e => e.agent === opts.agent);
  if (opts.action) events = events.filter(e => e.action === opts.action);
  if (opts.since) {
    const since = new Date(opts.since).getTime();
    events = events.filter(e => new Date(e.ts).getTime() >= since);
  }
  if (opts.last) events = events.slice(-opts.last);

  return events;
}

// --- Workstreams ---

function createWorkstream(name, opts = {}) {
  const state = loadState();
  if (state.workstreams[name]) {
    throw new Error(`Workstream "${name}" already exists`);
  }
  state.workstreams[name] = {
    description: opts.description || '',
    priority: opts.priority || 5,
    status: 'active',
    tasks: [],
    created_at: new Date().toISOString()
  };
  saveState(state);
  logEvent('system', 'workstream_created', { workstream: name });
  return state.workstreams[name];
}

function listWorkstreams() {
  const state = loadState();
  return Object.entries(state.workstreams).map(([name, ws]) => ({
    name,
    ...ws,
    task_count: ws.tasks.length,
    pending: ws.tasks.filter(t => t.status === 'pending').length,
    in_progress: ws.tasks.filter(t => t.status === 'in_progress').length,
    done: ws.tasks.filter(t => t.status === 'done').length
  })).sort((a, b) => a.priority - b.priority);
}

// --- Tasks ---

function addTask(workstream, opts) {
  const state = loadState();
  const ws = state.workstreams[workstream];
  if (!ws) throw new Error(`Workstream "${workstream}" not found`);

  const task = {
    id: genId(),
    title: opts.title,
    description: opts.description || '',
    status: 'pending',
    priority: opts.priority || 5,
    estimate: opts.estimate || null,
    assigned_to: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    result: null
  };
  ws.tasks.push(task);
  saveState(state);
  logEvent('system', 'task_created', { workstream, task_id: task.id, title: task.title });
  return task;
}

function claimTask(workstream, taskId, agentId) {
  const state = loadState();
  const ws = state.workstreams[workstream];
  if (!ws) throw new Error(`Workstream "${workstream}" not found`);

  const task = ws.tasks.find(t => t.id === taskId);
  if (!task) throw new Error(`Task "${taskId}" not found`);
  if (task.status !== 'pending') throw new Error(`Task "${taskId}" is ${task.status}, not pending`);

  task.status = 'in_progress';
  task.assigned_to = agentId;
  task.updated_at = new Date().toISOString();
  saveState(state);
  logEvent(agentId, 'task_claimed', { workstream, task_id: taskId });
  return task;
}

function completeTask(workstream, taskId, result = null) {
  const state = loadState();
  const ws = state.workstreams[workstream];
  if (!ws) throw new Error(`Workstream "${workstream}" not found`);

  const task = ws.tasks.find(t => t.id === taskId);
  if (!task) throw new Error(`Task "${taskId}" not found`);

  task.status = 'done';
  task.result = result;
  task.updated_at = new Date().toISOString();
  saveState(state);
  logEvent(task.assigned_to || 'system', 'task_completed', { workstream, task_id: taskId, result });
  return task;
}

function getNextTask(workstream, agentId) {
  const state = loadState();
  const ws = state.workstreams[workstream];
  if (!ws) throw new Error(`Workstream "${workstream}" not found`);

  const pending = ws.tasks
    .filter(t => t.status === 'pending')
    .sort((a, b) => a.priority - b.priority);

  if (pending.length === 0) return null;
  return claimTask(workstream, pending[0].id, agentId);
}

// --- Agents ---

function registerAgent(agentId, opts = {}) {
  const state = loadState();
  state.agents[agentId] = {
    type: opts.type || 'general',
    status: 'active',
    capabilities: opts.capabilities || [],
    registered_at: new Date().toISOString(),
    last_seen: new Date().toISOString()
  };
  saveState(state);
  logEvent(agentId, 'agent_registered', { type: opts.type });
  return state.agents[agentId];
}

function heartbeat(agentId) {
  const state = loadState();
  if (state.agents[agentId]) {
    state.agents[agentId].last_seen = new Date().toISOString();
    state.agents[agentId].status = 'active';
    saveState(state);
  }
}

// --- Locks ---

function acquireLock(resource, agentId, ttlMs = 60000) {
  const state = loadState();
  const existing = state.locks[resource];

  if (existing) {
    const expiresAt = new Date(existing.acquired_at).getTime() + existing.ttl_ms;
    if (Date.now() < expiresAt && existing.agent !== agentId) {
      return false; // Lock held by another agent
    }
  }

  state.locks[resource] = {
    agent: agentId,
    acquired_at: new Date().toISOString(),
    ttl_ms: ttlMs
  };
  saveState(state);
  logEvent(agentId, 'lock_acquired', { resource });
  return true;
}

function releaseLock(resource, agentId) {
  const state = loadState();
  if (state.locks[resource] && state.locks[resource].agent === agentId) {
    delete state.locks[resource];
    saveState(state);
    logEvent(agentId, 'lock_released', { resource });
    return true;
  }
  return false;
}

// --- Knowledge Base ---

function writeKnowledge(topic, content, agentId = 'system') {
  const filePath = path.join(KNOWLEDGE_DIR, `${topic}.md`);
  const header = `<!-- Updated by ${agentId} at ${new Date().toISOString()} -->\n`;
  fs.writeFileSync(filePath, header + content);
  logEvent(agentId, 'knowledge_written', { topic });
}

function readKnowledge(topic) {
  const filePath = path.join(KNOWLEDGE_DIR, `${topic}.md`);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

function deleteKnowledge(topic, agentId = 'system') {
  const filePath = path.join(KNOWLEDGE_DIR, `${topic}.md`);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  logEvent(agentId, 'knowledge_deleted', { topic });
  return true;
}

function listKnowledge() {
  return fs.readdirSync(KNOWLEDGE_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace('.md', ''));
}

// --- Status Dashboard ---

function status() {
  const state = loadState();
  const workstreams = listWorkstreams();
  const recentEvents = getEvents({ last: 10 });

  const agents = Object.entries(state.agents).map(([id, a]) => ({
    id,
    ...a,
    stale: (Date.now() - new Date(a.last_seen).getTime()) > 300000 // 5 min
  }));

  const activeLocks = Object.entries(state.locks)
    .filter(([, lock]) => {
      const expiresAt = new Date(lock.acquired_at).getTime() + lock.ttl_ms;
      return Date.now() < expiresAt;
    })
    .map(([resource, lock]) => ({ resource, ...lock }));

  return {
    version: state.version,
    updated_at: state.updated_at,
    workstreams,
    agents,
    active_locks: activeLocks,
    recent_events: recentEvents,
    knowledge_topics: listKnowledge()
  };
}

function statusText() {
  const s = status();
  const lines = [];

  lines.push('=== OpSpawn Orchestrator Status ===');
  lines.push(`State version: ${s.version} | Updated: ${s.updated_at}`);
  lines.push('');

  lines.push('--- Workstreams ---');
  for (const ws of s.workstreams) {
    lines.push(`[P${ws.priority}] ${ws.name}: ${ws.pending} pending, ${ws.in_progress} active, ${ws.done} done`);
  }
  lines.push('');

  lines.push('--- Agents ---');
  for (const a of s.agents) {
    lines.push(`${a.id} (${a.type}): ${a.status}${a.stale ? ' [STALE]' : ''}`);
  }
  if (s.agents.length === 0) lines.push('(none registered)');
  lines.push('');

  lines.push('--- Active Locks ---');
  for (const lock of s.active_locks) {
    lines.push(`${lock.resource}: held by ${lock.agent}`);
  }
  if (s.active_locks.length === 0) lines.push('(none)');
  lines.push('');

  lines.push('--- Recent Events ---');
  for (const e of s.recent_events) {
    const time = e.ts.split('T')[1].split('.')[0];
    lines.push(`[${time}] ${e.agent}: ${e.action}`);
  }
  lines.push('');

  lines.push('--- Knowledge Base ---');
  lines.push(s.knowledge_topics.join(', ') || '(empty)');

  return lines.join('\n');
}

module.exports = {
  loadState,
  logEvent,
  getEvents,
  createWorkstream,
  listWorkstreams,
  addTask,
  claimTask,
  completeTask,
  getNextTask,
  registerAgent,
  heartbeat,
  acquireLock,
  releaseLock,
  writeKnowledge,
  readKnowledge,
  deleteKnowledge,
  listKnowledge,
  status,
  statusText
};
