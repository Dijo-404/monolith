import { describe, expect, it, vi } from 'vitest';
import {
  chainName, createWalletStore, describeWalletError, parseAnnouncement, parseChainId, safeIcon, shortAddress,
  type Eip1193Provider,
} from '../src/features/wallet/wallet-store.js';

const ADDRESS = '0x52908400098527886E0F7030069857D2E4169EE7';
const SVG = 'data:image/svg+xml;base64,PHN2Zy8+';

type Listener = (value: unknown) => void;
const noop = (): undefined => undefined;

function fakeProvider(answers: Record<string, unknown | Error>) {
  const listeners = new Map<string, Set<Listener>>();
  const calls: string[] = [];
  const provider: Eip1193Provider & { emit(event: string, value: unknown): void; listenerCount(): number } = {
    async request({ method }) {
      calls.push(method);
      const answer = answers[method];
      if (answer instanceof Error) throw answer;
      return answer;
    },
    on(event: string, listener: Listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    },
    removeListener(event: string, listener: Listener) {
      listeners.get(event)?.delete(listener);
    },
    emit(event, value) {
      for (const listener of listeners.get(event) ?? []) listener(value);
    },
    listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
  return { provider, calls };
}

function announce(target: EventTarget, provider: Eip1193Provider, info: Record<string, unknown> = {}) {
  target.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
    detail: { info: { uuid: 'wallet-1', name: 'Test Wallet', rdns: 'example.wallet', icon: SVG, ...info }, provider },
  }));
}

function rejected(code: number) {
  return Object.assign(new Error('rejected'), { code });
}

describe('EIP-6963 announcements', () => {
  it('accepts the documented shape and keeps an inline icon', () => {
    const { provider } = fakeProvider({});
    const wallet = parseAnnouncement({ info: { uuid: 'a', name: 'A', rdns: 'a.example', icon: SVG }, provider });
    expect(wallet?.info).toEqual({ uuid: 'a', name: 'A', rdns: 'a.example', icon: SVG });
  });

  it('drops remote or scripted icons so rendering the picker contacts nobody', () => {
    expect(safeIcon('https://tracker.example/icon.png')).toBeNull();
    expect(safeIcon('//tracker.example/icon.png')).toBeNull();
    expect(safeIcon('data:text/html;base64,PHNjcmlwdD4=')).toBeNull();
    expect(safeIcon(SVG)).toBe(SVG);
  });

  it.each([
    null,
    { info: { uuid: 'a', name: 'A', rdns: 'a' } },
    { info: { uuid: 'a', name: 'A', rdns: 'a' }, provider: {} },
    { info: { uuid: '', name: 'A', rdns: 'a' }, provider: { request: noop } },
    { info: { name: 'A', rdns: 'a' }, provider: { request: noop } },
  ])('ignores malformed announcement %#', (detail) => {
    expect(parseAnnouncement(detail)).toBeNull();
  });

  it('asks installed wallets to announce and lists each uuid once', () => {
    const target = new EventTarget();
    const requested = vi.fn();
    target.addEventListener('eip6963:requestProvider', requested);
    const store = createWalletStore(target);
    store.discover();
    const { provider } = fakeProvider({});
    announce(target, provider);
    announce(target, provider);
    announce(target, provider, { uuid: 'wallet-2', name: 'Second' });
    expect(requested).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().wallets.map((wallet) => wallet.info.name)).toEqual(['Test Wallet', 'Second']);
  });
});

describe('wallet connection', () => {
  it('does nothing until a person chooses a wallet', () => {
    const target = new EventTarget();
    const store = createWalletStore(target);
    store.discover();
    const { provider, calls } = fakeProvider({ eth_requestAccounts: [ADDRESS], eth_chainId: '0xa' });
    announce(target, provider);
    expect(calls).toEqual([]);
    expect(store.getSnapshot().status).toBe('idle');
  });

  it('connects with only account and chain-ID requests', async () => {
    const target = new EventTarget();
    const store = createWalletStore(target);
    store.discover();
    const { provider, calls } = fakeProvider({ eth_requestAccounts: [ADDRESS], eth_chainId: '0xa' });
    announce(target, provider);
    await store.connect('wallet-1');
    expect(calls).toEqual(['eth_requestAccounts', 'eth_chainId']);
    expect(store.getSnapshot()).toMatchObject({ status: 'connected', address: ADDRESS, chainId: 10, error: null });
  });

  it('reports a declined request and stays disconnected', async () => {
    const target = new EventTarget();
    const store = createWalletStore(target);
    store.discover();
    const { provider } = fakeProvider({ eth_requestAccounts: rejected(4001) });
    announce(target, provider);
    await store.connect('wallet-1');
    expect(store.getSnapshot()).toMatchObject({
      status: 'idle', address: null, error: 'The request was declined in your wallet.',
    });
  });

  it('keeps the account when the wallet cannot name its chain', async () => {
    const target = new EventTarget();
    const store = createWalletStore(target);
    store.discover();
    const { provider } = fakeProvider({ eth_requestAccounts: [ADDRESS], eth_chainId: rejected(4900) });
    announce(target, provider);
    await store.connect('wallet-1');
    expect(store.getSnapshot()).toMatchObject({ status: 'connected', chainId: null });
    expect(chainName(null)).toBe('Unknown network');
  });

  it('follows account and chain changes, and disconnects when accounts are revoked', async () => {
    const target = new EventTarget();
    const store = createWalletStore(target);
    store.discover();
    const { provider } = fakeProvider({ eth_requestAccounts: [ADDRESS], eth_chainId: '0x1' });
    announce(target, provider);
    await store.connect('wallet-1');
    provider.emit('chainChanged', '0x2105');
    expect(store.getSnapshot().chainId).toBe(8453);
    provider.emit('accountsChanged', []);
    expect(store.getSnapshot()).toMatchObject({ status: 'idle', address: null });
    expect(provider.listenerCount()).toBe(0);
  });

  it('disconnects locally even when the wallet cannot revoke permissions', async () => {
    const target = new EventTarget();
    const store = createWalletStore(target);
    store.discover();
    const { provider, calls } = fakeProvider({
      eth_requestAccounts: [ADDRESS], eth_chainId: '0x1', wallet_revokePermissions: rejected(4200),
    });
    announce(target, provider);
    await store.connect('wallet-1');
    await store.disconnect();
    expect(calls.at(-1)).toBe('wallet_revokePermissions');
    expect(store.getSnapshot()).toMatchObject({ status: 'idle', address: null, walletId: null });
    expect(provider.listenerCount()).toBe(0);
  });

  it('rejects malformed accounts', async () => {
    const target = new EventTarget();
    const store = createWalletStore(target);
    store.discover();
    const { provider } = fakeProvider({ eth_requestAccounts: ['not-an-address'] });
    announce(target, provider);
    await store.connect('wallet-1');
    expect(store.getSnapshot()).toMatchObject({ status: 'idle', error: 'The wallet returned no account.' });
  });
});

describe('wallet formatting', () => {
  it('parses only positive hexadecimal chain IDs', () => {
    expect(parseChainId('0xa')).toBe(10);
    expect(parseChainId('10')).toBeNull();
    expect(parseChainId('0x0')).toBeNull();
    expect(parseChainId(10)).toBeNull();
  });

  it('names known chains and falls back to the number', () => {
    expect(chainName(1)).toBe('Ethereum');
    expect(chainName(424242)).toBe('Chain 424242');
  });

  it('shortens addresses and explains pending requests', () => {
    expect(shortAddress(ADDRESS)).toBe('0x5290…9EE7');
    expect(describeWalletError(rejected(-32002))).toMatch(/already has a request open/);
  });
});
