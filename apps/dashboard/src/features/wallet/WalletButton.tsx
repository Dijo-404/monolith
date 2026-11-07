import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from '../../components/Icon.js';
import {
  chainName, createWalletStore, shortAddress, WHITECHAIN_SEPOLIA_ID, type DiscoveredWallet, type WalletStore,
} from './wallet-store.js';

let shared: WalletStore | null = null;
/** One store per page, so every header instance shows the same connection. */
function walletStore(): WalletStore {
  shared ??= createWalletStore(window);
  return shared;
}

function WalletGlyph({ wallet, size = 24 }: { readonly wallet: DiscoveredWallet | undefined; readonly size?: number }) {
  if (wallet?.info.icon) {
    return <img className="wallet-glyph" src={wallet.info.icon} width={size} height={size} alt="" />;
  }
  return <span className="wallet-glyph wallet-glyph--fallback" style={{ width: size, height: size }} aria-hidden="true">
    {wallet ? wallet.info.name.slice(0, 1).toUpperCase() : <Icon name="wallet" size={size * 0.7} />}
  </span>;
}

function Disclosure() {
  return <div className="wallet-disclosure">
    <p className="wallet-disclosure__label">What connecting shares</p>
    <ul>
      <li>Your wallet tells this page your address and current network. It stays in this tab.</li>
      <li>Lab reads never use it. They keep the synthetic address and the privacy policy.</li>
      <li>Your wallet’s own RPC traffic is outside Monolith’s protection.</li>
      <li>Switching to Whitechain Sepolia changes only your wallet network. Checkout remains disabled.</li>
    </ul>
  </div>;
}

export function WalletButton() {
  const store = walletStore();
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const dialog = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);
  const titleId = useId();
  const connected = state.status === 'connected' && state.address !== null;
  const active = state.wallets.find((wallet) => wallet.info.uuid === state.walletId);

  useEffect(() => { store.discover(); }, [store]);

  const wasConnected = useRef(connected);
  useEffect(() => {
    // A successful connection completes the picker; return focus to the account button.
    if (connected && !wasConnected.current) dialog.current?.close();
    wasConnected.current = connected;
  }, [connected]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const open = () => {
    store.discover();
    store.clearError();
    dialog.current?.showModal();
  };
  const close = () => dialog.current?.close();
  const copy = async () => {
    if (state.address === null) return;
    try {
      await navigator.clipboard.writeText(state.address);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return <>
    <button type="button" className={`wallet-button${connected ? ' is-connected' : ''}`} onClick={open}
      aria-haspopup="dialog" aria-label={connected && state.address
        ? `Wallet ${active?.info.name ?? ''} connected as ${shortAddress(state.address)} on ${chainName(state.chainId)}. Open account.`
        : 'Connect a browser wallet'}>
      {connected && state.address ? <>
        <WalletGlyph wallet={active} size={20} />
        <span className="wallet-button__address mono">{shortAddress(state.address)}</span>
        <span className="wallet-button__chain">{chainName(state.chainId)}</span>
      </> : <>
        <Icon name="wallet" size={18} />
        <span className="wallet-button__label">{state.status === 'connecting' ? 'Connecting…' : 'Connect wallet'}</span>
      </>}
    </button>

    <dialog ref={dialog} className="wallet-dialog" aria-labelledby={titleId}
      onClick={(event) => { if (event.target === dialog.current) close(); }}>
      <div className="wallet-dialog__panel">
        <header className="wallet-dialog__head">
          <p className="eyebrow">{connected ? 'Account' : 'Wallets in this browser'}</p>
          <h2 id={titleId}>{connected ? active?.info.name ?? 'Connected wallet' : 'Connect a wallet'}</h2>
          <button type="button" className="icon-button" onClick={close}><Icon name="cross" size={18} label="Close" /></button>
        </header>

        {connected && state.address ? <div className="wallet-account">
          <dl className="wallet-account__facts">
            <div><dt>Address</dt><dd className="mono">{state.address}</dd></div>
            <div><dt>Network</dt><dd>{chainName(state.chainId)}{state.chainId !== null && <span className="mono"> · {state.chainId}</span>}</dd></div>
            <div><dt>Provider</dt><dd className="mono">{active?.info.rdns ?? 'Unknown'}</dd></div>
          </dl>
          <div className="wallet-account__actions">
            {state.chainId !== WHITECHAIN_SEPOLIA_ID && <button type="button" className="btn btn--secondary btn--small"
              disabled={state.switchingNetwork} aria-busy={state.switchingNetwork || undefined}
              onClick={() => void store.switchToWhitechain()}>
              {state.switchingNetwork ? 'Switching network…' : 'Switch to Whitechain Sepolia'}
            </button>}
            <button type="button" className="btn btn--secondary btn--small" onClick={() => void copy()}>
              <Icon name={copied ? 'check' : 'copy'} size={16} />{copied ? 'Copied' : 'Copy address'}
            </button>
            <button type="button" className="btn btn--secondary btn--small btn--danger" onClick={() => { void store.disconnect(); close(); }}>
              <Icon name="power" size={16} />Disconnect
            </button>
          </div>
        </div> : <>
          {state.wallets.length > 0 ? <ul className="wallet-list" aria-label="Detected wallets">
            {state.wallets.map((wallet) => {
              const pending = state.status === 'connecting' && state.walletId === wallet.info.uuid;
              return <li key={wallet.info.uuid}>
                <button type="button" className="wallet-option" disabled={state.status === 'connecting'}
                  aria-busy={pending || undefined} onClick={() => void store.connect(wallet.info.uuid)}>
                  <WalletGlyph wallet={wallet} size={32} />
                  <span className="wallet-option__text">
                    <span className="wallet-option__name">{wallet.info.name}</span>
                    <span className="wallet-option__rdns mono">{wallet.info.rdns}</span>
                  </span>
                  <span className="wallet-option__state">{pending ? 'Approve in wallet…' : <Icon name="arrow-right" size={18} />}</span>
                </button>
              </li>;
            })}
          </ul> : <div className="wallet-empty">
            <Icon name="wallet" size={28} />
            <p><strong>No browser wallet found.</strong> Monolith lists wallets that announce themselves through EIP-6963, such as MetaMask, Rabby, Coinbase Wallet or Phantom. Install or unlock one, then reload this page.</p>
          </div>}
        </>}
        {state.error && <p className="wallet-error" role="alert"><Icon name="alert" size={16} />{state.error}</p>}
        <Disclosure />
      </div>
    </dialog>
  </>;
}
