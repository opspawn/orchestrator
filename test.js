#!/usr/bin/env node
/**
 * Basic tests for OpSpawn Orchestrator
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Use a temp directory for test data
const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orchestrator-test-'));
process.env.ORCHESTRATOR_DIR = testDir;

// Now require the module (it will use the temp dir)
const orc = require('./orchestrator');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${msg}`);
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

function test(name, fn) {
  console.log(`\n${name}`);
  try {
    fn();
  } catch (err) {
    failed++;
    console.error(`  ERROR: ${err.message}`);
  }
}

// --- Tests ---

test('State initialization', () => {
  const state = orc.loadState();
  assert(state.version === 0, 'Initial version is 0');
  assert(Object.keys(state.workstreams).length === 0, 'No workstreams initially');
  assert(Object.keys(state.agents).length === 0, 'No agents initially');
  assert(Object.keys(state.locks).length === 0, 'No locks initially');
});

test('Workstream CRUD', () => {
  const ws = orc.createWorkstream('test-ws', { description: 'Test workstream', priority: 1 });
  assert(ws.description === 'Test workstream', 'Workstream has description');
  assert(ws.priority === 1, 'Workstream has priority');

  const list = orc.listWorkstreams();
  assert(list.length === 1, 'One workstream listed');
  assert(list[0].name === 'test-ws', 'Workstream name matches');

  let threw = false;
  try { orc.createWorkstream('test-ws'); } catch (e) { threw = true; }
  assert(threw, 'Cannot create duplicate workstream');
});

test('Task lifecycle', () => {
  const task = orc.addTask('test-ws', { title: 'Test task', description: 'A test', priority: 2 });
  assert(task.id.length === 8, 'Task has 8-char ID');
  assert(task.status === 'pending', 'Task starts pending');
  assert(task.title === 'Test task', 'Task title matches');

  const claimed = orc.claimTask('test-ws', task.id, 'agent-test');
  assert(claimed.status === 'in_progress', 'Claimed task is in_progress');
  assert(claimed.assigned_to === 'agent-test', 'Task assigned to agent');

  let threw = false;
  try { orc.claimTask('test-ws', task.id, 'agent-2'); } catch (e) { threw = true; }
  assert(threw, 'Cannot claim already-claimed task');

  const completed = orc.completeTask('test-ws', task.id, 'Done!');
  assert(completed.status === 'done', 'Completed task is done');
  assert(completed.result === 'Done!', 'Result recorded');
});

test('getNextTask', () => {
  orc.addTask('test-ws', { title: 'Task A', priority: 3 });
  orc.addTask('test-ws', { title: 'Task B', priority: 1 });

  const next = orc.getNextTask('test-ws', 'agent-auto');
  assert(next.title === 'Task B', 'Gets highest priority (lowest number) task');
  assert(next.status === 'in_progress', 'Auto-claimed');
});

test('Agent registration', () => {
  const agent = orc.registerAgent('test-agent', { type: 'worker', capabilities: ['code'] });
  assert(agent.type === 'worker', 'Agent type set');
  assert(agent.status === 'active', 'Agent starts active');

  orc.heartbeat('test-agent');
  const state = orc.loadState();
  assert(state.agents['test-agent'].status === 'active', 'Heartbeat keeps active');
});

test('Resource locking', () => {
  const got = orc.acquireLock('git-repo', 'agent-1', 5000);
  assert(got === true, 'Lock acquired');

  const denied = orc.acquireLock('git-repo', 'agent-2', 5000);
  assert(denied === false, 'Lock denied to other agent');

  const reacquire = orc.acquireLock('git-repo', 'agent-1', 5000);
  assert(reacquire === true, 'Same agent can re-acquire');

  const released = orc.releaseLock('git-repo', 'agent-1');
  assert(released === true, 'Lock released');

  const wrongRelease = orc.releaseLock('git-repo', 'agent-2');
  assert(wrongRelease === false, 'Cannot release lock not held');
});

test('Knowledge base', () => {
  orc.writeKnowledge('test-topic', '# Test\nSome knowledge here.');
  const content = orc.readKnowledge('test-topic');
  assert(content.includes('Some knowledge here'), 'Knowledge written and read');

  const missing = orc.readKnowledge('nonexistent');
  assert(missing === null, 'Missing topic returns null');

  const topics = orc.listKnowledge();
  assert(topics.includes('test-topic'), 'Topic listed');
});

test('Event log', () => {
  orc.logEvent('test-agent', 'test_action', { data: 'hello' });
  const events = orc.getEvents({ agent: 'test-agent', action: 'test_action' });
  assert(events.length >= 1, 'Event logged and retrieved');
  assert(events[events.length - 1].data === 'hello', 'Event data preserved');

  const recent = orc.getEvents({ last: 3 });
  assert(recent.length <= 3, 'Last N filter works');
});

test('Status dashboard', () => {
  const s = orc.status();
  assert(s.workstreams.length > 0, 'Status shows workstreams');
  assert(Array.isArray(s.agents), 'Status shows agents');
  assert(typeof s.version === 'number', 'Status shows version');

  const text = orc.statusText();
  assert(text.includes('OpSpawn Orchestrator Status'), 'Status text has header');
  assert(text.includes('test-ws'), 'Status text shows workstream');
});

// --- Cleanup ---
fs.rmSync(testDir, { recursive: true, force: true });

// --- Summary ---
console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log('All tests passed!');
}
