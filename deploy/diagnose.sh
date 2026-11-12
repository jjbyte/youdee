#!/usr/bin/env bash
#
# 只读诊断：一条命令把"现在跑的到底是什么"打全。用法（在发布目录里）：
#
#   cd /opt/youdee && sudo bash deploy/diagnose.sh
#
# 它不改任何东西（不启停服务、不写文件），只读：
#   1) systemd 单元的真实配置（工作目录、启动命令、可写路径）
#   2) /health 的原样返回（版本、版本来源、构建戳、进程 cwd、运行时长）
#   3) 磁盘与进程两侧是否对得上：package.json 版本、.next/BUILD_ID、端口监听者
#
# 为什要单独有一个：出问题时最怕"看不到"，而 journal 里通常只有一句 Ready。
# 0.1.27~0.1.29 三连败期间，唯一能确定的事全靠手动敲下面的命令去拼，拼错一条就白跑一轮。
set -uo pipefail

say() { echo "[diag] $*"; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE="${SERVICE:-youdee}"
PORT="${PORT:-3000}"
BASE_URL="${BASE_URL:-http://127.0.0.1:$PORT}"

# 看错目录 = 看错结论。本脚本只读，但同样以单元的工作目录为准：
# 0.1.31 那次失败，脚本在 /opt/youdee-old 里看"磁盘版本 0.1.31"，而线上跑的是 /opt/youdee 的 0.1.30。
UNIT_DIR="$(systemctl show -p WorkingDirectory "$SERVICE" 2>/dev/null | sed -n 's/^WorkingDirectory=//p' | tr -d '\r' || true)"
UNIT_DIR="${UNIT_DIR#-}"
SCRIPT_ROOT="$ROOT"
if [ -n "$UNIT_DIR" ] && [ "${UNIT_DIR%/}" != "$ROOT" ]; then
  ROOT="${UNIT_DIR%/}"
  say "注意：脚本在 $SCRIPT_ROOT，但 $SERVICE 的工作目录是 $ROOT —— 下面按 $ROOT 看，那才是线上。"
fi

# 每一段都单独兜底：某个信息取不到不该让整份诊断停在那里。
# 先把执行的命令打出来（对方照抄就能自己再跑一次），再打输出；末尾补空行，
# 因为 `cat BUILD_ID` 这类输出常常不带换行，会把下一段的标题挤到同一行里。
run() { echo "[diag]   $*"; bash -c "$*" 2>&1 | sed 's/^/[diag]     /'; echo; }

say "发布目录 $ROOT"
say "服务单元 $SERVICE / 端口 $PORT"

say "1) 单元配置"
run "systemctl show -p WorkingDirectory -p ExecStart -p ReadWritePaths '$SERVICE' | tr ';' '\n' | sed 's/argv\\[\\]=//'"

say "2) 服务状态"
run "systemctl --no-pager -l status '$SERVICE' | head -12"

say "3) /health 原样"
run "node -e 'fetch(process.argv[1],{signal:AbortSignal.timeout(3000)}).then(r=>r.json()).then(j=>console.log(JSON.stringify(j.data,null,2))).catch(e=>console.log(\"ERR \"+((e.cause&&e.cause.code)||e.name)))' '$BASE_URL/api/v1/health'"

say "3.5) 谁是线上？进程 cwd / 单元目录 / 这份脚本 三方对照"
LIVE_CWD="$(node -e '
  fetch(process.argv[1], { signal: AbortSignal.timeout(3000) })
    .then((r) => r.json()).then((j) => console.log((j.data && j.data.cwd) || ""))
    .catch(() => console.log(""));
' "$BASE_URL/api/v1/health" 2>/dev/null | tr -d '\r' || true)"
echo "[diag]   进程 cwd            ${LIVE_CWD:-（取不到；对面可能是 0.1.29 之前、不报 cwd 的版本）}"
echo "[diag]   单元 WorkingDirectory ${UNIT_DIR:-（未声明）}"
echo "[diag]   本脚本所在目录      $SCRIPT_ROOT"
if [ -n "$LIVE_CWD" ]; then
  if [ "${LIVE_CWD%/}" = "${UNIT_DIR%/}" ]; then
    echo "[diag]   → 一致：服务跑的正是单元声明的目录"
  else
    echo "[diag]   → ★ 不一致：进程在 $LIVE_CWD，单元写的是 ${UNIT_DIR:-空}。改单元那个目录以外的地方都不会生效"
  fi
fi
echo

# 同一台机器上常有 -old / -failed / -next 好几个完整目录，谁是哪一版肉眼分不清。
# 0.1.31 那次「磁盘版本 0.1.31、线上却报 0.1.30」的答案就在这里。
say "3.6) 各候选目录的版本 / BUILD_ID"
for d in "$(dirname "$ROOT")"/"$(basename "$ROOT")"*; do
  [ -d "$d" ] || continue
  if [ -f "$d/package.json" ]; then
    v="$(node -e 'try{console.log(require(process.argv[1]).version)}catch{console.log("?")}' "$d/package.json" 2>/dev/null || echo '?')"
  else
    v="（无 package.json）"
  fi
  b="$(cat "$d/.next/BUILD_ID" 2>/dev/null || true)"
  mark=""
  # 「单元指向」必须在单元真的声明了目录时才标：没有 WorkingDirectory 时 ROOT 是脚本目录，
  # 无条件打这个标记会让人以为"单元就是这个目录"，正好和这一节要回答的问题相反。
  [ -n "$UNIT_DIR" ] && [ "${d%/}" = "${UNIT_DIR%/}" ] && mark=" ← 单元指向"
  [ "${d%/}" = "${LIVE_CWD%/}" ] && mark="$mark ← 进程所在"
  echo "[diag]   $(basename "$d")  版本=$v  BUILD_ID=${b:-无}$mark"
done
echo

say "4) 磁盘上的这份代码"
run "grep -m1 '\"version\"' '$ROOT/package.json' 2>/dev/null || echo '读不到 package.json'"
run "cat '$ROOT/.next/BUILD_ID' 2>/dev/null || echo '没有 .next/BUILD_ID（未构建或构建失败）'"
run "stat -c '%y  %n' '$ROOT/.next/BUILD_ID' '$ROOT/package.json' 2>/dev/null"
run "ls -ld '$ROOT' '$ROOT/.env' '$ROOT/.next' '$ROOT/.next/cache' 2>/dev/null"

say "5) 端口的监听者（应该只有一个，且属于 $SERVICE 的进程）"
# CentOS 7 的 ss 不认 -H 和过滤表达式，旧写法在这台机器上一直是空输出 —— 空输出比报错更误导
if command -v ss >/dev/null 2>&1; then
  ss -lntp 2>/dev/null | awk -v p="$PORT" 'NR==1 || ($1 ~ /^tcp/ && (n=split($4,a,":")) && a[n]==p)'
  echo
elif command -v netstat >/dev/null 2>&1; then
  netstat -lntp 2>/dev/null | awk -v p="$PORT" 'NR<3 || ($1 ~ /^tcp/ && (n=split($4,a,":")) && a[n]==p)'
  echo
else
  say "  本机没有 ss / netstat，跳过"
fi

say "6) 目录往来（有过多少次更新/回滚）"
run "ls -d $(dirname "$ROOT")/$(basename "$ROOT")-* 2>/dev/null || echo '没有 -old / -failed / -next 目录，说明没走到切换这一步'"

say "7) 服务日志尾部"
run "journalctl -u '$SERVICE' -n 30 --no-pager"

say "把上面整段发出来即可定位；不要凭猜测改文件。"
