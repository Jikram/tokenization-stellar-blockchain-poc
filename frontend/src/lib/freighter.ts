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

  // First check if Freighter API is available
  if (Boolean(window.freighterApi)) {
    console.log('Freighter detected: window.freighterApi found');
    return true;
  }

  // Also check for alternative Freighter API names that might be used
  if (Boolean((window as any).freighter) || Boolean((window as any).stellar)) {
    console.log('Found alternative Freighter API:', { freighter: !!(window as any).freighter, stellar: !!(window as any).stellar });
    return true;
  }

  // Check all possible extension APIs that might exist
  const possibleAPIs = ['freighterApi', 'freighter', 'stellar', 'stellarWallet', 'lobstr', 'xbull'];
  for (const api of possibleAPIs) {
    if (Boolean((window as any)[api])) {
      console.log(`Found wallet API: ${api}`);
      return true;
    }
  }

  console.log('No wallet APIs found on window object');

  // If not available, check if we're in a browser that should support extensions
  // This helps provide better error messages
  const isLikelyExtensionBrowser = typeof (window as any).chrome !== 'undefined' ||
                                   typeof (window as any).browser !== 'undefined' ||
                                   typeof (window as any).safari !== 'undefined' ||
                                   navigator.userAgent.includes('Chrome') ||
                                   navigator.userAgent.includes('Firefox') ||
                                   navigator.userAgent.includes('Safari');

  // If we're in a browser that supports extensions but Freighter isn't found,
  // it might just not be installed yet
  return false;
};

const getFreighter = (): FreighterApi => {
  if (typeof window === 'undefined') {
    throw new Error('Freighter wallet requires a browser environment.');
  }

  if (!window.freighterApi) {
    // Check if we're in a browser that typically supports extensions
    const isExtensionBrowser = typeof (window as any).chrome !== 'undefined' ||
                               typeof (window as any).browser !== 'undefined' ||
                               typeof (window as any).safari !== 'undefined' ||
                               navigator.userAgent.includes('Chrome') ||
                               navigator.userAgent.includes('Firefox') ||
                               navigator.userAgent.includes('Safari') ||
                               navigator.userAgent.includes('Edge');

    if (!isExtensionBrowser) {
      throw new Error('Freighter wallet requires a browser that supports extensions (Chrome, Firefox, Safari, Edge, etc.). Please open this app in a compatible browser.');
    }

    throw new Error('Freighter wallet not found. Please ensure the Freighter extension is installed and enabled, then refresh the page.');
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
