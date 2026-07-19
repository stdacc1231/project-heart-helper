/**
 * Guarded service-worker registration for the Autoscript panel.
 * Never registers inside Lovable preview / dev / iframe / when ?sw=off is present —
 * always cleans up any existing registration in those contexts.
 */
export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  const host = window.location.hostname;
  const inIframe = (() => { try { return window.self !== window.top; } catch { return true; } })();
  const isLovable =
    host.startsWith("id-preview--") ||
    host.startsWith("preview--") ||
    host === "lovableproject.com" || host.endsWith(".lovableproject.com") ||
    host === "lovableproject-dev.com" || host.endsWith(".lovableproject-dev.com") ||
    host === "beta.lovable.dev" || host.endsWith(".beta.lovable.dev");
  const disabled = new URL(window.location.href).searchParams.get("sw") === "off";
  const isProd = import.meta.env.PROD;

  if (!isProd || inIframe || isLovable || disabled) {
    // Best-effort cleanup so stale workers can't keep serving old assets.
    navigator.serviceWorker.getRegistrations?.().then((regs) => {
      regs.forEach((r) => { if (r.active?.scriptURL?.endsWith("/sw.js")) r.unregister(); });
    }).catch(() => null);
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => null);
  });
}
