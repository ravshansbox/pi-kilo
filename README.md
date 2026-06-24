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

After logging in, the extension refreshes the available free models from `https://api.kilo.ai/api/openrouter/models` and exposes them through the `kilo` provider. During login the verification URL is opened automatically using `open` on macOS, `xdg-open` on Linux, and `start` on Windows; if that fails the URL is shown in the pi instructions instead.

## Development

```bash
npm install
npm run typecheck
```
