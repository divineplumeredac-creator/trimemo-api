export function publicSandboxEnabled() {
  return process.env.VERCEL_ENV === 'production' && process.env.FEDAPAY_PUBLIC_SANDBOX_ENABLED === 'true';
}
export function sandboxEnabled() {
  return process.env.FEDAPAY_SANDBOX_ENABLED === 'true' &&
    (process.env.VERCEL_ENV === 'preview' || publicSandboxEnabled());
}
