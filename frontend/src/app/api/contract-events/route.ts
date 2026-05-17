import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const contractId = searchParams.get('contractId');
  const network = searchParams.get('network') || 'testnet';
  const limit = searchParams.get('limit') || '50';

  if (!contractId) {
    return NextResponse.json({ error: 'contractId required' }, { status: 400 });
  }

  const networkPath = network === 'mainnet' ? 'public' : 'testnet';
  const url = `https://api.stellar.expert/explorer/${networkPath}/contract/${contractId}/events?limit=${limit}&order=desc`;

  const res = await fetch(url);
  if (!res.ok) {
    return NextResponse.json({ error: `Stellar Expert returned ${res.status}` }, { status: res.status });
  }

  const data = await res.json();
  return NextResponse.json(data);
}
