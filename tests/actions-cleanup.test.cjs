const {test} = require('node:test');
const assert = require('node:assert/strict');
const {selectRunsForCleanup, cleanupWorkflowRuns, parseArguments} = require('../scripts/cleanup-actions.cjs');

const repository = 'example/repository';
const api = `https://api.github.com/repos/${repository}`;
const run = (id, status = 'completed', conclusion = 'success') => ({id, status, conclusion, created_at: new Date(Date.UTC(2026, 0, id)).toISOString()});
const reply = (body, {status = 200, next} = {}) => new Response(status === 204 ? null : JSON.stringify(body), {status, headers: next ? {link: `<${next}>; rel="next"`} : {}});

test('retention counts every conclusion and keeps active older runs', () => {
 const runs = Array.from({length: 14}, (_, index) => run(index + 1, index === 0 ? 'in_progress' : 'completed', index % 2 ? 'failure' : 'success'));
 const plan = selectRunsForCleanup(runs.reverse());
 assert.equal(plan.kept, 10);
 assert.deepEqual(plan.candidates.map(item => item.id), [4, 3, 2]);
 assert.equal(plan.activeSkipped, 1);
 assert.equal(runs[0].id, 14);
});

test('equal timestamps use run IDs and repeated pages do not consume retention slots', () => {
 const old = {...run(1), created_at: run(2).created_at};
 assert.deepEqual(selectRunsForCleanup([old, run(2), run(2)], 1).candidates.map(item => item.id), [1]);
 assert.throws(() => selectRunsForCleanup([{...run(1), created_at: 'invalid'}]), /refusing cleanup/);
});

test('dry run follows all workflow and run pages without deleting', async () => {
 const requests = [];
 const pages = new Map([
  [`${api}/actions/workflows?per_page=100`, reply({workflows: [{id: 11, name: 'Build'}]}, {next: `${api}/actions/workflows?per_page=100&page=2`})],
  [`${api}/actions/workflows?per_page=100&page=2`, reply({workflows: [{id: 12, name: 'Pages'}]})],
  [`${api}/actions/workflows/11/runs?per_page=100`, reply({workflow_runs: [run(3), run(2)]}, {next: `${api}/actions/workflows/11/runs?per_page=100&page=2`})],
  [`${api}/actions/workflows/11/runs?per_page=100&page=2`, reply({workflow_runs: [run(2), run(1)]})],
  [`${api}/actions/workflows/12/runs?per_page=100`, reply({workflow_runs: [run(4)]})],
 ]);
 const summary = await cleanupWorkflowRuns({repository, token: 'test-token', keepCount: 1, log: () => {}, fetchImpl: async (url, options) => {
  requests.push({url, method: options.method});
  assert.equal(options.headers.Authorization, 'Bearer test-token');
  assert(pages.has(url), url);
  return pages.get(url);
 }});
 assert.equal(summary.candidates, 2);
 assert.equal(summary.deleted, 0);
 assert(requests.every(request => request.method === 'GET'));
 assert.equal(requests.length, 5);
});

test('deletion waits for complete inventory and rechecks rerun status', async () => {
 const requests = [];
 let inventoryComplete = false;
 const summary = await cleanupWorkflowRuns({repository, token: 'test-token', keepCount: 1, dryRun: false, log: () => {}, fetchImpl: async (url, options) => {
  requests.push(`${options.method} ${url}`);
  if (url === `${api}/actions/workflows?per_page=100`) return reply({workflows: [{id: 11}, {id: 12}]});
  if (url === `${api}/actions/workflows/11/runs?per_page=100`) return reply({workflow_runs: [run(4), run(3), run(2), run(1)]});
  if (url === `${api}/actions/workflows/12/runs?per_page=100`) {inventoryComplete = true; return reply({workflow_runs: []});}
  assert(inventoryComplete);
  if (url.endsWith('/runs/3')) {
   assert.equal(options.method, 'GET');
   return reply(run(3, 'queued'));
  }
  if (url.endsWith('/runs/2')) return options.method === 'GET' ? reply(run(2, 'completed', 'failure')) : reply(null, {status: 204});
  if (url.endsWith('/runs/1')) return options.method === 'GET' ? reply(run(1)) : reply({}, {status: 404});
  assert.fail(`Unexpected request ${options.method} ${url}`);
 }});
 assert.equal(summary.deleted, 1);
 assert.equal(summary.activeSkipped, 1);
 assert.equal(summary.alreadyDeleted, 1);
 assert(!requests.includes(`DELETE ${api}/actions/runs/3`));
});

test('an incomplete inventory or foreign pagination URL blocks every deletion', async () => {
 const methods = [];
 await assert.rejects(cleanupWorkflowRuns({repository, token: 'test-token', keepCount: 1, dryRun: false, log: () => {}, fetchImpl: async (url, options) => {
  methods.push(options.method);
  if (url.includes('/workflows?')) return reply({workflows: [{id: 11}, {id: 12}]});
  if (url.includes('/11/')) return reply({workflow_runs: [run(2), run(1)]});
  return reply({workflow_runs: null});
 }}), /refusing cleanup/);
 assert(methods.every(method => method === 'GET'));
 await assert.rejects(cleanupWorkflowRuns({repository, token: 'test-token', log: () => {}, fetchImpl: async () => reply({workflows: []}, {next: 'https://example.com/steal-token'})}), /Unexpected GitHub pagination URL/);
});

test('a concurrent rerun conflict leaves the run untouched and cleanup continues', async () => {
 const summary = await cleanupWorkflowRuns({repository, token: 'test-token', keepCount: 1, dryRun: false, log: () => {}, fetchImpl: async (url, options) => {
  if (url.includes('/workflows?')) return reply({workflows: [{id: 11}]});
  if (url.includes('/11/runs?')) return reply({workflow_runs: [run(3), run(2), run(1)]});
  if (options.method === 'GET') return reply(run(Number(url.split('/').at(-1))));
  return url.endsWith('/runs/2') ? reply({}, {status: 409}) : reply(null, {status: 204});
 }});
 assert.equal(summary.conflictsSkipped, 1);
 assert.equal(summary.deleted, 1);
});

test('CLI defaults to dry-run and invalid retention cannot enable deletion', () => {
 assert.deepEqual(parseArguments([]), {dryRun: true, keepCount: 10});
 assert.deepEqual(parseArguments(['--delete', '--keep', '10']), {dryRun: false, keepCount: 10});
 for (const args of [['--keep', '0'], ['--keep'], ['--keep', 'NaN'], ['--delete', '--dry-run'], ['--unknown']]) assert.throws(() => parseArguments(args));
});
