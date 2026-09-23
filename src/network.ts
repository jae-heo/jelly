import { execFileSync } from 'node:child_process';
import { isIPv4 } from 'node:net';

export function isTailnetIPv4(host: string): boolean {
  if (!isIPv4(host)) return false;
  const [first, second] = host.split('.').map(Number);
  return first === 100 && second! >= 64 && second! <= 127;
}

export function resolveBinding(mode: string): { host: string; dnsName?: string } {
  if (mode === '127.0.0.1') return { host: mode };
  if (mode !== 'tailscale') throw new Error('JELLY_HOST must be 127.0.0.1 or tailscale');
  const status = JSON.parse(execFileSync('tailscale', ['status', '--json'], { encoding: 'utf8', timeout: 5000 }));
  if (status.BackendState !== 'Running') throw new Error('Tailscale is not connected');
  const host = status.Self?.TailscaleIPs?.find((ip: string) => isTailnetIPv4(ip));
  if (!host) throw new Error('This machine has no Tailscale IPv4 address');
  const dnsName = status.Self?.DNSName?.replace(/\.$/, '');
  return { host, ...(typeof dnsName === 'string' && /^[a-z0-9.-]+$/i.test(dnsName) ? { dnsName } : {}) };
}

export function allowClientUrl(url: URL): boolean {
  if (url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol !== 'http:') return false;
  // Tailnet traffic is encrypted by Tailscale. Accept literal tailnet IPs without requiring TLS.
  // Use an IP rather than trusting arbitrary DNS names that could resolve outside the VPN.
  return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || isTailnetIPv4(url.hostname);
}
