let fhevmInstance: unknown = null;

async function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function initFhevm(network: unknown, chainId: number, gatewayUrl?: string, retries = 3) {
  let lastError: unknown;

  // 如果传入的是逗号分隔的 RPC 字符串，这里拆分并顺序尝试
  const splitRpcCandidates = (val: unknown): unknown[] => {
    if (typeof val === 'string' && val.includes(',')) {
      return val
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    return [val];
  };

  const candidates = splitRpcCandidates(network);

  for (const candidate of candidates) {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        if (attempt > 0) {
          const waitTime = Math.min(1000 * Math.pow(2, attempt), 5000);
          await delay(waitTime);
        }

        const { createInstance, SepoliaConfig } = await import('@zama-fhe/relayer-sdk/bundle');

        const config = {
          ...SepoliaConfig,
          network: candidate,
          chainId,
          gatewayUrl: gatewayUrl || (SepoliaConfig as Record<string, unknown>).gatewayUrl,
        };

        fhevmInstance = await createInstance(config as never);
        return fhevmInstance;
      } catch (error) {
        lastError = error;
        const errorMessage = error instanceof Error ? error.message : String(error);

        // 对速率限制做重试；其余错误按候选切换
        if (errorMessage.includes('Too Many Requests') || errorMessage.includes('-32005')) {
          if (attempt < retries - 1) {
            continue;
          }
        }

        console.error(`Failed to initialize FHE instance (attempt ${attempt + 1}/${retries}):`, error);
        // 当前候选尝试完毕或非可重试错误，切到下一个候选
        break;
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

export async function publicDecrypt(handles: string[]): Promise<{
  clearValues: Record<string, bigint | boolean | string>;
  abiEncodedClearValues: string;
  decryptionProof: string;
}> {
  const instance = getFhevmInstance() as {
    publicDecrypt: (handles: string[]) => Promise<{
      clearValues: Record<string, bigint | boolean | string>;
      abiEncodedClearValues: string;
      decryptionProof: string;
    }>;
  };
  
  // Add retry logic for rate limiting
  let retries = 3;
  let lastError;
  
  while (retries > 0) {
    try {
      return await instance.publicDecrypt(handles);
    } catch (error) {
      lastError = error;
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('Too Many Requests') && retries > 1) {
        console.log(`Rate limited, retrying in 2 seconds... (${retries - 1} retries left)`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        retries--;
      } else {
        throw error;
      }
    }
  }
  
  throw lastError;
}

