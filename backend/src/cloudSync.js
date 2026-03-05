const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { google } = require('googleapis');
const { DIRS, listProjects } = require('./storage');

const DRIVE_FOLDER_DEFAULT =
  '1DjFapXNpbkzqmFbiOLYWmgTa2wXjR9dT';

function loadSharedConfig() {
  const candidates = [
    path.join(process.cwd(), 'node-forge.config.json'),
    path.join(DIRS.root, 'node-forge.config.json'),
    path.join(path.dirname(DIRS.root), 'node-forge.config.json')
  ];
  for (const filePath of candidates) {
    if (!filePath) continue;
    if (!fs.existsSync(filePath)) continue;
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch (err) {
      // ignore invalid config
    }
  }
  return null;
}

const sharedConfig = loadSharedConfig() || {};

const CLOUD_CONFIG = {
  folder:
    process.env.NODE_FORGE_DRIVE_FOLDER_ID ||
    sharedConfig.driveFolderId ||
    DRIVE_FOLDER_DEFAULT,
  clientId:
    process.env.NODE_FORGE_DRIVE_CLIENT_ID ||
    sharedConfig.clientId ||
    'REPLACE_ME_CLIENT_ID',
  clientSecret:
    process.env.NODE_FORGE_DRIVE_CLIENT_SECRET ||
    sharedConfig.clientSecret ||
    'REPLACE_ME_CLIENT_SECRET',
  refreshToken:
    process.env.NODE_FORGE_DRIVE_REFRESH_TOKEN ||
    sharedConfig.refreshToken ||
    ''
};

const TOKEN_PATH = path.join(DIRS.root, 'drive-token.json');
let redirectUri = process.env.NODE_FORGE_DRIVE_REDIRECT_URI || '';

function extractFolderId(value) {
  if (!value) return '';
  const text = String(value).trim();
  const match = text.match(/drive\.google\.com\/drive\/folders\/([^/?]+)/i);
  if (match && match[1]) return match[1];
  return text;
}

function isPlaceholder(value, placeholder) {
  return !value || String(value).trim() === placeholder;
}

function isConfigured() {
  if (isPlaceholder(CLOUD_CONFIG.clientId, 'REPLACE_ME_CLIENT_ID')) return false;
  if (isPlaceholder(CLOUD_CONFIG.clientSecret, 'REPLACE_ME_CLIENT_SECRET')) return false;
  return true;
}

function setRedirectUri(next) {
  redirectUri = next || redirectUri;
}

function getRedirectUri() {
  return redirectUri || process.env.NODE_FORGE_DRIVE_REDIRECT_URI || 'http://localhost:17811/api/cloud/auth/callback';
}

function loadStoredToken() {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
  } catch (err) {
    return null;
  }
}

function saveToken(token) {
  try {
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2));
  } catch (err) {
    // best-effort only
  }
}

function getRefreshToken() {
  if (CLOUD_CONFIG.refreshToken) return CLOUD_CONFIG.refreshToken;
  const stored = loadStoredToken();
  return stored?.refresh_token || '';
}

function isAuthenticated() {
  return Boolean(getRefreshToken());
}

function createOAuthClient() {
  const client = new google.auth.OAuth2(
    CLOUD_CONFIG.clientId,
    CLOUD_CONFIG.clientSecret,
    getRedirectUri()
  );
  const refreshToken = getRefreshToken();
  const stored = loadStoredToken();
  if (refreshToken) {
    client.setCredentials({ refresh_token: refreshToken });
  } else if (stored) {
    client.setCredentials(stored);
  }
  return client;
}

const status = {
  status: 'idle',
  message: '',
  lastAttemptAt: null,
  lastSyncAt: null,
  syncInProgress: false,
  folderId: extractFolderId(CLOUD_CONFIG.folder),
  configured: isConfigured(),
  authenticated: isAuthenticated()
};

function getCloudStatus() {
  status.configured = isConfigured();
  status.authenticated = isAuthenticated();
  status.folderId = extractFolderId(CLOUD_CONFIG.folder);
  return { ...status };
}

function getAuthUrl() {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/drive']
  });
}

async function handleAuthCallback(code) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  const existing = loadStoredToken() || {};
  const next = {
    ...existing,
    ...tokens
  };
  if (!next.refresh_token && existing.refresh_token) {
    next.refresh_token = existing.refresh_token;
  }
  saveToken(next);
  return next;
}

async function listFolderRecursive(drive, folderId, basePath = '', folderMap = new Map(), driveId = '') {
  const files = [];
  let pageToken = null;
  do {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'nextPageToken, files(id,name,mimeType,modifiedTime,md5Checksum,size)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      ...(driveId ? { corpora: 'drive', driveId } : {}),
      pageSize: 1000,
      pageToken: pageToken || undefined
    });
    const items = response.data.files || [];
    for (const item of items) {
      if (item.mimeType === 'application/vnd.google-apps.folder') {
        const relPath = path.join(basePath, item.name);
        folderMap.set(relPath, item.id);
        const nested = await listFolderRecursive(
          drive,
          item.id,
          relPath,
          folderMap,
          driveId
        );
        files.push(...nested.files);
      } else {
        files.push({
          id: item.id,
          name: item.name,
          relativePath: path.join(basePath, item.name),
          modifiedTime: item.modifiedTime || null,
          md5Checksum: item.md5Checksum || null,
          size: Number(item.size || 0)
        });
      }
    }
    pageToken = response.data.nextPageToken;
  } while (pageToken);
  return { files, folderMap };
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function walkLocalFiles(root) {
  const results = [];
  if (!fs.existsSync(root)) return results;
  const visit = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      results.push(full);
    }
  };
  visit(root);
  return results;
}

function md5File(filePath) {
  const hash = crypto.createHash('md5');
  const data = fs.readFileSync(filePath);
  hash.update(data);
  return hash.digest('hex');
}

function buildLocalIndex(root) {
  const files = walkLocalFiles(root);
  const index = new Map();
  for (const filePath of files) {
    const rel = toPosix(path.relative(root, filePath));
    const stat = fs.statSync(filePath);
    index.set(rel, {
      relPath: rel,
      fullPath: filePath,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      md5: md5File(filePath)
    });
  }
  return index;
}

function buildLocalProjectNameMap() {
  const entries = listProjects();
  const map = new Map();
  entries.forEach((p) => {
    if (!p?.id) return;
    const name = String(p.name || p.id);
    map.set(String(p.id), name);
  });
  return map;
}

async function readDriveJsonFile(drive, fileId) {
  const response = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' }
  );
  return new Promise((resolve, reject) => {
    const chunks = [];
    response.data
      .on('data', (d) => chunks.push(d))
      .on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf-8');
          resolve(JSON.parse(raw));
        } catch (err) {
          reject(err);
        }
      })
      .on('error', reject);
  });
}

async function listDriveProjectFolders(drive, rootId, driveId = '') {
  const response = await drive.files.list({
    q: `'${rootId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    ...(driveId ? { corpora: 'drive', driveId } : {}),
    fields: 'files(id,name)',
    pageSize: 1000
  });
  const folders = response.data.files || [];
  const byId = new Map();
  for (const folder of folders) {
    let projectId = null;
    try {
      const projectFile = await drive.files.list({
        q: `'${folder.id}' in parents and name='project.json' and trashed=false`,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
        ...(driveId ? { corpora: 'drive', driveId } : {}),
        fields: 'files(id,name)',
        pageSize: 1
      });
      const file = projectFile.data.files?.[0];
      if (file?.id) {
        const meta = await readDriveJsonFile(drive, file.id);
        if (meta?.id) projectId = String(meta.id);
      }
    } catch {
      // ignore parsing errors
    }
    if (projectId) {
      byId.set(projectId, { id: folder.id, name: folder.name });
    }
  }
  return { folders, byId };
}

async function downloadFile(drive, file, targetRoot) {
  const targetPath = path.join(targetRoot, file.relativePath);
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(targetPath) && file.modifiedTime) {
    const localTime = fs.statSync(targetPath).mtime;
    const remoteTime = new Date(file.modifiedTime);
    if (localTime >= remoteTime) {
      return;
    }
  }

  const response = await drive.files.get(
    { fileId: file.id, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' }
  );

  await new Promise((resolve, reject) => {
    const dest = fs.createWriteStream(targetPath);
    response.data
      .on('end', resolve)
      .on('error', reject)
      .pipe(dest);
  });
}

async function ensureDriveFolder(drive, parentId, name, driveId = '') {
  const query = [
    `'${parentId}' in parents`,
    `name='${name.replace(/'/g, "\\'")}'`,
    "mimeType='application/vnd.google-apps.folder'",
    'trashed=false'
  ].join(' and ');
  const response = await drive.files.list({
    q: query,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    ...(driveId ? { corpora: 'drive', driveId } : {}),
    fields: 'files(id,name)',
    pageSize: 1
  });
  const existing = response.data.files?.[0];
  if (existing) return existing.id;
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId]
    },
    supportsAllDrives: true,
    fields: 'id'
  });
  return created.data.id;
}

async function ensureDrivePath(drive, rootId, folderMap, relPath, driveId = '', projectFolderById = new Map(), projectNameById = new Map()) {
  if (!relPath || relPath === '.') return rootId;
  const parts = relPath.split('/').filter(Boolean);
  let current = rootId;
  let currentPath = '';
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (i === 0 && projectFolderById?.has?.(part)) {
      const info = projectFolderById.get(part);
      current = info.id;
      currentPath = info.name;
      if (currentPath && !folderMap.has(currentPath)) {
        folderMap.set(currentPath, info.id);
      }
      continue;
    }
    if (i === 0 && projectNameById?.has?.(part)) {
      const displayName = projectNameById.get(part);
      currentPath = displayName;
      if (folderMap.has(currentPath)) {
        current = folderMap.get(currentPath);
        if (projectFolderById?.set) {
          projectFolderById.set(part, { id: current, name: currentPath });
        }
        continue;
      }
      const createdId = await ensureDriveFolder(drive, current, displayName, driveId);
      folderMap.set(currentPath, createdId);
      current = createdId;
      if (projectFolderById?.set) {
        projectFolderById.set(part, { id: createdId, name: currentPath });
      }
      continue;
    }
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    if (folderMap.has(currentPath)) {
      current = folderMap.get(currentPath);
      continue;
    }
    const createdId = await ensureDriveFolder(drive, current, part, driveId);
    folderMap.set(currentPath, createdId);
    current = createdId;
  }
  return current;
}

async function uploadFile(drive, file, rootId, folderMap, driveId = '', projectFolderById = new Map(), projectNameById = new Map()) {
  const parentPath = path.posix.dirname(file.relPath);
  const parentId = await ensureDrivePath(
    drive,
    rootId,
    folderMap,
    parentPath === '.' ? '' : parentPath,
    driveId,
    projectFolderById,
    projectNameById
  );
  const media = {
    mimeType: 'application/octet-stream',
    body: fs.createReadStream(file.fullPath)
  };

  return drive.files.create({
    requestBody: {
      name: path.posix.basename(file.relPath),
      parents: [parentId]
    },
    media,
    supportsAllDrives: true,
    fields: 'id,modifiedTime'
  });
}

async function updateFile(drive, remoteId, file) {
  const media = {
    mimeType: 'application/octet-stream',
    body: fs.createReadStream(file.fullPath)
  };
  return drive.files.update({
    fileId: remoteId,
    media,
    supportsAllDrives: true,
    fields: 'id,modifiedTime'
  });
}

function remoteTimeMs(remote) {
  return remote?.modifiedTime ? new Date(remote.modifiedTime).getTime() : 0;
}

function makeConflictName(relPath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ext = path.posix.extname(relPath);
  const base = relPath.slice(0, relPath.length - ext.length);
  return `${base}.conflict-${stamp}${ext || ''}`;
}

async function triggerCloudSync({ reason } = {}) {
  if (status.syncInProgress) return getCloudStatus();
  status.syncInProgress = true;
  status.status = 'syncing';
  status.message = reason ? `Syncing (${reason})...` : 'Syncing...';
  status.lastAttemptAt = new Date().toISOString();

  if (!isConfigured()) {
    status.status = 'not_configured';
    status.message = 'Set Google Drive client ID and secret.';
    status.syncInProgress = false;
    return getCloudStatus();
  }

  if (!isAuthenticated()) {
    status.status = 'not_configured';
    status.message = 'Authorize Google Drive to get a refresh token.';
    status.syncInProgress = false;
    return getCloudStatus();
  }

  try {
    const client = createOAuthClient();
    const drive = google.drive({ version: 'v3', auth: client });
    const folderId = extractFolderId(CLOUD_CONFIG.folder);
    let driveId = '';
    try {
      const folderMeta = await drive.files.get({
        fileId: folderId,
        fields: 'id,name,driveId,trashed',
        supportsAllDrives: true
      });
      if (folderMeta.data?.trashed) {
        throw new Error('Drive folder is in trash.');
      }
      driveId = folderMeta.data?.driveId || '';
    } catch (err) {
      throw new Error(`File not found or no access: ${folderId}.`);
    }

    const localProjectNameById = buildLocalProjectNameMap();
    const driveProjects = await listDriveProjectFolders(drive, folderId, driveId);
    const projectFolderById = driveProjects.byId || new Map();
    for (const [projectId, localName] of localProjectNameById.entries()) {
      if (!localName) continue;
      const info = projectFolderById.get(projectId);
      if (!info) continue;
      if (info.name !== localName) {
        try {
          const renamed = await drive.files.update({
            fileId: info.id,
            requestBody: { name: localName },
            supportsAllDrives: true,
            fields: 'id,name'
          });
          if (renamed?.data?.name) {
            info.name = renamed.data.name;
            projectFolderById.set(projectId, info);
          }
        } catch {
          // best-effort only
        }
      }
    }

    const { files: remoteFiles, folderMap } = await listFolderRecursive(drive, folderId, '', new Map(), driveId);
    const folderNameToProjectId = new Map();
    for (const [projectId, info] of projectFolderById.entries()) {
      if (info?.name) folderNameToProjectId.set(info.name, projectId);
    }
    const remapRelativePath = (rel) => {
      const parts = toPosix(rel).split('/').filter(Boolean);
      if (parts.length === 0) return rel;
      const mapped = folderNameToProjectId.get(parts[0]);
      if (mapped) parts[0] = mapped;
      return parts.join('/');
    };
    const remoteFilesMapped = remoteFiles.map((remote) => ({
      ...remote,
      relativePath: remapRelativePath(remote.relativePath)
    }));
    const localIndex = buildLocalIndex(DIRS.projects);
    const remoteIndex = new Map();
    for (const remote of remoteFilesMapped) {
      remoteIndex.set(toPosix(remote.relativePath), remote);
    }

    let uploaded = 0;
    let downloaded = 0;
    let updated = 0;
    let conflicts = 0;

    for (const [relPath, local] of localIndex.entries()) {
      const remote = remoteIndex.get(relPath);
      if (!remote) {
        await uploadFile(drive, local, folderId, folderMap, driveId, projectFolderById, localProjectNameById);
        uploaded += 1;
        continue;
      }

      const same = remote.md5Checksum && local.md5 === remote.md5Checksum;
      if (same) continue;

      const localTime = local.mtimeMs;
      const remoteTime = remoteTimeMs(remote);
      if (localTime > remoteTime) {
        await updateFile(drive, remote.id, local);
        updated += 1;
      } else if (remoteTime > localTime) {
        await downloadFile(drive, remote, DIRS.projects);
        updated += 1;
      } else {
        const conflictName = makeConflictName(relPath);
        const conflictPath = path.join(DIRS.projects, conflictName);
        fs.mkdirSync(path.dirname(conflictPath), { recursive: true });
        fs.copyFileSync(local.fullPath, conflictPath);
        const conflictLocal = {
          relPath: toPosix(conflictName),
          fullPath: conflictPath
        };
        await uploadFile(drive, conflictLocal, folderId, folderMap, driveId);
        conflicts += 1;
      }
    }

    for (const [relPath, remote] of remoteIndex.entries()) {
      if (localIndex.has(relPath)) continue;
      await downloadFile(drive, remote, DIRS.projects);
      downloaded += 1;
    }

    const total = uploaded + downloaded + updated;
    status.status = 'ok';
    status.message = `Sync complete. ${total} change${total === 1 ? '' : 's'} applied. ` +
      `Up ${uploaded}, Down ${downloaded}, Updated ${updated}, Conflicts ${conflicts}.`;
    status.lastSyncAt = new Date().toISOString();
  } catch (err) {
    status.status = 'error';
    status.message = err?.message || 'Drive sync failed.';
  } finally {
    status.syncInProgress = false;
  }

  return getCloudStatus();
}

function initCloudSync() {
  setTimeout(() => {
    if (!isConfigured()) {
      status.status = 'not_configured';
      status.message = 'Set Google Drive client ID and secret.';
      return;
    }
    if (!isAuthenticated()) {
      status.status = 'not_configured';
      status.message = 'Authorize Google Drive to get a refresh token.';
      return;
    }
    triggerCloudSync({ reason: 'startup' });
  }, 0);
}

module.exports = {
  CLOUD_CONFIG,
  setRedirectUri,
  getAuthUrl,
  handleAuthCallback,
  getCloudStatus,
  triggerCloudSync,
  initCloudSync
};
