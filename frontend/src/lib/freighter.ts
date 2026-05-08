import {
  isConnected,
  getAddress,
  requestAccess,
  signTransaction as freighterSignTransaction,
} from '@stellar/freighter-api';

export const checkFreighterInstalled = async (): Promise<boolean> => {
  if (typeof window === 'undefined') return false;
  try {
    const result = await isConnected();
    return result.isConnected;
  } catch {
    return false;
  }
};

export async function connectFreighter(): Promise<string> {
  const result = await requestAccess();
  if (result.error) throw new Error(String(result.error));
  if (!result.address) throw new Error('Freighter did not return an address. Is the wallet unlocked?');
  return result.address;
}

export async function getFreighterPublicKey(): Promise<string> {
  const result = await getAddress();
  if (result.error) throw new Error(String(result.error));
  return result.address;
}

export async function signWithFreighter(
  transactionXdr: string,
  opts: { networkPassphrase?: string; address?: string }
): Promise<{ signedTxXdr: string; signerAddress?: string }> {
  const result = await freighterSignTransaction(transactionXdr, {
    networkPassphrase: opts.networkPassphrase,
    address: opts.address,
  });
  if (result.error) throw new Error(String(result.error));
  return { signedTxXdr: result.signedTxXdr, signerAddress: result.signerAddress };
}
