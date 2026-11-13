#!/usr/bin/env bash
#
# 部署脚本自检：只跑纯逻辑，不启停服务、不碰数据库、不需要 root，随时可跑。
#
#   bash deploy/test-deploy.sh
#
# 为什么单独有这么一个文件：update.sh 自身的判断错，已经连累过四轮上线 ——
#   0.1.27  `|| true` 写在 $() 外面，版本号变成 "0.1.27 || true)"，健康却判失败
#   0.1.27  `grep` 无匹配 + pipefail，赋值失败让脚本静默退出，一句提示都没有
#   0.1.29  /health 只报一个来源不明的版本号，剩下的只能猜
#   0.1.31  发布目录按脚本位置推断，脚本在 /opt/youdee-old 执行，
#           于是对着一个没人运行的目录"成功"了三次，线上一直没变
# 这些全都是"脚本说成功了/失败了，但说的不是真话"。而它们都能用字符串和假 systemctl 验，
# 不该靠上线去试 —— 一次上线失败的代价是停机 + 回滚 + 一整轮排查。
set -uo pipefail

# Git Bash（MSYS）会把 `/opt/youdee` 这种参数自动改写成 Windows 路径，
# 于是本机跑出来的 cwd 全变成 D:/Program Files/...。Linux 上没有这个概念，
# 关掉只影响本机调试，不改变生产语义。
export MSYS_NO_PATHCONV=1

HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/update.sh"
MD="$HERE/manual-deploy.sh"
[ -f "$SRC" ] || { echo "找不到 $SRC" >&2; exit 1; }
[ -f "$MD" ] || { echo "找不到 $MD" >&2; exit 1; }

pass=0
fail=0
eq() { # <说明> <期望> <实际>
  if [ "$2" = "$3" ]; then
    pass=$((pass + 1)); printf '  \033[32m✓\033[0m %s\n' "$1"
  else
    fail=$((fail + 1)); printf '  \033[31m✗\033[0m %s\n      期望: %s\n      实际: %s\n' "$1" "$2" "$3"
  fi
}

echo "[test] 从 update.sh 里抽函数（保证测的就是线上跑的那份代码）"
SERVICE=youdee
eval "$(awk '/^is_abs\(\)/,/^}/' "$SRC")"
eval "$(awk '/^unit_dir_of\(\)/,/^}/' "$SRC")"
eval "$(awk '/^resolve_root\(\)/,/^}/' "$SRC")"
eval "$(awk '/^check_out\(\)/,/^}/' "$SRC")"
eval "$(awk '/^dir_verdict\(\)/,/^}/' "$MD")"
for fn in is_abs unit_dir_of resolve_root check_out dir_verdict; do
  [ "$(type -t "$fn" 2>/dev/null)" = "function" ] || { echo "抽不出 $fn，脚本的结构变了，先修这个测试脚本" >&2; exit 1; }
done

# ── 假 systemctl ────────────────────────────────────────────────────────
FAKE="$(mktemp -d)"
trap 'rm -rf "$FAKE" 2>/dev/null || true' EXIT
cat >"$FAKE/systemctl" <<'EOS'
#!/bin/sh
if [ "${1:-}" = "show" ]; then printf 'WorkingDirectory=%s\n' "${FAKE_UD:-}"; fi
exit 0
EOS
chmod +x "$FAKE/systemctl"
PATH="$FAKE:$PATH"

# 复刻主流程的两条判定：ROOT 取谁、什么时候必须停下
resolve_case() { # <单元值> <脚本目录> [APP_DIR]  → 打印 "ROOT|是否拦下"
  export FAKE_UD="$1"
  if [ -n "${3:-}" ]; then export APP_DIR="$3"; else unset APP_DIR; fi
  local got root
  got="$(resolve_root "$2")"
  root="${got%%|*}"
  if [ "$root" != "$2" ] && [ -z "${APP_DIR:-}" ]; then printf '%s|拦下' "$root"; else printf '%s|放行' "$root"; fi
}

echo
echo "[test] 1) 发布目录：谁说了算"
eq "单元与脚本目录一致 → 用单元目录，放行" \
  "/opt/youdee|放行" "$(resolve_case /opt/youdee /opt/youdee)"
eq "★ 0.1.31 的根因：脚本在 -old，单元在 /opt/youdee → 必须拦下" \
  "/opt/youdee|拦下" "$(resolve_case /opt/youdee /opt/youdee-old)"
eq "APP_DIR 显式指定 → 用 APP_DIR，放行（允许从别处执行）" \
  "/opt/youdee|放行" "$(resolve_case /opt/youdee /opt/youdee-old /opt/youdee)"
eq "单元没声明 WorkingDirectory → 退回脚本目录，放行（并会打 warn）" \
  "/opt/youdee|放行" "$(resolve_case '' /opt/youdee)"
eq "单元值带 systemd 的 - 前缀 → 剥掉" \
  "/opt/youdee|放行" "$(resolve_case -/opt/youdee /opt/youdee)"
eq "单元值不是绝对路径（异常配置）→ 不采信，退回脚本目录" \
  "/opt/youdee|放行" "$(resolve_case ../../opt/x /opt/youdee)"
eq "尾斜杠不影响判断" \
  "/opt/youdee|放行" "$(resolve_case /opt/youdee/ /opt/youdee)"

echo
echo "[test] 2) 健康检查判定（probe 输出 status|version|db|source|build_id|cwd）"
eq "全对 → ok" \
  "ok" "$(check_out 'ok|0.1.31|ok|package.json|BID1|/opt/youdee' 0.1.31 BID1 1 /opt/youdee)"
eq "★ 版本对、BUILD_ID 对，但进程在另一个目录 → 必须失败（0.1.31 就是这样漏的）" \
  "bad:cwd=/opt/youdee-old（期望 /opt/youdee，进程跑的不是这个目录）" \
  "$(check_out 'ok|0.1.31|ok|package.json|BID1|/opt/youdee-old' 0.1.31 BID1 1 /opt/youdee)"
eq "cwd 末尾多一个斜杠 → 仍算对" \
  "ok" "$(check_out 'ok|0.1.31|ok|package.json|BID1|/opt/youdee/' 0.1.31 BID1 1 /opt/youdee)"
eq "老版本没有 cwd / source 字段 → 回滚判定不能被误伤" \
  "ok" "$(check_out 'ok|0.1.25|ok|||' 0.1.25 '' 0 /opt/youdee)"
eq "版本号对上但 BUILD_ID 是上一次构建 → 失败" \
  "bad:build_id=BID0（期望 BID1，跑的不是这次构建的产物）" \
  "$(check_out 'ok|0.1.31|ok|package.json|BID0|/opt/youdee' 0.1.31 BID1 1 /opt/youdee)"
eq "端口没人听 → 直接报 REFUSED，不装作是版本问题" \
  "bad:REFUSED" "$(check_out 'REFUSED' 0.1.31 BID1 1 /opt/youdee)"

# 0.1.27 那次，`|| true` 写错位置，版本号真的长成了 "0.1.31 || true)"。
# 脏字符里自带 `|`，会把后面的字段整体错位 —— 这里要的就是"每个字段都被念出来"，
# 而不是"看着差不多就放过去"。字符串先放变量：`$()` 里直接写带 `)` 的字面量会提前截断。
dirty='ok|0.1.31 || true)|ok|||'
eq "版本号里混进 [|| true)] → 逐字段报错，不放过（0.1.27 的老坑）" \
  "bad:version=0.1.31 （期望 0.1.31）；db=空；version_source= true)（版本号不是读自磁盘，不可信）；build_id=ok（期望 BID1，跑的不是这次构建的产物）" \
  "$(check_out "$dirty" 0.1.31 BID1 1 /opt/youdee)"

echo
echo "[test] 3) 备用目录构建：manual-deploy 的目录守卫不能被 update.sh 撞上"
# 0.1.32 首次上线真实停在这里：update.sh 在 /opt/youdee-next 里调 manual-deploy.sh 构建，
# 而 manual-deploy 0.1.32 新加的守卫发现「当前目录 ≠ 单元目录」就 exit 1，
# update.sh 把它报成「构建失败」—— 日志里一句编译错误都没有，方向全错。
eq "就在线上目录里 → ok" \
  "ok" "$(dir_verdict /opt/youdee /opt/youdee)"
eq "★ 旁目录构建、调用方没说 APP_DIR → 必须 refuse（0.1.32 首次上线的现场）" \
  "refuse" "$(dir_verdict /opt/youdee-next /opt/youdee)"
eq "旁目录构建 + APP_DIR 显式声明 → override（放行，并打一行留痕）" \
  "override" "$(dir_verdict /opt/youdee-next /opt/youdee /opt/youdee-next)"
eq "单元没声明 WorkingDirectory → ok（无从比较，不拦）" \
  "ok" "$(dir_verdict /opt/youdee-next '')"
eq "尾斜杠不影响判断" \
  "ok" "$(dir_verdict /opt/youdee/ /opt/youdee)"

# 上一组只是把判定函数测通；真正决定线上成败的是 update.sh 有没有把 APP_DIR 传下去。
# 这里直接读源码里那次调用，缺一项就红 —— 免得「函数改好了、调用点忘了改」再来一轮。
CALL_BLOCK="$(awk '/^if ! \( cd "\$NEXT_DIR"/,/^fi$/' "$SRC")"
eq "update.sh 调 manual-deploy 时传了 APP_DIR=\$NEXT_DIR" \
  "有" "$(printf '%s' "$CALL_BLOCK" | grep -q 'APP_DIR="\$NEXT_DIR"' && echo 有 || echo 无)"
eq "同一处仍带 SKIP_MIGRATE=1（迁移要留到停机窗口）" \
  "有" "$(printf '%s' "$CALL_BLOCK" | grep -q 'SKIP_MIGRATE=1' && echo 有 || echo 无)"
eq "同一处仍带 SKIP_SEED=1（种子同理）" \
  "有" "$(printf '%s' "$CALL_BLOCK" | grep -q 'SKIP_SEED=1' && echo 有 || echo 无)"
eq "失败文案不再一律说「构建失败」（要能区分前置检查没过）" \
  "有" "$(printf '%s' "$CALL_BLOCK" | grep -q '前置检查没通过' && echo 有 || echo 无)"

echo
if [ "$fail" -eq 0 ]; then
  printf '\033[32m[test] 全部通过：%d 项\033[0m\n' "$pass"
  exit 0
fi
printf '\033[31m[test] %d 项失败 / 共 %d 项\033[0m\n' "$fail" "$((pass + fail))"
echo "[test] 这些用例对应的都是真实发生过的上线故障，别改断言去迁就实现。" >&2
exit 1
