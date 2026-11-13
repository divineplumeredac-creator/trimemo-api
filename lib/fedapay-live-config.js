export function publicLiveEnabled() { return process.env.VERCEL_ENV === 'production' && process.env.FEDAPAY_ENV === 'live'; }
export function liveEnabled() { return publicLiveEnabled(); }
