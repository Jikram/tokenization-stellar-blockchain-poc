import { getAddress, requestAccess, isConnected, signTransaction } from '@stellar/freighter-api';

export const WALLET_CONNECT_ID = 'wallet_connect';
export const FREIGHTER_ID = 'freighter';
export const WALLET_STORAGE_KEY = 'poc_wallet_id';

export function initKit(): void {
  // No-op: @creit.tech/stellar-wallets-kit removed; using @stellar/freighter-api directly
}

export function getSavedWalletId(): string | null {
  try { return localStorage.getItem(WALLET_STORAGE_KEY); } catch { return null; }
}

export function saveWalletId(id: string): void {
  try { localStorage.setItem(WALLET_STORAGE_KEY, id); } catch {}
}

export function clearSavedWallet(): void {
  try { localStorage.removeItem(WALLET_STORAGE_KEY); } catch {}
}

export async function connectFreighterViaKit(): Promise<string> {
  const { isConnected: connected } = await isConnected();
  if (!connected) {
    throw new Error('Freighter extension is not installed. Install it from freighter.app, then try again.');
  }
  await requestAccess();
  const { address } = await getAddress();
  if (!address) throw new Error('Freighter did not return an address. Make sure it is unlocked and has granted access.');
  return address;
}

export async function tryReconnect(walletId: string): Promise<string | null> {
  if (walletId === WALLET_CONNECT_ID) return null;
  try {
    const { isConnected: connected } = await isConnected();
    if (!connected) return null;
    const { address } = await getAddress();
    return address || null;
  } catch {
    return null;
  }
}

export async function disconnectKit(): Promise<void> {
  clearSavedWallet();
}

export async function signWithKit(
  xdr: string,
  opts: { networkPassphrase?: string; address?: string } = {}
): Promise<{ signedTxXdr: string }> {
  const result = await signTransaction(xdr, {
    networkPassphrase: opts.networkPassphrase,
    address: opts.address,
  } as any);
  if (typeof result === 'string') return { signedTxXdr: result };
  return result as unknown as { signedTxXdr: string };
}

export function onWalletSelected(_cb: (id: string) => void): () => void {
  return () => {};
}

export function walletLabel(id: string | null): string {
  if (!id) return '';
  if (id === FREIGHTER_ID) return 'Freighter';
  if (id === WALLET_CONNECT_ID) return 'WalletConnect';
  return id;
}
