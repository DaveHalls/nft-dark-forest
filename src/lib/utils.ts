export function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

export function formatAddress(address: string): string {
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString('zh-CN');
}

export function calculateCooldownRemaining(cooldownUntil: number): number {
  const now = Math.floor(Date.now() / 1000);
  const remaining = cooldownUntil - now;
  return remaining > 0 ? remaining : 0;
}

