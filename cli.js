#!/usr/bin/env node
/**
 * OpSpawn Orchestrator CLI
 *
 * Usage:
 *   node cli.js status                           - Show system status
 *   node cli.js workstream create <name> [desc]   - Create workstream
 *   node cli.js workstream list                   - List workstreams
 *   node cli.js task add <ws> <title> [desc]      - Add task to workstream
 *   node cli.js task claim <ws> <taskId> <agent>   - Claim a task
 *   node cli.js task complete <ws> <taskId> [result] - Complete a task
 *   node cli.js task next <ws> <agent>             - Get next pending task
 *   node cli.js agent register <id> [type]         - Register agent
 *   node cli.js lock acquire <resource> <agent>    - Acquire lock
 *   node cli.js lock release <resource> <agent>    - Release lock
 *   node cli.js kb write <topic> <content>         - Write knowledge
 *   node cli.js kb read <topic>                    - Read knowledge
 *   node cli.js kb list                            - List knowledge topics
 *   node cli.js events [--last N] [--agent X]      - Show events
 */

const orc = require('./orchestrator');

const [,, cmd, sub, ...args] = process.argv;

try {
  switch (cmd) {
    case 'status':
    case 's':
      console.log(orc.statusText());
      break;

    case 'workstream':
    case 'ws':
      switch (sub) {
        case 'create':
          orc.createWorkstream(args[0], { description: args[1] || '', priority: parseInt(args[2]) || 5 });
          console.log(`Created workstream: ${args[0]}`);
          break;
        case 'list':
        case 'ls':
          const wsList = orc.listWorkstreams();
          for (const ws of wsList) {
            console.log(`[P${ws.priority}] ${ws.name} - ${ws.description || '(no desc)'}`);
            console.log(`  Tasks: ${ws.pending} pending, ${ws.in_progress} active, ${ws.done} done`);
          }
          if (wsList.length === 0) console.log('No workstreams.');
          break;
        default:
          console.error('Usage: workstream <create|list>');
      }
      break;

    case 'task':
    case 't':
      switch (sub) {
        case 'add':
          const task = orc.addTask(args[0], { title: args[1], description: args[2] || '', priority: parseInt(args[3]) || 5 });
          console.log(`Added task ${task.id}: ${task.title}`);
          break;
        case 'claim':
          const claimed = orc.claimTask(args[0], args[1], args[2]);
          console.log(`Claimed: ${claimed.title} -> ${args[2]}`);
          break;
        case 'complete':
        case 'done':
          const completed = orc.completeTask(args[0], args[1], args[2] || null);
          console.log(`Completed: ${completed.title}`);
          break;
        case 'next':
          const next = orc.getNextTask(args[0], args[1]);
          if (next) {
            console.log(`Claimed next task: ${next.id} - ${next.title}`);
          } else {
            console.log('No pending tasks in this workstream.');
          }
          break;
        case 'list':
        case 'ls': {
          const state = orc.loadState();
          const ws = state.workstreams[args[0]];
          if (!ws) { console.error(`Workstream "${args[0]}" not found`); break; }
          for (const t of ws.tasks) {
            const assignee = t.assigned_to ? ` -> ${t.assigned_to}` : '';
            console.log(`[${t.status}] ${t.id}: ${t.title}${assignee}`);
          }
          if (ws.tasks.length === 0) console.log('No tasks.');
          break;
        }
        default:
          console.error('Usage: task <add|claim|complete|next|list>');
      }
      break;

    case 'agent':
    case 'a':
      switch (sub) {
        case 'register':
          orc.registerAgent(args[0], { type: args[1] || 'general' });
          console.log(`Registered agent: ${args[0]} (${args[1] || 'general'})`);
          break;
        case 'heartbeat':
          orc.heartbeat(args[0]);
          console.log(`Heartbeat: ${args[0]}`);
          break;
        default:
          console.error('Usage: agent <register|heartbeat>');
      }
      break;

    case 'lock':
    case 'l':
      switch (sub) {
        case 'acquire':
          const got = orc.acquireLock(args[0], args[1]);
          console.log(got ? `Lock acquired: ${args[0]}` : `Lock denied: ${args[0]} (held by another agent)`);
          break;
        case 'release':
          const released = orc.releaseLock(args[0], args[1]);
          console.log(released ? `Lock released: ${args[0]}` : `Lock not held by ${args[1]}`);
          break;
        default:
          console.error('Usage: lock <acquire|release>');
      }
      break;

    case 'kb':
    case 'knowledge':
      switch (sub) {
        case 'write':
          orc.writeKnowledge(args[0], args.slice(1).join(' '));
          console.log(`Wrote knowledge: ${args[0]}`);
          break;
        case 'read':
          const content = orc.readKnowledge(args[0]);
          console.log(content || `(no knowledge on "${args[0]}")`);
          break;
        case 'list':
        case 'ls':
          const topics = orc.listKnowledge();
          console.log(topics.length ? topics.join('\n') : '(empty)');
          break;
        default:
          console.error('Usage: kb <write|read|list>');
      }
      break;

    case 'events':
    case 'e': {
      const opts = {};
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--last') opts.last = parseInt(args[++i]);
        else if (args[i] === '--agent') opts.agent = args[++i];
        else if (args[i] === '--action') opts.action = args[++i];
        else if (args[i] === '--since') opts.since = args[++i];
      }
      if (!opts.last) opts.last = 20;
      const events = orc.getEvents(opts);
      for (const e of events) {
        const time = e.ts.split('T')[1].split('.')[0];
        const extra = Object.keys(e).filter(k => !['ts', 'agent', 'action'].includes(k));
        const extraStr = extra.length ? ` {${extra.map(k => `${k}=${e[k]}`).join(', ')}}` : '';
        console.log(`[${time}] ${e.agent}: ${e.action}${extraStr}`);
      }
      if (events.length === 0) console.log('No events.');
      break;
    }

    default:
      console.log(`OpSpawn Orchestrator CLI

Usage:
  node cli.js status                              Show system status
  node cli.js ws create <name> [desc] [priority]  Create workstream
  node cli.js ws list                             List workstreams
  node cli.js t add <ws> <title> [desc] [prio]    Add task
  node cli.js t list <ws>                         List tasks in workstream
  node cli.js t claim <ws> <taskId> <agent>       Claim task
  node cli.js t complete <ws> <taskId> [result]   Complete task
  node cli.js t next <ws> <agent>                 Get & claim next task
  node cli.js a register <id> [type]              Register agent
  node cli.js lock acquire <resource> <agent>     Acquire lock
  node cli.js lock release <resource> <agent>     Release lock
  node cli.js kb write <topic> <content>          Write knowledge
  node cli.js kb read <topic>                     Read knowledge
  node cli.js kb list                             List knowledge topics
  node cli.js events [--last N] [--agent X]       Show events`);
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
