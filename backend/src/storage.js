const fs = require('fs');
const path = require('path');

const ROOT = process.env.NODE_FORGE_DATA_DIR
  ? path.resolve(process.env.NODE_FORGE_DATA_DIR)
  : path.join(__dirname, '..', 'data');

const DIRS = {
  root: ROOT,
  projects: path.join(ROOT, 'Projects'),
  models: path.join(ROOT, 'Models'),
  modelTags: path.join(ROOT, 'Models', 'Tags'),
  modelUploads: path.join(ROOT, 'Models', 'Uploads'),
  pictures: path.join(ROOT, 'Pictures')
};

function ensureDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function safeSlug(input) {
  const base = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-');
  return base.replace(/^[-_]+|[-_]+$/g, '');
}

function ensureBaseStructure() {
  ensureDir(DIRS.root);
  ensureDir(DIRS.projects);
  ensureDir(DIRS.models);
  ensureDir(DIRS.modelTags);
  ensureDir(DIRS.modelUploads);
  ensureDir(DIRS.pictures);
}

function projectPath(projectId) {
  return path.join(DIRS.projects, projectId);
}

function projectMetaPath(projectId) {
  return path.join(projectPath(projectId), 'project.json');
}

function projectModelsRoot(projectId) {
  return path.join(projectPath(projectId), 'Models', 'Uploads');
}

function ensureProjectStructure(projectId, displayName) {
  const base = projectPath(projectId);
  ensureDir(base);
  ensureDir(path.join(base, 'GA'));
  ensureDir(path.join(base, 'Pictures'));
  ensureDir(path.join(base, 'Exports'));
  ensureDir(path.join(base, 'Versions'));
  ensureDir(path.join(base, 'Models'));
  ensureDir(path.join(base, 'Models', 'Uploads'));

  const metaPath = projectMetaPath(projectId);
  if (!fs.existsSync(metaPath)) {
    const now = new Date().toISOString();
    const payload = {
      id: projectId,
      name: displayName || projectId,
      createdAt: now,
      updatedAt: now,
      versions: [],
      defaultVersionId: ""
    };
    fs.writeFileSync(metaPath, JSON.stringify(payload, null, 2));
  }

  return base;
}

function loadProjectMeta(projectId) {
  const metaPath = projectMetaPath(projectId);
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  } catch (err) {
    return null;
  }
}

function saveProjectMeta(projectId, meta) {
  const metaPath = projectMetaPath(projectId);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}

function loadProjectMetaOrCreate(projectId, displayName) {
  ensureProjectStructure(projectId, displayName);
  return loadProjectMeta(projectId);
}

function listProjects() {
  ensureBaseStructure();
  if (!fs.existsSync(DIRS.projects)) return [];

  const entries = fs.readdirSync(DIRS.projects, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const meta = loadProjectMeta(entry.name);
      if (!meta) {
        return {
          id: entry.name,
          name: entry.name,
          updatedAt: null,
          versionCount: 0,
          defaultVersionId: ""
        };
      }
      return {
        id: meta.id || entry.name,
        name: meta.name || entry.name,
        updatedAt: meta.updatedAt || meta.createdAt || null,
        versionCount: Array.isArray(meta.versions) ? meta.versions.length : 0,
        defaultVersionId: meta.defaultVersionId || ""
      };
    })
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function createProject(name) {
  ensureBaseStructure();
  const baseSlug = safeSlug(name);
  if (!baseSlug) {
    throw new Error('Project name must include letters or numbers.');
  }

  let slug = baseSlug;
  const baseName = name || baseSlug;
  let displayName = baseName;
  let counter = 1;
  while (fs.existsSync(projectPath(slug))) {
    counter += 1;
    slug = `${baseSlug}-${counter}`;
    displayName = `${baseName} ${counter}`;
  }

  ensureProjectStructure(slug, displayName);
  return loadProjectMeta(slug);
}

function listVersions(projectId) {
  const meta = loadProjectMeta(projectId);
  if (!meta || !Array.isArray(meta.versions)) return [];
  return meta.versions;
}

function deleteProject(projectId) {
  ensureBaseStructure();
  const target = projectPath(projectId);
  if (!fs.existsSync(target)) {
    throw new Error('Project not found.');
  }
  fs.rmSync(target, { recursive: true, force: true });
  return { id: projectId };
}

function saveVersion(projectId, { label, snapshot, projectName, description } = {}) {
  ensureProjectStructure(projectId);
  const meta = loadProjectMeta(projectId);
  if (!meta) throw new Error('Project not found.');

  const now = new Date().toISOString();
  const versionId = `${Date.now()}`;
  const versionPayload = {
    id: versionId,
    label: label || `Version ${meta.versions.length + 1}`,
    createdAt: now,
    description: description || "",
    snapshot: snapshot || null
  };

  const versionPath = path.join(projectPath(projectId), 'Versions', `${versionId}.json`);
  fs.writeFileSync(versionPath, JSON.stringify(versionPayload, null, 2));

  meta.versions = [
    ...(meta.versions || []),
    { id: versionId, label: versionPayload.label, createdAt: now, description: versionPayload.description }
  ];
  meta.updatedAt = now;
  meta.defaultVersionId = versionId;
  if (projectName) {
    meta.name = projectName;
  }
  saveProjectMeta(projectId, meta);

  return versionPayload;
}

function updateVersion(projectId, versionId, { label, snapshot, projectName, description } = {}) {
  ensureProjectStructure(projectId);
  const meta = loadProjectMeta(projectId);
  if (!meta) throw new Error('Project not found.');
  const versions = Array.isArray(meta.versions) ? meta.versions : [];
  const idx = versions.findIndex((v) => v.id === versionId);
  if (idx === -1) throw new Error('Version not found.');

  const versionPath = path.join(projectPath(projectId), 'Versions', `${versionId}.json`);
  const existing = loadVersion(projectId, versionId) || {};
  const now = new Date().toISOString();
  const updatedPayload = {
    id: versionId,
    label: label || existing.label || versions[idx].label || `Version ${idx + 1}`,
    createdAt: existing.createdAt || versions[idx].createdAt || now,
    updatedAt: now,
    description: description !== undefined
      ? description
      : (existing.description || versions[idx].description || ""),
    snapshot: snapshot || existing.snapshot || null
  };

  fs.writeFileSync(versionPath, JSON.stringify(updatedPayload, null, 2));

  meta.versions = versions.map((v, i) => (
    i === idx
      ? { ...v, label: updatedPayload.label, createdAt: updatedPayload.createdAt, description: updatedPayload.description }
      : v
  ));
  meta.updatedAt = now;
  if (projectName) {
    meta.name = projectName;
  }
  saveProjectMeta(projectId, meta);

  return updatedPayload;
}

function deleteVersion(projectId, versionId) {
  ensureProjectStructure(projectId);
  const meta = loadProjectMeta(projectId);
  if (!meta) throw new Error('Project not found.');
  const versions = Array.isArray(meta.versions) ? meta.versions : [];
  const nextVersions = versions.filter((v) => v.id !== versionId);
  if (nextVersions.length === versions.length) {
    throw new Error('Version not found.');
  }

  const versionPath = path.join(projectPath(projectId), 'Versions', `${versionId}.json`);
  if (fs.existsSync(versionPath)) {
    fs.unlinkSync(versionPath);
  }

  meta.versions = nextVersions;
  meta.updatedAt = new Date().toISOString();
  if (meta.defaultVersionId === versionId) {
    meta.defaultVersionId = nextVersions.length ? nextVersions[nextVersions.length - 1].id : "";
  }
  saveProjectMeta(projectId, meta);
  return meta;
}

function setDefaultVersion(projectId, versionId) {
  const meta = loadProjectMeta(projectId);
  if (!meta) throw new Error('Project not found.');
  const exists = (meta.versions || []).some((v) => v.id === versionId);
  if (!exists) throw new Error('Version not found.');
  meta.defaultVersionId = versionId;
  meta.updatedAt = new Date().toISOString();
  saveProjectMeta(projectId, meta);
  return meta;
}

function loadVersion(projectId, versionId) {
  const versionPath = path.join(projectPath(projectId), 'Versions', `${versionId}.json`);
  if (!fs.existsSync(versionPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(versionPath, 'utf-8'));
  } catch (err) {
    return null;
  }
}

function ensureModelTag(tag) {
  ensureBaseStructure();
  const slug = safeSlug(tag);
  if (!slug) return null;
  const tagPath = path.join(DIRS.modelTags, slug);
  ensureDir(tagPath);
  return { id: slug, name: tag };
}

function listModelTags() {
  ensureBaseStructure();
  if (!fs.existsSync(DIRS.modelTags)) return [];
  const entries = fs.readdirSync(DIRS.modelTags, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ id: entry.name, name: entry.name }));
}

function listModelUploads() {
  ensureBaseStructure();
  const root = DIRS.modelUploads;
  if (!fs.existsSync(root)) return [];
  const results = [];

  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (ext !== '.glb' && ext !== '.gltf') continue;
      const rel = path.relative(root, full);
      const relPosix = rel.split(path.sep).join('/');
      results.push({
        id: safeSlug(relPosix.replace(/\//g, '-')),
        name: entry.name.replace(/\.(glb|gltf)$/i, ''),
        relativePath: relPosix,
      });
    }
  };

  walk(root);
  return results;
}

function listProjectModelUploads(projectId) {
  ensureProjectStructure(projectId);
  const root = projectModelsRoot(projectId);
  if (!fs.existsSync(root)) return [];
  const results = [];
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (ext !== '.glb' && ext !== '.gltf') continue;
      const rel = path.relative(root, full);
      const relPosix = rel.split(path.sep).join('/');
      results.push({
        id: safeSlug(relPosix.replace(/\//g, '-')),
        name: entry.name.replace(/\.(glb|gltf)$/i, ''),
        relativePath: relPosix,
      });
    }
  };
  walk(root);
  return results;
}

function listPictureUploads() {
  ensureBaseStructure();
  const root = DIRS.pictures;
  if (!fs.existsSync(root)) return [];
  const results = [];
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext)) continue;
      const rel = path.relative(root, full);
      const relPosix = rel.split(path.sep).join('/');
      results.push({
        id: safeSlug(relPosix.replace(/\//g, '-')),
        name: entry.name.replace(/\.(png|jpe?g|webp|gif|svg)$/i, ''),
        relativePath: relPosix,
      });
    }
  };
  walk(root);
  return results;
}

module.exports = {
  DIRS,
  ROOT,
  ensureBaseStructure,
  ensureProjectStructure,
  loadProjectMetaOrCreate,
  projectModelsRoot,
  listProjects,
  deleteProject,
  createProject,
  listVersions,
  saveVersion,
  updateVersion,
  deleteVersion,
  setDefaultVersion,
  loadVersion,
  ensureModelTag,
  listModelTags,
  listModelUploads,
  listProjectModelUploads,
  listPictureUploads,
  safeSlug
};
