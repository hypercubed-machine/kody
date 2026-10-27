# Execution contexts: throwaway prototypes

PROTOTYPE ONLY. Do not merge. This directory backs a draft PR that exists only
to validate risky infrastructure for the Execution Context Protocol (ECP) design
review. Nothing here is wired into Kody, deployed, or imported by any package.
It is local-only: `wrangler dev`, the pinned workerd, and Node.

## 1. WebSocket through edge, origin and a platform DO (`ws-edge/`)

Three workers in one `wrangler dev` session mirror the production hop chain:
`ecp-proto-edge` (api-worker stand-in) forwards to `ecp-proto-origin`'s
`KodyApi` WorkerEntrypoint over a service binding, which reaches
`ExecutionContextSessionV1` on `ecp-proto-platform` through a cross-script
Durable Object binding (`script_name`), declared with `new_sqlite_classes`.

```sh
npx wrangler dev -c prototypes/execution-contexts/ws-edge/edge.jsonc \
  -c prototypes/execution-contexts/ws-edge/origin.jsonc \
  -c prototypes/execution-contexts/ws-edge/platform.jsonc --port 8799
node prototypes/execution-contexts/ws-edge/client.mjs http://127.0.0.1:8799 20000
```

The client uses the Node global `WebSocket`, gets a single-use ticket, then
checks: the allowlisted-header path and the rebuilt-Response path both fail to
upgrade; the dedicated branch upgrades; an auto-response ping/pong works while
the DO is hibernated; a DO-initiated `run.request` after idle reaches the socket
from a new DO instance with the attachment intact; 6 MiB frames pass; a 33 MiB
frame closes with 1009; a reused ticket is rejected.

## 2 to 4. Ed25519, disk services, egress (`workerd/`)

```sh
node prototypes/execution-contexts/workerd/run.mjs
```

Runs the pinned workerd (`1.20260815.1`, cached at the path the CLI uses, or
`KODY_WORKERD_PATH`) three times with different `globalOutbound` services
(bridge in proxy style, bridge in host style, `network allow ["public"]`), and
prints JSON covering Node to workerd Ed25519 interop, `disk` service symlink and
dotfile behavior (read-only and writable), and how `fetch()` and `connect()`
reach the outbound service.
