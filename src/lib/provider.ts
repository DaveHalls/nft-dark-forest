import { ethers } from 'ethers';

let readOnlyProvider: ethers.JsonRpcProvider | null = null;

/**
 * Get a read-only provider for querying blockchain data
 * Uses NEXT_PUBLIC_RPC_URL from env, not wallet RPC
 * This is more stable and doesn't require wallet connection
 */
export function getReadOnlyProvider(): ethers.JsonRpcProvider {
  if (!readOnlyProvider) {
    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL;
    if (!rpcUrl) {
      throw new Error('NEXT_PUBLIC_RPC_URL is not configured');
    }
    readOnlyProvider = new ethers.JsonRpcProvider(rpcUrl);
  }
  return readOnlyProvider;
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

