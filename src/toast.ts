type ToastType = 'info' | 'error' | 'undo';

interface ToastOptions {
  message: string;
  type?: ToastType;
  duration?: number;
  actionLabel?: string;
  onAction?: () => void;
  onExpire?: () => void;
}

let container: HTMLDivElement | null = null;

function ensureContainer(): HTMLDivElement {
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(opts: ToastOptions): () => void {
  const el = document.createElement('div');
  el.className = `toast toast-${opts.type || 'info'}`;

  const msgSpan = document.createElement('span');
  msgSpan.textContent = opts.message;
  el.appendChild(msgSpan);

  if (opts.actionLabel && opts.onAction) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = opts.actionLabel;
    btn.addEventListener('click', () => {
      opts.onAction!();
      dismiss();
    });
    el.appendChild(btn);
  }

  const parent = ensureContainer();
  parent.appendChild(el);

  const duration = opts.duration ?? 4000;
  let expired = false;

  const timer = setTimeout(() => {
    expired = true;
    opts.onExpire?.();
    dismiss();
  }, duration);

  function dismiss() {
    clearTimeout(timer);
    el.classList.add('toast-fade-out');
    el.addEventListener('animationend', () => el.remove());
  }

  return () => {
    if (!expired) {
      clearTimeout(timer);
      dismiss();
    }
  };
}
