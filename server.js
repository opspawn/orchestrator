#!/usr/bin/env node

/**
 * OpSpawn Orchestrator - Web Dashboard & HTTP API
 *
 * Exposes the orchestrator state via REST API and serves a real-time dashboard.
 * Zero external dependencies - uses Node.js built-in http module.
 *
 * Usage:
 *   node server.js                    # Start on default port 4000
 *   PORT=8080 node server.js          # Custom port
 *   ORCHESTRATOR_DIR=/data node server.js  # Custom data directory
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const orc = require('./orchestrator');

const PORT = parseInt(process.env.PORT || '4000', 10);

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function json(res, data, statusCode = 200) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function error(res, message, statusCode = 400) {
  json(res, { error: message }, statusCode);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    return res.end();
  }

  try {
    // --- Dashboard ---
    if (pathname === '/' && method === 'GET') {
      const html = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(html);
    }

    // --- API: Status ---
    if (pathname === '/api/status' && method === 'GET') {
      return json(res, orc.status());
    }

    if (pathname === '/api/status/text' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(orc.statusText());
    }

    // --- API: Workstreams ---
    if (pathname === '/api/workstreams' && method === 'GET') {
      return json(res, orc.listWorkstreams());
    }

    if (pathname === '/api/workstreams' && method === 'POST') {
      const body = await parseBody(req);
      if (!body.name) return error(res, 'name is required');
      const ws = orc.createWorkstream(body.name, {
        description: body.description,
        priority: body.priority
      });
      return json(res, ws, 201);
    }

    // --- API: Tasks ---
    const taskMatch = pathname.match(/^\/api\/workstreams\/([^/]+)\/tasks$/);
    if (taskMatch && method === 'GET') {
      const wsName = decodeURIComponent(taskMatch[1]);
      const state = orc.loadState();
      const ws = state.workstreams[wsName];
      if (!ws) return error(res, `Workstream "${wsName}" not found`, 404);
      return json(res, ws.tasks);
    }

    if (taskMatch && method === 'POST') {
      const wsName = decodeURIComponent(taskMatch[1]);
      const body = await parseBody(req);
      if (!body.title) return error(res, 'title is required');
      const task = orc.addTask(wsName, {
        title: body.title,
        description: body.description,
        priority: body.priority,
        estimate: body.estimate
      });
      return json(res, task, 201);
    }

    const taskActionMatch = pathname.match(/^\/api\/workstreams\/([^/]+)\/tasks\/([^/]+)\/(claim|complete)$/);
    if (taskActionMatch && method === 'POST') {
      const wsName = decodeURIComponent(taskActionMatch[1]);
      const taskId = taskActionMatch[2];
      const action = taskActionMatch[3];
      const body = await parseBody(req);

      if (action === 'claim') {
        if (!body.agent) return error(res, 'agent is required');
        const task = orc.claimTask(wsName, taskId, body.agent);
        return json(res, task);
      }
      if (action === 'complete') {
        const task = orc.completeTask(wsName, taskId, body.result);
        return json(res, task);
      }
    }

    const nextTaskMatch = pathname.match(/^\/api\/workstreams\/([^/]+)\/next$/);
    if (nextTaskMatch && method === 'POST') {
      const wsName = decodeURIComponent(nextTaskMatch[1]);
      const body = await parseBody(req);
      if (!body.agent) return error(res, 'agent is required');
      const task = orc.getNextTask(wsName, body.agent);
      return json(res, task || { message: 'No pending tasks' });
    }

    // --- API: Agents ---
    if (pathname === '/api/agents' && method === 'GET') {
      const state = orc.loadState();
      const agents = Object.entries(state.agents).map(([id, a]) => ({
        id, ...a,
        stale: (Date.now() - new Date(a.last_seen).getTime()) > 300000
      }));
      return json(res, agents);
    }

    if (pathname === '/api/agents' && method === 'POST') {
      const body = await parseBody(req);
      if (!body.id) return error(res, 'id is required');
      const agent = orc.registerAgent(body.id, {
        type: body.type,
        capabilities: body.capabilities
      });
      return json(res, agent, 201);
    }

    const heartbeatMatch = pathname.match(/^\/api\/agents\/([^/]+)\/heartbeat$/);
    if (heartbeatMatch && method === 'POST') {
      const agentId = decodeURIComponent(heartbeatMatch[1]);
      orc.heartbeat(agentId);
      return json(res, { ok: true });
    }

    // --- API: Events ---
    if (pathname === '/api/events' && method === 'GET') {
      const opts = {};
      if (url.searchParams.get('agent')) opts.agent = url.searchParams.get('agent');
      if (url.searchParams.get('action')) opts.action = url.searchParams.get('action');
      if (url.searchParams.get('since')) opts.since = url.searchParams.get('since');
      if (url.searchParams.get('last')) opts.last = parseInt(url.searchParams.get('last'), 10);
      return json(res, orc.getEvents(opts));
    }

    // --- API: Knowledge ---
    if (pathname === '/api/knowledge' && method === 'GET') {
      return json(res, orc.listKnowledge());
    }

    const kbMatch = pathname.match(/^\/api\/knowledge\/([^/]+)$/);
    if (kbMatch && method === 'GET') {
      const topic = decodeURIComponent(kbMatch[1]);
      const content = orc.readKnowledge(topic);
      if (content === null) return error(res, `Topic "${topic}" not found`, 404);
      return json(res, { topic, content });
    }

    if (kbMatch && method === 'PUT') {
      const topic = decodeURIComponent(kbMatch[1]);
      const body = await parseBody(req);
      if (!body.content) return error(res, 'content is required');
      orc.writeKnowledge(topic, body.content, body.agent || 'api');
      return json(res, { ok: true });
    }

    // --- API: Locks ---
    if (pathname === '/api/locks' && method === 'GET') {
      const state = orc.loadState();
      const locks = Object.entries(state.locks)
        .filter(([, lock]) => {
          const expiresAt = new Date(lock.acquired_at).getTime() + lock.ttl_ms;
          return Date.now() < expiresAt;
        })
        .map(([resource, lock]) => ({ resource, ...lock }));
      return json(res, locks);
    }

    if (pathname === '/api/locks' && method === 'POST') {
      const body = await parseBody(req);
      if (!body.resource || !body.agent) return error(res, 'resource and agent are required');
      const acquired = orc.acquireLock(body.resource, body.agent, body.ttl || 60000);
      return json(res, { acquired }, acquired ? 200 : 409);
    }

    const lockMatch = pathname.match(/^\/api\/locks\/([^/]+)$/);
    if (lockMatch && method === 'DELETE') {
      const resource = decodeURIComponent(lockMatch[1]);
      const body = await parseBody(req);
      if (!body.agent) return error(res, 'agent is required');
      const released = orc.releaseLock(resource, body.agent);
      return json(res, { released });
    }

    // --- 404 ---
    error(res, 'Not found', 404);
  } catch (err) {
    error(res, err.message, 500);
  }
});

server.listen(PORT, () => {
  console.log(`OpSpawn Orchestrator Dashboard: http://localhost:${PORT}`);
  console.log(`API: http://localhost:${PORT}/api/status`);
});
