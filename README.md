# Gentle Office

A pixel-art office that shows real gentle-shell activity: the orchestrator, subagents, and tokens as a coffee pot. It ships as a standalone Pi package from this repo.

**Status (T1):** event contract, adapter, hub, toggle, and `/office` command. No window yet; the browser window arrives in T2.

## Install

From a checkout:

```bash
pi install ./
```

Or add the path to the `packages` list in your Pi `settings.json`.

## Use

```text
/office on       # attach listeners
/office off      # detach listeners and clear the hub
/office status   # enabled state and hub stats
```

The module is off by default. When it is off, the only thing registered is the `/office` command.

## Settings

`<agentDir>/gentle-office.json`:

```json
{ "enabled": false }
```

A missing or invalid file means disabled. Only an explicit `"enabled": true` turns the module on.

## Layout

- `src/contract/`: the normalized `OfficeEvent` contract (versioned, `v: 1`), role and feature mapping, and the inbound `boss.input` validator. Pure.
- `src/adapter/`: maps Pi events and gentle-pi task status to contract events, plus the in-memory `OfficeHub`. Pure.
- `src/settings.ts`, `src/toggle.ts`: settings file and the on/off controller.
- `extensions/gentle-office.ts`: thin Pi wiring.
- `test/`: `npm test` runs the suite with Node's built-in test runner and TypeScript type stripping. No dependencies to install.
