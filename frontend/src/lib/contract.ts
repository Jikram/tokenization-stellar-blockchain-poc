import { contract, Networks, rpc, scValToNative } from '@stellar/stellar-sdk';
import { signWithFreighter } from './freighter';

const RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK = process.env.NEXT_PUBLIC_STELLAR_NETWORK || 'testnet';
const NETWORK_PASSPHRASE = NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID || '';

async function getClient() {
  if (!CONTRACT_ID) throw new Error('NEXT_PUBLIC_CONTRACT_ID is not configured.');
  return (await contract.Client.from({
    rpcUrl: RPC_URL,
    contractId: CONTRACT_ID,
    networkPassphrase: NETWORK_PASSPHRASE,
    signTransaction: freighterSigner,
  })) as contract.Client & Record<string, any>;
}

async function freighterSigner(
  transactionXdr: string,
  opts: { networkPassphrase?: string; address?: string; submit?: boolean; submitUrl?: string } = {}
) {
  return await signWithFreighter(transactionXdr, {
    networkPassphrase: opts.networkPassphrase || NETWORK_PASSPHRASE,
    address: opts.address,
  } as any);
}

export async function initializeContract(adminAddress: string, assetName: string) {
  if (!adminAddress) throw new Error('Missing admin wallet address.');
  const client = await getClient();
  const assembled = await client.initialize(
    { admin: adminAddress, asset_name: assetName },
    { publicKey: adminAddress }
  );
  return await assembled.signAndSend({ signTransaction: freighterSigner });
}

export async function checkApprovalStatus(userAddress: string): Promise<boolean> {
  if (!userAddress) throw new Error('Missing wallet address.');
  const client = await getClient();
  const assembled = await client.is_approved({ user: userAddress });
  const sim = await assembled.simulate();
  return Boolean(sim.result);
}

export async function approveUser(adminAddress: string, userAddress: string) {
  if (!adminAddress) throw new Error('Missing admin wallet address.');
  if (!userAddress) throw new Error('Missing target user address.');
  const client = await getClient();
  const assembled = await client.approve_user(
    { admin: adminAddress, user: userAddress },
    { publicKey: adminAddress }
  );
  return await assembled.signAndSend({ signTransaction: freighterSigner });
}

export async function getBalance(userAddress: string): Promise<number> {
  if (!userAddress) throw new Error('Missing wallet address.');
  const client = await getClient();
  const assembled = await client.get_balance({ user: userAddress });
  const sim = await assembled.simulate();
  return Number(sim.result ?? 0);
}

export async function executeProtectedAction(userAddress: string) {
  if (!userAddress) throw new Error('Missing wallet address.');
  const client = await getClient();
  const assembled = await client.execute_action(
    { user: userAddress },
    { publicKey: userAddress }
  );
  return await assembled.signAndSend({ signTransaction: freighterSigner, force: true });
}

export async function fetchContractEvents(limit: number = 20): Promise<{ events: any[]; startLedger: number; endLedger: number }> {
  if (!CONTRACT_ID) throw new Error('NEXT_PUBLIC_CONTRACT_ID is not configured.');
  const server = new rpc.Server(RPC_URL);
  const latest = await server.getLatestLedger();
  const startLedger = Math.max(1, latest.sequence - 10000);
  const result = await server.getEvents({
    startLedger,
    filters: [{ type: 'contract', contractIds: [CONTRACT_ID] }],
    limit,
  });
  const events = result.events.map((event) => {
    const toReadable = (val: any): string => {
      try {
        const native = scValToNative(val);
        if (typeof native === 'object' && native !== null) {
          return JSON.stringify(native, (_, v) =>
            typeof v === 'bigint' ? v.toString() : v
          );
        }
        return String(native);
      } catch {
        return val?.toString() ?? '';
      }
    };

    return {
      id: event.id,
      type: event.type,
      ledger: event.ledger,
      contractId: event.contractId,
      topic: event.topic.map(toReadable),
      value: toReadable(event.value),
      inSuccessfulContractCall: event.inSuccessfulContractCall,
    };
  });
  return { events, startLedger, endLedger: latest.sequence };
}
