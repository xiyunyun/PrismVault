import fs from 'fs'
import path from 'path'
import { app } from 'electron'
// eslint-disable-next-line @typescript-eslint/no-require-imports
import { DatabaseSync } from 'node:sqlite'

let dbInstance: DatabaseSync | null = null
let dbFilePath = ''
let defaultCacheDirPath = ''
let activeCacheDirPath = ''
let defaultClipboardDirPath = ''
let activeClipboardDirPath = ''

export function getDataRoot(): string {
  if (process.env.XIYUN_DATA_DIR) {
    return process.env.XIYUN_DATA_DIR
  }
  return path.join(app.getPath('userData'), 'xiyun-data')
}

export function getDbPath(): string {
  return dbFilePath
}

export function getDefaultThumbCacheDir(): string {
  return defaultCacheDirPath
}

export const THUMB_SUBDIRS = ['models', 'cad'] as const

export function ensureThumbSubdirs(baseDir: string): void {
  fs.mkdirSync(baseDir, { recursive: true })
  for (const sub of THUMB_SUBDIRS) {
    fs.mkdirSync(path.join(baseDir, sub), { recursive: true })
  }
}

export function getThumbCacheDir(): string {
  return activeCacheDirPath || defaultCacheDirPath
}

export function getModelThumbCacheDir(): string {
  const dir = path.join(getThumbCacheDir(), 'models')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function getCadThumbCacheDir(): string {
  const dir = path.join(getThumbCacheDir(), 'cad')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function setThumbCacheDir(dirPath: string): string {
  const target = dirPath && dirPath.trim() ? path.resolve(dirPath.trim()) : defaultCacheDirPath
  ensureThumbSubdirs(target)
  activeCacheDirPath = target
  return activeCacheDirPath
}

export function getDefaultClipboardDir(): string {
  return defaultClipboardDirPath
}

export function getClipboardDir(): string {
  return activeClipboardDirPath || defaultClipboardDirPath
}

export function setClipboardDir(dirPath: string): string {
  const target = dirPath && dirPath.trim() ? path.resolve(dirPath.trim()) : defaultClipboardDirPath
  fs.mkdirSync(target, { recursive: true })
  activeClipboardDirPath = target
  return activeClipboardDirPath
}

export function getDb(): DatabaseSync {
  if (!dbInstance) {
    throw new Error('Database has not been initialized yet.')
  }
  return dbInstance
}

export function initDatabase(): DatabaseSync {
  if (dbInstance) return dbInstance

  const dataRoot = getDataRoot()
  fs.mkdirSync(dataRoot, { recursive: true })

  defaultCacheDirPath = path.join(dataRoot, 'thumbs')
  ensureThumbSubdirs(defaultCacheDirPath)
  activeCacheDirPath = defaultCacheDirPath

  defaultClipboardDirPath = path.join(dataRoot, 'clipboard')
  fs.mkdirSync(defaultClipboardDirPath, { recursive: true })
  activeClipboardDirPath = defaultClipboardDirPath

  dbFilePath = path.join(dataRoot, 'library.db')
  const db = new DatabaseSync(dbFilePath)

  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec('PRAGMA synchronous = NORMAL;')
  db.exec('PRAGMA temp_store = MEMORY;')
  db.exec('PRAGMA cache_size = -16000;')

  db.exec(`
    CREATE TABLE IF NOT EXISTS source_roots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      alias TEXT NOT NULL,
      watch_enabled INTEGER NOT NULL DEFAULT 0,
      ignore_patterns TEXT NOT NULL DEFAULT '["node_modules",".git","$RECYCLE.BIN","System Volume Information","Thumbs.db",".DS_Store"]',
      last_scanned_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      root_id INTEGER NOT NULL REFERENCES source_roots(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL UNIQUE,
      file_name TEXT NOT NULL,
      ext TEXT NOT NULL,
      media_type TEXT NOT NULL CHECK(media_type IN ('image','video','audio','text','model','other')),
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      file_size INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      modified_at INTEGER NOT NULL,
      fingerprint TEXT,
      width INTEGER,
      height INTEGER,
      duration REAL,
      extra_meta TEXT,
      note TEXT NOT NULL DEFAULT '',
      thumb_path TEXT,
      text_snippet TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','missing','hidden')),
      indexed_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_assets_root_id ON assets(root_id);
    CREATE INDEX IF NOT EXISTS idx_assets_media_type ON assets(media_type);
    CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
    CREATE INDEX IF NOT EXISTS idx_assets_fingerprint ON assets(fingerprint);
    CREATE INDEX IF NOT EXISTS idx_assets_created ON assets(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_assets_modified ON assets(modified_at DESC);
    CREATE INDEX IF NOT EXISTS idx_assets_size ON assets(file_size DESC);
    CREATE INDEX IF NOT EXISTS idx_assets_name ON assets(file_name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_assets_status_modified ON assets(status, modified_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_assets_status_created ON assets(status, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_assets_status_size ON assets(status, file_size DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_assets_status_type ON assets(status, media_type);
    CREATE INDEX IF NOT EXISTS idx_assets_status_root ON assets(status, root_id);
    CREATE INDEX IF NOT EXISTS idx_assets_status_indexed ON assets(status, indexed_at DESC);

    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6366f1',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS asset_groups (
      asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (asset_id, group_id)
    );

    CREATE INDEX IF NOT EXISTS idx_asset_groups_group ON asset_groups(group_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS assets_fts USING fts5(
      file_name,
      note,
      file_path,
      content='assets',
      content_rowid='id',
      tokenize='unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS assets_ai AFTER INSERT ON assets BEGIN
      INSERT INTO assets_fts(rowid, file_name, note, file_path)
      VALUES (new.id, new.file_name, new.note, new.file_path);
    END;

    CREATE TRIGGER IF NOT EXISTS assets_ad AFTER DELETE ON assets BEGIN
      INSERT INTO assets_fts(assets_fts, rowid, file_name, note, file_path)
      VALUES ('delete', old.id, old.file_name, old.note, old.file_path);
    END;

    CREATE TRIGGER IF NOT EXISTS assets_au AFTER UPDATE OF file_name, note, file_path ON assets BEGIN
      INSERT INTO assets_fts(assets_fts, rowid, file_name, note, file_path)
      VALUES ('delete', old.id, old.file_name, old.note, old.file_path);
      INSERT INTO assets_fts(rowid, file_name, note, file_path)
      VALUES (new.id, new.file_name, new.note, new.file_path);
    END;

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)

  // Seamless schema migration for v0.1.0/v0.2.0 databases whose assets.media_type CHECK lacked 'model'
  try {
    const tableRow = db
      .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'assets'`)
      .get() as { sql?: string } | undefined
    if (tableRow?.sql && !tableRow.sql.includes("'model'")) {
      db.exec('PRAGMA foreign_keys = OFF;')
      db.exec('BEGIN;')
      try {
        db.exec(`
          DROP TRIGGER IF EXISTS assets_ai;
          DROP TRIGGER IF EXISTS assets_ad;
          DROP TRIGGER IF EXISTS assets_au;

          CREATE TABLE assets_v3_migrated (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            root_id INTEGER NOT NULL REFERENCES source_roots(id) ON DELETE CASCADE,
            file_path TEXT NOT NULL UNIQUE,
            file_name TEXT NOT NULL,
            ext TEXT NOT NULL,
            media_type TEXT NOT NULL CHECK(media_type IN ('image','video','audio','text','model','other')),
            mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
            file_size INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            modified_at INTEGER NOT NULL,
            fingerprint TEXT,
            width INTEGER,
            height INTEGER,
            duration REAL,
            extra_meta TEXT,
            note TEXT NOT NULL DEFAULT '',
            thumb_path TEXT,
            text_snippet TEXT,
            status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','missing','hidden')),
            indexed_at INTEGER NOT NULL
          );

          INSERT INTO assets_v3_migrated SELECT * FROM assets;
          DROP TABLE assets;
          ALTER TABLE assets_v3_migrated RENAME TO assets;

          CREATE INDEX IF NOT EXISTS idx_assets_root_id ON assets(root_id);
          CREATE INDEX IF NOT EXISTS idx_assets_media_type ON assets(media_type);
          CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
          CREATE INDEX IF NOT EXISTS idx_assets_fingerprint ON assets(fingerprint);
          CREATE INDEX IF NOT EXISTS idx_assets_created ON assets(created_at DESC);
          CREATE INDEX IF NOT EXISTS idx_assets_modified ON assets(modified_at DESC);
          CREATE INDEX IF NOT EXISTS idx_assets_size ON assets(file_size DESC);
          CREATE INDEX IF NOT EXISTS idx_assets_name ON assets(file_name COLLATE NOCASE);
          CREATE INDEX IF NOT EXISTS idx_assets_status_modified ON assets(status, modified_at DESC, id DESC);
          CREATE INDEX IF NOT EXISTS idx_assets_status_created ON assets(status, created_at DESC, id DESC);
          CREATE INDEX IF NOT EXISTS idx_assets_status_size ON assets(status, file_size DESC, id DESC);
          CREATE INDEX IF NOT EXISTS idx_assets_status_type ON assets(status, media_type);
          CREATE INDEX IF NOT EXISTS idx_assets_status_root ON assets(status, root_id);
          CREATE INDEX IF NOT EXISTS idx_assets_status_indexed ON assets(status, indexed_at DESC);

          CREATE TRIGGER IF NOT EXISTS assets_ai AFTER INSERT ON assets BEGIN
            INSERT INTO assets_fts(rowid, file_name, note, file_path)
            VALUES (new.id, new.file_name, new.note, new.file_path);
          END;

          CREATE TRIGGER IF NOT EXISTS assets_ad AFTER DELETE ON assets BEGIN
            INSERT INTO assets_fts(assets_fts, rowid, file_name, note, file_path)
            VALUES ('delete', old.id, old.file_name, old.note, old.file_path);
          END;

          CREATE TRIGGER IF NOT EXISTS assets_au AFTER UPDATE OF file_name, note, file_path ON assets BEGIN
            INSERT INTO assets_fts(assets_fts, rowid, file_name, note, file_path)
            VALUES ('delete', old.id, old.file_name, old.note, old.file_path);
            INSERT INTO assets_fts(rowid, file_name, note, file_path)
            VALUES (new.id, new.file_name, new.note, new.file_path);
          END;

          UPDATE assets
          SET media_type = 'model'
          WHERE media_type = 'other'
            AND LOWER(ext) IN ('.obj', '.fbx', '.glb', '.gltf', '.stl', '.ply', '.dwg', '.dxf');

          INSERT INTO assets_fts(assets_fts) VALUES('rebuild');
        `)
        db.exec('COMMIT;')
      } catch (err) {
        db.exec('ROLLBACK;')
        throw err
      } finally {
        db.exec('PRAGMA foreign_keys = ON;')
      }
    }
  } catch (err) {
    console.warn('[DB] media_type migration warning:', err)
  }

  // Seamless v0.5.0 column migration: is_favorite + dominant_colors + composite indexes
  try {
    const cols = db.prepare(`PRAGMA table_info(assets)`).all() as Array<{ name: string }>
    const colNames = new Set(cols.map((c) => c.name))
    if (!colNames.has('is_favorite')) {
      db.exec(`ALTER TABLE assets ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;`)
    }
    if (!colNames.has('dominant_colors')) {
      db.exec(`ALTER TABLE assets ADD COLUMN dominant_colors TEXT;`)
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_assets_status_favorite ON assets(status, is_favorite, modified_at DESC);
      CREATE INDEX IF NOT EXISTS idx_assets_status_ext ON assets(status, ext);
    `)
  } catch (err) {
    console.warn('[DB] v0.5.0 column migration warning:', err)
  }

  // Apply custom thumbnail cache directory if user configured one
  try {
    const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'thumbCacheDir'`).get() as
      | { value: string }
      | undefined
    if (row?.value) {
      const parsed = JSON.parse(row.value)
      if (typeof parsed === 'string' && parsed.trim()) {
        const customPath = path.resolve(parsed.trim())
        ensureThumbSubdirs(customPath)
        activeCacheDirPath = customPath
      }
    }
  } catch {
    // Fallback gracefully to default cache dir if custom drive is currently disconnected
    activeCacheDirPath = defaultCacheDirPath
  }

  // Apply custom clipboard import directory if user configured one
  try {
    const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'clipboardDir'`).get() as
      | { value: string }
      | undefined
    if (row?.value) {
      const parsed = JSON.parse(row.value)
      if (typeof parsed === 'string' && parsed.trim()) {
        const customPath = path.resolve(parsed.trim())
        fs.mkdirSync(customPath, { recursive: true })
        activeClipboardDirPath = customPath
      }
    }
  } catch {
    activeClipboardDirPath = defaultClipboardDirPath
  }

  dbInstance = db
  return db
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
  }
}
