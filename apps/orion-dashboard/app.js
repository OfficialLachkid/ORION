const state = {
  csrfToken: '',
  username: '',
  overview: null,
};

const elements = Object.fromEntries([
  'loading-view', 'login-view', 'app-view', 'login-form', 'login-error',
  'username', 'password', 'session-user', 'logout-button', 'refresh-button',
  'last-updated', 'dashboard-error', 'module-list', 'kpi-grid', 'overall-health',
  'health-list', 'approval-list', 'publication-count', 'publication-table',
  'channel-count', 'channel-list', 'activity-list', 'source-list',
].map((id) => [id, document.getElementById(id)]));

function show(element) {
  element.classList.remove('hidden');
}

function hide(element) {
  element.classList.add('hidden');
}

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function clear(element) {
  element.replaceChildren();
}

function formatDate(value, includeTime = true) {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Not available';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    ...(includeTime ? { timeStyle: 'short' } : {}),
  }).format(date);
}

function friendly(value) {
  return String(value || 'unknown')
    .replaceAll('_', ' ')
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || 'Dashboard request failed.');
    error.status = response.status;
    throw error;
  }
  return body;
}

function renderModules(modules) {
  clear(elements['module-list']);
  for (const module of modules || []) {
    const button = node('button', `module-item ${module.id === 'overview' ? 'active' : ''}`);
    button.type = 'button';
    button.disabled = module.id !== 'overview';
    button.append(node('span', 'module-name', module.label));
    if (module.status !== 'available') {
      button.append(node('span', `module-state ${module.status}`, friendly(module.status)));
    }
    elements['module-list'].append(button);
  }
}

function kpiCard(label, value, detail, tone = '') {
  const card = node('article', `kpi-card ${tone}`);
  card.append(node('p', 'kpi-label', label));
  card.append(node('strong', 'kpi-value', String(value)));
  card.append(node('p', 'kpi-detail', detail));
  return card;
}

function renderKpis(overview) {
  clear(elements['kpi-grid']);
  const upcoming = overview.social.publications.upcoming.length;
  const leads = overview.leads.totalLoaded;
  elements['kpi-grid'].append(
    kpiCard('ORION health', friendly(overview.health.overall), `${overview.health.checks.length} runtime checks`, overview.health.overall),
    kpiCard('Pending approvals', overview.pendingApprovals.length, 'Same approval state Discord uses'),
    kpiCard('Upcoming posts', upcoming, 'Across enabled destinations'),
    kpiCard('Failed actions', overview.operations.executionsFailed, 'Last 24 hours', overview.operations.executionsFailed ? 'critical' : ''),
    kpiCard('Leads tracked', leads, overview.leads.truncated ? 'Showing bounded source window' : 'Shared lead store'),
  );
}

function emptyState(message) {
  return node('p', 'empty-state', message);
}

function renderHealth(health) {
  elements['overall-health'].className = `status-pill ${health.overall}`;
  elements['overall-health'].textContent = friendly(health.overall);
  clear(elements['health-list']);
  if (!health.checks.length) {
    elements['health-list'].append(emptyState('No health snapshot has been recorded yet.'));
    return;
  }
  for (const check of health.checks) {
    const item = node('div', 'stack-item');
    const marker = node('span', `health-marker ${check.severity}`);
    const copy = node('div', 'stack-copy');
    copy.append(node('strong', '', friendly(check.id)));
    copy.append(node('span', '', check.summary || friendly(check.state)));
    item.append(marker, copy, node('span', `small-status ${check.severity}`, friendly(check.severity)));
    elements['health-list'].append(item);
  }
}

function renderApprovals(approvals) {
  clear(elements['approval-list']);
  if (!approvals.length) {
    elements['approval-list'].append(emptyState('No approvals are waiting right now.'));
    return;
  }
  for (const approval of approvals.slice(0, 8)) {
    const item = node('div', 'stack-item');
    const copy = node('div', 'stack-copy');
    copy.append(node('strong', '', approval.summary));
    copy.append(node('span', '', `${friendly(approval.domain)} · ${formatDate(approval.submittedAt)}`));
    item.append(copy, node('span', 'small-status warning', friendly(approval.status)));
    elements['approval-list'].append(item);
  }
}

function renderPublications(publications) {
  elements['publication-count'].textContent = `${publications.upcoming.length} upcoming`;
  clear(elements['publication-table']);
  if (!publications.upcoming.length) {
    const row = document.createElement('tr');
    const cell = node('td', 'table-empty', 'No future publications are currently scheduled.');
    cell.colSpan = 4;
    row.append(cell);
    elements['publication-table'].append(row);
    return;
  }
  for (const publication of publications.upcoming) {
    const row = document.createElement('tr');
    const title = node('td');
    title.append(node('strong', '', publication.title));
    title.append(node('span', 'cell-subtitle', publication.videoId));
    row.append(
      title,
      node('td', '', `${friendly(publication.platform)} · ${publication.accountKey}`),
      node('td', '', friendly(publication.status)),
      node('td', '', formatDate(publication.scheduledFor)),
    );
    elements['publication-table'].append(row);
  }
}

function renderChannels(channels) {
  elements['channel-count'].textContent = `${channels.length} connected`;
  clear(elements['channel-list']);
  if (!channels.length) {
    elements['channel-list'].append(emptyState('No channel data is available.'));
    return;
  }
  for (const channel of channels.slice(0, 10)) {
    const item = node('div', 'stack-item');
    const avatar = node('span', 'channel-avatar', (channel.name || '?').slice(0, 1).toUpperCase());
    const copy = node('div', 'stack-copy');
    copy.append(node('strong', '', channel.name));
    const schedule = channel.scheduleSlots.length ? channel.scheduleSlots.join(', ') : 'Schedule inherited';
    copy.append(node('span', '', `${friendly(channel.platform)} · ${schedule}`));
    item.append(avatar, copy, node('span', `small-status ${channel.status === 'active' ? 'healthy' : 'warning'}`, friendly(channel.status)));
    elements['channel-list'].append(item);
  }
}

function renderActivity(events) {
  clear(elements['activity-list']);
  if (!events.length) {
    elements['activity-list'].append(emptyState('No recent operational events are available.'));
    return;
  }
  for (const event of events.slice(0, 10)) {
    const item = node('div', 'timeline-item');
    item.append(node('span', 'timeline-dot'));
    const copy = node('div');
    copy.append(node('strong', '', friendly(event.type)));
    const context = [event.domain, event.action, event.status].filter(Boolean).map(friendly).join(' · ');
    copy.append(node('span', '', context || 'ORION runtime event'));
    item.append(copy, node('time', '', formatDate(event.timestamp)));
    elements['activity-list'].append(item);
  }
}

function renderSources(sources) {
  clear(elements['source-list']);
  for (const [name, source] of Object.entries(sources || {})) {
    const item = node('div', `source-chip ${source.available ? 'available' : 'unavailable'}`);
    item.append(node('span', 'source-dot'));
    item.append(node('span', '', friendly(name)));
    item.title = source.available ? 'Connected to shared ORION state' : source.reason;
    elements['source-list'].append(item);
  }
}

function renderOverview(overview) {
  state.overview = overview;
  elements['last-updated'].textContent = `Snapshot ${formatDate(overview.generatedAt)} · Read-only first instance`;
  renderModules(overview.modules);
  renderKpis(overview);
  renderHealth(overview.health);
  renderApprovals(overview.pendingApprovals);
  renderPublications(overview.social.publications);
  renderChannels(overview.social.channels);
  renderActivity(overview.recentActivity);
  renderSources(overview.sources);
}

async function loadOverview(force = false) {
  elements['refresh-button'].disabled = true;
  hide(elements['dashboard-error']);
  try {
    const overview = await api(`/api/overview${force ? '?refresh=1' : ''}`);
    renderOverview(overview);
  } catch (error) {
    if (error.status === 401) {
      showLogin();
      return;
    }
    elements['dashboard-error'].textContent = error.message;
    show(elements['dashboard-error']);
  } finally {
    elements['refresh-button'].disabled = false;
  }
}

function showLogin() {
  state.csrfToken = '';
  hide(elements['loading-view']);
  hide(elements['app-view']);
  show(elements['login-view']);
  elements.username.focus();
}

function showApp(session) {
  state.csrfToken = session.csrfToken;
  state.username = session.username;
  elements['session-user'].textContent = session.username;
  hide(elements['loading-view']);
  hide(elements['login-view']);
  show(elements['app-view']);
  void loadOverview();
}

elements['login-form'].addEventListener('submit', async (event) => {
  event.preventDefault();
  elements['login-error'].textContent = '';
  const submit = elements['login-form'].querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const session = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: elements.username.value,
        password: elements.password.value,
      }),
    });
    elements.password.value = '';
    showApp(session);
  } catch (error) {
    elements['login-error'].textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

elements['logout-button'].addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', {
      method: 'POST',
      headers: { 'X-CSRF-Token': state.csrfToken },
      body: '{}',
    });
  } finally {
    showLogin();
  }
});

elements['refresh-button'].addEventListener('click', () => void loadOverview(true));

async function initialize() {
  try {
    const session = await api('/api/session');
    if (session.authenticated) showApp(session);
    else showLogin();
  } catch {
    showLogin();
  }
}

setInterval(() => {
  if (!elements['app-view'].classList.contains('hidden')) void loadOverview();
}, 60_000);

void initialize();

