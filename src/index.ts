/**
 * Kilo Provider Extension for Pi Agent
 */

import type { Api, Model, OAuthCredentials, OAuthLoginCallbacks } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ProviderModelConfig } from "@mariozechner/pi-coding-agent";
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

type KiloModelResponse = {
  id: string;
  name?: string;
  isFree?: boolean;
  pricing?: {
    prompt?: number | string;
    completion?: number | string;
    input_cache_read?: number | string;
    input_cache_write?: number | string;
  };
  cost?: {
    input?: number | string;
    output?: number | string;
    cache_read?: number | string;
    cache_write?: number | string;
  };
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
  };
  modalities?: {
    input?: string[];
    output?: string[];
  };
  supported_parameters?: string[];
  top_provider?: {
    context_length?: number;
    max_completion_tokens?: number;
  };
  context_length?: number;
  max_output_tokens?: number;
  limit?: {
    context?: number;
    output?: number;
  };
  reasoning?: boolean;
};

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function hasTextInput(model: KiloModelResponse): boolean {
  const inputs = model.architecture?.input_modalities || model.modalities?.input;
  return Array.isArray(inputs) && inputs.includes("text");
}

function hasTextOutput(model: KiloModelResponse): boolean {
  const outputs = model.architecture?.output_modalities || model.modalities?.output;
  return Array.isArray(outputs) && outputs.includes("text");
}

function supportsTools(model: KiloModelResponse): boolean {
  return Array.isArray(model.supported_parameters) && model.supported_parameters.includes("tools");
}

function isFreeModel(model: KiloModelResponse): boolean {
  if (model.isFree === true) return true;
  return toNumber(model.pricing?.prompt) === 0 && toNumber(model.pricing?.completion) === 0;
}

function mapModels(data: { data?: KiloModelResponse[] }): ProviderModelConfig[] {
  return (data.data || [])
    .filter((m) => isFreeModel(m) && hasTextInput(m) && hasTextOutput(m) && supportsTools(m))
    .map((m) => ({
      id: m.id,
      name: m.name || m.id,
      api: "openai-completions" as Api,
      reasoning: m.reasoning || false,
      input: ["text"],
      cost: {
        input: toNumber(m.pricing?.prompt ?? m.cost?.input),
        output: toNumber(m.pricing?.completion ?? m.cost?.output),
        cacheRead: toNumber(m.pricing?.input_cache_read ?? m.cost?.cache_read),
        cacheWrite: toNumber(m.pricing?.input_cache_write ?? m.cost?.cache_write),
      },
      contextWindow: m.context_length || m.top_provider?.context_length || m.limit?.context || 128000,
      maxTokens: m.top_provider?.max_completion_tokens || m.max_output_tokens || m.limit?.output || 4096,
    }));
}

async function fetchModels(token: string) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`${KILO_API}/api/openrouter/models`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });
      if (!response.ok) return [];
      return mapModels((await response.json()) as { data?: KiloModelResponse[] });
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return [];
  }
}

export default async function (pi: ExtensionAPI) {
  const token = getToken();
  const models = token ? await fetchModels(token) : [];

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

        try {
          const [cmd, ...args] = process.platform === "win32" ? ["cmd", "/c", "start", "", verificationUrl] : ["xdg-open", verificationUrl];
          execFileSync(cmd, args, { windowsHide: true });
        } catch {
          // Browser auto-open failed (headless env). User can open the URL manually from the instructions above.
        }

        for (let i = 0; i < Math.ceil(expiresIn / 5); i++) {
          await new Promise(r => setTimeout(r, 5000));
          const poll = await fetch(`${KILO_API}/api/device-auth/codes/${code}`);
          if (poll.status === 200) {
            const body = await poll.json();
            return { refresh: body.token, access: body.token, expires: Date.now() + 31536000000 };
          }
          if (poll.status !== 202) throw new Error(poll.status === 403 ? "Denied" : "Expired");
        }
        throw new Error("Timeout");
      },

      refreshToken: async (c) => c,
      getApiKey: (c) => c.access,

      modifyModels(models: Model<Api>[], credentials: OAuthCredentials) {
        void fetchModels(credentials.access).then(() => undefined);
        return models;
      },
    },
  });
}
