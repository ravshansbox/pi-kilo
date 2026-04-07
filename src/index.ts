/**
 * Kilo Provider Extension for Pi Agent
 */

import type { OAuthCredentials, OAuthLoginCallbacks } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const KILO_API = "https://api.kilo.ai";
const AUTH_PATH = join(homedir(), ".pi", "agent", "auth.json");

function getToken(): string | null {
  try {
    const auth = JSON.parse(readFileSync(AUTH_PATH, "utf8"));
    const kilo = auth["kilo"];
    if (!kilo?.access) return null;
    if (kilo.expires && Date.now() > kilo.expires) return null;
    return kilo.access;
  } catch {
    return null;
  }
}

function fetchModels(token: string) {
  try {
    const out = execFileSync("curl", ["-s", "-H", `Authorization: Bearer ${token}`, "-H", "Content-Type: application/json", "--max-time", "10", `${KILO_API}/api/openrouter/models`], { encoding: "utf8" });
    const data = JSON.parse(out);
    return (data.data || []).map((m: any) => ({
      id: m.id,
      name: m.name,
      provider: "kilo",
      api: "openai-completions",
      reasoning: m.reasoning || false,
      input: m.modalities?.input || ["text"],
      output: m.modalities?.output || ["text"],
      cost: { input: m.cost?.input || 0, output: m.cost?.output || 0, cacheRead: m.cost?.cache_read || 0, cacheWrite: m.cost?.cache_write || 0 },
      contextWindow: m.limit?.context || 128000,
      maxTokens: m.limit?.output || 4096,
    }));
  } catch {
    return [];
  }
}

export default function (pi: ExtensionAPI) {
  const token = getToken();
  const models = token ? fetchModels(token) : [];

  pi.registerProvider("kilo", {
    baseUrl: `${KILO_API}/api/openrouter/v1`,
    api: "openai-completions",
    authHeader: true,
    models,

    oauth: {
      name: "Kilo Gateway",

      async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
        const { code, verificationUrl, expiresIn } = await (await fetch(`${KILO_API}/api/device-auth/codes`, { method: "POST", headers: { "Content-Type": "application/json" } })).json();
        callbacks.onAuth({ url: verificationUrl, instructions: `Enter code: ${code}` });

        const [cmd, ...args] = process.platform === "win32" ? ["cmd", "/c", "start", "", verificationUrl] : ["xdg-open", verificationUrl];
        execFileSync(cmd, args, { windowsHide: true });

        for (let i = 0; i < Math.ceil(expiresIn / 5); i++) {
          await new Promise(r => setTimeout(r, 5000));
          const poll = await fetch(`${KILO_API}/api/device-auth/codes/${code}`);
          if (poll.status === 200) return { refresh: (await poll.json()).token, access: (await poll.json()).token, expires: Date.now() + 31536000000 };
          if (poll.status !== 202) throw new Error(poll.status === 403 ? "Denied" : "Expired");
        }
        throw new Error("Timeout");
      },

      refreshToken: (c) => c,
      getApiKey: (c) => c.access,

      modifyModels(models, credentials) {
        const kiloModels = fetchModels(credentials.access);
        return [...models.filter(m => m.provider !== "kilo"), ...kiloModels.map(m => ({ ...m, baseUrl: `${KILO_API}/api/openrouter/v1` }))];
      },
    },
  });
}
