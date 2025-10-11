let fhevmInstance: unknown = null;

export async function initFhevm(network: unknown, chainId: number, gatewayUrl?: string) {
  try {
    const { createInstance, SepoliaConfig } = await import('@zama-fhe/relayer-sdk/bundle');

    const config = {
      ...SepoliaConfig,
      network,
      chainId,
      gatewayUrl: gatewayUrl || (SepoliaConfig as Record<string, unknown>).gatewayUrl,
    };

    fhevmInstance = await createInstance(config as Record<string, unknown>);

    return fhevmInstance;
  } catch (error) {
    console.error('Failed to initialize FHE instance:', error);
    throw error;
  }
}

export function getFhevmInstance() {
  if (!fhevmInstance) {
    console.error('fhevmInstance is null when getFhevmInstance is called:', fhevmInstance);
    throw new Error('FHE instance not initialized, please ensure wallet is connected and on the correct network');
  }
  return fhevmInstance;
}

export async function encryptValue(value: number): Promise<Uint8Array> {
  const instance = getFhevmInstance() as { encrypt64: (value: bigint) => Promise<Uint8Array> };
  return instance.encrypt64(BigInt(value));
}

export async function requestDecryption(
  contractAddress: string,
  _userAddress: string
): Promise<string> {
  const instance = getFhevmInstance() as { generateToken: (opts: { verifyingContract: string }) => Promise<string> };
  return instance.generateToken({
    verifyingContract: contractAddress,
  });
}

export async function decrypt64(ciphertext: string): Promise<bigint> {
  const instance = getFhevmInstance() as { decrypt64: (ciphertext: string) => Promise<bigint> };
  return instance.decrypt64(ciphertext);
}

