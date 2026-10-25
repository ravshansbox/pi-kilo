import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const agentDir = mkdtempSync(join(tmpdir(), 'pi-kilo-'));
process.env['PI_CODING_AGENT_DIR'] = agentDir;

const freeModel = {
  id: 'free/model',
  name: 'Free Model',
  pricing: { prompt: '0', completion: '0' },
  architecture: { input_modalities: ['text'], output_modalities: ['text'] },
  supported_parameters: ['tools'],
};

globalThis.fetch = async () => new Response(JSON.stringify({ data: [freeModel] }));

const { default: extension } = await import('./index.ts');

async function load(auth: object) {
  writeFileSync(join(agentDir, 'auth.json'), JSON.stringify(auth));
  let config: any;
  await extension({ registerProvider: (_: string, c: unknown) => (config = c) } as any);
  return config;
}

const credentials = { access: 'token', refresh: 'token', expires: Date.now() + 60_000 };

test('refreshed models keep the Kilo base URL', async () => {
  const config = await load({ kilo: credentials });
  const existing = config.models.map((m: object) => ({
    ...m,
    provider: 'kilo',
    baseUrl: config.baseUrl,
  }));
  const models = config.oauth.modifyModels(existing, credentials);
  assert.ok(models.length > 0);
  for (const model of models) assert.equal(model.baseUrl, config.baseUrl);
});
