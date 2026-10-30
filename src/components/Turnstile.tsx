import { useEffect, useRef } from 'react';

/**
 * Cloudflare Turnstile widget.
 *
 * The widget only requests a token in the browser. The token is posted to our
 * own API, where Siteverify validates it with the server-only secret. Rendering
 * is explicit so the widget can be reset after a failed or expired challenge.
 */

interface TurnstileRenderOptions {
  sitekey: string;
  action: string;
  theme?: 'light' | 'dark' | 'auto';
  size?: 'normal' | 'compact' | 'flexible';
  callback: (token: string) => void;
  'expired-callback': () => void;
  'error-callback': (code: string) => void;
}

interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_ID = 'cf-turnstile-script';
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptPromise: Promise<void> | null = null;

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Turnstile script failed to load')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener(
      'error',
      () => {
        script.remove();
        scriptPromise = null;
        reject(new Error('Turnstile script failed to load'));
      },
      { once: true },
    );
    document.head.appendChild(script);
  });

  return scriptPromise;
}

export interface TurnstileWidgetProps {
  siteKey: string;
  action: 'login' | 'register' | 'forgot-password';
  onToken: (token: string | null) => void;
  onError?: (message: string) => void;
  /** Increment to discard the current token and request a fresh challenge. */
  resetKey?: number;
  className?: string;
}

export function TurnstileWidget({
  siteKey,
  action,
  onToken,
  onError,
  resetKey = 0,
  className,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const callbacks = useRef({ onToken, onError });

  callbacks.current = { onToken, onError };

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    void loadTurnstileScript()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        const turnstile = window.turnstile;
        if (!turnstile) {
          callbacks.current.onToken(null);
          callbacks.current.onError?.('The bot check could not be loaded. Please retry.');
          return;
        }
        // The explicit-render API is ready once the script's load event fires.
        // Calling `ready()` here triggers Cloudflare's pre-load warning and can
        // leave the widget unrendered, so render directly.
        widgetId.current = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action,
          theme: 'dark',
          size: 'flexible',
          callback: (token) => callbacks.current.onToken(token),
          'expired-callback': () => callbacks.current.onToken(null),
          'error-callback': () => {
            callbacks.current.onToken(null);
            callbacks.current.onError?.('The bot check could not be loaded. Please retry.');
          },
        });
      })
      .catch(() => {
        callbacks.current.onToken(null);
        callbacks.current.onError?.('The bot check could not be loaded. Check your connection and retry.');
      });

    return () => {
      cancelled = true;
      callbacks.current.onToken(null);
      if (widgetId.current && window.turnstile) {
        window.turnstile.remove(widgetId.current);
      }
      widgetId.current = null;
    };
  }, [siteKey, action]);

  useEffect(() => {
    if (!widgetId.current || !window.turnstile) return;
    callbacks.current.onToken(null);
    window.turnstile.reset(widgetId.current);
  }, [resetKey]);

  return <div ref={containerRef} className={className} data-turnstile-action={action} />;
}
