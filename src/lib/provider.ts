import { ethers } from 'ethers';

let readOnlyProvider: ethers.JsonRpcProvider | null = null;
let rpcCandidates: string[] = [];
let rpcIndex = 0;

function buildSingleProvider(url: string): ethers.JsonRpcProvider {
  const chainIdEnv = process.env.NEXT_PUBLIC_CHAIN_ID || '0xaa36a7';
  const chainId = /^0x/i.test(chainIdEnv) ? parseInt(chainIdEnv, 16) : Number(chainIdEnv);
  const network = { chainId: Number.isFinite(chainId) ? chainId : 11155111, name: 'sepolia' };
  return new ethers.JsonRpcProvider(url, network);
}

/**
 * Get a read-only provider for querying blockchain data
 * Uses NEXT_PUBLIC_RPC_URL from env, not wallet RPC
 * This is more stable and doesn't require wallet connection
 */
export function getReadOnlyProvider(): ethers.JsonRpcProvider {
  if (readOnlyProvider) return readOnlyProvider;

  const env = process.env.NEXT_PUBLIC_RPC_URL;
  if (!env) {
    throw new Error('NEXT_PUBLIC_RPC_URL is not configured');
  }

  rpcCandidates = env
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (rpcCandidates.length === 0) {
    throw new Error('NEXT_PUBLIC_RPC_URL has no valid endpoints');
  }

  rpcIndex = 0;
  readOnlyProvider = buildSingleProvider(rpcCandidates[rpcIndex]);
  return readOnlyProvider as ethers.JsonRpcProvider;
}

function rotateReadOnlyProvider(): ethers.JsonRpcProvider {
  if (rpcCandidates.length === 0) getReadOnlyProvider();
  rpcIndex = (rpcIndex + 1) % rpcCandidates.length;
  readOnlyProvider = buildSingleProvider(rpcCandidates[rpcIndex]);
  return readOnlyProvider as ethers.JsonRpcProvider;
}

function isRateLimitOrNodeError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return (
    msg.includes('Too Many Requests') ||
    msg.includes('-32005') ||
    msg.includes('rate limit') ||
    msg.includes('429') ||
    msg.includes('Block range is too large') ||
    msg.includes('10 block range') ||
    msg.includes('-32062') ||
    msg.includes('-32600')
  );
}

export async function readWithFallback<T>(fn: (p: ethers.JsonRpcProvider) => Promise<T>): Promise<T> {
  let lastErr: unknown;
  const tried = new Set<number>();
  for (let i = 0; i < Math.max(1, rpcCandidates.length); i++) {
    const p = getReadOnlyProvider();
    try {
      return await fn(p);
    } catch (e) {
      lastErr = e;
      if (!isRateLimitOrNodeError(e)) break;

      const before = rpcIndex;
      rotateReadOnlyProvider();
      tried.add(before);
      if (tried.size >= rpcCandidates.length) break;
      continue;
    }
  }
  throw lastErr;
}

/**
 * Get a contract instance for read-only operations
 * Uses the stable public RPC instead of wallet RPC
 */
export function getReadOnlyContract<T = ethers.Contract>(
  address: string,
  abi: ethers.InterfaceAbi
): T {
  return new ethers.Contract(address, abi, getReadOnlyProvider()) as T;
}

/**
 * Request wallet accounts to ensure the wallet popup shows up.
 * Throws on user cancellation to allow caller to stop gracefully.
 */
export async function requestAccountsOrThrow(provider: { send: (m: string, p?: unknown[]) => Promise<unknown> }): Promise<void> {
  try {
    await provider.send('eth_requestAccounts', []);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: unknown })?.code as unknown;
    if (code === 4001 || msg.includes('user rejected') || msg.includes('User denied') || msg.includes('ACTION_REJECTED')) {
      throw err;
    }
    // Propagate other errors as well
    throw err;
  }
}

export type NotifyFn = (msg: string, type: 'info' | 'success' | 'error') => void;

/**
 * Send transaction using low-level eth_sendTransaction first to reliably trigger wallet popup,
 * then fall back to a provided contract call if needed. Waits for confirmation using the stable read-only provider.
 */
export async function sendTxWithPopup(
  opts: {
    provider: { send: (m: string, p?: unknown[]) => Promise<unknown> } & ethers.BrowserProvider;
    signer: ethers.Signer;
    to: string;
    data: string;
    gasHex?: string; // e.g. '0x989680'
    valueHex?: string; // optional value in wei hex
    fallbackSend?: () => Promise<{ hash: string }>;
    notify?: NotifyFn;
    pendingTip?: string;
  }
): Promise<ethers.TransactionReceipt | null> {
  const { provider, signer, to, data, gasHex = '0x989680', valueHex, fallbackSend, notify, pendingTip } = opts;

  if (notify) notify('Please confirm the transaction in your wallet', 'info');

  let txHashStr = '';
  let receipt: ethers.TransactionReceipt | null = null;
  try {
    const txObj: Record<string, unknown> = { from: await signer.getAddress(), to, data, gas: gasHex };
    if (valueHex) txObj.value = valueHex;
    txHashStr = await (provider as unknown as { send: (m: string, p?: unknown[]) => Promise<string> }).send('eth_sendTransaction', [txObj]);
    const stable = getReadOnlyProvider();
    receipt = await stable.waitForTransaction(txHashStr, 1);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: unknown })?.code as unknown;
    if (code === 4001 || msg.includes('user rejected') || msg.includes('User denied') || msg.includes('ACTION_REJECTED')) {
      throw err;
    }
    if (!fallbackSend) throw err;
    const tx = await fallbackSend();
    txHashStr = tx.hash;
    const stable = getReadOnlyProvider();
    receipt = await stable.waitForTransaction(txHashStr, 1);
  }
  if (!receipt && pendingTip && notify) notify(pendingTip, 'info');
  return receipt;
}

