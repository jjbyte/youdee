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
# 0.1.30 又补了三处，都是 0.1.27~0.1.29 三连败逼出来的：
#   1) /health 现在返回 version（读自磁盘 package.json）+ version_source + build_id。
#      旧实现只回一个来自 npm 环境变量的版本号，0.1.29 上线时它报 0.1.27，而磁盘和交付包
#      都是 0.1.29 —— 屏幕上只剩一个来源不明的数字，分不清"代码旧"还是"变量旧"。
#   2) 判断达标不再用字符串相等，改成 check_out() 逐项比并说出原因。
#      字符串比较已经害过两次（`|| true` 写错位置 → 版本号里混进 " || true)"）。
#   3) 换完目录立刻核对磁盘版本；6/6 失败时 dump_truth() 把"版本 / 构建产物 / 端口归属 /
#      单元配置"一次打全。上一轮只有 journal，而 journal 里只有一句 Ready，看不出跑的是谁。
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

# 本次更新的起始时刻（UTC，与 /health 的 build_id 时间对照用）。
# 用途：构建产物若早于这个时刻，说明服务跑的不是这次编出来的 JS。
# 本次更新的起始时刻（epoch 秒），用来判断 BUILD_ID 是不是这次新编出来的产物
RUN_START_EPOCH="$(date +%s)"

# 探一次健康检查。输出四种形态，必须能分开看，排查方向完全不同：
#   status|版本|库|来源|BUILD_ID   正常
#   REFUSED                      端口没人听 —— 进程启动即退出（这是最常见的"起不来"）
#   TIMEOUT                      端口通了，但 3 秒内没答完 —— 多半卡在库连接上，不是没启动
# 0.1.25 首跑时把前两种和后两种混成了同一句"未返回 ok（||）"，白绕一圈。
#
# 为什么要带上"来源"和"BUILD_ID"两个字段：0.1.29 上线时 /health 报 version=0.1.27，
# 而磁盘和交付包都是 0.1.29。旧探针只取三项（status|version|db），于是屏幕上只剩一个
# 无处追查的 0.1.27 —— 是代码旧？是环境变量旧？还是跑的根本不是这次构建？分不出来。
probe() {
  node -e '
    const url = process.argv[1];
    (async () => {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
        const j = await r.json();
        const d = j.data || {};
        // 分隔符与换行若混进内容会撑破字段，统一替换掉
        const f = (x) => (x === undefined || x === null ? "" : String(x).replace(/[|\r\n]/g, "/"));
        console.log([f(d.status), f(d.version), f(d.db), f(d.version_source), f(d.build_id)].join("|"));
      } catch (e) {
        if (e.name === "TimeoutError") { console.log("TIMEOUT"); return; }
        const code = (e.cause && e.cause.code) || e.code || "";
        if (/ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ENOTFOUND/.test(code)) console.log("REFUSED");
        else console.log("ERR:" + (code || e.name || "unknown"));
      }
    })();
  ' "$1" 2>/dev/null | tr -d '\r' || true
}
# 末尾的 `|| true` 不是多余的：脚本开了 pipefail，node 一旦异常退出（缺 node、
# 被 OOM 顺手带走、段错误），整条管道的退出码就是非零，于是 `out="$(probe ...)"`
# 这个**赋值本身**失败，set -e 当场结束脚本——一句提示都不打。
# 探针是"问问对方活着没"，它自己失败应该被当成一种结果（空串），而不是让脚本沉默地死。

# 把 /health 的 data 原样打出来（单行 JSON），排错时看全貌用，不做字段裁剪
probe_raw() {
  node -e '
    fetch(process.argv[1], { signal: AbortSignal.timeout(3000) })
      .then((r) => r.json())
      .then((j) => console.log(JSON.stringify(j.data)))
      .catch((e) => console.log("ERR:" + (((e.cause && e.cause.code) || e.name || "unknown"))));
  ' "$1" 2>/dev/null | tr -d '\r' || true
}

# 判断一次探测结果是否达标：输出 "ok" 或 "bad:原因1；原因2"。
#
# 为什么不再用字符串相等去比（`[ "$out" = "ok|$NEW_VER|ok" ]`）：
#   1) 这套比较已经害了两次 —— `|| true` 写错位置，版本号里混进 " || true)"，明明健康却判失败；
#   2) 一旦不相等，等式只能说"不等"，说不出是版本不对、库不对，还是根本没有应答。
# 判断交给 node：逐项比，并给出人能直接读的原因。
#
# 参数：<探测输出> <期望版本> <期望 BUILD_ID，空=不比> [1=要求版本读自磁盘]
check_out() {
  node -e '
    const [out, want, wantBuildId, strict] = process.argv.slice(1);
    const raw = (out || "").trim();
    let res;
    if (!raw) {
      res = "bad:探针没有输出（本机 node 跑不起来？）";
    } else if (/^(REFUSED|TIMEOUT|ERR:)/.test(raw)) {
      res = "bad:" + raw;
    } else {
      const [status, version, db, source, buildId] = raw.split("|");
      const why = [];
      if (status !== "ok") why.push("status=" + (status || "空"));
      if (version !== want) why.push("version=" + (version || "空") + "（期望 " + want + "）");
      if (db !== "ok") why.push("db=" + (db || "空"));
      // 只在新版本上要求"版本号必须读自磁盘 package.json"：回滚到 0.1.25 这类老版本时，
      // 它们根本没有 version_source 字段，拿这条去卡会让"回滚成功"被误判成失败。
      if (strict === "1" && source !== "package.json") {
        why.push("version_source=" + (source || "空") + "（版本号不是读自磁盘，不可信）");
      }
      // BUILD_ID 是"产物身份"：版本号说明代码是哪一版，它说明 JS 是哪一次编的。
      if (wantBuildId && buildId !== wantBuildId) {
        why.push("build_id=" + (buildId || "空") + "（期望 " + wantBuildId + "，跑的不是这次构建的产物）");
      }
      res = why.length ? "bad:" + why.join("；") : "ok";
    }
    console.log(res);
  ' "$1" "$2" "${3:-}" "${4:-1}" || true
}

# 出问题时把"该看的东西"一次摊开：版本、构建产物、端口归属、单元配置。
# 上一轮失败只打了 journal，而 journal 里只有一句 Ready —— 看不出跑的是哪个目录、
# 版本号从哪来、端口是谁在听，于是只能猜，一个 0.1.27 猜了三轮。
dump_truth() {
  warn "现场（先看这几行，比 journal 有用）："
  warn "  /health 全量：$(probe_raw "$BASE_URL/api/v1/health")"
  warn "  磁盘版本 $ROOT/package.json：$(version_of "$ROOT/package.json" 2>/dev/null || echo 读不出)"
  warn "  交付包版本 $PKG：${NEW_VER:-未解析}"
  warn "  发布目录指向：$(readlink -f "$ROOT" 2>/dev/null || echo 读不出)（$(ls -ld "$ROOT" 2>/dev/null | awk '{print $1, $3":"$4}' || true)）"
  warn "  .next/BUILD_ID：$(cat "$ROOT/.next/BUILD_ID" 2>/dev/null || echo 缺失)（$(stat -c '%y' "$ROOT/.next/BUILD_ID" 2>/dev/null || echo 无时间)）"
  if command -v ss >/dev/null 2>&1; then
    warn "  端口 $PORT 的监听者：$(ss -lntpH "sport = :$PORT" 2>/dev/null | tail -n +2 | tr '\n' ' ' || true)"
  fi
  warn "  单元 WorkingDirectory：$(systemctl show -p WorkingDirectory "$SERVICE" 2>/dev/null | sed -n 's/^WorkingDirectory=//p' || true)"
  warn "  单元 ExecStart：$(systemctl show -p ExecStart "$SERVICE" 2>/dev/null | sed -n 's/^ExecStart=//p' | cut -c1-160 || true)"
}


OLD_VER="$(version_of "$ROOT/package.json")"
[ -n "$OLD_VER" ] || die "读不出线上版本（$ROOT/package.json 损坏？）"

# 包里的版本：直接从包内单取 package.json，不解压整包
# `|| true` 必须放在 **$() 里面**（紧跟在 node 之后）。放到右括号外面就变成普通字符串，
# 版本号会变成 "0.1.27 || true)"，于是探针拿 ok|0.1.27|ok 永远比不上 ok|0.1.27 || true)|ok，
# 健康状况全对却报"自检未通过"——0.1.27 第二次上线就是这么挂的。
NEW_VER="$(tar -xzOf "$PKG" ./package.json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).version)}catch{console.log("")}})' || true)"
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

# `systemctl show --value` 是 systemd 230+ 才有的，CentOS 7（219）会直接报用法错误；
# 上一版就是靠"取不到 → 退回默认 youdee"碰巧对上的。这里改成任何版本都能用的写法。
RUN_USER="${RUN_USER:-$(systemctl show -p User "$SERVICE" 2>/dev/null | sed -n 's/^User=//p' || true)}"
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
FREE_KB="$(df -Pk "$PARENT" 2>/dev/null | awk 'NR==2{print $4}' || true)"
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

# 记下这次构建的"产物身份"，6/6 要拿它跟 /health 报出来的比对。
# 版本号只能证明代码是哪一版，BUILD_ID 才能证明跑的是**这次编出来的** JS ——
# 两者缺一，就会出现"数字对、跑的其实是旧产物"这种最难查的状态。
NEW_BUILD_ID="$(cat "$NEXT_DIR/.next/BUILD_ID" 2>/dev/null | tr -d '\r\n' || true)"
[ -n "$NEW_BUILD_ID" ] || die "构建产物里没有 .next/BUILD_ID —— 构建没真正完成，线上未受影响（仍是 $OLD_VER）"
BID_MTIME="$(stat -c %Y "$NEXT_DIR/.next/BUILD_ID" 2>/dev/null || echo 0)"
if [ "${BID_MTIME:-0}" -lt "$RUN_START_EPOCH" ] 2>/dev/null; then
  warn "BUILD_ID 的修改时间早于本次更新开始时间 —— 这份产物不是这次新编的（构建被跳过了？）"
  warn "  产物 $NEXT_DIR/.next/BUILD_ID 时间 $(date -d "@$BID_MTIME" '+%F %T' 2>/dev/null || echo 未知)，本次开始 $(date -d "@$RUN_START_EPOCH" '+%F %T' 2>/dev/null || echo 未知)"
  rm -rf "$NEXT_DIR"
  die "已中止：线上未受影响（仍是 $OLD_VER）。删掉新目录后重跑，注意看 3/6 的构建日志。"
fi
say "    本次构建产物 BUILD_ID=$NEW_BUILD_ID"

# ── 单元文件引用的可写目录必须先存在 ────────────────────────────────────
# systemd 给服务建挂载命名空间时，ReadWritePaths 里的路径**不存在**就直接失败：
#   Failed to set up mount namespacing: /run/systemd/unit-root/opt/youdee/public/uploads:
#   No such file or directory        → status=226/NAMESPACE
# 报错只有这一句，完全指不到"少建了一个空目录"。而空目录最容易被丢：
# tar 未必带上、git 不跟踪空目录、Turbopack 也不像 webpack 那样一定生成 .next/cache。
#
# 教训（0.1.27 首轮真实宕机）：**不要按 .env 里的 UPLOAD_DIR 猜路径**。
# 生产上 UPLOAD_DIR 的取值和单元文件写死的 public/uploads 并不一致，猜就补错了地方，
# 预启动自检还照样通过（它直接跑 next start，绕过了 systemd 沙箱），一路到 6/6 才炸。
# 正确做法：把单元里声明的每一条，按 $ROOT→$NEXT_DIR 映射，逐条落成真实目录。
UNIT_RW="$(systemctl show -p ReadWritePaths "$SERVICE" 2>/dev/null | sed -n 's/^ReadWritePaths=//p' || true)"
for rw in $UNIT_RW; do
  rw="${rw#-}"                      # 单元里写 "-/path" 表示"可选"，前缀要去掉
  case "$rw" in
    "$ROOT"/*) rel="${rw#"$ROOT"/}" ;;
    *) continue ;;                  # 不在发布目录里（如 /var/lib/xxx），不归这份脚本管
  esac
  [ -n "$rel" ] || continue
  mkdir -p "$NEXT_DIR/$rel"
  chown -R "$RUN_USER:$RUN_USER" "$NEXT_DIR/$rel" 2>/dev/null || true
  say "    已备好单元要求的可写目录：$rel"
done

# 兜底：单元没声明 ReadWritePaths 的部署，至少把 .env 里的上传目录与 .next/cache 建出来
mkdir -p "$NEXT_DIR/.next/cache"
case "$UPLOAD_DIR" in
  /*) mkdir -p "$UPLOAD_DIR"; chown -R "$RUN_USER:$RUN_USER" "$UPLOAD_DIR" 2>/dev/null || true ;;
  *)  mkdir -p "$NEXT_DIR/$UPLOAD_DIR" ;;
esac
chown -R "$RUN_USER:$RUN_USER" "$NEXT_DIR/.next/cache" 2>/dev/null || true

# 附件实体也要跟着走：上面只建了空目录。判断依据是"目录在发布目录里且确实存在"，
# 不看 UPLOAD_DIR——历史附件可能躺在 public/uploads，而 .env 早改成了别的值。
# 漏搬的后果是切过去之后合同附件全部 404，文件却还好端端躺在旧目录里。
for src in "$ABS_UPLOAD" "$ROOT/public/uploads" "$ROOT/var/uploads"; do
  [ -n "$src" ] && [ -d "$src" ] || continue
  case "$src" in "$ROOT"/*) ;; *) continue ;; esac
  rel="${src#"$ROOT"/}"
  [ "$rel" = "$UPLOAD_DIR" ] && continue   # 前面已经搬过
  mkdir -p "$NEXT_DIR/$rel"
  cp -a "$src/." "$NEXT_DIR/$rel/" 2>/dev/null || true
done

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

  pf=""; pf_why=""
  for _ in $(seq 1 25); do
    out="$(probe "$PF_URL/api/v1/health")"
    pf_why="$(check_out "$out" "$NEW_VER" "$NEW_BUILD_ID")"
    if [ "$pf_why" = "ok" ]; then pf="yes"; break; fi
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
    # `|| true` 必须留：端口清干净后 grep 无匹配、退出码 1，pipefail 会把这个
    # 赋值判成失败，set -e 直接结束脚本。0.1.27 首跑就是死在这一行——
    # 预启动明明 ✓ Ready，却既没打印"自检通过"也没打印失败日志，回到提示符。
    still="$(ss -lntpH "sport = :$PF_PORT" 2>/dev/null | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2 || true)"
    if [ -n "${still:-}" ]; then
      kill -9 "$still" 2>/dev/null || true
      warn "备用端口 $PF_PORT 仍有残留进程（pid $still），已强杀"
    fi
  fi

  if [ -z "$pf" ]; then
    warn "预启动自检未通过：新版本 $NEW_VER 在 :$PF_PORT 上没通过健康检查"
    warn "  最后一次探测：${out:-无响应}（格式 status|version|db|version_source|build_id）"
    warn "  不达标原因：${pf_why#bad:}"
    case "$out" in
      REFUSED)  warn "  $PF_URL 拒绝连接 —— 进程启动即退出，下面的日志里会有真正的死因" ;;
      TIMEOUT)  warn "  端口通了但 /health 3 秒内没答完 —— 进程在跑，卡在库连接之类的外部依赖上" ;;
      "ok|$NEW_VER|error|"*)
                warn "  版本对，但库连不上。这次更新与库无关：先确认 DATABASE_URL 与数据库是否可达" ;;
      "")       warn "  探针没跑出结果，先确认本机能跑 node -v" ;;
    esac
    warn "  新版本自己的启动日志（$PF_LOG）："
    sed -n '1,60p' "$PF_LOG" 2>/dev/null | sed 's/^/    /' >&2 || true
    rm -rf "$NEXT_DIR"
    die "已中止：线上仍是 $OLD_VER，这一次服务没停过、库没动过。按上面的原因修好再重发。"
  fi
  say "    预启动自检通过：$NEW_VER 在 :$PF_PORT 应答 ok，版本读自磁盘、BUILD_ID 与本次构建一致"
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

# ── rollback ────────────────────────────────────────────────────────────
# 定义在换目录**之前**：换完目录如果磁盘上的版本就不对，要在那一刻当场回滚，
# 而不是等 6/6 起完服务再发现 —— 那会多一次本来不必要的停服。
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
    # 第四个参数 0 = 不要求 version_source（回滚目标可能是没有这个字段的老版本）
    if [ "$(check_out "$last" "$OLD_VER" "" 0)" = "ok" ]; then rb="yes"; break; fi
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

# ── 5/6 换目录 ──────────────────────────────────────────────────────────
say "5/6 切换目录"
if [ -e "$PREV_DIR" ]; then
  mv "$PREV_DIR" "$PREV_DIR.$TS"
  warn "上一次的旧目录已改名为 $PREV_DIR.$TS（确认稳定后可删）"
fi
mv "$ROOT" "$PREV_DIR"
mv "$NEXT_DIR" "$ROOT"

# 换完立刻核对**磁盘**，别急着起服务。
# 这一条是 0.1.29 那次失败逼出来的：6/6 的健康检查报了 0.1.27（既不是旧的 0.1.25，
# 也不是新的 0.1.29），而脚本直到那一刻都还在假定"目录已经换好了"。真实情况完全可能相反 ——
# 新目录没上位（目标被占用/是挂载点/切换命令没生效），跑的还是另一份代码。
# 在起服务之前把"磁盘上是哪个版本"验一遍，就能把"代码问题"和"切换问题"分开。
SWAPPED_VER="$(version_of "$ROOT/package.json")"
if [ "$SWAPPED_VER" != "$NEW_VER" ]; then
  warn "换目录后磁盘版本不对：$ROOT/package.json = ${SWAPPED_VER:-读不出}，期望 $NEW_VER"
  warn "  这不是代码的问题，是切换没把新目录放到 $ROOT 上（目标被占用、挂载点、属主/权限都可能）"
  dump_truth
  rollback
fi
say "    已切换：$ROOT/package.json = $SWAPPED_VER"

# ── 6/6 起服务并核对版本 ────────────────────────────────────────────────
say "6/6 启动服务"
systemctl start "$SERVICE" || rollback

# 健康检查：版本号 + 来源 + BUILD_ID，是这次更新唯一能证明"跑的是新代码 + 新产物"的证据。
# 少任何一项都会留下"数字对但来源不明"的空档 —— 0.1.29 就是卡在这个空档里。
say "    等待 $BASE_URL/api/v1/health 就绪（要求 status=ok / version=$NEW_VER / db=ok / 版本读自磁盘 / BUILD_ID=$NEW_BUILD_ID）"
okflag=""; out_why=""
for _ in $(seq 1 40); do
  out="$(probe "$BASE_URL/api/v1/health")"
  out_why="$(check_out "$out" "$NEW_VER" "$NEW_BUILD_ID" 1)"
  if [ "$out_why" = "ok" ]; then okflag="yes"; break; fi
  sleep 2
done

if [ -z "$okflag" ]; then
  warn "健康检查未在 80 秒内达标（最后一次：${out:-无响应}）"
  warn "  不达标原因：${out_why#bad:}"
  case "$out" in
    REFUSED)  warn "  $BASE_URL 拒绝连接：进程启动即退出 / 被 OOM 杀掉 / 端口被别的进程占着" ;;
    TIMEOUT)  warn "  端口通了但 3 秒内没答完：进程在跑，卡在库连接等外部依赖上" ;;
    "ok|$OLD_VER|"*) warn "  应答正常但还是旧版本 $OLD_VER —— 旧进程没死，新进程起不来（端口被占）" ;;
    "")       warn "  探针本身没出结果，先确认本机 node 能跑（node -v）" ;;
  esac
  dump_truth
  warn "服务状态（前 20 行）："
  systemctl --no-pager -l status "$SERVICE" 2>&1 | head -20 | sed 's/^/    /' >&2 || true
  warn "服务日志（最后 40 行；完整：journalctl -u $SERVICE -n 200 --no-pager）："
  journalctl -u "$SERVICE" -n 40 --no-pager 2>&1 | sed 's/^/    /' >&2 || true
  rollback
fi

say "完成：$OLD_VER → $NEW_VER"
say "健康检查：$(probe_raw "$BASE_URL/api/v1/health")"
say ""
say "建议接着跑一次业务自检（会写入 1 张客户名为「自检样例」的报价单，看到后作废即可）："
say "  cd $ROOT && BASE_URL=$BASE_URL node deploy/verify.mjs"
say ""
say "回滚入口（代码）："
say "  systemctl stop $SERVICE && mv $ROOT $FAILED_DIR && mv $PREV_DIR $ROOT && systemctl start $SERVICE"
say "清理（确认稳定后）：rm -rf $PREV_DIR* $PARENT/$BASE-backup/<更早的目录>"
