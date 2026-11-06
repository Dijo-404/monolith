# Monolith CLI

`@monolith/cli` provides the `monolith` executable and an interactive terminal UI.
Use Node.js 24.22.2 or newer within the Node.js 24 release line.

This package is prepared for local tarball installation. Its npm name availability
and public registry publication have not been established.

From the Monolith workspace, install its pinned dependencies and build before
packing:

```sh
pnpm install --frozen-lockfile
pnpm build
cd packages/cli
npm pack
```

Install the resulting `monolith-cli-0.1.0.tgz` in a separate directory:

```sh
npm install /absolute/path/to/monolith-cli-0.1.0.tgz
./node_modules/.bin/monolith --help
./node_modules/.bin/monolith tui
```

The executable bundles the private Monolith shared/analyzer packages and Zod.
It has no runtime npm dependencies. The tarball includes Monolith's MIT license
and the bundled Zod license in `dist/THIRD_PARTY_NOTICES.txt`.

Use `monolith --help` for the supported local checks, report inspection and browser
lab launcher. The TUI invokes the same command handlers. Protected reads remain
inside the existing browser lab using a verified anonymity worker or fail closed;
launching a browser does not establish that a protected run succeeded. Report
inspection does not authenticate network evidence or verify artifact contents.

After an owner separately authorizes and completes registry publication, an npm
execution command could be `npx @monolith/cli@0.1.0 --help`. This is a future usage
example, not evidence that the package is published. Publication is not part of
the local CLI implementation.
