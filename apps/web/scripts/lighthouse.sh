#!/bin/bash
# Lighthouse (mobile) N times against URL; prints perf/a11y and the main metrics.
# usage: scripts/lighthouse.sh http://localhost:3100/ 3
CHROME=$(node -e "const {chromium}=require('@playwright/test');console.log(chromium.executablePath())")
OUT=${LH_OUT:-$(mktemp -d)}
for i in $(seq 1 $2); do
  CHROME_PATH="$CHROME" npx -y lighthouse@13.6.0 "$1" --quiet --chrome-flags="--headless=new" --only-categories=performance,accessibility --output=json --output-path=$OUT/run.json > /dev/null 2>&1
  python3 -c "
import json
d=json.load(open('$OUT/run.json'))
a=d['audits']
print('perf',round(d['categories']['performance']['score']*100),'a11y',round(d['categories']['accessibility']['score']*100),'TBT',a['total-blocking-time']['displayValue'],'LCP',a['largest-contentful-paint']['displayValue'],'SI',a['speed-index']['displayValue'],'longtasks',[round(x['duration']) for x in a['long-tasks']['details']['items']])
"
done
