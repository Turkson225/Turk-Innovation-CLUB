// Public offline shell plus per-account Web Push. Nothing private is cached.
(() => {
  const scriptUrl = document.currentScript?.src;
  if (!scriptUrl) return;
  const workerUrl = new URL('sw.js', scriptUrl);
  const ownerStorageKey = 'innovatex.push.owner';
  let currentUserId = '';
  let activeSubscription = false;
  let lastReason = '';

  const installed = () => window.matchMedia?.('(display-mode: standalone)').matches === true || navigator.standalone === true;
  const capabilityReason = () => {
    if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
      return 'This browser does not support web push notifications.';
    if (/iPad|iPhone|iPod/i.test(navigator.userAgent) && !installed())
      return 'On iPhone, add InnovateX to your Home Screen and open it from the app icon first.';
    return '';
  };
  const permission = () => 'Notification' in window ? Notification.permission : 'unsupported';
  const state = () => ({
    supported: !capabilityReason(),
    permission: permission(),
    subscribed: activeSubscription,
    installed: installed(),
    reason: capabilityReason() || lastReason
  });
  const announce = () => window.dispatchEvent(new CustomEvent('innovatexpushstatechange', { detail: state() }));
  const readOwner = () => { try { return localStorage.getItem(ownerStorageKey) || ''; } catch { return ''; } };
  const saveOwner = userId => { try { if (userId) localStorage.setItem(ownerStorageKey, userId); else localStorage.removeItem(ownerStorageKey); } catch {} };

  const pushUrl = () => {
    const base = window.INNOVATEX_CONFIG?.supabaseUrl;
    if (!base || !/^https:\/\/[^/]+\.supabase\.co\/?$/.test(base)) throw new Error('Supabase is not configured for club notifications.');
    return `${base.replace(/\/$/, '')}/functions/v1/send-push-notifications`;
  };
  const vapidBytes = encoded => {
    if (!/^[A-Za-z0-9_-]{86,88}$/.test(encoded)) throw new Error('The club push key is invalid. Ask an administrator to check the setup.');
    const padded = (encoded.replace(/-/g, '+').replace(/_/g, '/') + '===').slice(0, Math.ceil(encoded.length / 4) * 4);
    const bytes = Uint8Array.from(atob(padded), char => char.charCodeAt(0));
    if (bytes.length !== 65 || bytes[0] !== 4) throw new Error('The club push key is invalid. Ask an administrator to check the setup.');
    return bytes;
  };
  async function publicKey() {
    const endpoint = pushUrl();
    let response;
    try { response = await fetch(endpoint, { method: 'GET', cache: 'no-store' }); }
    catch { throw new Error('Could not reach the club notification service. Check your connection and try again.'); }
    if (response.status === 404)
      throw new Error('Device alerts are not set up yet. A club administrator needs to deploy the notification function in Supabase. Your in-app inbox still works.');
    if (response.status === 401 || response.status === 403)
      throw new Error('Device alerts are blocked by the club notification settings. An administrator needs to check the Edge Function access settings.');
    if (!response.ok) throw new Error('The club notification service is temporarily unavailable. Please try again later.');
    let data;
    try { data = await response.json(); }
    catch { throw new Error('The club notification service returned an invalid setup response. Ask an administrator to check the function.'); }
    if (!data?.vapid_public_key) throw new Error('A club administrator still needs to add the device notification keys in Supabase.');
    return vapidBytes(data.vapid_public_key);
  }
  const registration = create => !('serviceWorker' in navigator) ? Promise.resolve(null)
    : create ? navigator.serviceWorker.register(workerUrl.href) : navigator.serviceWorker.getRegistration(workerUrl.href);
  async function syncRow(userId, db, subscription) {
    const record = subscription.toJSON();
    if (!record.endpoint || !record.keys?.p256dh || !record.keys?.auth) throw new Error('The browser did not provide a usable push subscription.');
    const { error } = await db.from('push_subscriptions').upsert({
      user_id: userId, endpoint: record.endpoint, p256dh: record.keys.p256dh, auth: record.keys.auth
    }, { onConflict: 'endpoint' });
    if (error) throw error;
  }
  async function clearBadge() {
    try { if (typeof navigator.clearAppBadge === 'function') await navigator.clearAppBadge(); }
    catch (error) { console.debug('App badge unavailable', error); }
  }
  async function updateBadge(count) {
    if (!currentUserId) return clearBadge();
    try {
      const unread = Math.max(0, Math.min(99, Number(count) || 0));
      if (!unread) await clearBadge();
      else if (typeof navigator.setAppBadge === 'function') await navigator.setAppBadge(unread);
    } catch (error) { console.debug('App badge unavailable', error); }
  }
  async function unsubscribe(userId, db) {
    const reg = await registration();
    const subscription = await reg?.pushManager?.getSubscription();
    // Retire the device endpoint even when the network is unavailable. The
    // backend also prunes expired endpoints if server deletion cannot finish.
    let deviceError = null;
    if (subscription) {
      try { if (!await subscription.unsubscribe()) deviceError = new Error('Browser could not retire the push endpoint'); }
      catch (error) { deviceError = error; }
    }
    saveOwner('');
    activeSubscription = !!deviceError;
    await clearBadge();
    let deleteError = null;
    if (subscription && userId && db) {
      let timer;
      try {
        const operation = db.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', subscription.endpoint);
        const result = await Promise.race([
          operation,
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Subscription cleanup timed out')), 4000); })
        ]);
        deleteError = result.error;
      } catch (error) { deleteError = error; }
      finally { clearTimeout(timer); }
    }
    lastReason = deviceError && deleteError ? 'Could not turn off notifications on this device or at the club. Check your connection and try again before signing out.'
      : deleteError ? 'Notifications are off on this device. Server cleanup will finish when connectivity returns.'
      : deviceError ? 'The server stopped notifications, but this browser could not remove its subscription.' : '';
    if (deviceError) console.warn('Push device cleanup failed', deviceError);
    if (deleteError) console.warn('Push subscription server cleanup pending', deleteError);
    announce();
    if (deviceError && deleteError) throw new Error(lastReason);
    return state();
  }
  async function subscribe(userId, db) {
    if (!userId || !db) throw new Error('Sign in to turn on notifications.');
    const unsupported = capabilityReason();
    if (unsupported) throw new Error(unsupported);
    currentUserId = userId;
    // Safari Home Screen requires this permission request to begin directly
    // in the click handler, before any network or service worker await.
    const granted = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (granted !== 'granted') {
      lastReason = granted === 'denied' ? 'Allow notifications in your device settings to turn them on.' : 'Notification permission was not granted.';
      announce();
      throw new Error(lastReason);
    }
    let key;
    try { key = await publicKey(); }
    catch (error) {
      lastReason = error instanceof Error ? error.message : 'Device alerts could not be enabled.';
      announce();
      throw error;
    }
    const reg = await registration(true);
    let existing = await reg.pushManager.getSubscription();
    const owner = readOwner();
    const oldKey = existing?.options?.applicationServerKey;
    if (existing && (owner !== userId || !oldKey || !equalBytes(new Uint8Array(oldKey), key))) {
      await existing.unsubscribe(); existing = null; saveOwner('');
    }
    const subscription = existing || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    try { await syncRow(userId, db, subscription); }
    catch (error) {
      if (!existing) await subscription.unsubscribe().catch(() => {});
      activeSubscription = !!existing && owner === userId;
      lastReason = 'The device could not register with the club notification service.';
      announce();
      throw error;
    }
    saveOwner(userId);
    activeSubscription = true;
    lastReason = '';
    announce();
    return state();
  }
  const equalBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  async function authChanged(userId, db) {
    const previousUserId = currentUserId || readOwner();
    currentUserId = userId || '';
    if (!userId) {
      // Auth can end in another tab. Try both cleanup paths while the old
      // identity is known; browser unsubscribe still works without a session.
      await unsubscribe(previousUserId, db);
      currentUserId = '';
      return state();
    }
    const reg = await registration();
    const subscription = await reg?.pushManager?.getSubscription();
    const owner = readOwner();
    if (subscription && owner !== userId) {
      await subscription.unsubscribe();
      saveOwner('');
      activeSubscription = false;
    } else {
      activeSubscription = !!subscription && owner === userId && permission() === 'granted';
      if (activeSubscription) {
        try { await syncRow(userId, db, subscription); lastReason = ''; }
        catch (error) { lastReason = 'Could not refresh this device’s notifications. Check your connection.'; console.warn(lastReason, error); }
      }
    }
    announce();
    return state();
  }

  window.InnovateXPush = { state, subscribe, unsubscribe, authChanged, updateBadge };
  if ('serviceWorker' in navigator && ['https:', 'http:'].includes(location.protocol)) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(workerUrl.href).catch(error => console.warn('InnovateX offline screen unavailable', error));
    }, { once: true });
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'INNOVATEX_PUSH_RECEIVED')
        window.dispatchEvent(new CustomEvent('innovatexpush', { detail: { kind: event.data.kind === 'message' ? 'message' : 'notification' } }));
    });
  }
})();
