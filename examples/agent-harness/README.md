# Fixed balance example

This is original Monolith example code licensed under the adjacent [MIT license](LICENSE). It deliberately starts with one call to `regressionRead()` so the agent harness has a concrete privacy failure to find. The one supported repair changes that call to `privateRead()` in `app.mjs`.

The trusted runner supplies both capabilities, first performs a protected useful-read witness, then invokes this example once. The regression capability is an explicit synthetic negative control. The candidate cannot edit the capabilities, runner, inventory, policy, collector or oracle. No arbitrary code, imports, callbacks, URLs, wallets or report fields are accepted as a repair.

The controller binds the exact original source SHA-256, the candidate patch and source hashes, the repository Git commit and unchanged trusted inputs in each trial. This new original example did not exist at the base commit: its content digest, rather than a claim that it was already committed at that revision, pins its identity. The repaired copy is disposable; the maintained example remains deliberately regressed.

Synthetic runs use real Chromium with an explicitly fake transport driver and intercepted fixed HTTP response. They are marked `SIMULATED`, including successful repairs, and establish no live anonymity, Arkiv or deployed-worker acceptance. The public RPC destination can read request payloads during genuine supported live use; worker bootstrap is separately disclosed. Live integration remains unavailable while its normal dependency acceptance is pending.
