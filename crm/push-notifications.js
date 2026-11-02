(() => {
  const statusEl = () => document.getElementById("pushNotificationStatus");
  const resultEl = () => document.getElementById("pushNotificationResult");
  const setStatus = (text) => { if (statusEl()) statusEl().textContent = text; };
  const setResult = (text) => { if (resultEl()) resultEl().textContent = text; };
  const notify = (message, type = "success") => {
    if (typeof showMessage === "function") showMessage(message, type);
    else setResult(message);
  };
  const supported = () => ("serviceWorker" in navigator) && ("PushManager" in window) && ("Notification" in window);
  function applicationServerKey(value) {
    const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
  }
  async function invokePush(action, extra = {}) {
    const { data, error } = await supabaseClient.functions.invoke("push-subscribe", { body: { action, ...extra } });
    if (error) throw new Error(error.message || "Push notification request failed");
    if (!data?.ok) throw new Error(data?.error || "Push notification request failed");
    return data;
  }
  async function registration() {
    await navigator.serviceWorker.ready;
    const reg = await navigator.serviceWorker.getRegistration("./");
    if (!reg) throw new Error("CRM service worker is not registered. Refresh the CRM and try again.");
    return reg;
  }

  window.refreshCrmPushStatus = async function () {
    if (typeof currentUser === "undefined" || !currentUser) {
      setStatus("Sign in to CRM to manage device notifications.");
      return;
    }
    if (!supported()) {
      setStatus("This browser does not support web push notifications.");
      return;
    }
    try {
      const reg = await registration();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        setStatus("Push notifications are enabled on this device. Permission: " + Notification.permission + ".");
      } else if (Notification.permission === "denied") {
        setStatus("Notifications are blocked in browser settings. Allow them there, then enable again.");
      } else {
        setStatus("Push notifications are not enabled on this device.");
      }
    } catch (error) {
      setStatus(error.message || "Unable to check push notification status.");
    }
  };

  window.enableCrmPush = async function () {
    const button = document.getElementById("enablePushBtn");
    if (button) { button.disabled = true; button.textContent = "Enabling..."; }
    try {
      if (!supported()) throw new Error("This browser does not support web push notifications.");
      if (Notification.permission !== "granted") {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") throw new Error("Notification permission was not granted.");
      }
      const reg = await registration();
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const keyData = await invokePush("public_key");
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(keyData.publicKey)
        });
      }
      await invokePush("subscribe", { subscription: sub.toJSON() });
      setResult("This device is registered for CRM push notifications.");
      notify("Push notifications enabled on this device.", "success");
      await window.refreshCrmPushStatus();
    } catch (error) {
      setResult(error.message || "Unable to enable push notifications.");
      notify(error.message || "Unable to enable push notifications.", "error");
    } finally {
      if (button) { button.disabled = false; button.textContent = "Enable notifications"; }
    }
  };

  window.testCrmPush = async function () {
    const button = document.getElementById("testPushBtn");
    if (button) { button.disabled = true; button.textContent = "Sending..."; }
    try {
      const data = await invokePush("test");
      if (data.sent > 0) notify("Test notification sent to this account's registered device(s).", "success");
      else notify("No active device subscription found. Enable notifications first.", "error");
      setResult("Sent: " + data.sent + " · Expired removed: " + data.removed + " · Failed: " + data.failed);
      await window.refreshCrmPushStatus();
    } catch (error) {
      notify(error.message || "Push test failed.", "error");
    } finally {
      if (button) { button.disabled = false; button.textContent = "Send test to this device"; }
    }
  };

  window.disableCrmPush = async function () {
    const button = document.getElementById("disablePushBtn");
    if (button) { button.disabled = true; button.textContent = "Disabling..."; }
    try {
      const reg = await registration();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await invokePush("unsubscribe", { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setResult("This device has been unsubscribed from CRM push notifications.");
      notify("Push notifications disabled on this device.", "success");
      await window.refreshCrmPushStatus();
    } catch (error) {
      notify(error.message || "Unable to disable push notifications.", "error");
    } finally {
      if (button) { button.disabled = false; button.textContent = "Disable on this device"; }
    }
  };

  window.addEventListener("fsp-crm-authenticated", () => window.refreshCrmPushStatus());
  if (typeof currentUser !== "undefined" && currentUser) window.refreshCrmPushStatus();
})();