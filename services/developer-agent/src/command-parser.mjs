const COMMAND_PREFIXES = [
  /^create issue for developer\s*:\s*/iu,
  /^create developer issue\s*:\s*/iu,
  /^developer task\s*:\s*/iu,
  /^developer-agent task\s*:\s*/iu,
  /^create developer task\s*:\s*/iu,
];

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

export function parseDeveloperTaskCommand(content) {
  const raw = String(content || '').trim();
  const prefix = COMMAND_PREFIXES.find((candidate) => candidate.test(raw));
  if (!prefix) {
    return null;
  }

  const objective = normalizeWhitespace(raw.replace(prefix, ''));
  if (!objective) {
    return null;
  }

  return {
    objective,
    baseBranch: 'main',
  };
}

export function serializeDeveloperTaskCommand(request = {}) {
  const objective = normalizeWhitespace(request.objective);
  return objective ? `create issue for developer: ${objective}` : '';
}

export function summarizeDeveloperTaskRequest(request = {}, maxLength = 140) {
  const objective = normalizeWhitespace(request.objective);
  const prefix = 'Developer issue: ';
  const available = Math.max(1, maxLength - prefix.length);
  return `${prefix}${objective.length > available ? `${objective.slice(0, available - 3)}...` : objective}`;
}
