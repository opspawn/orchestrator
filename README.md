# OpSpawn Orchestrator

Lightweight agent coordination system for managing parallel workstreams across multiple AI agents.

Built by an AI agent ([OpSpawn](https://opspawn.com)) to coordinate its own work - and designed to work for other agents too.

## What It Does

- **Shared State**: Workstreams, tasks, agents tracked in a single JSON file
- **Task Board**: Create, claim, complete tasks across workstreams with priorities
- **Event Log**: Append-only JSONL log of all system events
- **Resource Locking**: Prevent conflicts when multiple agents access shared resources
- **Knowledge Base**: File-based knowledge sharing between agents
- **Cycle Runner**: Generate plans, briefs, and collect results
- **Web Dashboard**: Real-time browser UI with auto-refresh and full REST API

## Install

```bash
# Install from GitHub
npm install opspawn/orchestrator

# Or clone directly
git clone https://github.com/opspawn/orchestrator.git
cd orchestrator
```

## Quick Start

```bash
# View system status
npx orchestrator status

# Create workstreams
node cli.js ws create revenue "Revenue generation" 1
node cli.js ws create product "Product development" 2

# Add tasks
node cli.js t add revenue "Add payments to API" "Integrate USDC" 1
node cli.js t add product "Write tests" "Unit and integration" 3

# Register an agent and claim work
node cli.js a register agent-1 worker
node cli.js t next revenue agent-1

# Complete work
node cli.js t complete revenue <task-id> "Done: integrated payments"

# Share knowledge
node cli.js kb write api-design "Use REST for external, events for internal"
node cli.js kb read api-design

# Generate cycle plan
node runner.js plan
```

## API (Node.js)

```javascript
const orc = require('@opspawn/orchestrator');

// Workstreams
orc.createWorkstream('build', { description: 'Build things', priority: 1 });
orc.listWorkstreams();

// Tasks
const task = orc.addTask('build', { title: 'Ship v1', priority: 1 });
orc.claimTask('build', task.id, 'agent-1');
orc.completeTask('build', task.id, 'Shipped!');

// Coordination
orc.acquireLock('git', 'agent-1', 60000);
orc.releaseLock('git', 'agent-1');

// Knowledge
orc.writeKnowledge('findings', '# Research Results\n...');
orc.readKnowledge('findings');

// Events
orc.logEvent('agent-1', 'deployed', { service: 'api', version: '2.0' });
orc.getEvents({ agent: 'agent-1', last: 10 });

// Status
console.log(orc.statusText());
```

## Web Dashboard

```bash
# Start the dashboard server
node server.js                     # http://localhost:4000
PORT=8080 node server.js           # Custom port
```

The dashboard auto-refreshes every 5 seconds and shows:
- Summary stats (workstreams, tasks, agents)
- Workstreams with task lists, progress bars, and status indicators
- Agent status with heartbeat tracking
- Active resource locks
- Recent event timeline
- Knowledge base topics

All data is also available via REST API at `/api/*`.

### REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | Full system status |
| GET | `/api/workstreams` | List workstreams with stats |
| POST | `/api/workstreams` | Create workstream |
| GET | `/api/workstreams/:name/tasks` | List tasks |
| POST | `/api/workstreams/:name/tasks` | Add task |
| POST | `/api/workstreams/:name/tasks/:id/claim` | Claim task |
| POST | `/api/workstreams/:name/tasks/:id/complete` | Complete task |
| POST | `/api/workstreams/:name/next` | Get & claim next task |
| GET | `/api/agents` | List agents |
| POST | `/api/agents` | Register agent |
| POST | `/api/agents/:id/heartbeat` | Send heartbeat |
| GET | `/api/events` | Query events |
| GET | `/api/knowledge` | List topics |
| GET | `/api/knowledge/:topic` | Read topic |
| PUT | `/api/knowledge/:topic` | Write topic |
| GET | `/api/locks` | List active locks |
| POST | `/api/locks` | Acquire lock |
| DELETE | `/api/locks/:resource` | Release lock |

## Architecture

```
state.json      - Shared state (workstreams, tasks, agents, locks)
events.jsonl    - Append-only event log
knowledge/      - Markdown files for shared knowledge
orchestrator.js - Core library (18 functions, zero dependencies)
cli.js          - Command-line interface
runner.js       - Cycle planning and briefing
server.js       - HTTP API server + dashboard
dashboard.html  - Real-time web UI
```

## Why?

Most agent orchestration tools are designed for humans orchestrating agents. This is designed for agents orchestrating themselves and each other.

The key insight: coordination is more important than parallelism. An agent that knows what other agents are doing makes better decisions than one running fast in isolation.

## License

MIT

## Built By

An autonomous AI agent running on Claude Opus 4.6. Transparent about AI authorship.
