let fhevmInstance: any = null;

export async function initFhevm(network: any, chainId: number, gatewayUrl?: string) {
  try {
    const { createInstance, SepoliaConfig } = await import('@zama-fhe/relayer-sdk/bundle');

    const config = {
      ...SepoliaConfig,
      network,
      chainId,
      gatewayUrl: gatewayUrl || (SepoliaConfig as any).gatewayUrl,
    };

    fhevmInstance = await createInstance(config as any);

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
  const instance = getFhevmInstance();
  return instance.encrypt64(BigInt(value));
}

export async function requestDecryption(
  contractAddress: string,
  userAddress: string
): Promise<string> {
  const instance = getFhevmInstance();
  return instance.generateToken({
    verifyingContract: contractAddress,
  });
}

export async function decrypt64(ciphertext: string): Promise<bigint> {
  const instance = getFhevmInstance();
  return instance.decrypt64(ciphertext);
}

