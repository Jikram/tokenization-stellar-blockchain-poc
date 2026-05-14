'use client';

import { useEffect, useState } from 'react';
import { checkApprovalStatus, approveUser, executeProtectedAction, fetchContractEvents, getBalance } from '../lib/contract';
import { connectFreighter, getFreighterPublicKey, checkFreighterInstalled } from '../lib/freighter';
import { StrKey } from '@stellar/stellar-sdk';

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

const EVENT_LABELS: Record<string, string> = {
  init: 'Contract Initialized',
  apprv: 'Investor Whitelisted',
  prot_exec: 'Asset Accessed',
};

function shortenAddress(addr: string): string {
  return addr.length > 20 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;
}

function formatEventValue(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((v) => (typeof v === 'string' ? shortenAddress(v) : String(v))).join(', ');
    }
    if (typeof parsed === 'string') return shortenAddress(parsed);
    return JSON.stringify(parsed);
  } catch {
    return typeof raw === 'string' ? shortenAddress(raw) : raw;
  }
}

function InitEventContent({ value }: { value: string }) {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.length < 4) return <p className="mt-1 text-sm text-slate-300 break-all">{value}</p>;
    const [admin, assetName, ledger, meta] = parsed;
    const statusKey = meta?.status
      ? (Array.isArray(meta.status) ? String(meta.status[0]) : Object.keys(meta.status)[0])
      : null;
    return (
      <div className="mt-2 max-h-72 overflow-y-auto space-y-1 pr-1">
        <Row label="Admin" value={typeof admin === 'string' ? admin : String(admin)} mono />
        <Row label="Asset" value={String(assetName)} />
        <Row label="Ledger" value={String(ledger)} />
        {meta && (<>
          <Divider />
          <Row label="Type" value={String(meta.asset_type ?? '—')} />
          <Row label="Status" value={statusKey ?? '—'} highlight={statusKey === 'Active' ? 'green' : 'red'} />
          <Row label="Total Supply" value={meta.total_supply ? Number(meta.total_supply).toLocaleString() + ' units' : '—'} />
          <Row label="Min Investment" value={meta.min_investment ? '$' + Number(meta.min_investment).toLocaleString() + '.00' : '—'} />
          <Row label="ISIN" value={String(meta.optional_isin ?? 'N/A')} />
          <Row label="Tags" value={Array.isArray(meta.tags) ? meta.tags.join(' · ') : '—'} />
          <Row label="Doc Hash" value={String(meta.document_hash ?? '—')} mono truncate />
          <Row label="Location" value={meta.geo ? `${meta.geo.region}, ${meta.geo.country}` : '—'} />
          <Row label="Issued At" value={meta.issued_at ? new Date(Number(meta.issued_at) * 1000).toUTCString() : '—'} />
          {meta.properties && Object.entries(meta.properties).map(([k, v]) => (
            <Row key={k} label={k.replace(/_/g, ' ')} value={String(v)} indent />
          ))}
        </>)}
      </div>
    );
  } catch {
    return <p className="mt-1 text-sm text-slate-300 break-all">{value}</p>;
  }
}

function Row({ label, value, mono, truncate, highlight, indent }: { label: string; value: string; mono?: boolean; truncate?: boolean; highlight?: 'green' | 'red'; indent?: boolean }) {
  return (
    <div className={`flex items-start justify-between gap-2 text-xs min-w-0 ${indent ? 'pl-3' : ''}`}>
      <span className="shrink-0 text-slate-500 capitalize">{label}</span>
      <span className={`text-right min-w-0 ${mono ? 'font-mono' : ''} ${truncate ? 'truncate' : 'break-all'} ${highlight === 'green' ? 'text-emerald-400' : highlight === 'red' ? 'text-red-400' : 'text-slate-300'}`}>{value}</span>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-slate-800 my-1" />;
}

function Badge({ label, variant }: { label: string; variant: 'get' | 'set' | 'execute' }) {
  const styles = {
    get: 'bg-blue-500/15 text-blue-300 border border-blue-500/30',
    set: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
    execute: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-widest ${styles[variant]}`}>
      {label}
    </span>
  );
}

export default function Home() {
  const [walletAddress, setWalletAddress] = useState<string>('');
  const [connected, setConnected] = useState(false);
  const [kycCheckTarget, setKycCheckTarget] = useState('');
  const [kycStatus, setKycStatus] = useState<string | null>(null);
  const [actionState, setActionState] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<boolean | null>(null);
  const [whitelistTarget, setWhitelistTarget] = useState('');
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [contractEvents, setContractEvents] = useState<ContractEvent[]>([]);
  const [adminAddress, setAdminAddress] = useState<string>('');
  const [fetchRange, setFetchRange] = useState<{ start: number; end: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasFreighter, setHasFreighter] = useState(false);
  const [userBalance, setUserBalance] = useState<number | null>(null);

  useEffect(() => {
    const checkAndSetFreighter = async () => {
      const detected = await checkFreighterInstalled();
      setHasFreighter(detected);
      if (detected) {
        getFreighterPublicKey()
          .then((publicKey) => {
            setWalletAddress(publicKey);
            setConnected(true);
          })
          .catch(() => setConnected(false));
      }
    };
    checkAndSetFreighter();
    const interval = setInterval(checkAndSetFreighter, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!walletAddress) { setUserBalance(null); return; }
    getBalance(walletAddress).then(setUserBalance).catch(() => setUserBalance(null));
  }, [walletAddress]);

  const pushActivity = (entry: ActivityEntry) => {
    setActivity((current) => [entry, ...current].slice(0, 8));
  };

  const handleConnect = async () => {
    setLoading(true);
    try {
      const publicKey = await connectFreighter();
      setWalletAddress(publicKey);
      setConnected(true);
      pushActivity({ timestamp: new Date().toISOString(), type: 'wallet_connect', status: 'success', message: `Wallet connected: ${publicKey.slice(0, 8)}...${publicKey.slice(-4)}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to connect wallet';
      pushActivity({ timestamp: new Date().toISOString(), type: 'wallet_connect', status: 'error', message });
    } finally {
      setLoading(false);
    }
  };

  const handleKycCheck = async () => {
    const target = kycCheckTarget.trim();
    if (!target) return;
    if (!StrKey.isValidEd25519PublicKey(target)) {
      setKycStatus('invalid');
      return;
    }
    setLoading(true);
    setKycStatus(null);
    try {
      if (!CONTRACT_ID || CONTRACT_ID === 'Not set') throw new Error('Contract ID not configured.');
      pushActivity({ timestamp: new Date().toISOString(), type: 'kyc_check', status: 'pending', message: `Reading KYC status for ${target.slice(0, 8)}...` });
      const isApproved = await checkApprovalStatus(target);
      setKycStatus(isApproved ? 'approved' : 'not_approved');
      pushActivity({ timestamp: new Date().toISOString(), type: 'kyc_check', status: 'success', message: `${target.slice(0, 8)}... is ${isApproved ? 'KYC approved ✓' : 'not KYC approved ✗'}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'KYC check failed';
      setKycStatus('error');
      pushActivity({ timestamp: new Date().toISOString(), type: 'kyc_check', status: 'error', message });
    } finally {
      setLoading(false);
    }
  };

  const handleExecuteAction = async () => {
    setLoading(true);
    setActionState(null);
    setActionSuccess(null);
    try {
      if (!CONTRACT_ID || CONTRACT_ID === 'Not set') throw new Error('Contract ID not configured.');
      if (!walletAddress) throw new Error('Connect your wallet first.');
      pushActivity({ timestamp: new Date().toISOString(), type: 'asset_access', status: 'pending', message: 'Requesting access to tokenized asset...' });
      const result = await executeProtectedAction(walletAddress);
      const txHash = result.sendTransactionResponse?.hash || result.getTransactionResponse?.hash;
      const newBalance = await getBalance(walletAddress);
      setUserBalance(newBalance);
      setActionState(`Access granted — you now hold ${newBalance} unit${newBalance !== 1 ? 's' : ''} ($${(newBalance * 1000).toLocaleString()}.00) of this asset.`);
      setActionSuccess(true);
      pushActivity({ timestamp: new Date().toISOString(), type: 'asset_access', status: 'success', message: `Asset access granted. Holdings: ${newBalance} unit${newBalance !== 1 ? 's' : ''}`, txHash });
    } catch (error) {
      const raw = error instanceof Error ? error.message : '';
      const isAccessDenied =
        raw.includes('not approved') ||
        raw.includes('UnreachableCodeReached') ||
        raw.includes('WasmVm') ||
        raw.includes('execute_action');
      const message = isAccessDenied
        ? 'Access denied — this wallet has not been KYC approved by the asset issuer.'
        : raw || 'Access denied';
      setActionState(message);
      setActionSuccess(false);
      pushActivity({ timestamp: new Date().toISOString(), type: 'asset_access', status: 'error', message });
    } finally {
      setLoading(false);
    }
  };

  const handleWhitelistUser = async () => {
    setLoading(true);
    try {
      if (!CONTRACT_ID || CONTRACT_ID === 'Not set') throw new Error('Contract ID not configured.');
      if (!walletAddress) throw new Error('Connect your wallet first.');
      if (!whitelistTarget.trim()) throw new Error('Enter an investor wallet address.');
      pushActivity({ timestamp: new Date().toISOString(), type: 'whitelist', status: 'pending', message: `Writing KYC approval for ${whitelistTarget.slice(0, 8)}...` });
      const result = await approveUser(walletAddress, whitelistTarget.trim());
      pushActivity({
        timestamp: new Date().toISOString(),
        type: 'whitelist',
        status: 'success',
        message: `Investor whitelisted on-chain: ${whitelistTarget.slice(0, 8)}...`,
        txHash: result.result?.transactionHash,
      });
      setWhitelistTarget('');
    } catch (error) {
      const raw = error instanceof Error ? error.message : '';
      const isNotAdmin =
        raw.includes('UnreachableCodeReached') ||
        raw.includes('WasmVm') ||
        raw.includes('approve_user') ||
        raw.includes('only admin');
      const message = isNotAdmin
        ? 'Only the admin wallet can whitelist investors. Switch to the admin wallet in Freighter.'
        : raw || 'Whitelist failed';
      pushActivity({ timestamp: new Date().toISOString(), type: 'whitelist', status: 'error', message });
    } finally {
      setLoading(false);
    }
  };

  const handleFetchEvents = async () => {
    setLoading(true);
    try {
      pushActivity({ timestamp: new Date().toISOString(), type: 'fetch_events', status: 'pending', message: 'Fetching on-chain events...' });
      const { events, startLedger, endLedger } = await fetchContractEvents(20);
      setContractEvents(events);
      setFetchRange({ start: startLedger, end: endLedger });
      const initEvent = events.find((e) => e.topic[0] === 'init');
      if (initEvent) {
        try {
          const parsed = JSON.parse(initEvent.value);
          // value shape: [admin: Address, asset_name: String, ledger: u32, metadata: AssetMetadata]
          const addr = Array.isArray(parsed) ? parsed[0] : (parsed?.vec?.[0]?.address ?? null);
          setAdminAddress(addr ?? initEvent.value);
        } catch {
          setAdminAddress(initEvent.value);
        }
      }
      pushActivity({ timestamp: new Date().toISOString(), type: 'fetch_events', status: 'success', message: `Loaded ${events.length} contract events` });
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

        {/* Header */}
        <header className="mb-8 flex flex-col gap-6 rounded-3xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-cyan-400">Stellar Soroban · Rust Smart Contract</p>
              <h1 className="mt-3 text-4xl font-semibold text-white">Tokenized Asset Access Control</h1>
              <p className="mt-3 max-w-2xl text-slate-400">
                A regulated tokenized asset on Stellar Testnet. Investor wallets must be KYC-approved on-chain before they can access the asset — enforced by a Rust smart contract, not a database.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:items-end">
              <button
                onClick={handleConnect}
                disabled={loading || !hasFreighter}
                className="inline-flex items-center justify-center rounded-full bg-cyan-500 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {connected ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : 'Connect Freighter'}
              </button>
              {!hasFreighter && (
                <p className="text-xs text-amber-400">
                  <a href="https://www.freighter.app/" target="_blank" rel="noopener noreferrer" className="underline hover:text-amber-300">Install Freighter</a> to interact with the contract.
                </p>
              )}
            </div>
          </div>

          {/* Demo flow strip */}
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              { step: '1', label: 'Admin whitelists their own wallet', action: 'SET — issuer self-approves', color: 'amber' },
              { step: '2', label: 'Admin whitelists an investor wallet', action: 'SET — writes to chain', color: 'amber' },
              { step: '3', label: 'Anyone reads KYC status of a wallet', action: 'GET — reads from chain', color: 'blue' },
              { step: '4', label: 'Approved wallet accesses the asset', action: 'EXECUTE — contract enforces rule', color: 'emerald' },
            ].map(({ step, label, action, color }) => (
              <div key={step} className={`rounded-2xl border border-slate-800 bg-slate-950/60 p-4`}>
                <p className={`text-xs font-bold uppercase tracking-widest text-${color}-400`}>Step {step}</p>
                <p className="mt-1 text-sm font-medium text-white">{label}</p>
                <p className={`mt-1 text-xs text-${color}-400/70`}>{action}</p>
              </div>
            ))}
          </div>

          {/* Info strip */}
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
              <p className="text-xs text-slate-400 uppercase tracking-widest">Connected Wallet</p>
              <div className="mt-1 flex items-center gap-2">
                <p className="text-sm font-semibold text-white truncate flex-1">{walletAddress || 'Not connected'}</p>
                {walletAddress && (
                  <button
                    onClick={() => navigator.clipboard.writeText(walletAddress)}
                    title="Copy address"
                    className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-700 hover:text-white"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                  </button>
                )}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
              <p className="text-xs text-slate-400 uppercase tracking-widest">Contract ID</p>
              <div className="mt-1 flex items-start gap-2">
                <p className="text-xs font-semibold text-white break-all flex-1">{CONTRACT_ID}</p>
                {CONTRACT_ID && CONTRACT_ID !== 'Not set' && (
                  <button
                    onClick={() => navigator.clipboard.writeText(CONTRACT_ID)}
                    title="Copy contract ID"
                    className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-700 hover:text-white"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                  </button>
                )}
              </div>
              {CONTRACT_ID && CONTRACT_ID !== 'Not set' && (
                <div className="mt-2 flex items-center gap-3">
                  <a
                    href={`https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 transition"
                  >
                    Stellar Expert ↗
                  </a>
                  <a
                    href={`https://lab.stellar.org/r/testnet/contract/${CONTRACT_ID}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 transition"
                  >
                    Stellar Lab ↗
                  </a>
                </div>
              )}
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
              <p className="text-xs text-slate-400 uppercase tracking-widest">Network</p>
              <p className="mt-1 text-sm font-semibold text-white capitalize">{NETWORK}</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
              <p className="text-xs text-slate-400 uppercase tracking-widest">Your Holdings</p>
              <p className="mt-1 text-sm font-semibold text-white">
                {userBalance === null ? (connected ? '...' : '—') : `$${(userBalance * 1000).toLocaleString()}.00`}
              </p>
              {userBalance !== null && userBalance > 0 && (
                <p className="mt-0.5 text-xs text-slate-500">{userBalance} unit{userBalance !== 1 ? 's' : ''} × $1,000.00</p>
              )}
            </div>
          </div>
        </header>

        <section className="grid gap-6 xl:grid-cols-[1.45fr_0.95fr]">
          <div className="space-y-6">

            {/* GET — KYC Status Check */}
            <article className="rounded-3xl border border-slate-800 bg-slate-900/90 p-8 shadow-xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge label="GET" variant="get" />
                    <h2 className="text-xl font-semibold text-white">Check KYC Status</h2>
                  </div>
                  <p className="mt-2 text-sm text-slate-400">
                    Read directly from the smart contract whether a wallet is cleared to hold this tokenized asset. No wallet connection required.
                  </p>
                </div>
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_auto]">
                <input
                  value={kycCheckTarget}
                  onChange={(e) => setKycCheckTarget(e.target.value)}
                  placeholder="Paste any Stellar wallet address…"
                  className="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none focus:border-blue-400 placeholder:text-slate-600"
                />
                <button
                  onClick={handleKycCheck}
                  disabled={loading || !kycCheckTarget.trim()}
                  className="rounded-2xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Read Chain
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                {walletAddress
                  ? 'No wallet signature needed — this is a free read from the blockchain.'
                  : 'Paste any Stellar wallet address above — no wallet connection needed to check.'}
              </p>

              {kycStatus && (
                <div className={`mt-4 rounded-2xl p-4 flex items-center gap-3 ${
                  kycStatus === 'approved' ? 'bg-emerald-500/10 border border-emerald-500/30' :
                  kycStatus === 'not_approved' ? 'bg-red-500/10 border border-red-500/30' :
                  kycStatus === 'invalid' ? 'bg-amber-500/10 border border-amber-500/30' :
                  'bg-slate-800 border border-slate-700'
                }`}>
                  <span className="text-2xl">
                    {kycStatus === 'approved' ? '✓' : kycStatus === 'not_approved' ? '✗' : '!'}
                  </span>
                  <div>
                    <p className={`text-sm font-semibold ${
                      kycStatus === 'approved' ? 'text-emerald-300' :
                      kycStatus === 'not_approved' ? 'text-red-300' :
                      kycStatus === 'invalid' ? 'text-amber-300' :
                      'text-slate-300'
                    }`}>
                      {kycStatus === 'approved' ? 'KYC Approved — wallet is whitelisted on-chain' :
                       kycStatus === 'not_approved' ? 'Not Approved — wallet has not been KYC cleared' :
                       kycStatus === 'invalid' ? 'Invalid address — Stellar addresses start with G and are 56 characters long' :
                       'Error reading from contract'}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {kycStatus === 'invalid'
                        ? 'Check the address and try again.'
                        : 'Result returned by the Rust smart contract on Stellar Testnet'}
                    </p>
                  </div>
                </div>
              )}
            </article>

            {/* SET — Whitelist Investor */}
            <article className="rounded-3xl border border-slate-800 bg-slate-900/90 p-8 shadow-xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge label="SET" variant="set" />
                    <h2 className="text-xl font-semibold text-white">Whitelist Investor</h2>
                  </div>
                  <p className="mt-2 text-sm text-slate-400">
                    As the asset issuer (admin), KYC-approve an investor wallet. This writes a permanent record to the Stellar blockchain — the wallet can now access the tokenized asset.
                  </p>
                </div>
              </div>

              {/* Admin self-whitelist tip */}
              {connected && (
                <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <p className="text-xs font-semibold text-amber-400 uppercase tracking-widest">Demo tip — Step 1</p>
                  <p className="mt-1 text-sm text-slate-300">
                    The admin wallet is not whitelisted by default. Whitelist yourself first so you can also demo the Execute step.
                  </p>
                  <button
                    onClick={() => setWhitelistTarget(walletAddress)}
                    className="mt-3 rounded-full border border-amber-500/30 px-4 py-1.5 text-xs font-semibold text-amber-400 transition hover:bg-amber-500/10"
                  >
                    Pre-fill my address
                  </button>
                </div>
              )}

              <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
                <input
                  value={whitelistTarget}
                  onChange={(e) => setWhitelistTarget(e.target.value)}
                  placeholder="Investor wallet address to approve…"
                  className="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none focus:border-amber-400 placeholder:text-slate-600"
                />
                <button
                  onClick={handleWhitelistUser}
                  disabled={loading || !connected}
                  className="rounded-2xl bg-amber-500 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Write to Chain
                </button>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Requires admin wallet. Freighter will prompt you to sign the transaction before it is submitted to Stellar.
              </p>
            </article>

            {/* EXECUTE — Access Tokenized Asset */}
            <article className="rounded-3xl border border-slate-800 bg-slate-900/90 p-8 shadow-xl">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge label="EXECUTE" variant="execute" />
                    <h2 className="text-xl font-semibold text-white">Access Tokenized Asset</h2>
                  </div>
                  <p className="mt-2 text-sm text-slate-400">
                    Simulate an investor interacting with the tokenized asset. The smart contract checks on-chain KYC status and either grants or denies access — no off-chain database involved.
                  </p>
                </div>
                <button
                  onClick={handleExecuteAction}
                  disabled={loading || !connected}
                  className="shrink-0 rounded-2xl bg-emerald-500 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Execute
                </button>
              </div>

              {actionState && (
                <div className={`mt-6 rounded-2xl p-4 flex items-start gap-3 ${
                  actionSuccess ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-red-500/10 border border-red-500/30'
                }`}>
                  <span className="text-2xl mt-0.5">{actionSuccess ? '✓' : '✗'}</span>
                  <div>
                    <p className={`text-sm font-semibold ${actionSuccess ? 'text-emerald-300' : 'text-red-300'}`}>
                      {actionState}
                    </p>
                    {actionSuccess && (
                      <p className="mt-0.5 text-xs text-slate-500">Access enforced by the Rust contract — not middleware or a backend API.</p>
                    )}
                  </div>
                </div>
              )}
            </article>
          </div>

          {/* Right sidebar */}
          <aside className="min-w-0 space-y-6">

            {/* Asset NAV Feed */}
            <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-8 shadow-xl">
              <p className="text-xs uppercase tracking-widest text-cyan-400">Mock Oracle</p>
              <h3 className="mt-2 text-xl font-semibold text-white">Asset NAV Feed</h3>
              <p className="mt-1 text-sm text-slate-400">Tokenized Real Estate Fund · Series A</p>
              <div className="mt-6 rounded-2xl bg-slate-950/80 p-6 text-center">
                <p className="text-xs uppercase tracking-widest text-slate-400">Net Asset Value / Unit</p>
                <p className="mt-3 text-5xl font-semibold text-white">$1,000.00</p>
                <p className="mt-2 text-xs text-slate-500">Simulated price feed · Testnet only</p>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-slate-950/60 p-3 text-center">
                  <p className="text-xs text-slate-400">Asset Type</p>
                  <p className="mt-1 text-sm font-semibold text-white">Real Estate</p>
                </div>
                <div className="rounded-2xl bg-slate-950/60 p-3 text-center">
                  <p className="text-xs text-slate-400">Access</p>
                  <p className="mt-1 text-sm font-semibold text-white">KYC Gated</p>
                </div>
              </div>
            </div>

            {/* Activity */}
            <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-8 shadow-xl">
              <p className="text-xs uppercase tracking-widest text-cyan-400">Activity</p>
              <h3 className="mt-2 text-xl font-semibold text-white">Transaction Log</h3>
              <div className="mt-5 space-y-3">
                {activity.length === 0 ? (
                  <div className="rounded-2xl bg-slate-950/80 p-4 text-sm text-slate-500">
                    No activity yet. Connect Freighter and interact with the contract.
                  </div>
                ) : (
                  activity.map((entry, index) => (
                    <div key={index} className={`rounded-2xl border p-4 ${
                      entry.status === 'success' ? 'border-emerald-500/20 bg-slate-950/60' :
                      entry.status === 'error' ? 'border-red-500/20 bg-slate-950/60' :
                      'border-slate-700 bg-slate-950/60'
                    }`}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">{entry.type.replace(/_/g, ' ')}</p>
                        <span className={`text-xs font-semibold ${
                          entry.status === 'success' ? 'text-emerald-400' :
                          entry.status === 'error' ? 'text-red-400' :
                          'text-amber-400'
                        }`}>{entry.status}</span>
                      </div>
                      <p className="mt-1 text-sm text-slate-300">{entry.message}</p>
                      {entry.txHash && <p className="mt-1.5 text-xs text-slate-500 truncate">Tx: {entry.txHash}</p>}
                      <p className="mt-1 text-xs text-slate-600">{new Date(entry.timestamp).toLocaleTimeString()}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* On-Chain Events */}
            <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-8 shadow-xl">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-widest text-cyan-400">On-Chain</p>
                  <h3 className="mt-2 text-xl font-semibold text-white">Contract Events</h3>
                  {fetchRange && (
                    <p className="mt-1 text-xs text-slate-500">
                      Ledgers {fetchRange.start.toLocaleString()} → {fetchRange.end.toLocaleString()} · ~{Math.round((fetchRange.end - fetchRange.start) * 5 / 3600)}h lookback
                    </p>
                  )}
                </div>
                <button
                  onClick={handleFetchEvents}
                  disabled={loading}
                  className="rounded-full bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Fetch
                </button>
              </div>
              {adminAddress && (
                <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <p className="text-xs font-semibold uppercase tracking-widest text-amber-400">Admin Wallet</p>
                  <p className="mt-1 text-sm font-mono text-slate-300 truncate">{adminAddress}</p>
                  {walletAddress && (
                    <p className="mt-1 text-xs text-slate-500">
                      {walletAddress === adminAddress ? '✓ Your connected wallet is the admin' : 'Your connected wallet is not the admin'}
                    </p>
                  )}
                </div>
              )}
              <div className="mt-5 space-y-3">
                {contractEvents.length === 0 ? (
                  <div className="rounded-2xl bg-slate-950/80 p-4 text-sm text-slate-500">
                    No events loaded. Click Fetch to read from the blockchain.
                  </div>
                ) : (
                  contractEvents.map((event, index) => {
                    const topicKey = event.topic[0] ?? '';
                    const label = EVENT_LABELS[topicKey] ?? topicKey;
                    return (
                      <div key={index} className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/80 p-4">
                        <p className="text-xs font-semibold uppercase tracking-widest text-cyan-400">{label}</p>
                        {topicKey === 'init'
                          ? <InitEventContent value={event.value} />
                          : <p className="mt-1 text-sm text-slate-300 truncate">{formatEventValue(event.value)}</p>
                        }
                        <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                          <span>Ledger {event.ledger}</span>
                          <span className={event.inSuccessfulContractCall ? 'text-emerald-400' : 'text-red-400'}>
                            {event.inSuccessfulContractCall ? 'Success' : 'Failed'}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
