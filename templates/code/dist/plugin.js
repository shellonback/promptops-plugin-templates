// CODE template: a repository host. It reads METADATA from the hosting service.
// It never reads your local files or your code: plugins have no file access.
const API = 'https://api.github.com';

async function github(sdk, path) {
  const config = await sdk.config.get();
  const headers = { Accept: 'application/vnd.github+json' };
  if (config.__secretsSet.includes('token')) headers.Authorization = 'Bearer {{secret:token}}';
  const res = await sdk.http.fetch(API + path, { headers });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return JSON.parse(res.body);
}

// Never build a URL from unchecked input.
const safeRepo = (repo) => {
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(repo))) throw new Error('Repository must look like owner/name');
  return repo;
};

promptops.code.registerHost({
  async listPullRequests({ repo, state }, sdk) {
    const pulls = await github(sdk, `/repos/${safeRepo(repo)}/pulls?state=${state === 'closed' ? 'closed' : 'open'}&per_page=20`);
    return pulls.map((p) => ({
      number: p.number, title: p.title, author: p.user.login, state: p.state, draft: !!p.draft,
      url: p.html_url, headRef: p.head.ref, headSha: p.head.sha, updatedAt: p.updated_at,
    }));
  },

  // status must be one of: success, failure, pending, neutral
  async listChecks({ repo, ref }, sdk) {
    if (!/^[\w./-]+$/.test(String(ref))) throw new Error('Invalid ref');
    const data = await github(sdk, `/repos/${safeRepo(repo)}/commits/${ref}/check-runs?per_page=30`);
    return (data.check_runs || []).map((c) => ({
      name: c.name,
      status: c.status !== 'completed' ? 'pending' : c.conclusion === 'success' ? 'success' : c.conclusion === 'failure' ? 'failure' : 'neutral',
      url: c.html_url,
    }));
  },
});
