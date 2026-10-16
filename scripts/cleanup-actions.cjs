const DEFAULT_KEEP_COUNT = 10;
const API_ORIGIN = 'https://api.github.com';

class GitHubError extends Error {
 constructor(status, method, pathname) {
  super(`GitHub API ${method} ${pathname} failed with HTTP ${status}`);
  this.status = status;
 }
}

function validateKeepCount(keepCount) {
 if (!Number.isSafeInteger(keepCount) || keepCount < 1) throw new Error('Keep count must be a positive integer');
}

function selectRunsForCleanup(runs, keepCount = DEFAULT_KEEP_COUNT) {
 validateKeepCount(keepCount);
 const unique = new Map();
 for (const run of runs) {
  if (!Number.isSafeInteger(run.id) || run.id < 1 || !Number.isFinite(Date.parse(run.created_at)) || typeof run.status !== 'string') {
   throw new Error('GitHub returned an invalid workflow run; refusing cleanup');
  }
  unique.set(run.id, run);
 }
 const sorted = [...unique.values()].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at) || right.id - left.id);
 const older = sorted.slice(keepCount);
 return {
  total: sorted.length,
  kept: Math.min(keepCount, sorted.length),
  candidates: older.filter(run => run.status === 'completed'),
  activeSkipped: older.filter(run => run.status !== 'completed').length,
 };
}

async function cleanupWorkflowRuns({repository, token, keepCount = DEFAULT_KEEP_COUNT, dryRun = true, fetchImpl = globalThis.fetch, log = console.log}) {
 validateKeepCount(keepCount);
 if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repository || '')) throw new Error('Set GITHUB_REPOSITORY to owner/repository');
 if (!token) throw new Error('Set GH_TOKEN or GITHUB_TOKEN with repository Actions access');
 const repoPath = `/repos/${repository}`;

 function apiUrl(value) {
  const url = new URL(value, API_ORIGIN);
  if (url.origin !== API_ORIGIN || !url.pathname.startsWith(repoPath + '/')) throw new Error('Unexpected GitHub pagination URL; refusing cleanup');
  return url;
 }

 async function request(value, method = 'GET') {
  const url = apiUrl(value);
  const response = await fetchImpl(url.href, {
   method,
   headers: {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'md2chat-actions-cleanup',
   },
   redirect: 'error',
   signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new GitHubError(response.status, method, url.pathname);
  return response;
 }

 async function listPages(endpoint, key) {
  const items = [];
  const seen = new Set();
  let next = `${repoPath}${endpoint}?per_page=100`;
  while (next) {
   const url = apiUrl(next).href;
   if (seen.has(url)) throw new Error('Repeated GitHub pagination URL; refusing cleanup');
   seen.add(url);
   const response = await request(url);
   const body = await response.json();
   if (!Array.isArray(body[key])) throw new Error(`GitHub returned invalid ${key}; refusing cleanup`);
   items.push(...body[key]);
   next = response.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1] || null;
  }
  return items;
 }

 // Finish every inventory before deleting anything so pagination cannot shift
 // because of this cleanup's own deletions, and incomplete inventories fail closed.
 const workflows = await listPages('/actions/workflows', 'workflows');
 const plans = [];
 const seenWorkflows = new Set();
 for (const workflow of workflows) {
  if (!Number.isSafeInteger(workflow.id) || workflow.id < 1) throw new Error('GitHub returned an invalid workflow; refusing cleanup');
  if (seenWorkflows.has(workflow.id)) continue;
  seenWorkflows.add(workflow.id);
  const runs = await listPages(`/actions/workflows/${workflow.id}/runs`, 'workflow_runs');
  const plan = selectRunsForCleanup(runs, keepCount);
  plans.push({workflow, ...plan});
 }

 const summary = {dryRun, workflows: plans.length, candidates: 0, deleted: 0, activeSkipped: 0, alreadyDeleted: 0, conflictsSkipped: 0};
 for (const plan of plans) {
  const name = String(plan.workflow.name || plan.workflow.id).replace(/[\r\n]/g, ' ');
  log(`${dryRun ? '[dry-run] ' : ''}Workflow ${name}: ${plan.total} runs; keep newest ${plan.kept}; ${plan.candidates.length} older completed candidates; ${plan.activeSkipped} active runs skipped`);
  summary.candidates += plan.candidates.length;
  summary.activeSkipped += plan.activeSkipped;
  if (dryRun) continue;
  for (const run of plan.candidates) {
   try {
    // A completed run may have been rerun after inventory. Check immediately
    // before deletion so queued or in-progress reruns are left alone.
    const current = await (await request(`${repoPath}/actions/runs/${run.id}`)).json();
    if (current.id !== run.id || typeof current.status !== 'string') throw new Error('GitHub returned an invalid run status; refusing cleanup');
    if (current.status !== 'completed') {
     summary.activeSkipped += 1;
     log(`Run ${run.id} is now ${current.status}; skipping`);
     continue;
    }
    await request(`${repoPath}/actions/runs/${run.id}`, 'DELETE');
    summary.deleted += 1;
    log(`Deleted completed run ${run.id}`);
   } catch (error) {
    if (error.status === 404) {
     summary.alreadyDeleted += 1;
     log(`Run ${run.id} was already deleted; skipping`);
    } else if (error.status === 409) {
     // GitHub may reject deletion if a run becomes active after our recheck.
     summary.conflictsSkipped += 1;
     log(`Run ${run.id} has a concurrent conflict; leaving it untouched`);
    } else {
     throw error;
    }
   }
  }
 }
 log(`${dryRun ? 'Dry run complete' : 'Cleanup complete'}: ${summary.candidates} candidates, ${summary.deleted} deleted, ${summary.activeSkipped} active skipped, ${summary.alreadyDeleted} already deleted, ${summary.conflictsSkipped} conflicts skipped`);
 return summary;
}

function parseArguments(args) {
 let dryRun = true;
 let mode;
 let keepCount = DEFAULT_KEEP_COUNT;
 for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--delete' || arg === '--dry-run') {
   if (mode) throw new Error('Specify only one cleanup mode');
   mode = arg;
   dryRun = arg !== '--delete';
  } else if (arg === '--keep') {
   const value = args[++index];
   if (!/^[1-9]\d*$/.test(value || '')) throw new Error('--keep requires a positive integer');
   keepCount = Number(value);
  } else {
   throw new Error(`Unknown cleanup argument: ${arg}`);
  }
 }
 validateKeepCount(keepCount);
 return {dryRun, keepCount};
}

if (require.main === module) {
 Promise.resolve().then(() => cleanupWorkflowRuns({
  repository: process.env.GITHUB_REPOSITORY,
  token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
  ...parseArguments(process.argv.slice(2)),
 })).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
 });
}

module.exports = {DEFAULT_KEEP_COUNT, selectRunsForCleanup, cleanupWorkflowRuns, parseArguments};
