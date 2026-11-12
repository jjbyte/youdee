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

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE="${SERVICE:-youdee}"
PORT="${PORT:-3000}"
BASE_URL="${BASE_URL:-http://127.0.0.1:$PORT}"

say() { echo "[diag] $*"; }
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

say "4) 磁盘上的这份代码"
run "grep -m1 '\"version\"' '$ROOT/package.json' 2>/dev/null || echo '读不到 package.json'"
run "cat '$ROOT/.next/BUILD_ID' 2>/dev/null || echo '没有 .next/BUILD_ID（未构建或构建失败）'"
run "stat -c '%y  %n' '$ROOT/.next/BUILD_ID' '$ROOT/package.json' 2>/dev/null"
run "ls -ld '$ROOT' '$ROOT/.env' '$ROOT/.next' '$ROOT/.next/cache' 2>/dev/null"

say "5) 端口的监听者（应该只有一个，且属于 $SERVICE 的进程）"
if command -v ss >/dev/null 2>&1; then
  run "ss -lntpH 'sport = :$PORT'"
else
  say "  本机没有 ss，跳过"
fi

say "6) 目录往来（有过多少次更新/回滚）"
run "ls -d $(dirname "$ROOT")/$(basename "$ROOT")-* 2>/dev/null || echo '没有 -old / -failed / -next 目录，说明没走到切换这一步'"

say "7) 服务日志尾部"
run "journalctl -u '$SERVICE' -n 30 --no-pager"

say "把上面整段发出来即可定位；不要凭猜测改文件。"
