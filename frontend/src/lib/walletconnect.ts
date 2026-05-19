import SignClient from '@walletconnect/sign-client';

const PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '';
const TESTNET_CHAIN = 'stellar:testnet';
const SIGN_METHOD = 'stellar_signXDR';

let _client: Awaited<ReturnType<typeof SignClient.init>> | null = null;
let _sessionTopic: string | null = null;

async function getClient() {
  if (!_client) {
    _client = await SignClient.init({
      projectId: PROJECT_ID,
      metadata: {
        name: 'Tokenized Asset POC',
        description: 'Stellar Soroban tokenized real estate fund demo',
        url: 'https://stellar-tokenization-ji.vercel.app',
        icons: [],
      },
    });
    _client.on('session_delete', () => { _sessionTopic = null; });
  }
  return _client;
}

// WalletConnect v2 internally calls window.open() to deep-link into mobile wallets.
// For wc: URIs the target is "_self", which navigates the current page away to walletconnect.com.
// Patch window.open to a no-op for the duration of any WC operation that can trigger this.
function blockWindowOpen(): () => void {
  if (typeof window === 'undefined') return () => {};
  const orig = window.open.bind(window);
  window.open = () => null;
  return () => { window.open = orig; };
}

// Purge any stale WalletConnect localStorage entries from previous sessions
// (e.g. left over from Reown AppKit) that can trigger deeplink navigation on init.
function clearStaleWcStorage() {
  if (typeof localStorage === 'undefined') return;
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith('wc@') || key.startsWith('walletconnect') || key.startsWith('W3M') || key.startsWith('WCM'))) {
      toRemove.push(key);
    }
  }
  toRemove.forEach(k => localStorage.removeItem(k));
}

export async function wcConnect(): Promise<{
  uri: string;
  waitForApproval: () => Promise<{ address: string }>;
}> {
  // Block navigation BEFORE any WC code runs (init + connect both may trigger deeplinks)
  const unblock = blockWindowOpen();

  // Force fresh client — stale sessions from AppKit carry deeplink URLs that trigger on init
  _client = null;
  _sessionTopic = null;
  clearStaleWcStorage();

  let uri: string | undefined;
  let approval: (() => Promise<unknown>) | undefined;
  try {
    const client = await getClient();
    const result = await client.connect({
      requiredNamespaces: {
        stellar: {
          methods: [SIGN_METHOD],
          chains: [TESTNET_CHAIN],
          events: [],
        },
      },
    });
    uri = result.uri;
    approval = result.approval;
  } finally {
    unblock();
  }

  if (!uri) throw new Error('WalletConnect did not return a pairing URI.');
  return {
    uri,
    waitForApproval: async () => {
      const session = await approval!() as any;
      _sessionTopic = session.topic;
      const accounts = (session.namespaces?.stellar?.accounts ?? []).map(
        (a: string) => a.split(':')[2]
      );
      if (!accounts[0]) throw new Error('No Stellar address returned from wallet.');
      return { address: accounts[0] };
    },
  };
}

export async function wcSign(
  xdr: string,
  _opts: { networkPassphrase?: string; address?: string } = {}
): Promise<{ signedTxXdr: string }> {
  if (!_sessionTopic) throw new Error('No active WalletConnect session. Please reconnect your wallet.');
  const client = await getClient();

  const unblock = blockWindowOpen();
  let result: { signedXDR?: string; signedTxXdr?: string } | string;
  try {
    result = await client.request<{ signedXDR?: string; signedTxXdr?: string } | string>({
      topic: _sessionTopic,
      chainId: TESTNET_CHAIN,
      request: { method: SIGN_METHOD, params: { xdr } },
    });
  } finally {
    unblock();
  }
  const signedTxXdr =
    typeof result === 'string'
      ? result
      : (result as any).signedXDR ?? (result as any).signedTxXdr;
  if (!signedTxXdr) throw new Error('WalletConnect wallet did not return a signed transaction.');
  return { signedTxXdr };
}

export async function wcReconnect(): Promise<string | null> {
  try {
    const client = await getClient();
    const sessions = client.session.getAll();
    if (sessions.length === 0) return null;
    const session = sessions[sessions.length - 1];
    _sessionTopic = session.topic;
    const accounts = (session.namespaces?.stellar?.accounts ?? []).map(
      (a: string) => a.split(':')[2]
    );
    return accounts[0] || null;
  } catch {
    return null;
  }
}

export function wcClear() {
  _client = null;
  _sessionTopic = null;
}
