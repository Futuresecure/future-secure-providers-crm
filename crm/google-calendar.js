(() => {
  const statusEl = () => document.getElementById("googleCalendarStatus");
  const detailsEl = () => document.getElementById("googleCalendarSyncDetails");
  const setStatus = (message) => { if (statusEl()) statusEl().textContent = message; };
  const setDetails = (message) => { if (detailsEl()) detailsEl().textContent = message; };
  const notify = (message, type = "success") => {
    if (typeof showMessage === "function") showMessage(message, type);
    else setDetails(message);
  };

  async function calendarAction(action) {
    if (typeof currentUser === "undefined" || !currentUser) throw new Error("Sign in to CRM first");
    const { data, error } = await supabaseClient.functions.invoke("google-calendar-oauth", { body: { action } });
    if (error) throw new Error(error.message || "Google Calendar request failed");
    if (!data?.ok) throw new Error(data?.error || "Google Calendar request failed");
    return data;
  }

  window.loadGoogleCalendarStatus = async function () {
    if (typeof currentUser === "undefined" || !currentUser) {
      setStatus("Sign in to CRM to manage Google Calendar.");
      setDetails("");
      return;
    }
    setStatus("Checking Google Calendar connection...");
    try {
      const data = await calendarAction("status");
      const connection = data.connection;
      if (connection?.status === "connected") {
        setStatus("Connected to Google Calendar.");
      } else if (connection?.status === "needs_reconnect") {
        setStatus("Reconnect required. Calendar sync is paused until Google permission is renewed.");
      } else {
        setStatus("Google Calendar is not connected.");
      }
      const jobs = Array.isArray(data.jobs) ? data.jobs : [];
      const pending = jobs.filter(x => x.status === "pending").length;
      const errors = jobs.filter(x => x.status === "error").length;
      const synced = jobs.filter(x => x.status === "synced").length;
      setDetails("Linked appointments — Synced: " + synced + " · Pending: " + pending + " · Needs review: " + errors);
      if (new URLSearchParams(location.search).get("calendar") === "connected") {
        notify("Google Calendar connected. Pending linked appointments are being checked.", "success");
        const clean = new URL(location.href);
        clean.searchParams.delete("calendar");
        history.replaceState({}, "", clean.pathname + clean.search + clean.hash);
      }
    } catch (error) {
      setStatus("Unable to verify Google Calendar status.");
      setDetails(error.message || "Try again after signing in.");
    }
  };

  window.connectGoogleCalendar = async function () {
    const button = document.querySelector('[onclick="connectGoogleCalendar()"]');
    if (button) { button.disabled = true; button.textContent = "Connecting..."; }
    try {
      const data = await calendarAction("start");
      if (!data.url) throw new Error("Google authorization link was not returned");
      location.assign(data.url);
    } catch (error) {
      notify(error.message || "Unable to start Google Calendar connection.", "error");
      if (button) { button.disabled = false; button.textContent = "Connect / Reconnect Google Calendar"; }
    }
  };

  window.retryGoogleCalendarSync = async function () {
    const button = document.querySelector('[onclick="retryGoogleCalendarSync()"]');
    if (button) { button.disabled = true; button.textContent = "Checking..."; }
    try {
      const data = await calendarAction("retry");
      if (!data.connected) {
        setStatus("Reconnect required. No Calendar jobs were processed.");
        notify("Reconnect Google Calendar before retrying sync.", "error");
      } else {
        notify("Calendar worker checked " + Number(data.processed || 0) + " pending job(s).", "success");
      }
      await window.loadGoogleCalendarStatus();
    } catch (error) {
      notify(error.message || "Calendar retry failed.", "error");
    } finally {
      if (button) { button.disabled = false; button.textContent = "Retry linked appointment sync"; }
    }
  };

  window.addEventListener("fsp-crm-authenticated", () => window.loadGoogleCalendarStatus());
  if (typeof currentUser !== "undefined" && currentUser) window.loadGoogleCalendarStatus();
})();