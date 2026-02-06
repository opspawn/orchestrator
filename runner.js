#!/usr/bin/env node
/**
 * OpSpawn Orchestrator Runner
 *
 * Reads the task board and generates a cycle plan. Can be called by
 * the main agent loop to decide what to work on and spawn sub-agents.
 *
 * This doesn't directly spawn Claude sub-agents (that's done via the
 * Task tool in the main loop), but it:
 * 1. Selects the highest-priority work
 * 2. Generates a brief for each sub-agent
 * 3. Provides context from the knowledge base
 * 4. After work completes, collects results
 *
 * Usage:
 *   node runner.js plan          - Generate cycle plan
 *   node runner.js brief <ws>    - Generate agent brief for workstream
 *   node runner.js collect       - Summarize what happened this cycle
 */

const orc = require('./orchestrator');
const fs = require('fs');
const path = require('path');

const [,, cmd, ...args] = process.argv;

function generatePlan() {
  const workstreams = orc.listWorkstreams();
  const plan = {
    generated_at: new Date().toISOString(),
    workstreams: [],
    recommended_parallel: [],
    recommended_serial: []
  };

  for (const ws of workstreams) {
    if (ws.pending === 0 && ws.in_progress === 0) continue;

    const state = orc.loadState();
    const tasks = state.workstreams[ws.name].tasks
      .filter(t => t.status === 'pending')
      .sort((a, b) => a.priority - b.priority);

    plan.workstreams.push({
      name: ws.name,
      priority: ws.priority,
      next_task: tasks[0] || null,
      pending_count: ws.pending
    });

    if (tasks[0]) {
      // Tasks that can run in parallel (different workstreams, no shared resources)
      plan.recommended_parallel.push({
        workstream: ws.name,
        task: tasks[0],
        brief: generateBrief(ws.name, tasks[0])
      });
    }
  }

  // Identify conflicts (tasks that should be serial)
  const gitTasks = plan.recommended_parallel.filter(p =>
    p.brief.toLowerCase().includes('git') || p.brief.toLowerCase().includes('commit')
  );
  if (gitTasks.length > 1) {
    plan.recommended_serial.push({
      reason: 'Multiple tasks need git access',
      tasks: gitTasks.map(t => `${t.workstream}/${t.task.id}`)
    });
  }

  return plan;
}

function generateBrief(workstream, task) {
  const knowledge = orc.listKnowledge();
  const relevantKnowledge = knowledge
    .filter(topic => {
      const content = orc.readKnowledge(topic);
      return content && (
        content.toLowerCase().includes(workstream) ||
        content.toLowerCase().includes(task.title.toLowerCase().split(' ')[0])
      );
    })
    .map(topic => ({ topic, content: orc.readKnowledge(topic) }));

  const recentEvents = orc.getEvents({ last: 5 });

  let brief = `## Agent Brief: ${task.title}\n\n`;
  brief += `**Workstream**: ${workstream}\n`;
  brief += `**Task ID**: ${task.id}\n`;
  brief += `**Priority**: ${task.priority}\n`;
  brief += `**Description**: ${task.description || task.title}\n\n`;

  if (relevantKnowledge.length > 0) {
    brief += `### Relevant Knowledge\n`;
    for (const k of relevantKnowledge) {
      brief += `\n#### ${k.topic}\n${k.content}\n`;
    }
    brief += '\n';
  }

  if (recentEvents.length > 0) {
    brief += `### Recent System Events\n`;
    for (const e of recentEvents) {
      brief += `- ${e.ts}: ${e.agent} ${e.action}\n`;
    }
    brief += '\n';
  }

  brief += `### Instructions\n`;
  brief += `1. Complete the task described above\n`;
  brief += `2. Write any findings to the knowledge base using:\n`;
  brief += `   node /home/agent/projects/orchestrator/cli.js kb write <topic> "<content>"\n`;
  brief += `3. Mark the task complete when done:\n`;
  brief += `   node /home/agent/projects/orchestrator/cli.js t complete ${workstream} ${task.id} "<result>"\n`;

  return brief;
}

function collectResults() {
  const state = orc.loadState();
  const summary = {
    collected_at: new Date().toISOString(),
    completed_this_cycle: [],
    still_in_progress: [],
    knowledge_updates: orc.listKnowledge()
  };

  for (const [wsName, ws] of Object.entries(state.workstreams)) {
    for (const task of ws.tasks) {
      if (task.status === 'done') {
        summary.completed_this_cycle.push({
          workstream: wsName,
          task_id: task.id,
          title: task.title,
          result: task.result
        });
      } else if (task.status === 'in_progress') {
        summary.still_in_progress.push({
          workstream: wsName,
          task_id: task.id,
          title: task.title,
          assigned_to: task.assigned_to
        });
      }
    }
  }

  return summary;
}

try {
  switch (cmd) {
    case 'plan':
    case 'p': {
      const plan = generatePlan();
      console.log(JSON.stringify(plan, null, 2));
      break;
    }
    case 'brief':
    case 'b': {
      const ws = args[0];
      if (!ws) { console.error('Usage: brief <workstream>'); process.exit(1); }
      const state = orc.loadState();
      const wsData = state.workstreams[ws];
      if (!wsData) { console.error(`Workstream "${ws}" not found`); process.exit(1); }
      const nextTask = wsData.tasks.find(t => t.status === 'pending');
      if (!nextTask) { console.log('No pending tasks.'); break; }
      console.log(generateBrief(ws, nextTask));
      break;
    }
    case 'collect':
    case 'c': {
      const results = collectResults();
      console.log(JSON.stringify(results, null, 2));
      break;
    }
    default:
      console.log(`OpSpawn Runner
  node runner.js plan     - Generate cycle plan
  node runner.js brief <ws> - Generate agent brief
  node runner.js collect  - Collect cycle results`);
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
