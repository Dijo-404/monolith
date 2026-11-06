# MN-029 boundary fixtures

These fixtures are **SIMULATED** candidate source and patch inputs for the one
original MIT example. They do not establish a live worker run, an observed source
comparison, or a genuine live external-agent repair trial.

The controller tests construct disposable minimal repositories with independent
sentinels for every trusted source root. Cases exercise forbidden paths, additional
files or code, symlinks, missing/changed protected inputs, concurrent candidate
admission and cleanup. A successful patch changes the fixed example's admitted
read capability while preserving the maintained original and trusted oracle.

The supported repair diff is generated from the reviewed policy constants during
checks so the fixture never silently drifts from the one permitted example revision.
Live evidence, if obtained, is recorded separately by the actual runner.

[`recorded-simulated.json`](recorded-simulated.json) retains the actual local
controller/CLI/Chromium trial at its named source commit, including a separate
agent's [proposed diff](agent-proposed.diff), useful repair, simulated blocked
worker and deliberately unavailable live mode. The agent used the original
example and supplied observed diagnostic facts; it did not read the baseline
artifact. The coordinator attests that proposal provenance; the CLI and hashes
do not authenticate an agent. This record is not genuine live acceptance.
