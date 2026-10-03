#!/usr/bin/env bash
# Usage: scripts/new-topic.sh <slug> link <url>
#        scripts/new-topic.sh <slug> pdf <path-to-pdf>
#        scripts/new-topic.sh <slug> topic "<topic name>"
set -euo pipefail
slug="${1:?slug}"; kind="${2:?link|pdf|topic}"; val="${3:?value}"
root="$(cd "$(dirname "$0")/.." && pwd)/library/topics/$slug"
[ -e "$root" ] && { echo "exists: $root" >&2; exit 1; }
mkdir -p "$root"/{sources,pack,outputs,chat}
now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
python3 - "$root" "$slug" "$kind" "$val" "$now" <<'PY'
import json,sys,os,shutil
root,slug,kind,val,now=sys.argv[1:]
origin={"type":kind}
if kind=="link": origin["link"]=val
elif kind=="topic": origin["name"]=val
elif kind=="pdf":
    name=os.path.basename(val); shutil.copy(val,os.path.join(root,"sources",name)); origin["file"]="sources/"+name
json.dump({"id":slug,"title":slug,"status":"captured","origin":origin,"session_id":None,"resources":[],"created":now,"updated":now},open(os.path.join(root,"topic.json"),"w"),indent=2)
open(os.path.join(root,"progress.json"),"w").write("{}")
PY
echo "$root"
