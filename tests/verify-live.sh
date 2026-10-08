#!/usr/bin/env bash
# Post-restart verification untuk dsh-agent-skills.
#
# Jalankan SETELAH restart-dsh.sh selesai:
#   bash /home/administrator/agent-workspace/project/dsh-agent-skills/tests/verify-live.sh
#
# Exit 0 = semua pass. Exit 1 = ada yang gagal (lihat baris FAIL).
# Gate ini read-only: hanya membaca profil, symlink, modul, dan gateway lokal.
#
# Catatan arsitektur: plugin ini di-mount lewat `dsh.profile.bundles` di
# profile `package.json`. Saat pnpm resolve dependency, bundle auto-join
# layer stack. `cordis.patch.yml` profil tidak wajib — mount terjadi lewat
# package.json semata. Verifikasi di bawah mengecek jalur mount yang benar.

set -uo pipefail

# Derive the plugin dir from this script's own location so a relocated checkout
# is verifiable without editing the file. The profile paths stay absolute on
# purpose: this is a post-restart check against the LIVE web profile, not a CI
# gate, so it must read the profile that restart-dsh.sh actually booted.
PLUGIN_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DSH_HOME="${DSH_HOME:-$HOME/agent-workspace/.dsh}"
PROFILE_PKG="$DSH_HOME/profiles/web/package.json"
PROFILE_NM="$DSH_HOME/profiles/web/node_modules"
FAIL=0

# Skip the host-state steps (1-4) when the profile is not present on this
# machine, so the disk-contract checks (5-6) stay runnable on a fresh clone.
# Without this, RESULT: PASS on CI would be a statement about a host that
# does not exist here.
PROFILE_PRESENT=0
[ -d "$PROFILE_NM" ] && PROFILE_PRESENT=1

ok()   { printf 'PASS %s\n' "$1"; }
bad()  { printf 'FAIL %s\n' "$1"; FAIL=1; }

# 1. HTTP probe web GUI
# curl already writes 000 to stdout on transport failure, so a `|| echo 000`
# fallback appends a SECOND 000 and yields "000000". Drop the fallback.
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:13080/)
[ "$code" = 200 ] && ok "web GUI HTTP $code" || bad "web GUI HTTP $code (harusnya 200)"

# 2. Symlink plugin ter-resolve
[ -L "$PROFILE_NM/dsh-agent-skills" ] \
  && ok "symlink dsh-agent-skills ada di node_modules profil" \
  || bad "symlink dsh-agent-skills tidak ada di node_modules profil"

# 3. Modul plugin benar-benar loadable dari symlink profil
# Capture the reason: suppressing stderr here hid ERR_MODULE_NOT_FOUND, so the
# operator saw only a bare FAIL with no way to diagnose it.
if [ "$PROFILE_PRESENT" -eq 1 ]; then
  load_out=$(node --input-type=module -e "
  import { pathToFileURL } from 'node:url';
  const m = await import(pathToFileURL('$PROFILE_NM/dsh-agent-skills/lib/index.js').href);
  if (m.name !== 'dsh-agent-skills') throw new Error('name=' + m.name);
  if (typeof m.apply !== 'function') throw new Error('apply bukan fungsi');
  if (!Array.isArray(m.inject)) throw new Error('inject bukan array');
  " 2>&1)
  if [ $? -eq 0 ]; then
    ok "modul plugin loadable: name+apply+inject valid"
  else
    bad "modul plugin gagal load dari symlink profil:"
    printf '%s\n' "$load_out" | sed 's/^/    /' >&2
  fi
else
  ok "modul loadability: skipped (no profile on this machine)"
fi

# 4. Profil package.json punya dependency + bundles entry (jalur mount)
node -e "
const p = JSON.parse(require('fs').readFileSync('$PROFILE_PKG','utf8'));
if (!p.dependencies || !p.dependencies['dsh-agent-skills']) {
  console.log('FAIL: dependencies.dsh-agent-skills MISSING'); process.exit(1);
}
const bundles = (p.dsh && p.dsh.profile && p.dsh.profile.bundles) || [];
if (!bundles.includes('dsh-agent-skills')) {
  console.log('FAIL: dsh.profile.bundles tidak memuat dsh-agent-skills'); process.exit(1);
}
" \
  && ok "package.json: dependency + bundles entry dsh-agent-skills ada (mount via bundles)" \
  || bad "package.json: dependency/bundles entry dsh-agent-skills hilang (plugin tidak akan mount)"

# 5. Gate disk skill contract — capture output so a failure is diagnosable,
#    not just a bare exit code (the old >/dev/null swallowed the reason).
catalog_out=$(node "$PLUGIN_DIR/tests/verify-catalog-live.mjs" 2>&1)
catalog_rc=$?
if [ "$catalog_rc" -eq 0 ]; then
  ok "27 skill name valid, 0 mismatch name!==dir"
else
  bad "verify-catalog-live gagal (exit $catalog_rc):"
  printf '%s\n' "$catalog_out" | sed 's/^/    /' >&2
fi

# 6. Gerbang statis lokal masih hijau.
# When the web profile is absent (fresh clone / CI), the harness's pnpm cache
# may not contain yaml@2.9.0 either, so structural.test.mjs could fail for
# environment reasons. Skip these steps so `RESULT: PASS` does not punish a
# clean checkout on a machine that never ran restart-dsh.sh.
if [ "$PROFILE_PRESENT" -eq 1 ]; then
  ( cd "$PLUGIN_DIR" && node tests/structural.test.mjs >/dev/null 2>&1 ) \
    && ok "structural gate exit 0" || bad "structural gate gagal"
  ( cd "$PLUGIN_DIR" && node tests/skill-load.test.mjs >/dev/null 2>&1 ) \
    && ok "skill-load e2e gate exit 0 (27/27 via host provider)" || bad "skill-load e2e gate gagal"
  ( cd "$PLUGIN_DIR" && node tests/e2e-handler.test.mjs >/dev/null 2>&1 ) \
    && ok "e2e handler gate exit 0" || bad "e2e handler gate gagal"
  ( cd "$PLUGIN_DIR" && node tests/command-routing.test.mjs >/dev/null 2>&1 ) \
    && ok "command routing gate exit 0 (9/9)" || bad "command routing gate gagal"
else
  ok "structural/e2e/routing: skipped (no profile; run 'npm test' directly)"
fi
echo
if [ "$FAIL" -eq 0 ]; then
  if [ "$PROFILE_PRESENT" -eq 1 ]; then
    echo "RESULT: PASS — plugin terpasang, termount, dan loadable"
  else
    echo "RESULT: PASS — disk contract OK (host-state steps skipped: no web profile on this machine)"
  fi
else
  echo "RESULT: FAIL — ada baris FAIL di atas, jangan considersudah selesai"
fi
exit "$FAIL"
