#!/bin/sh
# One fail-fast gate shared by preview, production, and pull-request CI.
set -eu
cd "$(dirname "$0")/.."
npm run lint
npm run typecheck
npm run build
npm test
npm run test:browser
python3 -m unittest discover -s test -p 'test_build_tooling.py'
