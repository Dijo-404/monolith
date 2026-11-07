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
  const requests: Array<{ readonly method: string; readonly params?: readonly unknown[] }> = [];
  const provider: Eip1193Provider & { emit(event: string, value: unknown): void; listenerCount(): number } = {
    async request(args) {
      const { method } = args;
      calls.push(method);
      requests.push(args);
      const answer = answers[method];
      if (answer instanceof Error) throw answer;
      if (typeof answer === 'function') return (answer as () => unknown)();
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
  return { provider, calls, requests };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function connectedWallet() {
  const target = new EventTarget();
  const store = createWalletStore(target);
  store.discover();
  const answers: Record<string, unknown> = { eth_requestAccounts: [ADDRESS], eth_chainId: '0x1' };
  const fake = fakeProvider(answers);
  announce(target, fake.provider);
  await store.connect('wallet-1');
  return { store, answers, ...fake };
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
    expect(chainName(1874)).toBe('Whitechain Sepolia');
    expect(chainName(424242)).toBe('Chain 424242');
  });

  it('shortens addresses and explains pending requests', () => {
    expect(shortAddress(ADDRESS)).toBe('0x5290…9EE7');
    expect(describeWalletError(rejected(-32002))).toMatch(/already has a request open/);
  });
});

describe('explicit Whitechain network selection', () => {
  it('does not request a network change without a connected account', async () => {
    const target = new EventTarget();
    const store = createWalletStore(target);
    store.discover();
    const { provider, calls } = fakeProvider({});
    announce(target, provider);
    await store.switchToWhitechain();
    expect(calls).toEqual([]);
  });

  it('switches only on request and verifies the resulting chain ID', async () => {
    const { store, answers, calls, requests } = await connectedWallet();
    expect(calls).toEqual(['eth_requestAccounts', 'eth_chainId']);
    answers['eth_chainId'] = '0x752';
    await store.switchToWhitechain();
    expect(requests.slice(2)).toEqual([
      { method: 'wallet_switchEthereumChain', params: [{ chainId: '0x752' }] },
      { method: 'eth_chainId' },
    ]);
    expect(store.getSnapshot()).toMatchObject({ status: 'connected', chainId: 1874, switchingNetwork: false, error: null });
  });

  it('adds only the fixed official network after 4902, then switches and verifies', async () => {
    const { store, answers, requests } = await connectedWallet();
    let attempts = 0;
    answers['wallet_switchEthereumChain'] = () => {
      if (attempts++ === 0) throw rejected(4902);
      answers['eth_chainId'] = '0x752';
      return null;
    };
    await store.switchToWhitechain();
    expect(requests.slice(2)).toEqual([
      { method: 'wallet_switchEthereumChain', params: [{ chainId: '0x752' }] },
      { method: 'wallet_addEthereumChain', params: [{
        chainId: '0x752', chainName: 'Whitechain Sepolia',
        nativeCurrency: { name: 'WhiteBIT Coin', symbol: 'WBT', decimals: 18 },
        rpcUrls: ['https://rpc.testnet.whitechain.io'],
        blockExplorerUrls: ['https://explorer.testnet.whitechain.io'],
      }] },
      { method: 'wallet_switchEthereumChain', params: [{ chainId: '0x752' }] },
      { method: 'eth_chainId' },
    ]);
    expect(store.getSnapshot()).toMatchObject({ chainId: 1874, error: null });
  });

  it.each([4001, -32002, 4200, 4900])('does not add a network or claim success for switch error %s', async (code) => {
    const { store, answers, calls } = await connectedWallet();
    answers['wallet_switchEthereumChain'] = rejected(code);
    await store.switchToWhitechain();
    expect(calls.slice(2)).toEqual(['wallet_switchEthereumChain']);
    expect(store.getSnapshot()).toMatchObject({ status: 'connected', chainId: 1, switchingNetwork: false });
    expect(store.getSnapshot().error).toBeTruthy();
    if (code === 4001) expect(store.getSnapshot().error).toMatch(/declined/);
  });

  it('stops if adding the missing network is declined', async () => {
    const { store, answers, calls } = await connectedWallet();
    answers['wallet_switchEthereumChain'] = rejected(4902);
    answers['wallet_addEthereumChain'] = rejected(4001);
    await store.switchToWhitechain();
    expect(calls.slice(2)).toEqual(['wallet_switchEthereumChain', 'wallet_addEthereumChain']);
    expect(store.getSnapshot()).toMatchObject({ chainId: 1, switchingNetwork: false });
    expect(store.getSnapshot().error).toMatch(/declined/);
  });

  it.each(['0x1', '1874', null])('does not claim Whitechain when verification returns %s', async (chain) => {
    const { store, answers } = await connectedWallet();
    answers['eth_chainId'] = chain;
    await store.switchToWhitechain();
    expect(store.getSnapshot().chainId).not.toBe(1874);
    expect(store.getSnapshot().error).toMatch(/did not confirm/);
    expect(store.getSnapshot().switchingNetwork).toBe(false);
  });

  it('does not claim success if the chain-ID recheck fails', async () => {
    const { store, answers } = await connectedWallet();
    answers['eth_chainId'] = rejected(4900);
    await store.switchToWhitechain();
    expect(store.getSnapshot()).toMatchObject({ chainId: 1, switchingNetwork: false });
    expect(store.getSnapshot().error).toBeTruthy();
  });

  it('deduplicates a pending switch and ignores its result after disconnect', async () => {
    const { store, answers, calls } = await connectedWallet();
    const pending = deferred<null>();
    answers['wallet_switchEthereumChain'] = () => pending.promise;
    const switching = store.switchToWhitechain();
    expect(store.getSnapshot().switchingNetwork).toBe(true);
    await store.switchToWhitechain();
    await store.disconnect();
    pending.resolve(null);
    await switching;
    expect(calls.slice(2)).toEqual(['wallet_switchEthereumChain', 'wallet_revokePermissions']);
    expect(store.getSnapshot()).toMatchObject({ status: 'idle', chainId: null, switchingNetwork: false, error: null });
  });

  it('does not continue adding a network after the provider disconnects', async () => {
    const { store, answers, provider, calls } = await connectedWallet();
    const pending = deferred<never>();
    answers['wallet_switchEthereumChain'] = () => pending.promise;
    const switching = store.switchToWhitechain();
    provider.emit('disconnect', {});
    pending.reject(rejected(4902));
    await switching;
    expect(calls.slice(2)).toEqual(['wallet_switchEthereumChain']);
    expect(store.getSnapshot()).toMatchObject({ status: 'idle', chainId: null, error: null });
  });

  it('invalidates a pending network action when the account changes', async () => {
    const { store, answers, provider, calls } = await connectedWallet();
    const pending = deferred<null>();
    answers['wallet_switchEthereumChain'] = () => pending.promise;
    const switching = store.switchToWhitechain();
    const nextAccount = '0x0000000000000000000000000000000000000001';
    provider.emit('accountsChanged', [nextAccount]);
    pending.resolve(null);
    await switching;
    expect(calls.slice(2)).toEqual(['wallet_switchEthereumChain']);
    expect(store.getSnapshot()).toMatchObject({ address: nextAccount, chainId: 1, switchingNetwork: false });
  });

  it('keeps a newer chain event instead of a stale chain-ID response', async () => {
    const { store, answers, provider } = await connectedWallet();
    const pending = deferred<string>();
    answers['eth_chainId'] = () => pending.promise;
    const switching = store.switchToWhitechain();
    await vi.waitFor(() => expect(store.getSnapshot().switchingNetwork).toBe(true));
    // Allow the resolved switch request to start the chain-ID recheck.
    await Promise.resolve();
    provider.emit('chainChanged', '0xa');
    pending.resolve('0x752');
    await switching;
    expect(store.getSnapshot()).toMatchObject({ chainId: 10, switchingNetwork: false });
    expect(store.getSnapshot().error).toMatch(/did not confirm/);
  });
});

describe('wallet connection lifecycle', () => {
  it('supports basic providers without optional event subscriptions', async () => {
    const target = new EventTarget();
    const store = createWalletStore(target);
    store.discover();
    let chain = '0x1';
    const calls: string[] = [];
    announce(target, {
      async request({ method }) {
        calls.push(method);
        if (method === 'eth_requestAccounts') return [ADDRESS];
        if (method === 'wallet_switchEthereumChain') chain = '0x752';
        return method === 'eth_chainId' ? chain : null;
      },
    });
    await store.connect('wallet-1');
    await store.switchToWhitechain();
    expect(calls).toEqual(['eth_requestAccounts', 'eth_chainId', 'wallet_switchEthereumChain', 'eth_chainId']);
    expect(store.getSnapshot()).toMatchObject({ status: 'connected', chainId: 1874, switchingNetwork: false });
  });

  it('observes account changes while a connection prompt is still pending', async () => {
    const target = new EventTarget();
    const store = createWalletStore(target);
    store.discover();
    const pending = deferred<string[]>();
    const { provider } = fakeProvider({ eth_requestAccounts: () => pending.promise, eth_chainId: '0x752' });
    announce(target, provider);
    const connecting = store.connect('wallet-1');
    const nextAccount = '0x0000000000000000000000000000000000000001';
    provider.emit('accountsChanged', [nextAccount]);
    pending.resolve([ADDRESS]);
    await connecting;
    expect(store.getSnapshot()).toMatchObject({ status: 'connected', address: nextAccount, chainId: 1874 });
  });

  it('cannot reconnect from an outstanding chain lookup after accounts are revoked', async () => {
    const target = new EventTarget();
    const store = createWalletStore(target);
    store.discover();
    const pending = deferred<string>();
    const { provider, calls } = fakeProvider({ eth_requestAccounts: [ADDRESS], eth_chainId: () => pending.promise });
    announce(target, provider);
    const connecting = store.connect('wallet-1');
    await vi.waitFor(() => expect(calls).toContain('eth_chainId'));
    provider.emit('accountsChanged', []);
    pending.resolve('0x752');
    await connecting;
    expect(store.getSnapshot()).toMatchObject({ status: 'idle', address: null, chainId: null });
    expect(provider.listenerCount()).toBe(0);
  });

  it('keeps the latest chain and account events during the initial chain lookup', async () => {
    const target = new EventTarget();
    const store = createWalletStore(target);
    store.discover();
    const pending = deferred<string>();
    const { provider, calls } = fakeProvider({ eth_requestAccounts: [ADDRESS], eth_chainId: () => pending.promise });
    announce(target, provider);
    const connecting = store.connect('wallet-1');
    await vi.waitFor(() => expect(calls).toContain('eth_chainId'));
    const nextAccount = '0x0000000000000000000000000000000000000001';
    provider.emit('accountsChanged', [nextAccount]);
    provider.emit('chainChanged', '0x752');
    pending.resolve('0x1');
    await connecting;
    expect(store.getSnapshot()).toMatchObject({ status: 'connected', address: nextAccount, chainId: 1874 });
  });

  it('cancels a pending connection when the store is disposed', async () => {
    const target = new EventTarget();
    const store = createWalletStore(target);
    store.discover();
    const pending = deferred<string[]>();
    const { provider, calls } = fakeProvider({ eth_requestAccounts: () => pending.promise, eth_chainId: '0x752' });
    announce(target, provider);
    const connecting = store.connect('wallet-1');
    store.dispose();
    pending.resolve([ADDRESS]);
    await connecting;
    expect(calls).toEqual(['eth_requestAccounts']);
    expect(provider.listenerCount()).toBe(0);
    expect(store.getSnapshot()).toMatchObject({ status: 'idle', address: null, chainId: null });
  });

  it('cancels a pending network change when the store is disposed', async () => {
    const { store, answers, provider, calls } = await connectedWallet();
    const pending = deferred<null>();
    answers['wallet_switchEthereumChain'] = () => pending.promise;
    const switching = store.switchToWhitechain();
    store.dispose();
    pending.resolve(null);
    await switching;
    expect(calls.slice(2)).toEqual(['wallet_switchEthereumChain']);
    expect(provider.listenerCount()).toBe(0);
    expect(store.getSnapshot()).toMatchObject({ status: 'idle', address: null, chainId: null });
  });
});
