#!/bin/bash
cd "$(dirname "$0")"
open http://localhost:8787 &
exec node server.js
