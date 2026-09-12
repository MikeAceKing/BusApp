type WidgetOptions = {
  sitekey: string; size: string; callback: (token: string) => void;
  'error-callback': () => void; 'expired-callback': () => void;
};
type CaptchaProvider = { render(container: HTMLElement, options: WidgetOptions): string | number; execute(id: string | number): void; remove(id: string | number): void };
type CaptchaWindow = Window & { hcaptcha?: CaptchaProvider };
let scriptPromise: Promise<void> | undefined;

function loadProvider() {
  if ((window as CaptchaWindow).hcaptcha) return Promise.resolve();
  if (!scriptPromise) scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://js.hcaptcha.com/1/api.js?render=explicit';
    script.async = true; script.defer = true;
    const fail = () => { clearTimeout(timer); script.remove(); scriptPromise = undefined; reject(new Error('CAPTCHA_UNAVAILABLE')); };
    const timer = setTimeout(fail, 15000);
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = fail;
    document.head.append(script);
  });
  return scriptPromise;
}

// Public configuration only. The provider secret must never enter a browser bundle.
// Disabled by default, so existing anonymous/password flows stay unchanged.
export async function authCaptchaOptions(config = {
  enabled: import.meta.env.VITE_SECURITY_CAPTCHA_ENABLED === 'true',
  siteKey: String(import.meta.env.VITE_SECURITY_CAPTCHA_SITE_KEY || ''),
}): Promise<{ captchaToken?: string }> {
  if (!config.enabled) return {};
  if (!config.siteKey) throw new Error('CAPTCHA_NOT_CONFIGURED');
  await loadProvider();
  const provider = (window as CaptchaWindow).hcaptcha;
  if (!provider) throw new Error('CAPTCHA_UNAVAILABLE');
  return new Promise((resolve, reject) => {
    const container = document.createElement('div');
    container.setAttribute('aria-label', 'CAPTCHA');
    document.body.append(container);
    let widget: string | number | undefined;
    const cleanup = () => { clearTimeout(timeout); if (widget !== undefined) provider.remove(widget); container.remove(); };
    const fail = () => { cleanup(); reject(new Error('CAPTCHA_RETRY_REQUIRED')); };
    const timeout = setTimeout(fail, 120_000);
    try {
      widget = provider.render(container, { sitekey: config.siteKey, size: 'invisible',
        callback: token => { cleanup(); if (!token) reject(new Error('CAPTCHA_RETRY_REQUIRED')); else resolve({ captchaToken: token }); },
        'error-callback': fail, 'expired-callback': fail,
      });
      provider.execute(widget);
    } catch { fail(); }
  });
}
