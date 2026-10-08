export function trustedSender(sender, origin) {
  if (!origin || sender.id || !Number.isInteger(sender.tab?.id) || sender.frameId !== 0) return false;
  try {
    const url = new URL(sender.url);
    return url.origin === origin && url.pathname === '/' && !url.username && !url.password;
  } catch { return false; }
}
export function validProjection(p, now = Date.now()) {
  if (!p || Object.keys(p).sort().join(',') !== 'actions,connected,expires,issued,protected,source,total,version') return false;
  return p.version === 1 && ['gmail', 'demo'].includes(p.source) && typeof p.connected === 'boolean'
    && Number.isSafeInteger(p.issued) && p.issued <= now && p.issued > now - 120000
    && Number.isSafeInteger(p.expires) && p.expires > now && p.expires <= p.issued + 120000
    && ['total', 'protected', 'actions'].every(k => Number.isSafeInteger(p[k]) && p[k] >= 0 && p[k] <= 1e9);
}
export function createRelay(storage, origin, random = () => crypto.randomUUID(), secret = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,'0')).join('')) {
  let queue = Promise.resolve();
  const handle = (message, sender) => {
    const work = queue.then(async () => {
      if (!trustedSender(sender, origin)) throw Error('Untrusted relay');
      let { companion } = await storage.get('companion');
      if (message?.kind === 'reset' && Object.keys(message).sort().join(',') === 'id,kind,nonce' && companion && message.id === companion.id && message.nonce === companion.nonce) {
        await storage.remove('companion');
        return {reset:true};
      }
      if (message?.kind === 'hello' && Object.keys(message).length === 1) {
        if (!companion || companion.expires <= Date.now()) {
          companion = { id: random(), nonce: secret(), expires: Date.now() + 120000, paired: false, tab: sender.tab.id };
          await storage.set({ companion });
        }
        return { id: companion.id, nonce: companion.nonce, paired: companion.paired };
      }
      if (message?.kind !== 'summary' || Object.keys(message).sort().join(',') !== 'id,kind,nonce,projection' || !companion || companion.expires <= Date.now()
        || message.id !== companion.id || message.nonce !== companion.nonce || (!companion.paired && companion.tab !== sender.tab.id)
        || !validProjection(message.projection) || (companion.projection && message.projection.issued <= companion.projection.issued)) throw Error('Invalid relay');
      await storage.set({ companion: { ...companion, paired: true, expires: Date.now() + 30*86400000, projection: message.projection } });
      return { received: true };
    });
    queue = work.catch(() => undefined);
    return work;
  };
  handle.forget = () => {
    const work = queue.then(() => storage.remove('companion'));
    queue = work.catch(() => undefined);
    return work;
  };
  return handle;
}
