const ACTION_ROW = 1;
const BUTTON = 2;
const TEXT_INPUT = 4;
const BUTTON_SECONDARY = 2;
const BUTTON_SUCCESS = 3;
const BUTTON_DANGER = 4;
const BUTTON_LINK = 5;
const TEXT_INPUT_PARAGRAPH = 2;
const MESSAGE_COMPONENT = 3;
const MODAL_SUBMIT = 5;
const BUTTON_PREFIX = 'dar';
const MODAL_PREFIX = 'darm';
const ACTION_CODES = Object.freeze({
  approve: 'a',
  request_changes: 'c',
  reject: 'r',
});
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

function buildReference(prefix, action, context) {
  const code = ACTION_CODES[action];
  if (!code) throw new Error(`Unsupported digital asset review action: ${action}`);
  const value = [
    prefix,
    code,
    compactPart(context.productSlug, 'Product slug'),
    compactPart(context.assetId, 'Asset ID'),
    compactPart(String(context.manifestHash || context.manifestHashPrefix || '').slice(0, 16), 'Manifest hash prefix'),
  ].join('|');
  if (value.length > 100) throw new Error('Digital asset review custom ID exceeds Discord\'s 100 character limit.');
  return value;
}

function parseReference(value, expectedPrefix) {
  const parts = String(value || '').split('|');
  if (parts.length !== 5 || parts[0] !== expectedPrefix || !CODE_ACTIONS[parts[1]]) return null;
  if (!/^[a-z0-9-]+$/u.test(parts[2]) || !/^asset-[a-z0-9-]+$/u.test(parts[3])) return null;
  if (!/^[a-f0-9]{16}$/u.test(parts[4])) return null;
  return {
    decision: CODE_ACTIONS[parts[1]],
    productSlug: parts[2],
    assetId: parts[3],
    manifestHashPrefix: parts[4],
  };
}

function manifestLinkButton(manifestUrl) {
  return {
    type: BUTTON,
    style: BUTTON_LINK,
    label: 'Open Manifest',
    url: String(manifestUrl || ''),
  };
}

export function buildDigitalAssetReviewComponents(context) {
  return [{
    type: ACTION_ROW,
    components: [
      {
        type: BUTTON,
        style: BUTTON_SUCCESS,
        label: 'Approve',
        custom_id: buildReference(BUTTON_PREFIX, 'approve', context),
      },
      {
        type: BUTTON,
        style: BUTTON_SECONDARY,
        label: 'Request Changes',
        custom_id: buildReference(BUTTON_PREFIX, 'request_changes', context),
      },
      {
        type: BUTTON,
        style: BUTTON_DANGER,
        label: 'Reject',
        custom_id: buildReference(BUTTON_PREFIX, 'reject', context),
      },
      manifestLinkButton(context.manifestUrl),
    ],
  }];
}

export function buildResolvedDigitalAssetReviewComponents(manifestUrl) {
  return [{ type: ACTION_ROW, components: [manifestLinkButton(manifestUrl)] }];
}

export function parseDigitalAssetReviewCustomId(customId) {
  return parseReference(customId, BUTTON_PREFIX) || parseReference(customId, MODAL_PREFIX);
}

export function getDigitalAssetReviewModalRequest(interaction) {
  if (interaction?.type !== MESSAGE_COMPONENT) return null;
  const request = parseReference(interaction?.data?.custom_id, BUTTON_PREFIX);
  return request && ['request_changes', 'reject'].includes(request.decision) ? request : null;
}

export function buildDigitalAssetReviewModal(request) {
  if (!request || !['request_changes', 'reject'].includes(request.decision)) return null;
  const requestingChanges = request.decision === 'request_changes';
  return {
    custom_id: buildReference(MODAL_PREFIX, request.decision, request),
    title: requestingChanges ? 'Request Asset Changes' : 'Reject Asset',
    components: [{
      type: ACTION_ROW,
      components: [{
        type: TEXT_INPUT,
        custom_id: 'reason',
        style: TEXT_INPUT_PARAGRAPH,
        label: requestingChanges ? 'What should be changed?' : 'Why is this asset rejected?',
        placeholder: requestingChanges
          ? 'Describe the concrete revision needed.'
          : 'Explain why this asset should not be included.',
        min_length: 3,
        max_length: 1000,
        required: true,
      }],
    }],
  };
}

function extractReason(components = []) {
  for (const row of Array.isArray(components) ? components : []) {
    for (const component of Array.isArray(row?.components) ? row.components : []) {
      if (component?.custom_id === 'reason') {
        return String(component.value || '').replace(/\s+/gu, ' ').trim();
      }
    }
  }
  return '';
}

export function parseDigitalAssetReviewDecision(interaction) {
  const direct = interaction?.type === MESSAGE_COMPONENT
    ? parseReference(interaction?.data?.custom_id, BUTTON_PREFIX)
    : null;
  if (direct?.decision === 'approve') return { ...direct, reason: '' };

  const modal = interaction?.type === MODAL_SUBMIT
    ? parseReference(interaction?.data?.custom_id, MODAL_PREFIX)
    : null;
  if (!modal || !['request_changes', 'reject'].includes(modal.decision)) return null;
  const reason = extractReason(interaction?.data?.components);
  if (!reason) throw new Error('A reason is required for this asset decision.');
  return { ...modal, reason };
}

export function isDigitalAssetReviewInteraction(interaction) {
  return Boolean(parseDigitalAssetReviewCustomId(interaction?.data?.custom_id));
}
