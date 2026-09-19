// Browser-side copy of the permission descriptions shown in the approval screen.
const TEXT = {
  secrets: 'Use the credentials you configure, without ever reading them',
  storage: 'Keep its own small local data',
  notify: 'Show notifications',
  'sessions:read': 'See the names and status of your sessions, not their content',
  'tasks:read': 'Read tasks of the project where it is active',
  'tasks:write': 'Create and update tasks of the project where it is active',
  'prompt:propose': 'Propose a prompt that you review before it is sent',
  'agents:propose': 'Propose starting an agent, which you confirm',
};
export const describePermission = (p) => (p.startsWith('net:') ? `Connect to ${p.slice(4)} over HTTPS` : TEXT[p] ?? p);
