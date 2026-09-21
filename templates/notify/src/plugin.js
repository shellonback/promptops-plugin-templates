// NOTIFY template: react to app events and send a message somewhere.
// Events carry METADATA only: session name, status, duration. Never prompt text, answers, paths or code.

// The webhook token lives in the URL path. Secrets are allowed in the path and query, never in the host.
const send = async (sdk, content) => {
  const res = await sdk.http.fetch('https://discord.com/api/webhooks/{{secret:webhookPath}}', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`Discord answered ${res.status}`);
};

promptops.events.on('turn.completed', async (event, sdk) => {
  const config = await sdk.config.get();
  if (config.onlyFailures && event.status === 'success') return;
  const icon = event.status === 'success' ? 'done' : 'FAILED';
  await send(sdk, `[${icon}] ${event.sessionName}: turn finished in ${event.durationSec}s`);
});

promptops.events.on('approval.requested', async (event, sdk) => {
  await send(sdk, `${event.sessionName} is waiting for your approval (${event.tool})`);
});

promptops.actions.register('send-test', async (_context, sdk) => {
  await send(sdk, 'PromptOps test message');
  await sdk.notify.toast('Test message sent');
});
