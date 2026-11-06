# Monolith CLI

`@dijo-404/monolith-cli` provides the `monolith` command and an interactive terminal UI.
Use Node.js 24.22.2 or newer within the Node.js 24 release line.

```sh
npx @dijo-404/monolith-cli@0.1.0 --help
npx @dijo-404/monolith-cli@0.1.0 tui
```

To install the executable globally:

```sh
npm install --global @dijo-404/monolith-cli@0.1.0
monolith --help
monolith tui
```

Commands include `doctor`, `check --input <file>`, `report <file>`, and
`lab --url <dashboard-url>`. Run `monolith --help` for options. Checks and report
inspection use local JSON files; the lab command opens an explicitly configured
browser application. The TUI invokes the same command handlers.

Protected reads remain inside the existing browser lab using a verified anonymity
worker or fail closed. Launching a browser does not establish that a protected run
succeeded. Local input is unverified caller data, and report inspection does not
authenticate network evidence or verify artifact contents. The CLI performs no
protected RPC reads in Node.

The executable bundles Monolith shared/analyzer code and Zod. It has no runtime
npm dependencies. The package includes Monolith's MIT license and the bundled
Zod license in `dist/THIRD_PARTY_NOTICES.txt`.

The source workspace package is named `@monolith/cli`; release staging uses the
owner-approved public npm name `@dijo-404/monolith-cli`. This changes the
package identity and documentation; the verified executable and license bytes
are preserved.
