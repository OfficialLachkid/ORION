import { spawn } from 'node:child_process';
import { projectRoot } from '../../lib/runtime-config.mjs';

// Drafts a single, gentle follow-up to a lead who received the first outreach
// email and hasn't responded. Deliberately lighter than qualification — no
// re-fetch, no screenshot; it just writes a short Dutch nudge that references
// the original and re-states the free-design offer with an easy out. Runs on
// Claude (claude -p) like the qualifier, and every draft stays approval-gated.
const CLAUDE_TIMEOUT_MS = 120000;

const FOLLOW_UP_RULES = `You write ONE short, polite Dutch follow-up email to a local business that received a first outreach email from VBJ Services and did not reply.

Hard rules:
- Address the business by name in the greeting — "Beste <bedrijfsnaam>," (or "Beste heer/mevrouw <achternaam>," if the original email used a person's name). NEVER a bare "Beste," — that reads as impersonal mass-mail.
- SHORTER than a first email — 2 to 4 sentences, readable in ~10 seconds.
- Reference the earlier message lightly ("ik wilde even kort terugkomen op mijn eerdere bericht…") — do NOT repeat it in full.
- Re-state the offer in ONE line: a free, no-obligation website design/mockup; only if they like it do we build it out.
- Give an easy, respectful out ("mocht het niet interessant zijn, dan hoor ik het graag — dan laat ik u verder met rust").
- Business owner's language, no web-dev jargon. Courteous and professional. Never pushy, no fake urgency, no guilt.
- Dutch. Sign off as "VBJ Services".
- Subject: reuse the original subject with a "Re: " prefix so it threads.`;

function buildFollowUpPrompt(lead) {
  const q = lead.qualification || {};
  return `${FOLLOW_UP_RULES}

THE LEAD:
${JSON.stringify({ business_name: lead.business_name, website: lead.source_url, niche: lead.niche }, null, 2)}

THE ORIGINAL EMAIL THAT WENT UNANSWERED (for context — do not repeat it verbatim):
subject: ${q.draft_subject || '(unknown)'}
body:
${q.draft_body || '(unknown)'}

Respond with ONLY a JSON object, no markdown fences, no commentary:
{
  "draft_subject": "Re: <original subject> (Dutch)",
  "draft_body": "the short Dutch follow-up body"
}`;
}

function extractJson(text) {
  const trimmed = String(text || '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error(`No JSON object in Claude output: ${trimmed.slice(0, 200)}`);
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}

export function draftFollowUp(lead, config, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const command = config?.env?.CLAUDE_COMMAND || 'claude';
    const model = options.model || config?.env?.CLAUDE_MODEL || 'sonnet';
    const child = spawn(command, ['-p', buildFollowUpPrompt(lead), '--model', model], {
      cwd: projectRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectPromise(new Error(`Follow-up draft timed out after ${CLAUDE_TIMEOUT_MS / 1000}s.`));
    }, CLAUDE_TIMEOUT_MS);

    child.stdout.on('data', (c) => { stdout += c.toString(); });
    child.stderr.on('data', (c) => { stderr += c.toString(); });
    child.on('error', (error) => { clearTimeout(timer); rejectPromise(new Error(`Could not start claude: ${error.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        rejectPromise(new Error(stderr.trim() || `claude exited with code ${code}.`));
        return;
      }
      try {
        const parsed = extractJson(stdout);
        if (!parsed.draft_subject || !parsed.draft_body) {
          throw new Error('Follow-up draft missing subject or body.');
        }
        resolvePromise(parsed);
      } catch (error) {
        rejectPromise(new Error(`Could not parse follow-up output: ${error.message}`));
      }
    });
  });
}
