export function isNetworkSwitchError(error: unknown): boolean {
  const errorObj = error as { code?: string; event?: string };
  return errorObj.code === 'NETWORK_ERROR' && errorObj.event === 'changed';
}

export async function safeAsyncCall<T>(
  fn: () => Promise<T>,
  onError?: (error: unknown) => void
): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    if (isNetworkSwitchError(error)) {
      console.log('Network switched during operation, will auto-retry');
      return null;
    }
    if (onError) {
      onError(error);
    } else {
      throw error;
    }
    return null;
  }
}

