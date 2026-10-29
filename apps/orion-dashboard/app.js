const OVERVIEW_REFRESH_INTERVAL_MS = 15 * 60_000;

const state = {
  csrfToken: '',
  username: '',
  overview: null,
  activeModule: 'overview',
  publicationPlatform: 'all',
  channelQuery: '',
  leadStatus: 'all',
  leadPage: 1,
  leadOperations: null,
  leadLoading: false,
  leadError: '',
  overviewLoading: false,
  lastOverviewLoadedAt: 0,
};

const MODULE_COPY = {
  overview: {
    eyebrow: 'Operational overview',
    title: 'One source of truth.',
    description: 'Health, approvals, publishing, and recent activity across ORION.',
  },
  social: {
    eyebrow: 'Multi-platform operations',
    title: 'Social Media',
    description: 'The same approvals, channel schedules, and publication rows used by Discord and ORION workers.',
  },
  'digital-assets': {
    eyebrow: 'Product operations',
    title: 'Digital Assets',
    description: 'Canonical T7 products, generation progress, review gates, and verified marketplace releases.',
  },
  leads: {
    eyebrow: 'Lead generation operations',
    title: 'Lead Operations',
    description: 'A read-only view of the same gathered leads, qualification state, and totals reported by the VBJ bot in Discord.',
  },
};

const elements = Object.fromEntries([
  'loading-view', 'login-view', 'app-view', 'login-form', 'login-error',
  'username', 'password', 'session-user', 'logout-button', 'refresh-button',
  'page-eyebrow', 'page-title', 'page-description', 'last-updated', 'dashboard-error',
  'module-list', 'kpi-grid', 'overall-health',
  'health-list', 'approval-list', 'publication-count', 'publication-table',
  'publication-platform-filter', 'channel-search', 'channel-count', 'channel-list',
  'digital-asset-count', 'digital-asset-list', 'activity-list', 'source-list',
  'lead-status-filter', 'lead-count', 'lead-feedback', 'lead-table',
  'lead-previous', 'lead-page', 'lead-next',
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

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
    const interactive = Object.hasOwn(MODULE_COPY, module.id);
    const button = node('button', `module-item ${module.id === state.activeModule ? 'active' : ''}`);
    button.type = 'button';
    button.dataset.module = module.id;
    button.disabled = !interactive;
    button.setAttribute('aria-current', module.id === state.activeModule ? 'page' : 'false');
    button.append(node('span', 'module-name', module.label));
    if (module.status !== 'available') {
      button.append(node('span', `module-state ${module.status}`, friendly(module.status)));
    }
    if (interactive) button.addEventListener('click', () => setActiveModule(module.id));
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
  const publications = overview.social.publications;
  const activeChannels = overview.social.channels.filter((channel) => channel.status === 'active').length;
  const assets = overview.digitalAssets;

  if (state.activeModule === 'social') {
    elements['kpi-grid'].append(
      kpiCard('Connected channels', overview.social.channels.length, `${activeChannels} active`),
      kpiCard('Upcoming posts', publications.upcoming.length, 'Across enabled destinations'),
      kpiCard('Queued', publications.byStatus.queued || 0, 'Shared publication queue'),
      kpiCard('Failed', publications.byStatus.failed || 0, 'Platform delivery state', publications.byStatus.failed ? 'critical' : ''),
    );
    return;
  }

  if (state.activeModule === 'digital-assets') {
    elements['kpi-grid'].append(
      kpiCard('Products', assets.totalProducts, assets.available ? 'Canonical archive mounted' : 'Archive unavailable'),
      kpiCard('Assets', assets.totalAssets, `${assets.generatedAssets} generated`),
      kpiCard('Awaiting review', assets.byStatus.awaiting_asset_review || 0, 'Same review gates used by Discord'),
      kpiCard('Approved', assets.byStatus.approved || 0, 'Canonical product state'),
    );
    return;
  }

  if (state.activeModule === 'leads') {
    const leads = state.leadOperations;
    const available = Boolean(leads?.available);
    elements['kpi-grid'].append(
      kpiCard('Total leads', available ? leads.summary.total : '—', 'All gathered lead records'),
      kpiCard('New', available ? leads.summary.new : '—', 'Waiting for qualification'),
      kpiCard('Current view', available ? leads.summary.filtered : '—', state.leadStatus === 'all' ? 'All statuses' : friendly(state.leadStatus)),
      kpiCard(
        'Lead egress',
        available ? formatBytes(leads.resourceUsage.supabase.responseBytes) : '—',
        available ? `${leads.resourceUsage.supabase.requests} requests · ${leads.resourceUsage.supabase.rowsLoaded} rows` : 'Loads only when opened',
      ),
    );
    return;
  }

  elements['kpi-grid'].append(
    kpiCard('ORION health', friendly(overview.health.overall), `${overview.health.checks.length} runtime checks`, overview.health.overall),
    kpiCard('Pending approvals', overview.pendingApprovals.length, 'Same approval state Discord uses'),
    kpiCard('Upcoming posts', publications.upcoming.length, 'Across enabled destinations'),
    kpiCard('Digital products', assets.totalProducts, assets.available ? 'Canonical archive' : 'Archive unavailable'),
    kpiCard('Failed actions', overview.operations.executionsFailed, 'Last 24 hours', overview.operations.executionsFailed ? 'critical' : ''),
    kpiCard(
      'Snapshot egress',
      formatBytes(overview.resourceUsage.supabase.responseBytes),
      `${overview.resourceUsage.supabase.requests} Supabase requests · ${overview.resourceUsage.supabase.rowsLoaded} rows`,
    ),
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
  const domainTerms = state.activeModule === 'social'
    ? ['social', 'video', 'publication']
    : state.activeModule === 'digital-assets'
      ? ['digital', 'asset', 'marketplace', 'itch']
      : [];
  const visible = domainTerms.length
    ? approvals.filter((approval) => domainTerms.some((term) => (
      `${approval.domain} ${approval.summary}`.toLowerCase().includes(term)
    )))
    : approvals;
  if (!visible.length) {
    elements['approval-list'].append(emptyState('No approvals are waiting right now.'));
    return;
  }
  for (const approval of visible.slice(0, 8)) {
    const item = node('div', 'stack-item');
    const copy = node('div', 'stack-copy');
    copy.append(node('strong', '', approval.summary));
    copy.append(node('span', '', `${friendly(approval.domain)} · ${formatDate(approval.submittedAt)}`));
    item.append(copy, node('span', 'small-status warning', friendly(approval.status)));
    elements['approval-list'].append(item);
  }
}

function renderPublications(publications) {
  const platforms = [...new Set(publications.upcoming.map((publication) => publication.platform))].sort();
  const filter = elements['publication-platform-filter'];
  const currentOptions = [...filter.options].slice(1).map((option) => option.value);
  if (currentOptions.join('|') !== platforms.join('|')) {
    filter.replaceChildren(new Option('All platforms', 'all'));
    for (const platform of platforms) filter.append(new Option(friendly(platform), platform));
    filter.value = platforms.includes(state.publicationPlatform) ? state.publicationPlatform : 'all';
  }
  const visible = state.publicationPlatform === 'all'
    ? publications.upcoming
    : publications.upcoming.filter((publication) => publication.platform === state.publicationPlatform);
  elements['publication-count'].textContent = `${visible.length} of ${publications.upcoming.length} upcoming`;
  clear(elements['publication-table']);
  if (!visible.length) {
    const row = document.createElement('tr');
    const cell = node('td', 'table-empty', 'No future publications match this platform.');
    cell.colSpan = 4;
    row.append(cell);
    elements['publication-table'].append(row);
    return;
  }
  for (const publication of visible) {
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
  const query = state.channelQuery.trim().toLowerCase();
  const visible = query
    ? channels.filter((channel) => (
      `${channel.name} ${channel.accountKey} ${channel.platform} ${channel.niche}`.toLowerCase().includes(query)
    ))
    : channels;
  elements['channel-count'].textContent = `${visible.length} of ${channels.length} connected`;
  clear(elements['channel-list']);
  if (!visible.length) {
    elements['channel-list'].append(emptyState('No connected channels match this search.'));
    return;
  }
  for (const channel of visible.slice(0, 50)) {
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

function renderDigitalAssets(digitalAssets) {
  elements['digital-asset-count'].textContent = digitalAssets.available
    ? `${digitalAssets.totalProducts} products · ${digitalAssets.totalAssets} assets`
    : 'Archive unavailable';
  clear(elements['digital-asset-list']);
  if (!digitalAssets.available) {
    elements['digital-asset-list'].append(emptyState(digitalAssets.reason));
    return;
  }
  if (!digitalAssets.products.length) {
    elements['digital-asset-list'].append(emptyState('No canonical digital-asset products were found.'));
    return;
  }
  for (const product of digitalAssets.products) {
    const card = node('article', 'product-card');
    const heading = node('div', 'product-heading');
    const title = node('div');
    title.append(node('strong', '', product.title));
    title.append(node('span', '', `${product.category || 'Uncategorized'} · v${product.version || '—'}`));
    heading.append(title, node('span', `small-status ${product.status === 'approved' ? 'healthy' : 'warning'}`, friendly(product.status)));

    const progress = product.assetCount
      ? Math.round((product.generatedCount / product.assetCount) * 100)
      : 0;
    const meter = node('div', 'progress-track');
    const fill = node('span', 'progress-fill');
    fill.style.width = `${progress}%`;
    meter.append(fill);

    const meta = node('div', 'product-meta');
    meta.append(
      node('span', '', `${product.generatedCount}/${product.assetCount} generated`),
      node('span', '', product.marketplaces.length ? product.marketplaces.join(', ') : 'No marketplace target'),
      node('span', '', product.releaseStatus === 'verified_public' ? 'Verified public release' : 'Not publicly released'),
    );
    card.append(heading, meter, meta);
    if (product.publicUrl) {
      const link = node('a', 'product-link', 'Open public release');
      link.href = product.publicUrl;
      link.target = '_blank';
      link.rel = 'noreferrer';
      card.append(link);
    }
    elements['digital-asset-list'].append(card);
  }
}

function renderLeadOperations(result) {
  clear(elements['lead-table']);
  elements['lead-status-filter'].value = state.leadStatus;
  elements['lead-status-filter'].disabled = state.leadLoading;
  elements['lead-previous'].disabled = state.leadLoading || state.leadPage <= 1;
  elements['lead-next'].disabled = state.leadLoading
    || !result?.available
    || state.leadPage >= result.pagination.totalPages;

  if (state.leadLoading) {
    elements['lead-feedback'].textContent = 'Loading one bounded page from the shared lead store…';
    elements['lead-feedback'].classList.remove('error');
    elements['lead-count'].textContent = '';
    elements['lead-page'].textContent = `Page ${state.leadPage}`;
    const row = document.createElement('tr');
    const cell = node('td', 'table-empty', 'Loading gathered leads…');
    cell.colSpan = 5;
    row.append(cell);
    elements['lead-table'].append(row);
    return;
  }

  if (state.leadError) {
    elements['lead-feedback'].textContent = state.leadError;
    elements['lead-feedback'].classList.add('error');
    elements['lead-count'].textContent = '';
    elements['lead-page'].textContent = `Page ${state.leadPage}`;
    return;
  }

  if (!result?.available) {
    elements['lead-feedback'].textContent = result?.reason || 'Lead Operations has not been loaded yet.';
    elements['lead-count'].textContent = '';
    elements['lead-page'].textContent = `Page ${state.leadPage}`;
    return;
  }

  elements['lead-feedback'].classList.remove('error');
  elements['lead-feedback'].textContent = 'Read-only Supabase view. Discord leadgen and qualification continue unchanged.';
  elements['lead-count'].textContent = `${result.leads.length} shown · ${result.summary.filtered} matching`;
  elements['lead-page'].textContent = `Page ${result.pagination.page} of ${result.pagination.totalPages}`;
  if (!result.leads.length) {
    const row = document.createElement('tr');
    const cell = node('td', 'table-empty', 'No gathered leads match this status.');
    cell.colSpan = 5;
    row.append(cell);
    elements['lead-table'].append(row);
    return;
  }

  for (const lead of result.leads) {
    const row = document.createElement('tr');
    const business = node('td');
    if (lead.sourceUrl) {
      const link = node('a', 'table-link', lead.businessName);
      link.href = lead.sourceUrl;
      link.target = '_blank';
      link.rel = 'noreferrer';
      business.append(link);
    } else {
      business.append(node('strong', '', lead.businessName));
    }
    if (lead.businessType) business.append(node('span', 'cell-subtitle', lead.businessType));
    row.append(
      business,
      node('td', '', lead.niche || '—'),
      node('td', '', lead.location || '—'),
      node('td', '', friendly(lead.status)),
      node('td', '', formatDate(lead.createdAt)),
    );
    elements['lead-table'].append(row);
  }
}

function renderActivity(events) {
  clear(elements['activity-list']);
  const domainTerms = state.activeModule === 'social'
    ? ['social', 'video', 'publication', 'youtube', 'tiktok', 'instagram']
    : state.activeModule === 'digital-assets'
      ? ['digital', 'asset', 'marketplace', 'itch']
      : [];
  const visible = domainTerms.length
    ? events.filter((event) => domainTerms.some((term) => (
      `${event.type} ${event.domain} ${event.action}`.toLowerCase().includes(term)
    )))
    : events;
  if (!visible.length) {
    elements['activity-list'].append(emptyState('No recent operational events are available.'));
    return;
  }
  for (const event of visible.slice(0, 10)) {
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

function applyModuleView() {
  const copy = MODULE_COPY[state.activeModule] || MODULE_COPY.overview;
  elements['page-eyebrow'].textContent = copy.eyebrow;
  elements['page-title'].textContent = copy.title;
  elements['page-description'].textContent = copy.description;
  for (const section of document.querySelectorAll('[data-modules]')) {
    const modules = section.dataset.modules.split(/\s+/u);
    section.classList.toggle('module-view-hidden', !modules.includes(state.activeModule));
    section.classList.toggle('focused-panel', state.activeModule !== 'overview');
  }
}

function renderActiveModule() {
  if (!state.overview) return;
  renderModules(state.overview.modules);
  renderKpis(state.overview);
  renderApprovals(state.overview.pendingApprovals);
  renderPublications(state.overview.social.publications);
  renderChannels(state.overview.social.channels);
  renderDigitalAssets(state.overview.digitalAssets);
  renderLeadOperations(state.leadOperations);
  renderActivity(state.overview.recentActivity);
  applyModuleView();
}

function setActiveModule(moduleId, options = {}) {
  const available = state.overview?.modules?.some((module) => module.id === moduleId)
    || Object.hasOwn(MODULE_COPY, moduleId);
  state.activeModule = available ? moduleId : 'overview';
  if (options.updateHash !== false) {
    history.replaceState(null, '', `#${state.activeModule}`);
  }
  renderActiveModule();
  if (state.activeModule === 'leads' && !state.leadOperations) {
    void loadLeadOperations();
  }
}

function renderOverview(overview) {
  state.overview = overview;
  elements['last-updated'].textContent = `Snapshot ${formatDate(overview.generatedAt)} · Read-only first instance`;
  renderHealth(overview.health);
  renderSources(overview.sources);
  renderActiveModule();
}

async function loadOverview(force = false) {
  if (state.overviewLoading) return;
  state.overviewLoading = true;
  elements['refresh-button'].disabled = true;
  hide(elements['dashboard-error']);
  try {
    const overview = await api(`/api/overview${force ? '?refresh=1' : ''}`);
    renderOverview(overview);
    state.lastOverviewLoadedAt = Date.now();
  } catch (error) {
    if (error.status === 401) {
      showLogin();
      return;
    }
    elements['dashboard-error'].textContent = error.message;
    show(elements['dashboard-error']);
  } finally {
    state.overviewLoading = false;
    elements['refresh-button'].disabled = false;
  }
}

async function loadLeadOperations(force = false) {
  if (state.leadLoading) return;
  state.leadLoading = true;
  state.leadError = '';
  renderLeadOperations(state.leadOperations);
  hide(elements['dashboard-error']);
  try {
    const params = new URLSearchParams({
      page: String(state.leadPage),
      pageSize: '25',
      status: state.leadStatus,
    });
    if (force) params.set('refresh', '1');
    state.leadOperations = await api(`/api/leads?${params}`);
  } catch (error) {
    if (error.status === 401) {
      showLogin();
      return;
    }
    state.leadError = error.message;
  } finally {
    state.leadLoading = false;
    if (state.overview) {
      renderKpis(state.overview);
      renderLeadOperations(state.leadOperations);
    }
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

elements['refresh-button'].addEventListener('click', () => {
  void loadOverview(true);
  if (state.activeModule === 'leads') void loadLeadOperations(true);
});
elements['publication-platform-filter'].addEventListener('change', (event) => {
  state.publicationPlatform = event.target.value;
  if (state.overview) renderPublications(state.overview.social.publications);
});
elements['channel-search'].addEventListener('input', (event) => {
  state.channelQuery = event.target.value;
  if (state.overview) renderChannels(state.overview.social.channels);
});
elements['lead-status-filter'].addEventListener('change', (event) => {
  state.leadStatus = event.target.value;
  state.leadPage = 1;
  void loadLeadOperations();
});
elements['lead-previous'].addEventListener('click', () => {
  if (state.leadPage <= 1) return;
  state.leadPage -= 1;
  void loadLeadOperations();
});
elements['lead-next'].addEventListener('click', () => {
  const totalPages = state.leadOperations?.pagination?.totalPages || 1;
  if (state.leadPage >= totalPages) return;
  state.leadPage += 1;
  void loadLeadOperations();
});
window.addEventListener('hashchange', () => {
  setActiveModule(location.hash.slice(1) || 'overview', { updateHash: false });
});

async function initialize() {
  state.activeModule = Object.hasOwn(MODULE_COPY, location.hash.slice(1))
    ? location.hash.slice(1)
    : 'overview';
  try {
    const session = await api('/api/session');
    if (session.authenticated) showApp(session);
    else showLogin();
  } catch {
    showLogin();
  }
}

function refreshOverviewWhenDue() {
  const appIsVisible = !elements['app-view'].classList.contains('hidden');
  const snapshotIsStale = Date.now() - state.lastOverviewLoadedAt >= OVERVIEW_REFRESH_INTERVAL_MS;
  if (document.visibilityState === 'visible' && appIsVisible && snapshotIsStale) {
    void loadOverview();
  }
}

setInterval(refreshOverviewWhenDue, OVERVIEW_REFRESH_INTERVAL_MS);
document.addEventListener('visibilitychange', refreshOverviewWhenDue);

void initialize();
