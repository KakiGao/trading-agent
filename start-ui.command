#!/bin/zsh
set -e
cd -- "${0:A:h}"
.venv/bin/python -m dashboard.service
open http://127.0.0.1:8765
