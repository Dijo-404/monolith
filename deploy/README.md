# Monolith hosting

The deployment task packages the existing dashboard from an exact source commit. It does not replace the transport, registry, observer or privacy-test implementations.

Generated Sites source checkouts and archives stay outside the tracked repository. The tracked `.openai/hosting.json` records the selected Site identity; deployment commands and actual publication results belong in [the deployment guide](../docs/deployment.md).

Public hosting does not establish a working observer, a successful privacy comparison, or sponsor acceptance. The application and its evidence must state their actual results.
