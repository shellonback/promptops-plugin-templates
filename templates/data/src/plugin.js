// DATA template: an explorer. You describe resources and return ROWS.
// PromptOps draws the table, so there is no HTML, no CSS and no UI code in your plugin.
const API = 'https://jsonplaceholder.typicode.com';

const RESOURCES = {
  users: { name: 'Users', description: 'People registered in the demo API', columns: ['id', 'name', 'email', 'website'] },
  posts: { name: 'Posts', description: 'Blog posts', columns: ['id', 'userId', 'title'] },
  todos: { name: 'Todos', description: 'To-do items', columns: ['id', 'userId', 'title', 'completed'] },
};

promptops.data.registerExplorer({
  async listResources() {
    return Object.entries(RESOURCES).map(([id, r]) => ({ id, name: r.name, description: r.description }));
  },

  // Return at most `limit` rows. Values are shown as text, whatever they contain.
  async query({ resourceId, limit }, sdk) {
    const resource = RESOURCES[resourceId];
    if (!resource) throw new Error('Unknown resource');
    const res = await sdk.http.fetch(`${API}/${resourceId}?_limit=${Math.min(Number(limit) || 25, 100)}`);
    if (!res.ok) throw new Error(`The API answered ${res.status}`);
    const rows = JSON.parse(res.body);
    return {
      columns: resource.columns.map((key) => ({ key, label: key })),
      rows: rows.map((row) => Object.fromEntries(resource.columns.map((key) => [key, row[key]]))),
      total: Number(res.headers['x-total-count']) || undefined,
    };
  },
});
