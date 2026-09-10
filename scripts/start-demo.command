#!/bin/zsh
# Double-click this file on macOS to start the local demo.
cd "${0:A:h:h}" || exit 1
demo_node="$(command -v node 2>/dev/null)"
if [[ -z "$demo_node" ]]; then
  demo_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi
if [[ ! -x "$demo_node" ]]; then
  print 'Node.js 24 or newer is needed. Install Node.js, then run this file again.'
  read '?Press Enter to close.'
  exit 1
fi
"$demo_node" scripts/dev-demo.mjs
read '?Press Enter to close.'
