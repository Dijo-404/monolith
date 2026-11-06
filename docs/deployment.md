# Deploying Monolith

Deployment preparation is tracked in [MN-023 / issue #36](https://github.com/Dijo-404/monolith/issues/36). The owner selected no-cost hosting for the overnight release.

The dashboard is a static Vite build. The read-only observer and Arkiv registry API are a separate process. `MONOLITH_PUBLIC_OBSERVER_URL` is the only browser configuration value currently exposed by the Vite configuration. It is public and must contain an HTTP(S) origin without credentials, a path, query or fragment. A public deployment needs a reachable HTTPS backend; the local development default is not a deployed backend.

Build artifacts must be generated from an exact clean Git commit with the repository's pinned Node and pnpm versions. Do not upload `.env`, keys, local cloud credentials, dependency trees or private working files. Source provenance and content hashes describe what was built; they do not establish that privacy or chain reads succeeded.

The GitHub repository was verified **private** during deployment preparation. Publishing the compiled static application is authorized; making the source repository public is a separate owner decision. The Sites source snapshot contains compiled assets, license notices and provenance only. The exact source archive used internally to build is not uploaded with that snapshot. Hackathon source-publication requirements remain outstanding until the owner deliberately authorizes and performs that disclosure.

The connected Sites service is being evaluated for the static dashboard. The observer requires a separately verified source topology for paired-source proof. A free tunnel depends on the workstation staying online and may change its hostname; its public endpoint must not be described as permanent infrastructure.

This guide will record exact preparation/publication commands, actual URLs, browser checks and remaining limits after those operations run. No public application deployment is claimed by this initial document.
