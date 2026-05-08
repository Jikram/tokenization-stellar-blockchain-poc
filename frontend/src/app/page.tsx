'use client';

import { useEffect, useState } from 'react';
import { checkApprovalStatus, approveUser, executeProtectedAction, fetchContractEvents } from '../lib/contract';
import { connectFreighter, getFreighterPublicKey, isFreighterInstalled } from '../lib/freighter';

const NETWORK = process.env.NEXT_PUBLIC_STELLAR_NETWORK || 'testnet';
const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID || 'Not set';

type ActivityEntry = {
  timestamp: string;
  type: string;
  status: 'pending' | 'success' | 'error';
  message: string;
  txHash?: string;
};

type ContractEvent = {
  id: string;
  type: string;
  ledger: number;
  contractId: string;
  topic: string[];
  value: string;
  inSuccessfulContractCall: boolean;
};

export default function Home() {
  const [walletAddress, setWalletAddress] = useState<string>('');
  const [connected, setConnected] = useState(false);
  const [approvalStatus, setApprovalStatus] = useState<string>('Unknown');
  const [actionState, setActionState] = useState<string>('Idle');
  const [adminTarget, setAdminTarget] = useState('');
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [contractEvents, setContractEvents] = useState<ContractEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasFreighter, setHasFreighter] = useState(false);

  useEffect(() => {
    setHasFreighter(isFreighterInstalled());

    // Check for Freighter periodically in case user installs it
    const interval = setInterval(() => {
      setHasFreighter(isFreighterInstalled());
    }, 2000);

    if (typeof window !== 'undefined' && (window as any).freighterApi) {
      getFreighterPublicKey()
        .then((publicKey) => {
          setWalletAddress(publicKey);
          setConnected(true);
        })
        .catch(() => {
          setConnected(false);
        });
    }

    return () => clearInterval(interval);
  }, []);

  const pushActivity = (entry: ActivityEntry) => {
    setActivity((current) => [entry, ...current].slice(0, 8));
  };

  const handleConnect = async () => {
    setLoading(true);
    try {
      const publicKey = await connectFreighter();
      setWalletAddress(publicKey);
      setConnected(true);
      pushActivity({ timestamp: new Date().toISOString(), type: 'wallet_connect', status: 'success', message: `Freighter connected: ${publicKey}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to connect Freighter';
      pushActivity({ timestamp: new Date().toISOString(), type: 'wallet_connect', status: 'error', message });
    } finally {
      setLoading(false);
    }
  };

  const handleApprovalCheck = async () => {
    setLoading(true);
    setActionState('Checking approval status...');
    try {
      if (!CONTRACT_ID || CONTRACT_ID === 'Not set') throw new Error('Contract ID is not configured.');
      if (!walletAddress) throw new Error('Connect Freighter first.');

      pushActivity({ timestamp: new Date().toISOString(), type: 'status_check', status: 'pending', message: 'Querying approval status' });
      const isApproved = await checkApprovalStatus(walletAddress);
      setApprovalStatus(isApproved ? 'Approved' : 'Not approved');
      pushActivity({ timestamp: new Date().toISOString(), type: 'status_check', status: 'success', message: `Wallet is ${isApproved ? 'approved' : 'not approved'}` });
      setActionState('Approval status loaded');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Approval check failed';
      setApprovalStatus('Error');
      setActionState('Approval check error');
      pushActivity({ timestamp: new Date().toISOString(), type: 'status_check', status: 'error', message });
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteAction = async () => {
    setLoading(true);
    setActionState('Executing protected action...');
    try {
      if (!CONTRACT_ID || CONTRACT_ID === 'Not set') throw new Error('Contract ID is not configured.');
      if (!walletAddress) throw new Error('Connect Freighter first.');

      pushActivity({ timestamp: new Date().toISOString(), type: 'execute_action', status: 'pending', message: 'Submitting protected action' });
      const result = await executeProtectedAction(walletAddress);
      const txHash = result.sendTransactionResponse?.hash || result.getTransactionResponse?.hash || 'unknown';
      pushActivity({ timestamp: new Date().toISOString(), type: 'execute_action', status: 'success', message: 'Protected action executed', txHash });
      setActionState('Protected action executed');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Protected action failed';
      pushActivity({ timestamp: new Date().toISOString(), type: 'execute_action', status: 'error', message });
      setActionState('Execution failed');
    } finally {
      setLoading(false);
    }
  };

  const handleApproveUser = async () => {
    setLoading(true);
    try {
      if (!CONTRACT_ID || CONTRACT_ID === 'Not set') throw new Error('Contract ID is not configured.');
      if (!walletAddress) throw new Error('Connect Freighter first.');
      if (!adminTarget.trim()) throw new Error('Enter a wallet address to approve.');

      pushActivity({ timestamp: new Date().toISOString(), type: 'approve_user', status: 'pending', message: `Approving user: ${adminTarget}` });

      const result = await approveUser(walletAddress, adminTarget.trim());
      pushActivity({
        timestamp: new Date().toISOString(),
        type: 'approve_user',
        status: 'success',
        message: `User approved: ${adminTarget}`,
        txHash: result.result?.transactionHash
      });
      setAdminTarget('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Approval failed';
      pushActivity({ timestamp: new Date().toISOString(), type: 'approve_user', status: 'error', message });
    } finally {
      setLoading(false);
    }
  };

  const handleFetchEvents = async () => {
    setLoading(true);
    try {
      pushActivity({ timestamp: new Date().toISOString(), type: 'fetch_events', status: 'pending', message: 'Fetching contract events' });
      const events = await fetchContractEvents(20);
      setContractEvents(events);
      pushActivity({ timestamp: new Date().toISOString(), type: 'fetch_events', status: 'success', message: `Fetched ${events.length} events` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch events';
      pushActivity({ timestamp: new Date().toISOString(), type: 'fetch_events', status: 'error', message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <header className="mb-10 flex flex-col gap-4 rounded-3xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl shadow-slate-950/20">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-cyan-400">Stellar Soroban Demo</p>
              <h1 className="mt-3 text-4xl font-semibold text-white">Tokenization Control POC</h1>
              <p className="mt-3 max-w-2xl text-slate-400">
                Public demo of an approval-control smart contract with Freighter wallet, Soroban RPC, and a modern React interface.
              </p>
            </div>
            <button
              onClick={handleConnect}
              disabled={loading || !hasFreighter}
              className="inline-flex items-center justify-center rounded-full bg-cyan-500 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {connected ? 'Reconnect Wallet' : 'Connect Freighter'}
            </button>
            {!hasFreighter && (
              <div className="mt-3 space-y-2">
                <p className="text-sm text-amber-400">
                  Freighter wallet extension required.{' '}
                  <a
                    href="https://www.freighter.app/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-amber-300"
                  >
                    Install Freighter
                  </a>{' '}
                  and refresh the page.
                </p>
                <button
                  onClick={() => {
                    const freighterFound = isFreighterInstalled();
                    setHasFreighter(freighterFound);
                    if (!freighterFound) {
                      const debugInfo = {
                        hasWindow: typeof window !== 'undefined',
                        hasFreighterApi: Boolean((window as any).freighterApi),
                        userAgent: navigator.userAgent.substring(0, 50) + '...',
                        isExtensionBrowser: typeof (window as any).chrome !== 'undefined' ||
                                           typeof (window as any).browser !== 'undefined' ||
                                           typeof (window as any).safari !== 'undefined' ||
                                           navigator.userAgent.includes('Chrome') ||
                                           navigator.userAgent.includes('Firefox') ||
                                           navigator.userAgent.includes('Safari') ||
                                           navigator.userAgent.includes('Edge')
                      };
                      pushActivity({
                        timestamp: new Date().toISOString(),
                        type: 'freighter_check',
                        status: 'error',
                        message: `Freighter not detected. Debug: ${JSON.stringify(debugInfo)}`
                      });
                    } else {
                      pushActivity({
                        timestamp: new Date().toISOString(),
                        type: 'freighter_check',
                        status: 'success',
                        message: 'Freighter detected successfully!'
                      });
                    }
                  }}
                  className="text-sm px-3 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded transition"
                >
                  Check Again
                </button>
              </div>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-5">
              <p className="text-sm text-slate-400">Connected Wallet</p>
              <p className="mt-2 text-sm font-semibold text-white">{walletAddress || 'Not connected'}</p>
            </div>
            <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-5">
              <p className="text-sm text-slate-400">Contract ID</p>
              <p className="mt-2 text-sm font-semibold text-white break-all">{CONTRACT_ID}</p>
            </div>
            <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-5">
              <p className="text-sm text-slate-400">Network</p>
              <p className="mt-2 text-sm font-semibold text-white">{NETWORK}</p>
            </div>
          </div>
        </header>

        <section className="grid gap-6 xl:grid-cols-[1.45fr_0.95fr]">
          <div className="space-y-6">
            <article className="rounded-3xl border border-slate-800 bg-slate-900/90 p-8 shadow-xl shadow-slate-950/10">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-semibold text-white">Approval Control</h2>
                  <p className="mt-2 text-sm text-slate-400">Interact with the contract and verify which users can execute protected actions.</p>
                </div>
                <span className="rounded-full bg-cyan-500/15 px-3 py-1 text-xs uppercase tracking-[0.2em] text-cyan-300">Demo Ready</span>
              </div>

              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                <button
                  disabled={loading || !connected}
                  onClick={handleApprovalCheck}
                  className="rounded-2xl bg-slate-800 px-5 py-4 text-left text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <p className="font-semibold">Check Approval Status</p>
                  <p className="mt-2 text-sm text-slate-400">Read approval state from the contract for the connected wallet.</p>
                </button>
                <button
                  disabled={loading || !connected}
                  onClick={handleExecuteAction}
                  className="rounded-2xl bg-cyan-500 px-5 py-4 text-left text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <p className="font-semibold">Execute Protected Action</p>
                  <p className="mt-2 text-sm text-slate-700">Run the contract guard to verify user authorization.</p>
                </button>
              </div>

              <div className="mt-8 rounded-3xl border border-slate-800 bg-slate-950/70 p-6">
                <p className="text-sm uppercase tracking-[0.24em] text-slate-400">Status</p>
                <div className="mt-3 flex flex-wrap gap-3 text-sm text-white">
                  <span className="rounded-full bg-slate-800 px-4 py-2">Approval: {approvalStatus}</span>
                  <span className="rounded-full bg-slate-800 px-4 py-2">Action: {actionState}</span>
                  <span className="rounded-full bg-slate-800 px-4 py-2">Mode: {NETWORK}</span>
                </div>
              </div>
            </article>

            <article className="rounded-3xl border border-slate-800 bg-slate-900/90 p-8 shadow-xl shadow-slate-950/10">
              <h3 className="text-xl font-semibold text-white">Admin Approval</h3>
              <p className="mt-2 text-sm text-slate-400">Approve a new wallet address if you are the admin.</p>
              <div className="mt-6 grid gap-4 sm:grid-cols-[1fr_auto]">
                <input
                  value={adminTarget}
                  onChange={(event) => setAdminTarget(event.target.value)}
                  placeholder="Stellar address to approve"
                  className="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none focus:border-cyan-400"
                />
                <button
                  onClick={handleApproveUser}
                  disabled={loading || !connected}
                  className="rounded-2xl bg-slate-800 px-5 py-3 text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Approve User
                </button>
              </div>
              <p className="mt-4 text-sm text-slate-500">Only the admin wallet can invoke the approval function.</p>
            </article>
          </div>

          <aside className="space-y-6">
            <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-8 shadow-xl shadow-slate-950/10">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm uppercase tracking-[0.24em] text-cyan-400">Mock Oracle</p>
                  <h3 className="mt-2 text-2xl font-semibold text-white">Tokenized Asset Price</h3>
                </div>
              </div>
              <div className="mt-8 rounded-3xl bg-slate-950/80 p-6 text-center">
                <p className="text-sm uppercase tracking-[0.24em] text-slate-400">Price Signal</p>
                <p className="mt-4 text-5xl font-semibold text-white">$100.00</p>
                <p className="mt-2 text-sm text-slate-500">Mock price feed for asset tokenization use cases.</p>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-8 shadow-xl shadow-slate-950/10">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm uppercase tracking-[0.24em] text-cyan-400">Activity</p>
                  <h3 className="mt-2 text-2xl font-semibold text-white">Recent Events</h3>
                </div>
              </div>
              <div className="mt-6 space-y-4">
                {activity.length === 0 ? (
                  <div className="rounded-3xl bg-slate-950/80 p-5 text-sm text-slate-500">No activity yet. Connect Freighter to start.</div>
                ) : (
                  activity.map((entry, index) => (
                    <div key={index} className="rounded-3xl border border-slate-800 bg-slate-950/80 p-4">
                      <p className="text-sm font-semibold text-white">{entry.type}</p>
                      <p className="mt-1 text-sm text-slate-400">{entry.message}</p>
                      <div className="mt-3 flex items-center justify-between text-xs uppercase tracking-[0.2em] text-slate-500">
                        <span>{entry.status}</span>
                        <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                      </div>
                      {entry.txHash ? <p className="mt-2 text-xs text-slate-500">Tx: {entry.txHash}</p> : null}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-8 shadow-xl shadow-slate-950/10">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm uppercase tracking-[0.24em] text-cyan-400">On-Chain</p>
                  <h3 className="mt-2 text-2xl font-semibold text-white">Contract Events</h3>
                </div>
                <button
                  onClick={handleFetchEvents}
                  disabled={loading}
                  className="rounded-full bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Fetch Events
                </button>
              </div>
              <div className="mt-6 space-y-4">
                {contractEvents.length === 0 ? (
                  <div className="rounded-3xl bg-slate-950/80 p-5 text-sm text-slate-500">No events fetched yet. Click "Fetch Events" to load from the blockchain.</div>
                ) : (
                  contractEvents.map((event, index) => (
                    <div key={index} className="rounded-3xl border border-slate-800 bg-slate-950/80 p-4">
                      <p className="text-sm font-semibold text-white">{event.topic.join(' ')}</p>
                      <p className="mt-1 text-sm text-slate-400">{event.value}</p>
                      <div className="mt-3 flex items-center justify-between text-xs uppercase tracking-[0.2em] text-slate-500">
                        <span>Ledger {event.ledger}</span>
                        <span>{event.inSuccessfulContractCall ? 'Success' : 'Failed'}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
