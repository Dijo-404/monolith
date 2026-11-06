import { canRunRead } from './lab-reducer.js';
import type { LabAction, LabState } from './lab-model.js';

/** A user action in the guided demo; LabApp turns it into reducer actions with a timestamp. */
export type GuideCommand = 'send-direct' | 'send-private' | 'inject-leak' | 'fix-leak' | 'go-offline' | 'bring-online';

export interface GuideAction {
  readonly command: GuideCommand;
  readonly label: string;
  readonly disabled: boolean;
}

export interface GuideStep {
  readonly id: 'baseline' | 'protect' | 'leak' | 'outage';
  readonly title: string;
  readonly short: string;
  readonly body: string;
  readonly done: boolean;
  /** One line describing what happened, once something has. */
  readonly result: string | null;
  readonly primary: GuideAction | null;
  readonly secondary: GuideAction | null;
  /** Why the primary action is waiting, when it is. */
  readonly hint: string | null;
}

function waitingHint(state: LabState): string | null {
  if (state.worker.state === 'BOOTSTRAPPING') return `Starting the worker: ${state.worker.hopsReady} of 3 relays ready…`;
  if (state.reads.some((read) => read.outcome === 'in-flight' && read.kind !== 'leak')) return 'A read is on its way…';
  return null;
}

export function guideSteps(state: LabState): GuideStep[] {
  const { milestones: m, worker, leakInjected } = state;
  const busy = !canRunRead({ ...state, privateMode: true });
  const offline = worker.state === 'BLOCKED' || worker.state === 'CLOSED';
  const lastBlocked = state.reads.at(-1)?.errorCode === 'WORKER_UNAVAILABLE';

  return [
    {
      id: 'baseline',
      short: 'See what the endpoint learns',
      title: 'See what an RPC endpoint learns.',
      body: 'Most wallets send balance reads straight to an RPC provider. Send one the same way and look at what arrives.',
      done: m.baseline,
      result: m.baseline ? 'The endpoint saw your network origin, the method and the address you asked about.' : null,
      primary: { command: 'send-direct', label: m.baseline ? 'Send it again' : 'Send a direct read', disabled: false },
      secondary: null,
      hint: null,
    },
    {
      id: 'protect',
      short: 'Hide where it comes from',
      title: 'Hide where your reads come from.',
      body: 'Send the same read through the Anon-RPC worker. Monolith checks the endpoint it picked from the Arkiv registry, then routes the read across three relays.',
      done: m.protectedRead,
      result: m.protectedRead
        ? 'The endpoint saw an exit relay, not you. It can still read the method and address: Anon-RPC hides the route, not the request.'
        : null,
      primary: {
        command: 'send-private',
        label: m.protectedRead ? 'Send it again' : 'Send a private read',
        disabled: busy || offline,
      },
      secondary: null,
      hint: offline ? 'The anonymity network is offline. Bring it back in step 4.' : busy ? waitingHint(state) : null,
    },
    {
      id: 'leak',
      short: 'Catch a leak',
      title: 'Catch a leak before it ships.',
      body: 'Add a checkout widget that calls the RPC directly and skips Monolith. The privacy check fails and names the exact line.',
      done: m.leakFixed,
      result: m.leakFixed
        ? 'Fixed. The rerun sent every read through the transport, and the check passes again.'
        : m.leakCaught
          ? 'Caught: payments/status.ts:27 called eth_getTransactionReceipt directly. The privacy check fails.'
          : null,
      primary: m.leakCaught && leakInjected
        ? { command: 'fix-leak', label: 'Remove it and run again', disabled: busy || offline }
        : { command: 'inject-leak', label: m.leakCaught ? 'Inject it again' : 'Inject a leak', disabled: false },
      secondary: null,
      hint: m.leakCaught && leakInjected && (busy || offline) ? waitingHint(state) : null,
    },
    {
      id: 'outage',
      short: 'Fail closed',
      title: 'Keep private reads blocked during an outage.',
      body: 'Take the anonymity network offline and send a private read. Monolith blocks managed reads instead of sending them direct. A widget that skips Monolith still needs its own fix.',
      done: m.failedClosed,
      result: m.failedClosed
        ? leakInjected
          ? 'The managed read was blocked. The injected widget still sends directly; remove it in step 3.'
          : 'The managed read was blocked before send. No direct fallback was attempted.'
        : null,
      primary: offline
        ? { command: 'send-private', label: lastBlocked ? 'Try again' : 'Send a private read', disabled: false }
        : { command: 'go-offline', label: 'Take the network offline', disabled: worker.state === 'BOOTSTRAPPING' },
      secondary: offline && m.failedClosed ? { command: 'bring-online', label: 'Bring it back online', disabled: false } : null,
      hint: worker.state === 'BOOTSTRAPPING' ? waitingHint(state) : null,
    },
  ];
}

/** Reducer actions for a guide command. Time is passed in so the reducer stays pure. */
export function commandActions(command: GuideCommand, now: number): LabAction[] {
  switch (command) {
    case 'send-direct':
      return [{ type: 'confirm-direct', now }];
    case 'send-private':
      return [{ type: 'set-private-mode', on: true }, { type: 'run-read', now }];
    case 'inject-leak':
      return [{ type: 'set-leak', on: true, now }];
    case 'fix-leak':
      return [{ type: 'set-leak', on: false, now }, { type: 'new-run' }, { type: 'set-private-mode', on: true }, { type: 'run-read', now }];
    case 'go-offline':
      return [{ type: 'simulate-outage' }];
    case 'bring-online':
      return [{ type: 'retry-worker' }];
  }
}
