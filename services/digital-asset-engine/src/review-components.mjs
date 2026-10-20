const ACTION_ROW = 1;
const BUTTON = 2;
const STRING_SELECT = 3;
const TEXT_INPUT = 4;
const TEXT_DISPLAY = 10;
const LABEL = 18;
const BUTTON_SECONDARY = 2;
const BUTTON_SUCCESS = 3;
const BUTTON_DANGER = 4;
const BUTTON_LINK = 5;
const TEXT_INPUT_PARAGRAPH = 2;
const MESSAGE_COMPONENT = 3;
const MODAL_SUBMIT = 5;
const BUTTON_PREFIX = 'dpr';
const MODAL_PREFIX = 'dprm';
const ACTION_CODES = Object.freeze({ approve: 'a', request_changes: 'c', reject: 'r' });
const CODE_ACTIONS = Object.freeze(Object.fromEntries(
  Object.entries(ACTION_CODES).map(([action, code]) => [code, action]),
));

function compactPart(value, label) {
  const result = String(value || '').trim();
  if (!result || !/^[a-z0-9-]+$/u.test(result)) {
    throw new Error(`${label} must contain only lowercase letters, digits, and hyphens.`);
  }
  return result;
}

export function buildReviewReference(prefix, action, context) {
  const code = ACTION_CODES[action];
  if (!code) throw new Error(`Unsupported digital asset review action: ${action}`);
  const value = [
    prefix,
    code,
    compactPart(context.productSlug, 'Product slug'),
    compactPart(String(context.manifestHash || context.manifestHashPrefix || '').slice(0, 16), 'Manifest hash prefix'),
  ].join('|');
  if (value.length > 100) throw new Error('Digital asset review custom ID exceeds Discord\'s 100 character limit.');
  return value;
}

export function parseReviewReference(value, expectedPrefix) {
  const parts = String(value || '').split('|');
  if (parts.length !== 4 || parts[0] !== expectedPrefix || !CODE_ACTIONS[parts[1]]) return null;
  if (!/^[a-z0-9-]+$/u.test(parts[2])) return null;
  if (!/^[a-f0-9]{16}$/u.test(parts[3])) return null;
  return {
    decision: CODE_ACTIONS[parts[1]],
    productSlug: parts[2],
    manifestHashPrefix: parts[3],
  };
}

function linkButton(label, url) {
  return { type: BUTTON, style: BUTTON_LINK, label, url: String(url || '') };
}

export function buildDigitalAssetPackReviewComponents(context) {
  const links = [
    ...(context.itchUrl ? [linkButton(context.itchLabel || 'Open itch.io Draft', context.itchUrl)] : []),
    linkButton('Open Manifest', context.manifestUrl),
  ];
  return [{
    type: ACTION_ROW,
    components: [
      {
        type: BUTTON,
        style: BUTTON_SUCCESS,
        label: 'Approve Pack',
        custom_id: buildReviewReference(BUTTON_PREFIX, 'approve', context),
      },
      {
        type: BUTTON,
        style: BUTTON_SECONDARY,
        label: 'Request Changes',
        custom_id: buildReviewReference(BUTTON_PREFIX, 'request_changes', context),
      },
      {
        type: BUTTON,
        style: BUTTON_DANGER,
        label: 'Reject Pack',
        custom_id: buildReviewReference(BUTTON_PREFIX, 'reject', context),
      },
      ...links,
    ],
  }];
}

export function buildResolvedDigitalAssetReviewComponents(context) {
  return [{
    type: ACTION_ROW,
    components: [
      ...(context.itchUrl ? [linkButton(context.itchLabel || 'Open itch.io Draft', context.itchUrl)] : []),
      linkButton('Open Manifest', context.manifestUrl),
    ],
  }];
}

export function parseDigitalAssetReviewCustomId(customId) {
  return parseReviewReference(customId, BUTTON_PREFIX) || parseReviewReference(customId, MODAL_PREFIX);
}

export function getDigitalAssetReviewModalRequest(interaction) {
  if (interaction?.type !== MESSAGE_COMPONENT) return null;
  const request = parseReviewReference(interaction?.data?.custom_id, BUTTON_PREFIX);
  return request && ['request_changes', 'reject'].includes(request.decision) ? request : null;
}

function numberedAssetLines(assets) {
  const width = Math.max(2, String(assets.length).length);
  return assets.map((asset, index) => (
    `**${String(index + 1).padStart(width, '0')}** — ${asset.name}`
  )).join('\n');
}

function assetSelect(assets) {
  if (!assets.length || assets.length > 25) {
    throw new Error('Discord package feedback supports between 1 and 25 assets.');
  }
  const width = Math.max(2, String(assets.length).length);
  return {
    type: LABEL,
    label: 'Which assets need changes?',
    description: 'Select one or more numbered assets. Unselected assets are accepted for this revision.',
    component: {
      type: STRING_SELECT,
      custom_id: 'affected_assets',
      placeholder: 'Select assets to revise',
      min_values: 1,
      max_values: assets.length,
      required: true,
      options: assets.map((asset, index) => ({
        label: `${String(index + 1).padStart(width, '0')} · ${asset.name}`.slice(0, 100),
        value: asset.asset_id,
        description: String(asset.description || 'View the matching numbered preview in the thread.').slice(0, 100),
      })),
    },
  };
}

function reasonInput(requestingChanges) {
  return {
    type: LABEL,
    label: requestingChanges ? 'What should be changed?' : 'Why is this pack rejected?',
    description: requestingChanges
      ? 'One shared instruction may cover every selected asset.'
      : 'Explain why this release should not proceed.',
    component: {
      type: TEXT_INPUT,
      custom_id: 'reason',
      style: TEXT_INPUT_PARAGRAPH,
      placeholder: requestingChanges
        ? 'Describe the concrete revision needed.'
        : 'Explain why this pack should not proceed.',
      min_length: 3,
      max_length: 1000,
      required: true,
    },
  };
}

export function buildDigitalAssetReviewModal(request, assets = [], options = {}) {
  if (!request || !['request_changes', 'reject'].includes(request.decision)) return null;
  const requestingChanges = request.decision === 'request_changes';
  return {
    custom_id: options.referenceBuilder
      ? options.referenceBuilder(options.modalPrefix || MODAL_PREFIX, request.decision, request)
      : buildReviewReference(options.modalPrefix || MODAL_PREFIX, request.decision, request),
    title: requestingChanges ? 'Request Pack Changes' : 'Reject Asset Pack',
    components: [
      ...(requestingChanges ? [
        {
          type: TEXT_DISPLAY,
          content: `Select the matching numbered previews below.\n${numberedAssetLines(assets)}`.slice(0, 4000),
        },
        assetSelect(assets),
      ] : []),
      reasonInput(requestingChanges),
    ],
  };
}

function walkComponents(components, callback) {
  for (const component of Array.isArray(components) ? components : []) {
    callback(component);
    if (component?.component) walkComponents([component.component], callback);
    if (component?.components) walkComponents(component.components, callback);
  }
}

function extractModalValues(components = []) {
  let reason = '';
  let affectedAssetIds = [];
  walkComponents(components, (component) => {
    if (component?.custom_id === 'reason') {
      reason = String(component.value || '').replace(/\s+/gu, ' ').trim();
    }
    if (component?.custom_id === 'affected_assets') {
      affectedAssetIds = [...new Set((component.values || [])
        .map((value) => String(value || '').trim()).filter(Boolean))];
    }
  });
  return { reason, affectedAssetIds };
}

export function parseDigitalAssetReviewDecision(interaction) {
  const direct = interaction?.type === MESSAGE_COMPONENT
    ? parseReviewReference(interaction?.data?.custom_id, BUTTON_PREFIX)
    : null;
  if (direct?.decision === 'approve') return { ...direct, reason: '', affectedAssetIds: [] };

  const modal = interaction?.type === MODAL_SUBMIT
    ? parseReviewReference(interaction?.data?.custom_id, MODAL_PREFIX)
    : null;
  if (!modal || !['request_changes', 'reject'].includes(modal.decision)) return null;
  const { reason, affectedAssetIds } = extractModalValues(interaction?.data?.components);
  if (!reason) throw new Error('A reason is required for this package decision.');
  if (modal.decision === 'request_changes' && affectedAssetIds.length === 0) {
    throw new Error('Select at least one asset that needs changes.');
  }
  return { ...modal, reason, affectedAssetIds };
}

export function isDigitalAssetReviewInteraction(interaction) {
  return Boolean(parseDigitalAssetReviewCustomId(interaction?.data?.custom_id));
}
