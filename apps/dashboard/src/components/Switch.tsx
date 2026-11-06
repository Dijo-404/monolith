export function Switch({
  checked,
  onChange,
  labelledBy,
  describedBy,
  tone = 'protected',
}: {
  readonly checked: boolean;
  readonly onChange: (next: boolean) => void;
  readonly labelledBy: string;
  readonly describedBy?: string;
  readonly tone?: 'protected' | 'exposed';
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className={`switch switch--${tone}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch__thumb" aria-hidden="true" />
    </button>
  );
}
