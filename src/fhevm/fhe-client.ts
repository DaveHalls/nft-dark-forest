let fhevmInstance: unknown = null;

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function initFhevm(network: unknown, chainId: number, gatewayUrl?: string, retries = 3) {
  let lastError: unknown;
  
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      if (attempt > 0) {
        const waitTime = Math.min(1000 * Math.pow(2, attempt), 5000);
        await delay(waitTime);
      }

      const { createInstance, SepoliaConfig } = await import('@zama-fhe/relayer-sdk/bundle');

      const config = {
        ...SepoliaConfig,
        network,
        chainId,
        gatewayUrl: gatewayUrl || (SepoliaConfig as Record<string, unknown>).gatewayUrl,
      };

      fhevmInstance = await createInstance(config as never);

      return fhevmInstance;
    } catch (error) {
      lastError = error;
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes('Too Many Requests') || errorMessage.includes('-32005')) {
        if (attempt < retries - 1) {
          continue;
        }
      }
      
      console.error(`Failed to initialize FHE instance (attempt ${attempt + 1}/${retries}):`, error);
      
      if (attempt === retries - 1) {
        throw error;
      }
    }
  }
  
  throw lastError;
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
  contractAddress: string
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

