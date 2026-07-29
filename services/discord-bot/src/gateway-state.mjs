const API_VERSION = '10';
const ENCODING = 'json';

const TERMINAL_CLOSE_CODES = new Set([
  4004,
  4010,
  4011,
  4012,
  4013,
  4014,
]);

export function buildGatewayConnectionUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.searchParams.set('v', API_VERSION);
  url.searchParams.set('encoding', ENCODING);
  return url.toString();
}

export function hasResumableSession(sessionState, sequence) {
  return Boolean(
    sessionState?.sessionId &&
    sessionState?.resumeGatewayUrl &&
    sequence !== null &&
    sequence !== undefined
  );
}

export function getReconnectPlan({ closeCode, shuttingDown, sessionState, sequence }) {
  if (shuttingDown) {
    return { shouldReconnect: false, shouldResume: false };
  }

  if (TERMINAL_CLOSE_CODES.has(closeCode)) {
    return { shouldReconnect: false, shouldResume: false };
  }

  if (closeCode === 1000 || closeCode === 1001) {
    return { shouldReconnect: false, shouldResume: false };
  }

  return {
    shouldReconnect: true,
    shouldResume: hasResumableSession(sessionState, sequence),
  };
}

export function createEmptySessionState() {
  return {
    sessionId: '',
    resumeGatewayUrl: '',
  };
}
