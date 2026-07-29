function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function channelMention(channelId, fallbackLabel) {
  return channelId ? `<#${channelId}>` : fallbackLabel;
}

export function isCommandHelpRequest(content) {
  const normalized = normalizeWhitespace(content).toLowerCase();
  if (!normalized) {
    return false;
  }

  return [
    '/commands',
    '/help',
    'commands',
    'help',
    'show commands',
    'show help',
    'list commands',
    'what can you do',
    'what can i ask',
    'what commands can i use',
  ].includes(normalized);
}

export function buildCommandHelpDescriptor(config = {}) {
  const commandsChannel = channelMention(config?.channelIds?.commands, '#commands');
  const voiceCommandsChannel = channelMention(config?.channelIds?.voiceCommands, '#voice-commands');
  const approvalsChannel = channelMention(config?.channelIds?.approvals, '#approvals');
  const parsedTasksChannel = channelMention(config?.channelIds?.parsedTasks, '#parsed-tasks');
  const taskQueueChannel = channelMention(config?.channelIds?.taskQueue, '#task-queue');

  return {
    title: 'Operator Command Guide',
    description: `Use ${commandsChannel} for typed requests, ${voiceCommandsChannel} for voice notes, and ${approvalsChannel} for approval decisions.`,
    fields: [
      {
        name: 'How To Ask',
        value: [
          `- Send one request or multiple requests on separate lines in ${commandsChannel}.`,
          '- Or use the slash picker with `/commands`, `/health`, `/status`, or `/sync`.',
          `- Current parser is still keyword-based, so if something fails, use one of the example phrasings below.`,
          `- Parsed tasks appear in ${parsedTasksChannel} and queue state appears in ${taskQueueChannel}.`,
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Health Checks',
        value: [
          '`check ruflo worker service health`',
          '`check discord bot health`',
          '`check tailscale health`',
          '`check docker and colima health`',
          '`check ollama health`',
          '`check disk space`',
          '`check github auth health`',
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Runtime Checks',
        value: [
          '`check current launch agents health`',
          '`check current session checkpoint health`',
          '`check current runtime logs health`',
          '`check current disk-heavy folders`',
          '`check current memory/bridge sync health`',
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Sync + Updates',
        value: [
          '`sync github workflow`',
          '`sync the mac`',
          '`pull latest changes on the mac`',
          '`update the mac runtime`',
          '`/sync target:Mac runtime safe sync`',
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Email Drafts',
        value: [
          '`draft email to vbjtechservices@gmail.com subject: Smoke test body: Hello from O.R.I.O.N.`',
          '`/email-draft to:vbjtechservices@gmail.com subject:Smoke test body:Hello from O.R.I.O.N.`',
          '- Draft creation is safe and immediate; sending still requires approval.',
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Developer Agent',
        value: [
          '`create issue for developer: fix the queue result card ordering bug`',
          '`/create-developer-issue objective:fix the queue result card ordering bug`',
          '- Developer issues require approval before Claude quota or GitHub writes are used.',
          '- Approved work runs in an isolated branch and opens a draft PR.',
          '- Green PR CI creates a final approval; approving it in Discord revalidates and merges the tested commit.',
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Slash Checks',
        value: [
          '`/health target:Ruflo worker service`',
          '`/health target:Discord bot`',
          '`/health target:Tailscale`',
          '`/status target:Disk space`',
          '`/health target:Memory bridge sync`',
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Voice, Images, Approval',
        value: [
          `- Upload a voice memo in ${voiceCommandsChannel}.`,
          `- For images, send the command with the image, or send the image shortly before/after the command in the same channel.`,
          `- Approve with buttons or reply in ${approvalsChannel} using \`approve TASK-ID\` or \`reject TASK-ID because <reason>\`.`,
          '- Reject buttons now open a feedback form and require revision notes before the task is closed.',
        ].join('\n'),
        inline: false,
      },
    ],
    footerText: 'Ruflo operator help',
  };
}
