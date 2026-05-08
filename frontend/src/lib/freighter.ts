export type FreighterApi = {
  connect?: () => Promise<string>;
  getPublicKey: () => Promise<string>;
  signTransaction: (
    transactionXdr: string,
    networkPassphrase: string | { networkPassphrase: string; submit?: boolean }
  ) => Promise<{ signedTransaction?: string; signedTxXdr?: string; signed_transaction?: string; error?: any } | string>;
};

declare global {
  interface Window {
    freighterApi?: FreighterApi;
  }
}

export const isFreighterInstalled = (): boolean => {
  if (typeof window === 'undefined') return false;

  // Check if we're in an environment that supports browser extensions
  const hasExtensionSupport = typeof (window as any).chrome !== 'undefined' || typeof (window as any).browser !== 'undefined';
  if (!hasExtensionSupport) {
    return false; // Not a browser that supports extensions
  }

  return Boolean(window.freighterApi);
};

const getFreighter = (): FreighterApi => {
  if (typeof window === 'undefined') {
    throw new Error('Freighter wallet requires a browser environment.');
  }

  const hasExtensionSupport = typeof (window as any).chrome !== 'undefined' || typeof (window as any).browser !== 'undefined';
  if (!hasExtensionSupport) {
    throw new Error('Freighter wallet requires a browser that supports extensions (Chrome, Firefox, Edge, etc.). Please open this app in a compatible browser.');
  }

  if (!window.freighterApi) {
    throw new Error('Freighter wallet not found. Please install the Freighter extension from https://www.freighter.app/ and refresh the page.');
  }

  return window.freighterApi;
};

export async function connectFreighter(): Promise<string> {
  const freighter = getFreighter();
  if (freighter.connect) {
    await freighter.connect();
  }
  return freighter.getPublicKey();
}

export async function getFreighterPublicKey(): Promise<string> {
  return getFreighter().getPublicKey();
}

export async function signWithFreighter(
  transactionXdr: string,
  opts: { networkPassphrase?: string; address?: string; submit?: boolean; submitUrl?: string }
): Promise<{ signedTxXdr: string; signerAddress?: string; error?: any }> {
  const freighter = getFreighter();
  const signed = await freighter.signTransaction(transactionXdr, opts as any);

  if (typeof signed === 'string') {
    return { signedTxXdr: signed };
  }

  const signedTxXdr = signed.signedTxXdr ?? signed.signedTransaction ?? signed.signed_transaction;
  if (!signedTxXdr) {
    throw new Error('Freighter returned an unsupported signing response.');
  }

  return { signedTxXdr, error: signed.error };
}
