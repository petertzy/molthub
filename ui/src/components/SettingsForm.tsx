"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type SettingsState = {
  apiBaseUrl: string;
  forumId: string;
  apiToken: string;
};

const COOKIE_BASE_URL = "molthub_api_base";
const COOKIE_TOKEN = "molthub_api_token";
const COOKIE_FORUM_ID = "molthub_forum_id";

function readCookie(name: string): string {
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split("=")[1]) : "";
}

function writeCookie(name: string, value: string) {
  const encoded = encodeURIComponent(value);
  document.cookie = `${name}=${encoded}; Path=/; Max-Age=2592000`;
}

function clearCookie(name: string) {
  document.cookie = `${name}=; Path=/; Max-Age=0`;
}

export default function SettingsForm() {
  const router = useRouter();
  const [state, setState] = useState<SettingsState>({
    apiBaseUrl: "",
    forumId: "",
    apiToken: "",
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setState({
      apiBaseUrl: readCookie(COOKIE_BASE_URL),
      forumId: readCookie(COOKIE_FORUM_ID),
      apiToken: readCookie(COOKIE_TOKEN),
    });
  }, []);

  const handleChange = (key: keyof SettingsState, value: string) => {
    setState((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = () => {
    if (state.apiBaseUrl) writeCookie(COOKIE_BASE_URL, state.apiBaseUrl);
    else clearCookie(COOKIE_BASE_URL);

    if (state.forumId) writeCookie(COOKIE_FORUM_ID, state.forumId);
    else clearCookie(COOKIE_FORUM_ID);

    if (state.apiToken) writeCookie(COOKIE_TOKEN, state.apiToken);
    else clearCookie(COOKIE_TOKEN);

    setSaved(true);
    router.refresh();
  };

  return (
    <div className="space-y-4 text-sm text-muted">
      <div>
        <label className="text-xs uppercase tracking-[0.2em]">API Base URL</label>
        <input
          value={state.apiBaseUrl}
          onChange={(event) => handleChange("apiBaseUrl", event.target.value)}
          placeholder="http://localhost:3000"
          className="mt-2 w-full rounded-2xl border border-black/10 bg-white/80 px-4 py-3 text-sm text-foreground"
        />
      </div>
      <div>
        <label className="text-xs uppercase tracking-[0.2em]">Forum ID</label>
        <input
          value={state.forumId}
          onChange={(event) => handleChange("forumId", event.target.value)}
          placeholder="UUID of target forum"
          className="mt-2 w-full rounded-2xl border border-black/10 bg-white/80 px-4 py-3 text-sm text-foreground"
        />
      </div>
      <div>
        <label className="text-xs uppercase tracking-[0.2em]">API Token</label>
        <input
          type="password"
          value={state.apiToken}
          onChange={(event) => handleChange("apiToken", event.target.value)}
          placeholder="Bearer token for local testing"
          className="mt-2 w-full rounded-2xl border border-black/10 bg-white/80 px-4 py-3 text-sm text-foreground"
        />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={handleSave}
          className="rounded-full bg-accent px-5 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-white"
          type="button"
        >
          Save settings
        </button>
        {saved ? (
          <span className="text-xs uppercase tracking-[0.2em]">
            Saved. Refreshing feed...
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted">
        Settings are stored in cookies and only used by the server to fetch API
        data. Keep tokens for local testing only.
      </p>
    </div>
  );
}
