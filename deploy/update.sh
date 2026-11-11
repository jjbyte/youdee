#!/usr/bin/env bash
#
# 更新线上版本（systemd 直装，非 Docker）。
#
#   cd /opt/youdee
#   sudo bash deploy/update.sh /tmp/youdee-0.1.25-20261111.tar.gz
#
# 为什么不直接「停服务 → 解包覆盖 → 起服务」：
#   1) next start 从 .next 读静态 chunk，npm ci 又会先清 node_modules。解包 + 装依赖 +
#      构建要两三分钟，这几分钟里页面白屏或 404，跑到一半的进程连 require 都会失败。
#   2) tar 覆盖解包**不会删掉**新版本里已经删掉的文件。被移除的路由会残留、被重新编译
#      进产物，"代码里明明删了却还生效"这类问题事后极难查。所以要解到干净目录整体切换。
#   3) prisma migrate deploy 只有 up、没有 down。库备份是唯一真正的回滚手段，
#      必须在迁移之前完成，且要能在切回去之后还原。
#
# 顺序：备份（库 / 附件 / .env）→ 解到旁目录 → 装依赖 + 构建（线上照常跑）
#       → 预启动自检（新版本先在备用端口跑一份，验通了才动线上）
#       → 停服务 → 迁移 → 换目录 → 起服务 → 校验版本
# 停机窗口只剩「停 → 迁移 → 换 → 起」这几秒。
#
# 0.1.26 起加了「预启动自检」（步骤 3.5）。0.1.25 首跑踩到的坑：
# 只在切完目录后才做健康检查，于是"新版本起不来"的代价是——线上停过一次、库迁过、
# 再整目录回滚。用户看到的就是一次真实宕机，而脚本能给的信息只有一句
# 「（最后一次：||）」，连是"连不上"还是"版本不符"都分不清。
# 现在改成：新版本先在 :PORT+1 以服务用户的身份起一份，健康检查通过才继续；
# 不通就把日志打屏、删掉旁目录、脚本退出，线上一次都没停过。
#
# 可选环境变量：
#   SERVICE=youdee          systemd 单元名
#   RUN_USER=youdee         目标属主，默认读单元文件里的 User=
#   BASE_URL=...            校验地址，默认 http://127.0.0.1:<.env 里的 PORT>
#   PREFLIGHT=0             跳过预启动自检（不推荐：那等于把新版本起不来的风险留给线上）
#   PREFLIGHT_PORT=3101     预启动用的端口，默认 PORT+1
#   ALLOW_NO_DB_BACKUP=1    没有 pg_dump 也继续（不推荐：等于放弃回滚）
set -euo pipefail

say() { echo "[update] $*"; }
warn() { echo "[update] !! $*" >&2; }
die() { echo "[update] 失败：$*" >&2; exit 1; }

PKG="${1:-}"
[ -n "$PKG" ] || die "用法：sudo bash deploy/update.sh <交付包.tar.gz>"
[ -f "$PKG" ] || die "找不到交付包：$PKG"
case "$PKG" in *.tar.gz|*.tgz) ;; *) die "交付包应当是 .tar.gz：$PKG" ;; esac

[ "$(id -u)" -eq 0 ] || die "需要 root（要动 systemd 和 /opt 属主）：请用 sudo bash $0 ..."
command -v systemctl >/dev/null 2>&1 || die "本机没有 systemctl，这份脚本只适用于 systemd 直装"

# 路径全部按绝对路径算好再动目录：换目录那一瞬间 $ROOT 会短暂不存在，
# 若此时还在用相对路径（或 cwd 恰好在 $ROOT 里），后续命令会莫名其妙地找不到东西。
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PARENT="$(dirname "$ROOT")"
BASE="$(basename "$ROOT")"
NEXT_DIR="$PARENT/$BASE-next"
PREV_DIR="$PARENT/$BASE-old"
FAILED_DIR="$PARENT/$BASE-failed.$(date +%Y%m%d-%H%M%S)"
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$PARENT/$BASE-backup/$TS"
SERVICE="${SERVICE:-youdee}"

say "线上目录 $ROOT"
say "服务单元 $SERVICE"

[ -f "$ROOT/.env" ] || die "$ROOT/.env 不存在。更新不会重建它——里面是数据库口令和 JWT 密钥，丢了没法复原。先确认部署目录对不对。"
systemctl cat "$SERVICE" >/dev/null 2>&1 || die "systemd 里没有 $SERVICE 单元。若单元名不同，用 SERVICE=名字 再跑一次。"

version_of() {
  node -e 'const fs=require("node:fs");try{console.log(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).version)}catch{console.log("")}' "$1"
}

# 探一次健康检查。输出四种形态，必须能分开看，排查方向完全不同：
#   ok|版本|ok      正常
#   ok|版本|error   进程在跑、版本对，但库连不上（跟这次更新无关，先查 DATABASE_URL）
#   REFUSED         端口没人听 —— 进程启动即退出（这是最常见的"起不来"）
#   TIMEOUT         端口通了，但 3 秒内没答完 —— 多半卡在库连接上，不是没启动
# 0.1.25 首跑时把前两种和后两种混成了同一句"未返回 ok（||）"，白绕一圈。
probe() {
  node -e '
    const url = process.argv[1];
    (async () => {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
        const j = await r.json();
        const d = j.data || {};
        console.log(`${d.status||""}|${d.version||""}|${d.db||""}`);
      } catch (e) {
        if (e.name === "TimeoutError") { console.log("TIMEOUT"); return; }
        const code = (e.cause && e.cause.code) || e.code || "";
        if (/ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ENOTFOUND/.test(code)) console.log("REFUSED");
        else console.log("ERR:" + (code || e.name || "unknown"));
      }
    })();
  ' "$1" 2>/dev/null | tr -d '\r'
}

OLD_VER="$(version_of "$ROOT/package.json")"
[ -n "$OLD_VER" ] || die "读不出线上版本（$ROOT/package.json 损坏？）"

# 包里的版本：直接从包内单取 package.json，不解压整包
NEW_VER="$(tar -xzOf "$PKG" ./package.json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).version)}catch{console.log("")}})')"
[ -n "$NEW_VER" ] || die "$PKG 里取不到 package.json —— 包不完整，或不是本项目的交付包（根目录应对应 ./）"

say "版本 $OLD_VER → $NEW_VER"
if [ "$OLD_VER" = "$NEW_VER" ]; then
  warn "新旧版本号相同。若是修配置/重跑部署可以继续；若是发布新版本，检查 package.json 是否忘了升版本"
fi

# ── 包完整性 ────────────────────────────────────────────────────────────
# 交付包带着 .sha256 就当场校验：传一半的包解出来是残缺的，
# 而残缺的具体表现是构建期某个 module not found，报错完全指不到"包没传完"。
if [ -f "$PKG.sha256" ]; then
  if ( cd "$(dirname "$PKG")" && sha256sum -c "$(basename "$PKG").sha256" >/dev/null 2>&1 ); then
    say "sha256 校验通过"
  else
    die "sha256 与 $PKG.sha256 不符：包在传输中损坏，或文件被替换过。重新上传后再试。"
  fi
else
  warn "没找到 $PKG.sha256，跳过完整性校验（建议连同校验值一起上传）"
fi

# ── 读 .env（不覆盖后文，只为拿 DATABASE_URL / UPLOAD_DIR / PORT）──────
set -a
# shellcheck disable=SC1090,SC1091
. "$ROOT/.env"
set +a
: "${DATABASE_URL:?.env 里缺 DATABASE_URL}"
PORT="${PORT:-3000}"
BASE_URL="${BASE_URL:-http://127.0.0.1:$PORT}"
UPLOAD_DIR="${UPLOAD_DIR:-var/uploads}"
UPLOAD_DIR="${UPLOAD_DIR%$'\r'}"

RUN_USER="${RUN_USER:-$(systemctl show -p User --value "$SERVICE" 2>/dev/null || true)}"
RUN_USER="${RUN_USER:-youdee}"

# ── 1/6 备份 ────────────────────────────────────────────────────────────
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
cp -a "$ROOT/.env" "$BACKUP_DIR/env"
cp -a "$ROOT/package.json" "$BACKUP_DIR/package.json"
say "1/6 备份到 $BACKUP_DIR"

ABS_UPLOAD="$UPLOAD_DIR"
case "$UPLOAD_DIR" in /*) ;; *) ABS_UPLOAD="$ROOT/$UPLOAD_DIR" ;; esac
if [ -d "$ABS_UPLOAD" ]; then
  tar -czf "$BACKUP_DIR/uploads.tar.gz" -C "$(dirname "$ABS_UPLOAD")" "$(basename "$ABS_UPLOAD")" 2>/dev/null \
    && say "    附件已备份（$(du -sh "$ABS_UPLOAD" 2>/dev/null | cut -f1)）" \
    || warn "附件备份失败（目录可能在别处或没权限），请确认 $ABS_UPLOAD 是重要资料的唯一副本"
else
  warn "附件目录 $ABS_UPLOAD 不存在，跳过"
fi

if command -v pg_dump >/dev/null 2>&1; then
  # `?schema=public` 是 Prisma 的私有参数，libpq（pg_dump / pg_restore）不认，
  # 会直接报 "invalid URI query parameter: schema"。而 README 里的连接串示例恰好带着它，
  # 照着抄过来就会让备份失败、整次更新中止。所以备份前把查询串去掉。
  PG_URL="${DATABASE_URL%%\?*}"
  if pg_dump "$PG_URL" -Fc -f "$BACKUP_DIR/db.dump" 2>"$BACKUP_DIR/db.err"; then
    say "    数据库已备份（$(du -h "$BACKUP_DIR/db.dump" | cut -f1)）"
  else
    warn "pg_dump 失败：$(tail -3 "$BACKUP_DIR/db.err" | tr '\n' ' ')"
    [ "${ALLOW_NO_DB_BACKUP:-0}" = "1" ] || die "迁移前必须有库备份。装好 postgresql-client 后重试，或 ALLOW_NO_DB_BACKUP=1 强行继续（放弃回滚）。"
  fi
else
  warn "本机没有 pg_dump（postgresql-client 未安装）"
  [ "${ALLOW_NO_DB_BACKUP:-0}" = "1" ] || die "迁移前必须有库备份。装 postgresql-client 后重试，或 ALLOW_NO_DB_BACKUP=1 强行继续（放弃回滚）。"
fi

# ── 2/6 解到旁目录 ──────────────────────────────────────────────────────
# 更新期间新旧两套 node_modules + .next 同时存在，约需 1.5GB。空间不够时构建会失败，
# 但报错是夹在 npm 输出里的 ENOSPC，很容易被当成依赖问题查半天。这里提前说一声。
FREE_KB="$(df -Pk "$PARENT" 2>/dev/null | awk 'NR==2{print $4}')"
if [ -n "${FREE_KB:-}" ] && [ "$FREE_KB" -lt 1572864 ] 2>/dev/null; then
  warn "$PARENT 所在分区仅剩 $((FREE_KB / 1024))MB，更新需要约 1.5GB（新旧两套依赖并存）"
  warn "  建议先删掉历史 /opt/youdee-old* 与较早的备份目录，再继续"
fi

say "2/6 解包到 $NEXT_DIR"
rm -rf "$NEXT_DIR"
mkdir -p "$NEXT_DIR"
tar -xzf "$PKG" -C "$NEXT_DIR"
# 包不包含 .env（pack.sh 明确排除），用线上正在用的那份
cp -a "$BACKUP_DIR/env" "$NEXT_DIR/.env"
# Turbopack 在目标机失败过的记号要跟着走，否则每次更新都白试一次编译
[ -f "$ROOT/.build-via-webpack" ] && cp -a "$ROOT/.build-via-webpack" "$NEXT_DIR/.build-via-webpack"

# 附件目录若在发布目录内（相对路径，如 public/uploads），先预热复制一份。
# 备份阶段已经打包过，这里是为了让新目录自包含；停机后再补一次增量，
# 免得停机窗口里为了几百兆附件干等。
if [ "${UPLOAD_DIR#/}" = "$UPLOAD_DIR" ] && [ -d "$ABS_UPLOAD" ]; then
  mkdir -p "$NEXT_DIR/$(dirname "$UPLOAD_DIR")"
  cp -a "$ABS_UPLOAD" "$NEXT_DIR/$(dirname "$UPLOAD_DIR")/" 2>/dev/null || true
fi

# ── 3/6 装依赖 + 构建（线上此时仍正常服务）─────────────────────────────
say "3/6 在新目录装依赖并构建（线上照常运行；这一步最慢，可以另开窗口 tail -f）"
if ! ( cd "$NEXT_DIR" && SKIP_MIGRATE=1 SKIP_SEED=1 bash deploy/manual-deploy.sh ); then
  rm -rf "$NEXT_DIR"
  die "构建失败，线上版本未受影响（仍是 $OLD_VER）。日志见 /tmp/youdee-build.log。"
fi

# 属主在切目录前就改好：chown 一整个 node_modules 要几秒，不该占停机窗口
chown -R "$RUN_USER:$RUN_USER" "$NEXT_DIR" 2>/dev/null || warn "chown 到 $RUN_USER 失败，请手动确认属主"

# ── 单元文件引用的可写目录必须先存在 ────────────────────────────────────
# deploy/youdee.service 里有 ReadWritePaths=/opt/youdee/public/uploads 与 /opt/youdee/.next/cache。
# systemd 给服务建挂载命名空间时，这两个路径**不存在**就直接失败，单位停在
# status=226/NAMESPACE，而报错只有一句 "Failed to set up mount namespacing: No such file or directory"，
# 完全指不到"少建了一个空目录"。偏偏空目录最容易被丢：tar 未必带上、git 不跟踪空目录、
# Turbopack 构建也不像 webpack 那样一定生成 .next/cache。
# 无条件补建，成本为零，能挡掉一整类"新版本起不来"。
mkdir -p "$NEXT_DIR/.next/cache"
case "$UPLOAD_DIR" in
  /*) mkdir -p "$UPLOAD_DIR"; chown -R "$RUN_USER:$RUN_USER" "$UPLOAD_DIR" 2>/dev/null || true ;;
  *)  mkdir -p "$NEXT_DIR/$UPLOAD_DIR" ;;
esac
chown -R "$RUN_USER:$RUN_USER" "$NEXT_DIR/.next/cache" 2>/dev/null || true

# ── 3.5/6 预启动自检：新版本先在备用端口起一份，验通了才动线上 ──────────
if [ "${PREFLIGHT:-1}" = "1" ]; then
  PF_PORT="${PREFLIGHT_PORT:-$((PORT + 1))}"
  if command -v ss >/dev/null 2>&1; then
    for cand in $((PORT + 1)) $((PORT + 2)) $((PORT + 3)); do
      if ! ss -lntH "sport = :$cand" 2>/dev/null | grep -q .; then PF_PORT="$cand"; break; fi
    done
  fi
  PF_LOG=/tmp/youdee-preflight.log
  PF_URL="http://127.0.0.1:$PF_PORT"
  say "3.5/6 预启动自检：新版本先在 :$PF_PORT 起一份（线上照常运行）"

  # 切到服务用户跑。root 能跑而 youdee 不能，正是"构建成功、启动即退出"最常见的原因
  # （文件属主、UPLOAD_DIR 写权限、HOME 不可写、node 不在该用户的 PATH 里）。
  # 只有换身份跑才暴露得出来；以 root 试跑会一路通过，然后线上失败。
  if command -v runuser >/dev/null 2>&1; then
    RUN_AS() { runuser -u "$RUN_USER" -- "$@"; }
  elif command -v sudo >/dev/null 2>&1; then
    RUN_AS() { sudo -u "$RUN_USER" -- "$@"; }
  else
    warn "没有 runuser / sudo，预启动只能用当前用户（root）跑，权限类问题查不出来"
    RUN_AS() { "$@"; }
  fi

  ( cd "$NEXT_DIR" && RUN_AS env NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
      npx --no-install next start -H 127.0.0.1 -p "$PF_PORT" ) >"$PF_LOG" 2>&1 &
  PF_PID=$!

  pf=""
  for _ in $(seq 1 25); do
    out="$(probe "$PF_URL/api/v1/health")"
    if [ "$out" = "ok|$NEW_VER|ok" ]; then pf="yes"; break; fi
    # 进程已经退出就别干等满 50 秒
    kill -0 "$PF_PID" 2>/dev/null || break
    sleep 2
  done

  # 收尾：npx 会 fork 出 node 子进程，只杀父进程留不住——先按端口精确匹配地清理，
  # 再确认端口真的空了（残留进程会一直占着备用端口，下次更新就选不到它了）
  pkill -f "next start -H 127.0.0.1 -p $PF_PORT" 2>/dev/null || true
  kill "$PF_PID" 2>/dev/null || true
  wait "$PF_PID" 2>/dev/null || true
  if command -v ss >/dev/null 2>&1; then
    sleep 1
    still="$(ss -lntpH "sport = :$PF_PORT" 2>/dev/null | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)"
    if [ -n "${still:-}" ]; then
      kill -9 "$still" 2>/dev/null || true
      warn "备用端口 $PF_PORT 仍有残留进程（pid $still），已强杀"
    fi
  fi

  if [ -z "$pf" ]; then
    warn "预启动自检未通过：新版本 $NEW_VER 起不来（最后一次探测：${out:-无响应}）"
    case "$out" in
      REFUSED)  warn "  $PF_URL 拒绝连接 —— 进程启动即退出，下面的日志里会有真正的死因" ;;
      TIMEOUT)  warn "  端口通了但 /health 3 秒内没答完 —— 进程在跑，卡在库连接之类的外部依赖上" ;;
      "ok|$NEW_VER|error")
                warn "  版本对，但库连不上。这次更新与库无关：先确认 DATABASE_URL 与数据库是否可达" ;;
      "")       warn "  探针没跑出结果，先确认本机能跑 node -v" ;;
      *)        warn "  进程在跑但状态不对：status|version|db = $out" ;;
    esac
    warn "  新版本自己的启动日志（$PF_LOG）："
    sed -n '1,60p' "$PF_LOG" 2>/dev/null | sed 's/^/    /' >&2 || true
    rm -rf "$NEXT_DIR"
    die "已中止：线上仍是 $OLD_VER，这一次服务没停过、库没动过。按上面的日志修好再重发。"
  fi
  say "    预启动自检通过：$NEW_VER 在 :$PF_PORT 应答 ok，版本与库都对"
fi

# 单元文件若也跟着改了，提醒去更新（脚本不改 /etc，那是系统配置，不该被应用包悄悄覆盖）
if [ -f "$NEXT_DIR/deploy/youdee.service" ] && ! diff -q "$ROOT/deploy/youdee.service" "$NEXT_DIR/deploy/youdee.service" >/dev/null 2>&1; then
  warn "本次 deploy/youdee.service 有变化。启动后请手动对比并更新 /etc/systemd/system/$SERVICE.service，"
  warn "  然后 systemctl daemon-reload（否则新单元里的 Environment / 加固项不会生效）"
fi

# ── 4/6 停机 → 迁移 ─────────────────────────────────────────────────────
say "4/6 停止服务并执行数据库迁移"
systemctl stop "$SERVICE"

# 停机后再补一次增量：构建那几分钟里可能有人刚传了附件
if [ "${UPLOAD_DIR#/}" = "$UPLOAD_DIR" ] && [ -d "$ABS_UPLOAD" ]; then
  cp -a "$ABS_UPLOAD/." "$NEXT_DIR/$UPLOAD_DIR/" 2>/dev/null || true
fi

if ! ( cd "$NEXT_DIR" && set -a && . ./.env && set +a && npx --no-install prisma migrate deploy ); then
  warn "迁移失败。服务已停，现在把旧目录换回去并启动，库未变（migrate deploy 单条失败会整体中止）"
  rm -rf "$NEXT_DIR"
  systemctl start "$SERVICE" || true
  die "迁移失败，已回滚到 $OLD_VER 并重启。库备份在 $BACKUP_DIR/db.dump"
fi

# 种子：以"库里有几个用户"为闸门，生产库已有用户时是空操作
if [ "${SEED_ON_BOOT:-1}" = "1" ]; then
  say "    灌入种子（已有数据会自动跳过）"
  ( cd "$NEXT_DIR" && npx --no-install tsx prisma/seed.ts ) || warn "种子执行失败，不影响启动；确认新增的默认设置行是否缺失"
fi

# ── 5/6 换目录 ──────────────────────────────────────────────────────────
say "5/6 切换目录"
if [ -e "$PREV_DIR" ]; then
  mv "$PREV_DIR" "$PREV_DIR.$TS"
  warn "上一次的旧目录已改名为 $PREV_DIR.$TS（确认稳定后可删）"
fi
mv "$ROOT" "$PREV_DIR"
mv "$NEXT_DIR" "$ROOT"

rollback() {
  warn "校验未通过，回滚到 $OLD_VER"
  systemctl stop "$SERVICE" || true
  [ -d "$ROOT" ] && mv "$ROOT" "$FAILED_DIR"
  mv "$PREV_DIR" "$ROOT"
  systemctl start "$SERVICE" || true

  # "已回滚"这句话本身也要验：如果回滚后服务同样起不来，那现在是一次真正的宕机，
  # 得立刻把该看的东西摊在屏幕上，而不是等人下次登录才发现。
  local rb="" last=""
  for _ in $(seq 1 15); do
    last="$(probe "$BASE_URL/api/v1/health")"
    if [ "$last" = "ok|$OLD_VER|ok" ]; then rb="yes"; break; fi
    sleep 2
  done

  if [ -n "$rb" ]; then
    warn "代码已回滚，线上已恢复（$OLD_VER 应答正常）。被换下的新版本留在 $FAILED_DIR（别急着删，排错要看）"
  else
    warn "！！回滚后线上仍未恢复（最后一次探测：${last:-无响应}）——现在是一次真实宕机，优先把服务弄起来"
    warn "   1) journalctl -u $SERVICE -n 200 --no-pager"
    warn "   2) ls -ld $ROOT $ROOT/.env $ROOT/.next $ROOT/.next/cache $ABS_UPLOAD"
    warn "   3) cd $ROOT && sudo -u $RUN_USER env NODE_ENV=production npx --no-install next start -p 3100"
    warn "   被换下的新版本在 $FAILED_DIR，出问题的旧痕迹在 $PREV_DIR*"
  fi

  if [ -f "$BACKUP_DIR/db.dump" ]; then
    warn "若新版本迁移已改库、导致旧代码不正常，用备份还原（会丢掉迁移之后的写入）："
    warn "  pg_restore -d \"${PG_URL:-$DATABASE_URL}\" -c --if-exists $BACKUP_DIR/db.dump"
  fi
  exit 1
}

# ── 6/6 起服务并核对版本 ────────────────────────────────────────────────
say "6/6 启动服务"
systemctl start "$SERVICE" || rollback

# 健康检查：版本号是这次更新唯一能一眼确认"跑的是新代码"的证据
say "    等待 $BASE_URL/api/v1/health 就绪"
ok=""
for _ in $(seq 1 40); do
  out="$(probe "$BASE_URL/api/v1/health")"
  [ "$out" = "ok|$NEW_VER|ok" ] && { ok="yes"; break; }
  sleep 2
done

if [ -z "$ok" ]; then
  warn "健康检查未在 80 秒内返回 ok / 版本 $NEW_VER / 库 ok（最后一次：${out:-无响应}）"
  case "$out" in
    REFUSED)  warn "  $BASE_URL 拒绝连接：进程启动即退出 / 被 OOM 杀掉 / 端口被别的进程占着" ;;
    TIMEOUT)  warn "  端口通了但 3 秒内没答完：进程在跑，卡在库连接等外部依赖上" ;;
    "ok|$OLD_VER|ok") warn "  应答正常但还是旧版本 $OLD_VER —— 旧进程没死，新进程起不来（端口被占）" ;;
    "ok|$NEW_VER|error") warn "  新版本已起来，但库连不上" ;;
    "")       warn "  探针本身没出结果，先确认本机 node 能跑（node -v）" ;;
    *)        warn "  进程在跑但状态不对：status|version|db = $out" ;;
  esac
  warn "服务状态（前 20 行）："
  systemctl --no-pager -l status "$SERVICE" 2>&1 | head -20 | sed 's/^/    /' >&2 || true
  warn "服务日志（最后 40 行；完整：journalctl -u $SERVICE -n 200 --no-pager）："
  journalctl -u "$SERVICE" -n 40 --no-pager 2>&1 | sed 's/^/    /' >&2 || true
  rollback
fi

say "完成：$OLD_VER → $NEW_VER"
say "健康检查：$(node -e 'fetch(process.argv[1]).then(r=>r.json()).then(j=>console.log(JSON.stringify(j.data)))' "$BASE_URL/api/v1/health" 2>/dev/null || echo '读取失败')"
say ""
say "建议接着跑一次业务自检（会写入 1 张客户名为「自检样例」的报价单，看到后作废即可）："
say "  cd $ROOT && BASE_URL=$BASE_URL node deploy/verify.mjs"
say ""
say "回滚入口（代码）："
say "  systemctl stop $SERVICE && mv $ROOT $FAILED_DIR && mv $PREV_DIR $ROOT && systemctl start $SERVICE"
say "清理（确认稳定后）：rm -rf $PREV_DIR* $PARENT/$BASE-backup/<更早的目录>"
