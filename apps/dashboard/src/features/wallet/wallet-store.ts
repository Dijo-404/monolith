/*
 * Browser-wallet discovery and connection through EIP-6963 announcements and EIP-1193 requests.
 *
 * Boundaries this module keeps:
 * - It reads only wallet connection metadata: accounts and current chain ID. An explicit network
 *   action may switch/add the fixed Whitechain Sepolia network, then recheck its chain ID.
 * - The connected address stays in memory. It is never handed to the lab, which reads a synthetic
 *   address through the privacy policy.
 * - Wallet icons render only from inline `data:image/*` URIs, so showing a picker contacts nobody.
 * - Nothing connects automatically; a reload starts disconnected.
 */

export interface Eip1193Provider {
  request(args: { readonly method: string; readonly params?: readonly unknown[] }): Promise<unknown>;
  on?(event: string, listener: (value: unknown) => void): unknown;
  removeListener?(event: string, listener: (value: unknown) => void): unknown;
}

export interface WalletInfo {
  readonly uuid: string;
  readonly name: string;
  /** A validated inline image, or null when the wallet supplied an unsafe or missing icon. */
  readonly icon: string | null;
  readonly rdns: string;
}

export interface DiscoveredWallet {
  readonly info: WalletInfo;
  readonly provider: Eip1193Provider;
}

export type WalletStatus = 'idle' | 'connecting' | 'connected';

export interface WalletSnapshot {
  readonly wallets: readonly DiscoveredWallet[];
  readonly status: WalletStatus;
  /** uuid of the wallet being connected or connected. */
  readonly walletId: string | null;
  readonly address: string | null;
  readonly chainId: number | null;
  readonly switchingNetwork: boolean;
  readonly error: string | null;
}

/** Fixed official testnet metadata; never populated from a wallet announcement or user URL. */
export const WHITECHAIN_SEPOLIA = {
  chainId: '0x752',
  chainName: 'Whitechain Sepolia',
  nativeCurrency: { name: 'WhiteBIT Coin', symbol: 'WBT', decimals: 18 },
  rpcUrls: ['https://rpc.testnet.whitechain.io'],
  blockExplorerUrls: ['https://explorer.testnet.whitechain.io'],
} as const;
export const WHITECHAIN_SEPOLIA_ID = 1874;

const ANNOUNCE = 'eip6963:announceProvider';
const REQUEST = 'eip6963:requestProvider';
const ICON = /^data:image\/(?:svg\+xml|png|webp|jpeg|gif)[;,]/i;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const MAX_ICON_LENGTH = 256 * 1024;

export function safeIcon(icon: unknown): string | null {
  return typeof icon === 'string' && icon.length <= MAX_ICON_LENGTH && ICON.test(icon) ? icon : null;
}

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max ? value.trim() : null;
}

/** Accepts only the documented announcement shape; anything else is ignored. */
export function parseAnnouncement(detail: unknown): DiscoveredWallet | null {
  if (typeof detail !== 'object' || detail === null) return null;
  const { info, provider } = detail as { info?: unknown; provider?: unknown };
  if (typeof info !== 'object' || info === null) return null;
  if (typeof provider !== 'object' || provider === null
    || typeof (provider as { request?: unknown }).request !== 'function') return null;
  const raw = info as Record<string, unknown>;
  const uuid = text(raw['uuid'], 128);
  const name = text(raw['name'], 80);
  const rdns = text(raw['rdns'], 255);
  if (uuid === null || name === null || rdns === null) return null;
  return { info: { uuid, name, rdns, icon: safeIcon(raw['icon']) }, provider: provider as Eip1193Provider };
}

export function parseChainId(value: unknown): number | null {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,16}$/.test(value)) return null;
  const parsed = Number.parseInt(value, 16);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseAccounts(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && ADDRESS.test(item)) : [];
}

/** Maps EIP-1193 provider errors to sentences a person can act on. */
export function describeWalletError(error: unknown): string {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (code === 4001) return 'The request was declined in your wallet.';
  if (code === -32002) return 'Your wallet already has a request open. Finish or dismiss it there.';
  if (code === 4100) return 'The wallet has not authorised this page. Unlock it and try again.';
  if (code === 4900 || code === 4901) return 'The wallet is not connected to a network.';
  return 'The wallet did not connect. Check it is unlocked, then try again.';
}

const CHAIN_NAMES: Readonly<Record<number, string>> = {
  1: 'Ethereum',
  10: 'OP Mainnet',
  56: 'BNB Smart Chain',
  137: 'Polygon',
  [WHITECHAIN_SEPOLIA_ID]: WHITECHAIN_SEPOLIA.chainName,
  8453: 'Base',
  42161: 'Arbitrum One',
  84532: 'Base Sepolia',
  11155111: 'Sepolia',
  11155420: 'OP Sepolia',
};

export function chainName(chainId: number | null): string {
  if (chainId === null) return 'Unknown network';
  return CHAIN_NAMES[chainId] ?? `Chain ${chainId}`;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

const IDLE: Omit<WalletSnapshot, 'wallets'> = {
  status: 'idle', walletId: null, address: null, chainId: null, switchingNetwork: false, error: null,
};

function networkError(error: unknown): string {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (code === 4001) return 'The network request was declined in your wallet.';
  if (code === -32002) return 'Your wallet already has a request open. Finish or dismiss it there.';
  if (code === 4200) return 'This wallet cannot change networks here. Select Whitechain Sepolia in your wallet.';
  return 'The wallet could not switch to Whitechain Sepolia. Check your wallet and try again.';
}

export interface WalletStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): WalletSnapshot;
  /** Starts listening for announcements and asks installed wallets to announce. Idempotent. */
  discover(): void;
  connect(uuid: string): Promise<void>;
  /** Explicit user action only. Never signs, submits payments or reads balances. */
  switchToWhitechain(): Promise<void>;
  disconnect(): Promise<void>;
  clearError(): void;
  dispose(): void;
}

export function createWalletStore(target: EventTarget): WalletStore {
  let snapshot: WalletSnapshot = { wallets: [], ...IDLE };
  const listeners = new Set<() => void>();
  let listening = false;
  let attempt = 0;
  let networkAttempt = 0;
  let accountRevision = 0;
  let chainRevision = 0;
  let detach: (() => void) | null = null;

  const set = (next: Partial<WalletSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener();
  };

  const onAnnounce = (event: Event) => {
    const wallet = parseAnnouncement((event as CustomEvent<unknown>).detail);
    if (wallet === null) return;
    // EIP-6963: a uuid identifies one announcement; keep the first provider object we saw.
    if (snapshot.wallets.some((known) => known.info.uuid === wallet.info.uuid)) return;
    set({ wallets: [...snapshot.wallets, wallet] });
  };

  const release = () => {
    detach?.();
    detach = null;
  };

  const reset = () => {
    attempt += 1;
    networkAttempt += 1;
    release();
    set(IDLE);
  };

  const watch = (wallet: DiscoveredWallet, ticket: number) => {
    const { provider } = wallet;
    const onAccounts = (accounts: unknown) => {
      if (ticket !== attempt || snapshot.walletId !== wallet.info.uuid) return;
      accountRevision += 1;
      const [address] = parseAccounts(accounts);
      if (address === undefined) {
        reset();
      } else {
        // A pending network result belongs to the previously selected account.
        networkAttempt += 1;
        set({ address, switchingNetwork: false, error: null });
      }
    };
    const onChain = (chainId: unknown) => {
      if (ticket !== attempt || snapshot.walletId !== wallet.info.uuid) return;
      chainRevision += 1;
      set({ chainId: parseChainId(chainId), error: null });
    };
    const onDisconnect = () => {
      if (ticket === attempt && snapshot.walletId === wallet.info.uuid) reset();
    };
    provider.on?.('accountsChanged', onAccounts);
    provider.on?.('chainChanged', onChain);
    provider.on?.('disconnect', onDisconnect);
    detach = () => {
      provider.removeListener?.('accountsChanged', onAccounts);
      provider.removeListener?.('chainChanged', onChain);
      provider.removeListener?.('disconnect', onDisconnect);
    };
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    discover() {
      if (!listening) {
        target.addEventListener(ANNOUNCE, onAnnounce);
        listening = true;
      }
      target.dispatchEvent(new Event(REQUEST));
    },
    async connect(uuid) {
      const wallet = snapshot.wallets.find((item) => item.info.uuid === uuid);
      if (wallet === undefined || snapshot.status === 'connecting') return;
      const ticket = ++attempt;
      networkAttempt += 1;
      release();
      set({ ...IDLE, status: 'connecting', walletId: uuid });
      try {
        watch(wallet, ticket);
        const accountAtRequest = accountRevision;
        const accounts = await wallet.provider.request({ method: 'eth_requestAccounts' });
        if (ticket !== attempt) return;
        const address = accountAtRequest === accountRevision ? parseAccounts(accounts)[0] : snapshot.address;
        if (!address) {
          release();
          set({ ...IDLE, error: 'The wallet returned no account.' });
          return;
        }
        set({ address });
        let chainId: number | null = null;
        const chainAtRequest = chainRevision;
        try {
          chainId = parseChainId(await wallet.provider.request({ method: 'eth_chainId' }));
        } catch {
          // The account is connected; an unknown network is shown as such.
        }
        if (ticket !== attempt) return;
        if (chainAtRequest !== chainRevision) chainId = snapshot.chainId;
        set({ status: 'connected', chainId, error: null });
      } catch (error) {
        if (ticket === attempt) {
          release();
          set({ ...IDLE, error: describeWalletError(error) });
        }
      }
    },
    async switchToWhitechain() {
      if (snapshot.status !== 'connected' || snapshot.switchingNetwork) return;
      const wallet = snapshot.wallets.find((item) => item.info.uuid === snapshot.walletId);
      if (wallet === undefined) return;
      const connection = attempt;
      const ticket = ++networkAttempt;
      const current = () => connection === attempt && ticket === networkAttempt && snapshot.status === 'connected';
      set({ switchingNetwork: true, error: null });
      try {
        try {
          await wallet.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: WHITECHAIN_SEPOLIA.chainId }] });
        } catch (error) {
          if (!current()) return;
          const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
          if (code !== 4902) throw error;
          await wallet.provider.request({ method: 'wallet_addEthereumChain', params: [WHITECHAIN_SEPOLIA] });
          if (!current()) return;
          await wallet.provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: WHITECHAIN_SEPOLIA.chainId }] });
        }
        if (!current()) return;
        const chainAtRequest = chainRevision;
        const result = await wallet.provider.request({ method: 'eth_chainId' });
        if (!current()) return;
        // A later chainChanged event supersedes a response captured on the previous network.
        const chainId = chainAtRequest === chainRevision ? parseChainId(result) : snapshot.chainId;
        set({
          switchingNetwork: false,
          chainId,
          error: chainId === WHITECHAIN_SEPOLIA_ID ? null : 'The wallet did not confirm Whitechain Sepolia. Select it in your wallet and try again.',
        });
      } catch (error) {
        if (current()) set({ switchingNetwork: false, error: networkError(error) });
      }
    },
    async disconnect() {
      const wallet = snapshot.wallets.find((item) => item.info.uuid === snapshot.walletId);
      reset();
      // Best effort: wallets that support EIP-2255 forget this page; the rest keep their own grant.
      try {
        await wallet?.provider.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] });
      } catch {
        // Local disconnection already happened.
      }
    },
    clearError() {
      if (snapshot.error !== null) set({ error: null });
    },
    dispose() {
      attempt += 1;
      networkAttempt += 1;
      release();
      if (listening) target.removeEventListener(ANNOUNCE, onAnnounce);
      listening = false;
      listeners.clear();
      snapshot = { wallets: [], ...IDLE };
    },
  };
}
