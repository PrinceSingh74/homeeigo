import os
drop = {"DATABASE_URL","DIRECT_DATABASE_URL","REDIS_URL","PORT","NODE_ENV","LOAD_TEST_MODE","SECRETS_SOURCE"}
out = {}
for line in open(".env", encoding="utf-8", errors="ignore"):
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    k = k.strip()
    if k in drop:
        continue
    v = v.strip().strip('"').strip("'")
    if v == "" or "'" in v:   # skip empties + values needing complex quoting
        continue
    out[k] = v
out["NODE_ENV"] = "staging"
out["LOAD_TEST_MODE"] = "1"
with open("/tmp/run-env.yaml", "w", encoding="utf-8") as f:
    for k, v in out.items():
        f.write(k + ": '" + v + "'\n")
print("  wrote " + str(len(out)) + " env vars to /tmp/run-env.yaml")
print("  keys: " + ", ".join(list(out.keys())[:14]))
