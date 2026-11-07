import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon.js';
import { highlight, type Language } from './highlight.js';

/** A titled snippet with a copy action. `source` notes where an excerpt was taken from. */
export function CodeBlock({ code, language = 'ts', title, source }: {
  readonly code: string;
  readonly language?: Language;
  readonly title?: string;
  readonly source?: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return <figure className="code">
    <figcaption className="code__head">
      <span className="code__lang mono">{language === 'sh' ? 'shell' : language}</span>
      {title && <span className="code__title">{title}</span>}
      <button type="button" className="code__copy" onClick={() => void copy()}
        aria-label={copied ? 'Copied' : `Copy ${title ?? 'snippet'}`}>
        <Icon name={copied ? 'check' : 'copy'} size={14} /><span aria-hidden="true">{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </figcaption>
    <pre className="code__body" tabIndex={0}><code>{highlight(code, language).map((token, index) =>
      token.kind === 'plain' ? token.text : <span key={index} className={`tok-${token.kind}`}>{token.text}</span>)}</code></pre>
    {source && <p className="code__source mono">{source}</p>}
  </figure>;
}
