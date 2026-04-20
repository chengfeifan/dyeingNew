#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# 备份配置
BACKUP_DIR="/var/backups/sqlite"        # 备份目录
KEEP_DAYS=14                              # 保留最近 N 天备份
NAME="appdb"                            # 备份文件前缀

# SQLite 数据库路径：可通过 DB_FILE 覆盖
DB_FILE="${DB_FILE:-${HISTORY_DIR:-$(pwd)/spectra_history}/history.db}"

if [[ ! -f "$DB_FILE" ]]; then
  echo "❌ SQLite 数据库不存在: $DB_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +"%Y%m%d_%H%M%S")"
BACKUP_FILE="$BACKUP_DIR/${NAME}_${TIMESTAMP}.sqlite"

# sqlite3 .backup 可保证在线备份一致性
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_FILE" ".backup '$BACKUP_FILE'"
else
  cp "$DB_FILE" "$BACKUP_FILE"
fi

# 压缩备份文件
if command -v gzip >/dev/null 2>&1; then
  gzip -f "$BACKUP_FILE"
  BACKUP_FILE="${BACKUP_FILE}.gz"
fi

# 清理超期备份
find "$BACKUP_DIR" -maxdepth 1 -type f -name "${NAME}_*.sqlite*" -mtime +"$KEEP_DAYS" -delete

echo "✅ 数据库备份完成: $BACKUP_FILE"
