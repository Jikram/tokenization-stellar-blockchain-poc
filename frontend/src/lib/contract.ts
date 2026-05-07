import { contract, Networks } from '@stellar/stellar-sdk';
import { signWithFreighter } from './freighter';

const RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK = process.env.NEXT_PUBLIC_STELLAR_NETWORK || 'testnet';
const NETWORK_PASSPHRASE = NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID || '';

type ContractClient = contract.Client & Record<string, any>;

function contractClientOptions() {
  if (!CONTRACT_ID) throw new Error('NEXT_PUBLIC_CONTRACT_ID is not configured.');
  return {
    rpcUrl: RPC_URL,
    contractId: CONTRACT_ID,
    networkPassphrase: NETWORK_PASSPHRASE,
    signTransaction: freighterSigner,
  } as const;
}

async function getContractClient(): Promise<ContractClient> {
  return (await contract.Client.from(contractClientOptions())) as ContractClient;
}

async function freighterSigner(
  transactionXdr: string,
  opts: { networkPassphrase?: string; address?: string; submit?: boolean; submitUrl?: string } = {}
) {
  const networkPassphrase = opts.networkPassphrase || NETWORK_PASSPHRASE;
  return await signWithFreighter(transactionXdr, {
    networkPassphrase,
    address: opts.address,
    submit: opts.submit,
    submitUrl: opts.submitUrl,
  } as any);
}

export async function checkApprovalStatus(userAddress: string): Promise<boolean> {
  if (!userAddress) throw new Error('Missing wallet address.');
  const client = await getContractClient();
  const assembled = await client.is_approved([userAddress], {
    publicKey: userAddress,
    networkPassphrase: NETWORK_PASSPHRASE,
    submit: false,
  });
  await assembled.simulate();
  return Boolean(assembled.result);
}

export async function approveUser(adminAddress: string, userAddress: string) {
  if (!adminAddress) throw new Error('Missing admin wallet address.');
  if (!userAddress) throw new Error('Missing target user address.');
  const client = await getContractClient();
  const assembled = await client.approve_user([adminAddress, userAddress], {
    publicKey: adminAddress,
    networkPassphrase: NETWORK_PASSPHRASE,
    submit: true,
  });
  return await assembled.signAndSend({ signTransaction: freighterSigner });
}

export async function executeProtectedAction(userAddress: string) {
  if (!userAddress) throw new Error('Missing wallet address.');
  const client = await getContractClient();
  const assembled = await client.execute_action([userAddress], {
    publicKey: userAddress,
    networkPassphrase: NETWORK_PASSPHRASE,
    submit: true,
  });
  return await assembled.signAndSend({ signTransaction: freighterSigner });
}

export async function initializeContract(adminAddress: string) {
  if (!adminAddress) throw new Error('Missing admin wallet address.');
  const client = await getContractClient();
  const assembled = await client.initialize([adminAddress], {
    publicKey: adminAddress,
    networkPassphrase: NETWORK_PASSPHRASE,
    submit: true,
  });
  return await assembled.signAndSend({ signTransaction: freighterSigner });
}
