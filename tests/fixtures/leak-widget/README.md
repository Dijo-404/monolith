# Controlled leaking widget

All values and transport routes here are **SIMULATED**. The fixture returns authored chain-ID/balance/pending-receipt results through the public `MonolithTransport` interface. Its driver is a software test port, never the real Anon-RPC worker.

`leak-widget.ts` deliberately calls ordinary browser fetch for a synthetic receipt request. The independent CDP collector sees its actual method and initiator location without a transport trace. In the fixed scenario the same useful operation goes through the fail-closed transport. An extra untracked read checks that undeclared requests expand the report denominator. Retry, outage, blocked functional reads, missing traces and an explicit direct control exercise separate boundaries.

The reserved `.example` RPC origins are intercepted by the browser runner. This page is not a production RPC endpoint or public proxy, takes no wallet/order inputs, and must not be presented as live anonymity or payment evidence. See [the capture policy](../../privacy/egress/README.md).
