'use client';

import { useEffect, useState } from 'react';
import { checkApprovalStatus, approveUser, mintTokens, burnTokens, clawbackTokens, fetchContractEvents, getBalance, getMetadata, getAdmin, getCirculatingSupply } from '../lib/contract';
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
  approved: 'Investor Whitelisted',
  minted: 'Tokens Minted',
  burned: 'Tokens Burned',
  clawback: 'Regulatory Clawback',
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
    if (typeof parsed === 'object' && parsed !== null) {
      return Object.values(parsed).map((v) => (typeof v === 'string' ? shortenAddress(v) : String(v))).join(', ');
    }
    return String(parsed);
  } catch {
    return typeof raw === 'string' ? shortenAddress(raw) : raw;
  }
}

function InitEventContent({ value }: { value: string }) {
  try {
    const parsed = JSON.parse(value);
    const admin = Array.isArray(parsed) ? parsed[0] : parsed?.admin;
    const assetName = Array.isArray(parsed) ? parsed[1] : parsed?.asset_name;
    const ledger = Array.isArray(parsed) ? parsed[2] : parsed?.ledger;
    const meta = Array.isArray(parsed) ? parsed[3] : parsed?.metadata;
    if (!admin || !meta) return <p className="mt-1 text-sm text-slate-300 break-all">{value}</p>;
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
          <Row label="Issued At" value={meta.issued_at ? new Date(Number(meta.issued_at) * 1000).toLocaleString() : '—'} />
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

function AssetMetadataCard({ meta, circulatingSupply }: { meta: any; circulatingSupply: number | null }) {
  const extractStatus = (s: any): string | null => {
    if (!s) return null;
    if (typeof s === 'string') return s;
    if (Array.isArray(s)) return String(s[0]);
    if (s.tag) return String(s.tag);
    const keys = Object.keys(s);
    return keys.length > 0 ? keys[0] : null;
  };
  const getProperties = (props: any): Array<[string, string]> => {
    if (!props) return [];
    if (Array.isArray(props))
      return props.map((e: any) => Array.isArray(e) ? [String(e[0]), String(e[1])] : [String(e), '']);
    if (typeof props.entries === 'function')
      return Array.from(props.entries()).map(([k, v]: any) => [String(k), String(v)]);
    return Object.entries(props).map(([k, v]) => [k, String(v)]);
  };
  const formatBytes = (v: any): string => {
    if (!v) return '—';
    if (typeof v === 'string') return v;
    if (v instanceof Uint8Array) return Array.from(v).map((b: number) => b.toString(16).padStart(2, '0')).join('');
    if (v && typeof v === 'object' && v.type === 'Buffer' && Array.isArray(v.data))
      return (v.data as number[]).map((b: number) => b.toString(16).padStart(2, '0')).join('');
    return String(v);
  };
  const statusKey = extractStatus(meta?.status);
  const properties = getProperties(meta?.properties);
  const totalSupply = meta?.total_supply ? Number(meta.total_supply) : null;
  return (
    <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-cyan-400 mb-2">Asset Metadata</p>
      <div className="space-y-1">
        <Row label="Type" value={String(meta.asset_type ?? '—')} />
        <Row label="Status" value={statusKey ?? '—'} highlight={statusKey === 'Active' ? 'green' : 'red'} />
        <Row label="Total Supply" value={totalSupply ? totalSupply.toLocaleString() + ' units' : '—'} />
        <Row
          label="Circulating"
          value={circulatingSupply !== null ? circulatingSupply.toLocaleString() + ' units' : '…'}
          highlight={totalSupply && circulatingSupply !== null && circulatingSupply >= totalSupply ? 'red' : 'green'}
        />
        <Row label="Min Investment" value={meta.min_investment ? '$' + Number(meta.min_investment).toLocaleString() + '.00' : '—'} />
        <Row label="ISIN" value={String(meta.optional_isin ?? 'N/A')} />
        <Row label="Tags" value={Array.isArray(meta.tags) ? meta.tags.join(' · ') : '—'} />
        <Row label="Doc Hash" value={formatBytes(meta.document_hash)} mono truncate />
        <Row label="Location" value={meta.geo ? `${meta.geo.region}, ${meta.geo.country}` : '—'} />
        <Row label="Issued At" value={meta.issued_at ? new Date(Number(meta.issued_at) * 1000).toLocaleString() : '—'} />
        {properties.map(([k, v]) => (
          <Row key={k} label={k.replace(/_/g, ' ')} value={v} indent />
        ))}
      </div>
    </div>
  );
}

function EventDetail({ topic, value }: { topic: string; value: string }) {
  try {
    const d = JSON.parse(value);
    if (typeof d !== 'object' || d === null) return <p className="mt-1 text-sm text-slate-300 truncate">{formatEventValue(value)}</p>;
    const nav = (p: any) => `$${(Number(p) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    const ts = (t: any) => new Date(Number(t) * 1000).toLocaleString();
    const addr = (a: any) => shortenAddress(String(a));
    if (topic === 'approved') return (
      <div className="mt-2 space-y-1">
        <Row label="Investor" value={addr(d.user)} mono />
        <Row label="Status" value="✓ Approved" highlight="green" />
        <Row label="By Admin" value={addr(d.admin)} mono />
        <Row label="Time" value={ts(d.timestamp)} />
      </div>
    );
    if (topic === 'minted') return (
      <div className="mt-2 space-y-1">
        <Row label="Investor" value={addr(d.user)} mono />
        <Row label="Amount" value={`+${Number(d.amount).toLocaleString()} units`} highlight="green" />
        <Row label="New Balance" value={`${Number(d.new_balance).toLocaleString()} units`} />
        <Row label="Circulating" value={`${Number(d.circulating_supply).toLocaleString()} units`} />
        <Row label="NAV" value={nav(d.nav_price)} />
        <Row label="Time" value={ts(d.timestamp)} />
      </div>
    );
    if (topic === 'burned') return (
      <div className="mt-2 space-y-1">
        <Row label="Investor" value={addr(d.user)} mono />
        <Row label="Amount" value={`-${Number(d.amount).toLocaleString()} units`} highlight="red" />
        <Row label="New Balance" value={`${Number(d.new_balance).toLocaleString()} units`} />
        <Row label="Circulating" value={`${Number(d.circulating_supply).toLocaleString()} units`} />
        <Row label="NAV" value={nav(d.nav_price)} />
        <Row label="Time" value={ts(d.timestamp)} />
      </div>
    );
    if (topic === 'clawback') return (
      <div className="mt-2 space-y-1">
        <Row label="Investor" value={addr(d.user)} mono />
        <Row label="Amount" value={`-${Number(d.amount).toLocaleString()} units`} highlight="red" />
        <Row label="Reason" value={String(d.reason)} />
        <Row label="Severity" value={`${d.severity}/10`} />
        <Row label="Case Ref" value={String(d.case_reference)} />
        <Row label="New Balance" value={`${Number(d.new_balance).toLocaleString()} units`} />
        <Row label="Circulating" value={`${Number(d.circulating_supply).toLocaleString()} units`} />
        <Row label="Time" value={ts(d.timestamp)} />
      </div>
    );
    return <p className="mt-1 text-sm text-slate-300 truncate">{formatEventValue(value)}</p>;
  } catch {
    return <p className="mt-1 text-sm text-slate-300 truncate">{formatEventValue(value)}</p>;
  }
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
  const [kycCheckedAddress, setKycCheckedAddress] = useState('');
  const [whitelistTarget, setWhitelistTarget] = useState('');
  const [mintTarget, setMintTarget] = useState('');
  const [mintAmount, setMintAmount] = useState('');
  const [burnTarget, setBurnTarget] = useState('');
  const [burnAmount, setBurnAmount] = useState('');
  const [burnType, setBurnType] = useState<'burn' | 'clawback'>('burn');
  const [clawbackReason, setClawbackReason] = useState('');
  const [clawbackSeverity, setClawbackSeverity] = useState('');
  const [clawbackCaseRef, setClawbackCaseRef] = useState('');
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [contractEvents, setContractEvents] = useState<ContractEvent[]>([]);
  const [adminAddress, setAdminAddress] = useState<string>('');
  const [fetchRange, setFetchRange] = useState<{ start: number; end: number; source: 'stellar-expert' | 'rpc' } | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasFreighter, setHasFreighter] = useState(false);
  const [userBalance, setUserBalance] = useState<number | null>(null);
  const [assetMetadata, setAssetMetadata] = useState<any>(null);
  const [circulatingSupply, setCirculatingSupply] = useState<number | null>(null);

  const isAdmin = connected && walletAddress && adminAddress && walletAddress === adminAddress;

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

  useEffect(() => {
    getMetadata().then(setAssetMetadata).catch(() => setAssetMetadata(null));
    getAdmin().then(setAdminAddress).catch(() => {});
    getCirculatingSupply().then(setCirculatingSupply).catch(() => setCirculatingSupply(null));
  }, []);

  const refreshBalances = async () => {
    if (walletAddress) getBalance(walletAddress).then(setUserBalance).catch(() => {});
    getCirculatingSupply().then(setCirculatingSupply).catch(() => {});
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem('poc_activity_log');
      if (saved) setActivity(JSON.parse(saved));
    } catch {}
  }, []);

  const pushActivity = (entry: ActivityEntry) => {
    setActivity((current) => {
      const updated = [entry, ...current].slice(0, 30);
      try { localStorage.setItem('poc_activity_log', JSON.stringify(updated)); } catch {}
      return updated;
    });
  };

  const clearActivity = () => {
    setActivity([]);
    try { localStorage.removeItem('poc_activity_log'); } catch {}
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
      setKycCheckedAddress(target);
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

  const handleWhitelistUser = async () => {
    setLoading(true);
    try {
      if (!CONTRACT_ID || CONTRACT_ID === 'Not set') throw new Error('Contract ID not configured.');
      if (!walletAddress) throw new Error('Connect your wallet first.');
      if (!whitelistTarget.trim()) throw new Error('Enter an investor wallet address.');
      pushActivity({ timestamp: new Date().toISOString(), type: 'whitelist', status: 'pending', message: `Writing KYC approval for ${whitelistTarget.slice(0, 8)}...` });
      const result = await approveUser(walletAddress, whitelistTarget.trim()) as any;
      pushActivity({
        timestamp: new Date().toISOString(),
        type: 'whitelist',
        status: 'success',
        message: `Investor whitelisted on-chain: ${whitelistTarget.slice(0, 8)}...`,
        txHash: result?.result?.transactionHash,
      });
      setWhitelistTarget('');
    } catch (error) {
      const raw = error instanceof Error ? error.message : '';
      const isTimeout = raw.includes('Transaction submitted');
      const isNotAdmin =
        raw.includes('UnreachableCodeReached') ||
        raw.includes('WasmVm') ||
        raw.includes('approve_user') ||
        raw.includes('only admin');
      const message = isTimeout
        ? raw
        : isNotAdmin
        ? 'Only the admin wallet can whitelist investors. Switch to the admin wallet in Freighter.'
        : raw || 'Whitelist failed';
      pushActivity({ timestamp: new Date().toISOString(), type: 'whitelist', status: isTimeout ? 'success' : 'error', message });
    } finally {
      setLoading(false);
    }
  };

  const handleMint = async () => {
    const target = mintTarget.trim();
    const amount = parseInt(mintAmount, 10);
    if (!target || !amount || amount <= 0) return;
    setLoading(true);
    try {
      if (!CONTRACT_ID || CONTRACT_ID === 'Not set') throw new Error('Contract ID not configured.');
      if (!walletAddress) throw new Error('Connect your wallet first.');
      pushActivity({ timestamp: new Date().toISOString(), type: 'mint', status: 'pending', message: `Minting ${amount} tokens to ${target.slice(0, 8)}...` });
      const result = await mintTokens(walletAddress, target, amount) as any;
      await refreshBalances();
      pushActivity({
        timestamp: new Date().toISOString(),
        type: 'mint',
        status: 'success',
        message: `Minted ${amount} tokens to ${target.slice(0, 8)}...`,
        txHash: result?.result?.transactionHash,
      });
      setMintTarget('');
      setMintAmount('');
    } catch (error) {
      const raw = error instanceof Error ? error.message : '';
      const isTimeout = raw.includes('Transaction submitted');
      const isContractReject = raw.includes('UnreachableCodeReached') || raw.includes('WasmVm') || raw.includes('InvalidAction');
      const message = isTimeout
        ? raw
        : isContractReject
        ? 'Mint rejected — investor wallet is not KYC approved, or amount exceeds total supply cap.'
        : raw || 'Mint failed';
      pushActivity({ timestamp: new Date().toISOString(), type: 'mint', status: isTimeout ? 'success' : 'error', message });
    } finally {
      setLoading(false);
    }
  };

  const handleBurnOrClawback = async () => {
    const target = burnTarget.trim();
    const amount = parseInt(burnAmount, 10);
    if (!target || !amount || amount <= 0) return;
    setLoading(true);
    try {
      if (!CONTRACT_ID || CONTRACT_ID === 'Not set') throw new Error('Contract ID not configured.');
      if (!walletAddress) throw new Error('Connect your wallet first.');
      if (burnType === 'clawback') {
        if (!clawbackReason.trim()) throw new Error('Clawback reason is required.');
        const severity = parseInt(clawbackSeverity, 10);
        const caseRef = parseInt(clawbackCaseRef, 10);
        if (!severity || severity < 1 || severity > 10) throw new Error('Severity must be 1–10.');
        if (!caseRef) throw new Error('Case reference number is required.');
        pushActivity({ timestamp: new Date().toISOString(), type: 'clawback', status: 'pending', message: `Clawback ${amount} tokens from ${target.slice(0, 8)}... (${clawbackReason})` });
        const result = await clawbackTokens(walletAddress, target, amount, clawbackReason.trim(), severity, caseRef) as any;
        await refreshBalances();
        pushActivity({
          timestamp: new Date().toISOString(),
          type: 'clawback',
          status: 'success',
          message: `Clawback complete — ${amount} tokens removed from ${target.slice(0, 8)}...`,
          txHash: result?.result?.transactionHash,
        });
      } else {
        pushActivity({ timestamp: new Date().toISOString(), type: 'burn', status: 'pending', message: `Burning ${amount} tokens from ${target.slice(0, 8)}...` });
        const result = await burnTokens(walletAddress, target, amount) as any;
        await refreshBalances();
        pushActivity({
          timestamp: new Date().toISOString(),
          type: 'burn',
          status: 'success',
          message: `Burned ${amount} tokens from ${target.slice(0, 8)}...`,
          txHash: result?.result?.transactionHash,
        });
      }
      setBurnTarget('');
      setBurnAmount('');
      setClawbackReason('');
      setClawbackSeverity('');
      setClawbackCaseRef('');
    } catch (error) {
      const raw = error instanceof Error ? error.message : '';
      const isTimeout = raw.includes('Transaction submitted');
      const isContractReject = raw.includes('UnreachableCodeReached') || raw.includes('WasmVm') || raw.includes('InvalidAction');
      const message = isTimeout
        ? raw
        : isContractReject
        ? 'Cannot burn/clawback more than the investor currently holds.'
        : raw || 'Operation failed';
      pushActivity({ timestamp: new Date().toISOString(), type: burnType, status: isTimeout ? 'success' : 'error', message });
    } finally {
      setLoading(false);
    }
  };

  const handleFetchEvents = async () => {
    setLoading(true);
    try {
      pushActivity({ timestamp: new Date().toISOString(), type: 'fetch_events', status: 'pending', message: 'Fetching on-chain events...' });
      const { events, startLedger, endLedger, source } = await fetchContractEvents(50);
      setContractEvents(events);
      setFetchRange({ start: startLedger, end: endLedger, source });
      const initEvent = events.find((e) => e.topic[0] === 'init');
      if (initEvent) {
        try {
          const parsed = JSON.parse(initEvent.value);
          const addr = Array.isArray(parsed) ? parsed[0] : (parsed?.admin ?? null);
          setAdminAddress(addr ?? initEvent.value);
        } catch {
          setAdminAddress(initEvent.value);
        }
      }
      const sourceLabel = source === 'stellar-expert' ? 'Stellar Expert (full history)' : 'Soroban RPC (~24h)';
      pushActivity({ timestamp: new Date().toISOString(), type: 'fetch_events', status: 'success', message: `Loaded ${events.length} events via ${sourceLabel}` });
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
                A regulated tokenized asset on Stellar Testnet. Investor wallets must be KYC-approved on-chain before receiving tokens — enforced by a Rust smart contract, not a database.
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
              { step: '1', label: 'Admin whitelists investor wallet', action: 'SET — KYC approval on-chain', blue: false },
              { step: '2', label: 'Anyone verifies KYC status on-chain', action: 'GET — reads from chain', blue: true },
              { step: '3', label: 'Admin mints tokens to investor', action: 'SET — issues fund units', blue: false },
              { step: '4', label: 'Admin burns or clawbacks tokens', action: 'SET — regulatory control', blue: false },
            ].map(({ step, label, action, blue }) => (
              <div key={step} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                <p className={`text-xs font-bold uppercase tracking-widest ${blue ? 'text-blue-400' : 'text-amber-400'}`}>Step {step}</p>
                <p className="mt-1 text-sm font-medium text-white">{label}</p>
                <p className={`mt-1 text-xs ${blue ? 'text-blue-400/70' : 'text-amber-400/70'}`}>{action}</p>
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
                  onChange={(e) => { setKycCheckTarget(e.target.value); setKycStatus(null); }}
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
                <div className={`mt-4 rounded-2xl p-4 flex items-start gap-3 ${
                  kycStatus === 'approved' ? 'bg-emerald-500/10 border border-emerald-500/30' :
                  kycStatus === 'not_approved' ? 'bg-red-500/10 border border-red-500/30' :
                  kycStatus === 'invalid' ? 'bg-amber-500/10 border border-amber-500/30' :
                  'bg-slate-800 border border-slate-700'
                }`}>
                  <span className="text-2xl mt-0.5">
                    {kycStatus === 'approved' ? '✓' : kycStatus === 'not_approved' ? '✗' : '!'}
                  </span>
                  <div className="flex-1">
                    {kycCheckedAddress && (
                      <p className="text-xs text-slate-500 font-mono mb-1 truncate">{kycCheckedAddress}</p>
                    )}
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
                  <button
                    onClick={() => { setKycStatus(null); setKycCheckedAddress(''); }}
                    className="shrink-0 rounded-lg p-1 text-slate-500 hover:text-slate-300 transition hover:bg-slate-700"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
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
                    As the asset issuer (admin), KYC-approve an investor wallet. This writes a permanent record to the Stellar blockchain — the wallet can now receive tokens.
                  </p>
                </div>
              </div>

              {connected && (
                <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
                  <p className="text-xs font-semibold text-amber-400 uppercase tracking-widest">Demo tip — Steps 1 → 2 → 3</p>
                  <p className="mt-1 text-sm text-slate-300">
                    Whitelist the investor wallet first, verify KYC status, then mint tokens.
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
                Requires admin wallet. Freighter will prompt you to sign the transaction.
              </p>
            </article>

            {/* SET — Mint Tokens */}
            <article className="rounded-3xl border border-slate-800 bg-slate-900/90 p-8 shadow-xl">
              <div className="flex items-center gap-2 mb-2">
                <Badge label="SET" variant="set" />
                <h2 className="text-xl font-semibold text-white">Mint Tokens</h2>
              </div>
              <p className="mt-1 text-sm text-slate-400">
                Issue fund units to a KYC-approved investor. Admin only. Cannot exceed the total supply cap of 1,000,000 units.
              </p>
              {!isAdmin && connected && (
                <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-950/60 p-3">
                  <p className="text-xs text-slate-500">Switch to the admin wallet in Freighter to mint tokens.</p>
                </div>
              )}
              <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
                <input
                  value={mintTarget}
                  onChange={(e) => setMintTarget(e.target.value)}
                  placeholder="Investor wallet address…"
                  disabled={!isAdmin}
                  className="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none focus:border-amber-400 placeholder:text-slate-600 disabled:opacity-40"
                />
                <input
                  value={mintAmount}
                  onChange={(e) => setMintAmount(e.target.value)}
                  placeholder="Amount"
                  type="number"
                  min="1"
                  disabled={!isAdmin}
                  className="w-28 rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none focus:border-amber-400 placeholder:text-slate-600 disabled:opacity-40"
                />
                <button
                  onClick={handleMint}
                  disabled={loading || !isAdmin || !mintTarget.trim() || !mintAmount}
                  className="rounded-2xl bg-amber-500 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Mint
                </button>
              </div>
              {connected && mintTarget && (
                <button
                  onClick={() => setMintTarget(walletAddress)}
                  className="mt-2 text-xs text-slate-500 hover:text-slate-300 transition"
                >
                  Use my address
                </button>
              )}
            </article>

            {/* SET — Burn / Clawback */}
            <article className="rounded-3xl border border-slate-800 bg-slate-900/90 p-8 shadow-xl">
              <div className="flex items-center gap-2 mb-2">
                <Badge label="SET" variant="set" />
                <h2 className="text-xl font-semibold text-white">Burn / Clawback</h2>
              </div>
              <p className="mt-1 text-sm text-slate-400">
                Burn redeems tokens cooperatively. Clawback is a forced regulatory action — requires a reason, severity level, and case reference number.
              </p>
              {!isAdmin && connected && (
                <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-950/60 p-3">
                  <p className="text-xs text-slate-500">Switch to the admin wallet in Freighter to burn or clawback tokens.</p>
                </div>
              )}

              {/* Type toggle */}
              <div className="mt-5 flex gap-2">
                <button
                  onClick={() => setBurnType('burn')}
                  className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${burnType === 'burn' ? 'bg-amber-500 text-slate-950' : 'border border-slate-700 text-slate-400 hover:text-slate-200'}`}
                >
                  Normal Burn
                </button>
                <button
                  onClick={() => setBurnType('clawback')}
                  className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${burnType === 'clawback' ? 'bg-red-500 text-white' : 'border border-slate-700 text-slate-400 hover:text-slate-200'}`}
                >
                  Regulatory Clawback
                </button>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
                <input
                  value={burnTarget}
                  onChange={(e) => setBurnTarget(e.target.value)}
                  placeholder="Investor wallet address…"
                  disabled={!isAdmin}
                  className="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none focus:border-amber-400 placeholder:text-slate-600 disabled:opacity-40"
                />
                <input
                  value={burnAmount}
                  onChange={(e) => setBurnAmount(e.target.value)}
                  placeholder="Amount"
                  type="number"
                  min="1"
                  disabled={!isAdmin}
                  className="w-28 rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none focus:border-amber-400 placeholder:text-slate-600 disabled:opacity-40"
                />
                <button
                  onClick={handleBurnOrClawback}
                  disabled={loading || !isAdmin || !burnTarget.trim() || !burnAmount}
                  className={`rounded-2xl px-6 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${burnType === 'clawback' ? 'bg-red-500 text-white hover:bg-red-400' : 'bg-amber-500 text-slate-950 hover:bg-amber-400'}`}
                >
                  {burnType === 'clawback' ? 'Clawback' : 'Burn'}
                </button>
              </div>

              {/* Clawback extra fields */}
              {burnType === 'clawback' && (
                <div className="mt-4 space-y-3 rounded-2xl border border-red-500/20 bg-red-500/5 p-4">
                  <p className="text-xs font-semibold uppercase tracking-widest text-red-400">Regulatory Details</p>
                  <input
                    value={clawbackReason}
                    onChange={(e) => setClawbackReason(e.target.value)}
                    placeholder="Reason (e.g. sanctions, fraud, court_order)"
                    disabled={!isAdmin}
                    className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none focus:border-red-400 placeholder:text-slate-600 disabled:opacity-40"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      value={clawbackSeverity}
                      onChange={(e) => setClawbackSeverity(e.target.value)}
                      placeholder="Severity (1–10)"
                      type="number"
                      min="1"
                      max="10"
                      disabled={!isAdmin}
                      className="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none focus:border-red-400 placeholder:text-slate-600 disabled:opacity-40"
                    />
                    <input
                      value={clawbackCaseRef}
                      onChange={(e) => setClawbackCaseRef(e.target.value)}
                      placeholder="Case reference #"
                      type="number"
                      disabled={!isAdmin}
                      className="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-100 outline-none focus:border-red-400 placeholder:text-slate-600 disabled:opacity-40"
                    />
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
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-widest text-cyan-400">Activity</p>
                  <h3 className="mt-2 text-xl font-semibold text-white">Transaction Log</h3>
                </div>
                {activity.length > 0 && (
                  <button
                    onClick={clearActivity}
                    className="rounded-full border border-slate-700 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 hover:border-slate-500 transition"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="mt-5 max-h-[420px] overflow-y-auto space-y-3 pr-1">
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
                      {fetchRange.source === 'stellar-expert'
                        ? <>Full history · <span className="text-cyan-500">Stellar Expert</span></>
                        : <>Ledgers {fetchRange.start.toLocaleString()} → {fetchRange.end.toLocaleString()} · ~{Math.round((fetchRange.end - fetchRange.start) * 5 / 3600)}h · <span className="text-amber-500">Soroban RPC fallback</span></>
                      }
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
              {assetMetadata && (
                <div className="mt-5">
                  <AssetMetadataCard meta={assetMetadata} circulatingSupply={circulatingSupply} />
                </div>
              )}
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
                        {topicKey === 'init' && !assetMetadata
                          ? <InitEventContent value={event.value} />
                          : topicKey === 'init'
                          ? (() => { try { const p = JSON.parse(event.value); const name = Array.isArray(p) ? p[1] : p?.asset_name; const led = Array.isArray(p) ? p[2] : p?.ledger; return <p className="mt-1 text-sm text-slate-300 truncate">{name ? `${name} · Ledger ${led}` : '—'}</p>; } catch { return <p className="mt-1 text-sm text-slate-300">—</p>; } })()
                          : <EventDetail topic={topicKey} value={event.value} />
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
