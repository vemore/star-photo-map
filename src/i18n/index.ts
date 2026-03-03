import fr from './fr';
import en from './en';

export type Lang = 'fr' | 'en';

const translations: Record<Lang, typeof fr> = { fr, en };

let currentLang: Lang | null = null;

function detectLang(): Lang {
  // 1. localStorage
  const stored = localStorage.getItem('lang');
  if (stored === 'fr' || stored === 'en') return stored;

  // 2. navigator.languages
  for (const lang of navigator.languages) {
    const code = lang.split('-')[0].toLowerCase();
    if (code === 'fr') return 'fr';
    if (code === 'en') return 'en';
  }

  // 3. fallback
  return 'fr';
}

export function getLang(): Lang {
  if (!currentLang) {
    currentLang = detectLang();
  }
  return currentLang;
}

export function setLang(lang: Lang): void {
  localStorage.setItem('lang', lang);
  location.reload();
}

function getNestedValue(obj: any, path: string): string | undefined {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return typeof current === 'string' ? current : undefined;
}

export function t(key: string, params?: Record<string, string | number>): string {
  const lang = getLang();
  let value = getNestedValue(translations[lang], key);

  if (value === undefined) {
    // Fallback to French
    value = getNestedValue(translations.fr, key);
    if (value === undefined) {
      if (import.meta.env.DEV) {
        console.warn(`[i18n] Missing key: "${key}"`);
      }
      return key;
    }
  }

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }

  return value;
}
