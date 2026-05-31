#!/bin/bash
set -e
cd "$(dirname "$0")"
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.dev.txt -q
python -m pytest tests/test_menu.py tests/test_analytics_dashboard.py -x -q
