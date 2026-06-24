# pi-kilo

Kilo Gateway provider extension for pi.

## Install

```json
{
  "extensions": ["github:ravshansbox/pi-kilo"]
}
```

## Usage

Pi loads the provider from `./index.ts` and registers a `kilo` provider that signs in through the Kilo device-auth flow and fetches free text-capable tool-calling models.

For example, after logging in to Kilo from pi, the extension can fetch the available free models from `https://api.kilo.ai/api/openrouter/models` and expose them through the `kilo` provider.

## Development

```bash
npm install
npm run typecheck
```
