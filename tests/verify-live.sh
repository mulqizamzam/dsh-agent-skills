#!/usr/bin/env bash
# Post-restart verification untuk dsh-agent-skills.
#
# Subagent reports are advisory only — see docs/verification-policy.md: verify
# every acceptance criterion against disk state and this script's exit code.
#
# Exit codes:
#   0 — everything registered
#   10 — DSH web GUI unreachable (host down)
#   11 — plugin symlink missing (install step 3 not run)
#   12 — plugin module failed to load (step 2 symlinks broken)
#   13 — profile package.json missing dependency/bundles entry (step 3 wrong profile)
#   14 — catalog count mismatch / malformed SKILL.md / derived count wrong
#   15 — a static gate from the test suite failed (structural, skill-load,
#        e2e handler, command routing, flow command)
# Precedence rule: when multiple failures occur, the lowest exit code
# (numerically smallest) is reported. I.e., exit code 10 takes precedence
# over 11, 12, 13, 14.
#
# Jalankan SETELAH restart-dsh.sh selesai:
#   bash /home/administrator/agent-workspace/project/dsh-agent-skills/tests/verify-live.sh
#
# Gate ini read-only: hanya membaca profil, symlink, modul, dan gateway lokal.
#
# Catatan arsitektur: plugin ini di-mount lewat `dsh.profile.bundles` di
# profile `package.json`. Saat pnpm resolve dependency, bundle auto-join
# layer stack. `cordis.patch.yml` profil tidak wajib — mount terjadi lewak
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
EXIT_CODE=0

# Skip the host-state steps (1-4) when the profile is not present on this
# machine, so the disk-contract checks (5-6) stay runnable on a fresh clone.
# Without this, RESULT: PASS on CI would be a statement about a host that
# does not exist here.
PROFILE_PRESENT=0
[ -d "$PROFILE_NM" ] && PROFILE_PRESENT=1

ok()   { printf 'PASS %s\n' "$1"; }
bad()  { printf 'FAIL %s\n' "$1"; }

set_exit_code() {
  local new_code=$1
  if [ "$EXIT_CODE" -eq 0 ]; then
    EXIT_CODE=$new_code
  elif [ "$new_code" -lt "$EXIT_CODE" ]; then
    EXIT_CODE=$new_code
  fi
}

# Derived counts. The shipped skill count is read from lib/counts.js rather
# than written into this file, so adding a skill needs no edit here. A broken
# counter must fail, not print an empty number that reads as a pass.
derive_count() {
  node --input-type=module -e "
import { pathToFileURL } from 'node:url';
const mod = await import(pathToFileURL(process.argv[1]).href);
process.stdout.write(String(mod[process.argv[2]]()));
" "$PLUGIN_DIR/lib/counts.js" "$1" 2>/dev/null
}

SKILL_COUNT=$(derive_count countSkills)
case "$SKILL_COUNT" in
  ''|*[!0-9]*)
    bad "lib/counts.js countSkills() tidak menghasilkan angka: '${SKILL_COUNT}'"
    set_exit_code 14
    SKILL_COUNT='?' ;;
esac

# Total registered commands: the nine skill aliases plus the /flow workflow
# command. Derived, so the count in the status lines below cannot drift.
COMMAND_COUNT=$(derive_count countTotalCommands)
case "$COMMAND_COUNT" in
  ''|*[!0-9]*)
    bad "lib/counts.js countTotalCommands() tidak menghasilkan angka: '${COMMAND_COUNT}'"
    set_exit_code 14
    COMMAND_COUNT='?' ;;
esac

# A derived number that nobody asserts is decoration. command-routing.test.mjs
# below never reads counts.js, so without this line a mutation that makes
# countTotalCommands() return the wrong total just prints in a PASS status
# line. The expectation is stated here on purpose: it is the same 9 aliases +
# /flow that tests/e2e-handler.test.mjs asserts.
if [ "$COMMAND_COUNT" != '10' ]; then
  bad "lib/counts.js countTotalCommands() = '${COMMAND_COUNT}', expected 10 (9 skill aliases + /flow)"
  set_exit_code 14
fi

# 1. HTTP probe web GUI
# curl already writes 000 to stdout on transport failure, so a `|| echo 000`
# fallback appends a SECOND 000 and yields "000000". Drop the fallback.
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:13080/)
if [ "$code" = 200 ]; then
  ok "web GUI HTTP $code"
else
  bad "web GUI HTTP $code (harusnya 200)"
  set_exit_code 10
fi

# 2. Symlink plugin ter-resolve
if [ "$PROFILE_PRESENT" -eq 1 ]; then
  [ -L "$PROFILE_NM/dsh-agent-skills" ] \
    && ok "symlink dsh-agent-skills ada di node_modules profil" \
    || { bad "symlink dsh-agent-skills tidak ada di node_modules profil"; set_exit_code 11; }
else
  ok "symlink: skipped (no profile on this machine)"
fi

# 3. Modul plugin benar-benar loadable dari symlink profil
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
    set_exit_code 12
    printf '%s\n' "$load_out" | sed 's/^/    /' >&2
  fi
else
  ok "modul loadability: skipped (no profile on this machine)"
fi

# 4. Profil package.json punya dependency + bundles entry (jalur mount)
if [ "$PROFILE_PRESENT" -eq 1 ]; then
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
  || { bad "package.json: dependency/bundles entry dsh-agent-skills hilang (plugin tidak akan mount)"; set_exit_code 13; }
else
  ok "package.json: skipped (no profile on this machine)"
fi

# 5. Gate disk skill contract — capture output so a failure is diagnosable,
#    not just a bare exit code (the old >/dev/null swallowed the reason).
catalog_out=$(node "$PLUGIN_DIR/tests/verify-catalog-live.mjs" 2>&1)
catalog_rc=$?
if [ "$catalog_rc" -eq 0 ]; then
  ok "$SKILL_COUNT skill name valid, 0 mismatch name!==dir"
else
  bad "verify-catalog-live gagal (exit $catalog_rc):"
  set_exit_code 14
  printf '%s\n' "$catalog_out" | sed 's/^/    /' >&2
fi

# 6. Gerbang statis lokal masih hijau.
# When the web profile is absent (fresh clone / CI), the harness's pnpm cache
# may not contain yaml@2.9.0 either, so structural.test.mjs could fail for
# environment reasons. Skip these steps so `RESULT: PASS` does not punish a
# clean checkout on a machine that never ran restart-dsh.sh.
if [ "$PROFILE_PRESENT" -eq 1 ]; then
  # Every gate below has to be able to fail this script. The previous version
  # printed FAIL and still exited 0, so a red gate read as "RESULT: PASS" to
  # the operator running it after a restart. Measured: with a deliberately
  # broken count the script printed FAIL and exited 0.
  gate() {
    local file=$1 label=$2
    if ( cd "$PLUGIN_DIR" && node "tests/$file" >/dev/null 2>&1 ); then
      ok "$label"
    else
      bad "$label"
      set_exit_code 15
    fi
  }
  gate structural.test.mjs "structural gate exit 0"
  gate skill-load.test.mjs "skill-load e2e gate exit 0 ($SKILL_COUNT/$SKILL_COUNT via host provider)"
  gate e2e-handler.test.mjs "e2e handler gate exit 0"
  gate command-routing.test.mjs "command routing gate exit 0 (${COMMAND_COUNT}/${COMMAND_COUNT})"
  gate flow-command.test.mjs "flow command gate exit 0"
else
  ok "structural/e2e/routing: skipped (no profile; run 'npm test' directly)"
fi
echo
if [ "$EXIT_CODE" -eq 0 ]; then
  if [ "$PROFILE_PRESENT" -eq 1 ]; then
    echo "RESULT: PASS — plugin terpasang, termount, dan loadable"
  else
    echo "RESULT: PASS — disk contract OK (host-state steps skipped: no web profile on this machine)"
  fi
else
  echo "RESULT: FAIL — ada baris FAIL di atas, jangan considersudah selesai"
fi
exit "$EXIT_CODE"