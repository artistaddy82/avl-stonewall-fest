/**
 * deploy.js — SFTP uploader to DreamHost for stonewallfestavl.com
 *
 * Uses ssh2-sftp-client (SFTP on port 22).
 * Reads credentials from .env. Never hardcode secrets here.
 *
 * Usage:
 *   node deploy.js            # deploy site
 *   node deploy.js --dry-run  # list what WOULD upload
 */

require('dotenv').config()
const SftpClient = require('ssh2-sftp-client')
const fs   = require('fs-extra')
const path = require('path')

const SFTP_CONFIG = {
  host:             process.env.FTP_HOST     || 'iad1-shared-b7-02.dreamhost.com',
  port:             parseInt(process.env.FTP_PORT || '22', 10),
  username:         process.env.FTP_USER     || 'general_account',
  password:         process.env.FTP_PASSWORD,
  readyTimeout:     30_000,
  retries:          2,
  retry_minTimeout: 2000,
}

const REMOTE_DIR = process.env.REMOTE_DIR || '/home/general_account/stonewallfestavl.com'
const LOCAL_DIR  = __dirname

const args   = process.argv.slice(2)
const DRY    = args.includes('--dry-run')

const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', '.gitkeep', '.gitignore',
                             'deploy.js', 'package.json', 'package-lock.json', '.env'])

async function* walk(dir, baseDir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (SKIP_FILES.has(entry.name)) continue
    if (entry.name.startsWith('.')) continue
    const localPath = path.join(dir, entry.name)
    const relPath   = path.relative(baseDir, localPath)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      yield* walk(localPath, baseDir)
    } else if (entry.isFile()) {
      yield { localPath, relPath }
    }
  }
}

async function main() {
  if (!DRY && !SFTP_CONFIG.password) {
    console.error('\n✗ Missing FTP_PASSWORD in .env')
    process.exit(1)
  }

  const files = []
  for await (const f of walk(LOCAL_DIR, LOCAL_DIR)) files.push(f)

  if (!files.length) {
    console.error('✗ No files found to deploy')
    process.exit(1)
  }

  console.log(`\n🚀 ${DRY ? 'DRY RUN: ' : ''}Deploying ${files.length} file(s) to ${REMOTE_DIR}\n`)

  if (DRY) {
    files.forEach(f => console.log(`  [dry] ${f.relPath}`))
    return
  }

  const sftp = new SftpClient()
  try {
    await sftp.connect(SFTP_CONFIG)
    console.log(`✓ Connected to ${SFTP_CONFIG.host}\n`)

    const ensuredDirs = new Set()

    if (!(await sftp.exists(REMOTE_DIR))) {
      await sftp.mkdir(REMOTE_DIR, true)
    }
    ensuredDirs.add(REMOTE_DIR)

    let uploaded = 0
    for (const f of files) {
      const remotePath  = `${REMOTE_DIR}/${f.relPath.replace(/\\/g, '/')}`
      const remoteSubdir = path.posix.dirname(remotePath)

      if (!ensuredDirs.has(remoteSubdir)) {
        await sftp.mkdir(remoteSubdir, true)
        ensuredDirs.add(remoteSubdir)
      }

      await sftp.fastPut(f.localPath, remotePath)
      uploaded++
      console.log(`  ✓ ${f.relPath} (${uploaded}/${files.length})`)
    }

    console.log(`\n✅ Done — ${uploaded} file(s) deployed to ${REMOTE_DIR}`)
  } finally {
    await sftp.end()
  }
}

main().catch(err => { console.error('Deploy failed:', err); process.exit(1) })
