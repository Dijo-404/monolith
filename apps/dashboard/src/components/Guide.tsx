import type { GuideAction, GuideCommand, GuideStep } from '../app/guide.js';
import { Icon } from './Icon.js';

export interface GuideProps {
  readonly steps: readonly GuideStep[];
  readonly active: number;
  readonly onSelect: (index: number) => void;
  readonly onCommand: (command: GuideCommand) => void;
}

function tone(step: GuideStep): 'good' | 'exposed' | 'wait' | null {
  if (step.result !== null) return step.id === 'leak' && !step.done ? 'exposed' : 'good';
  return step.hint !== null ? 'wait' : null;
}

export function Guide({ steps, active, onSelect, onCommand }: GuideProps) {
  const step = steps[active] ?? steps[0];
  if (step === undefined) return null;
  const next = steps[active + 1];
  const last = active === steps.length - 1;

  // Once a step is done, moving on becomes the main action and repeating it the quiet one.
  const primary: (GuideAction & { next?: boolean }) | null =
    step.done && next !== undefined && step.secondary === null
      ? { command: step.primary?.command ?? 'send-direct', label: `Next: ${next.short}`, disabled: false, next: true }
      : step.primary;
  const secondary: GuideAction | null =
    step.done && next !== undefined && step.secondary === null ? step.primary : step.secondary;

  const statusTone = tone(step);
  const status = step.result ?? step.hint;

  return (
    <section className="guide" aria-labelledby="guide-title">
      <div className="guide__progress" aria-hidden="true">
        {steps.map((item, index) => (
          <span key={item.id} data-state={index === active ? 'current' : item.done ? 'done' : 'todo'} />
        ))}
      </div>
      <p className="guide__count">
        Step {active + 1} of {steps.length}
      </p>
      <h2 id="guide-title" className="guide__title">
        {step.title}
      </h2>
      <p className="guide__body">{step.body}</p>

      <div className="guide__actions">
        {primary !== null && (
          <button
            type="button"
            className="btn btn--primary"
            disabled={primary.disabled}
            onClick={() => (primary.next ? onSelect(active + 1) : onCommand(primary.command))}
          >
            {primary.label}
            <Icon name="arrow-right" />
          </button>
        )}
        {secondary !== null && (
          <button
            type="button"
            className="btn btn--secondary"
            disabled={secondary.disabled}
            onClick={() => onCommand(secondary.command)}
          >
            {secondary.label}
          </button>
        )}
        {last && step.done && (
          <a className="btn btn--secondary" href="#under-the-hood">
            See the details
            <Icon name="arrow-down" />
          </a>
        )}
      </div>

      <p className="guide__status" data-tone={statusTone ?? undefined} aria-live="polite">
        {status !== null && (
          <>
            <Icon name={statusTone === 'good' ? 'check' : statusTone === 'exposed' ? 'alert' : 'clock'} />
            <span>{status}</span>
          </>
        )}
      </p>

      <ol className="steps" aria-label="Demo steps">
        {steps.map((item, index) => (
          <li key={item.id}>
            <button
              type="button"
              className="step"
              aria-current={index === active ? 'step' : undefined}
              data-done={item.done}
              onClick={() => onSelect(index)}
            >
              <span className="step__marker" aria-hidden="true">
                {item.done ? <Icon name="check" size={14} /> : index + 1}
              </span>
              {item.short}
              {item.done && <span className="step__state">Done</span>}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
