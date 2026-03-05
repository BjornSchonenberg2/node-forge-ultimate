const express = require('express');
const cors = require('cors');
const path = require('path');
const {
  DIRS,
  ensureBaseStructure,
  ensureProjectStructure,
  loadProjectMetaOrCreate,
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
  projectModelsRoot,
  safeSlug,
  listPictureUploads
} = require('./storage');
const {
  getCloudStatus,
  getAuthUrl,
  handleAuthCallback,
  setRedirectUri,
  triggerCloudSync,
  initCloudSync
} = require('./cloudSync');

const app = express();
const port = Number(process.env.PORT || process.env.NODE_FORGE_BACKEND_PORT || 17811);

ensureBaseStructure();
setRedirectUri(process.env.NODE_FORGE_DRIVE_REDIRECT_URI || `http://localhost:${port}/api/cloud/auth/callback`);
initCloudSync();

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use('/api/models/uploads', express.static(DIRS.modelUploads));
app.use('/api/pictures', express.static(DIRS.pictures));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', dataRoot: DIRS.root });
});

app.get('/api/cloud/status', (req, res) => {
  res.json({ status: getCloudStatus() });
});

app.get('/api/cloud/auth/url', (req, res) => {
  try {
    const url = getAuthUrl();
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unable to create auth URL.' });
  }
});

app.get('/api/cloud/auth/callback', async (req, res) => {
  const { code, error } = req.query || {};
  if (error) {
    res.status(400).send(`Authorization failed: ${error}`);
    return;
  }
  if (!code) {
    res.status(400).send('Authorization code missing.');
    return;
  }
  try {
    await handleAuthCallback(String(code));
    res.send('Drive authorization complete. You can return to Node Forge.');
  } catch (err) {
    res.status(500).send(`Authorization failed: ${err.message || 'Unknown error.'}`);
  }
});

app.post('/api/cloud/sync', async (req, res) => {
  const status = await triggerCloudSync({ reason: 'manual' });
  res.json({ status });
});

app.get('/api/projects', (req, res) => {
  res.json({ projects: listProjects() });
});

app.post('/api/projects', (req, res) => {
  const { name } = req.body || {};
  try {
    const project = createProject(name);
    res.status(201).json({ project });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/projects/:projectId', (req, res) => {
  const id = safeSlug(req.params.projectId);
  ensureProjectStructure(id);
  res.json({ id, path: id });
});

app.delete('/api/projects/:projectId', (req, res) => {
  const id = safeSlug(req.params.projectId);
  try {
    const result = deleteProject(id);
    res.status(200).json({ project: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/projects/:projectId/meta', (req, res) => {
  const id = safeSlug(req.params.projectId);
  const meta = loadProjectMetaOrCreate(id);
  res.json({ meta });
});

app.get('/api/projects/:projectId/versions', (req, res) => {
  const id = safeSlug(req.params.projectId);
  res.json({ versions: listVersions(id) });
});

app.get('/api/projects/:projectId/versions/:versionId', (req, res) => {
  const id = safeSlug(req.params.projectId);
  const versionId = safeSlug(req.params.versionId);
  const version = loadVersion(id, versionId);
  if (!version) {
    res.status(404).json({ error: 'Version not found.' });
    return;
  }
  res.json({ version });
});

app.post('/api/projects/:projectId/versions', (req, res) => {
  const id = safeSlug(req.params.projectId);
  try {
    const version = saveVersion(id, req.body || {});
    res.status(201).json({ version });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/projects/:projectId/versions/:versionId', (req, res) => {
  const id = safeSlug(req.params.projectId);
  const versionId = safeSlug(req.params.versionId);
  try {
    const version = updateVersion(id, versionId, req.body || {});
    res.status(200).json({ version });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/projects/:projectId/versions/:versionId', (req, res) => {
  const id = safeSlug(req.params.projectId);
  const versionId = safeSlug(req.params.versionId);
  try {
    const meta = deleteVersion(id, versionId);
    res.status(200).json({ meta });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/projects/:projectId/defaultVersion', (req, res) => {
  const id = safeSlug(req.params.projectId);
  const { versionId } = req.body || {};
  if (!versionId) {
    res.status(400).json({ error: 'versionId is required.' });
    return;
  }
  try {
    const meta = setDefaultVersion(id, String(versionId));
    res.status(200).json({ meta });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/models/tags', (req, res) => {
  res.json({ tags: listModelTags() });
});

app.get('/api/models/uploads', (req, res) => {
  const files = listModelUploads().map((entry) => ({
    ...entry,
    url: `/api/models/uploads/${entry.relativePath}`,
  }));
  res.json({ models: files });
});

app.get('/api/pictures/list', (req, res) => {
  const files = listPictureUploads().map((entry) => ({
    ...entry,
    url: `/api/pictures/${entry.relativePath}`,
  }));
  res.json({ pictures: files });
});

app.get('/api/projects/:projectId/models/uploads/list', (req, res) => {
  const id = safeSlug(req.params.projectId);
  const files = listProjectModelUploads(id).map((entry) => ({
    ...entry,
    url: `/api/projects/${id}/models/uploads/${entry.relativePath}`,
  }));
  res.json({ models: files });
});

app.get('/api/projects/:projectId/models/uploads/*', (req, res) => {
  const id = safeSlug(req.params.projectId);
  const base = projectModelsRoot(id);
  const rel = req.params[0] || '';
  const target = path.normalize(path.join(base, rel));
  if (!target.startsWith(base)) {
    res.status(403).json({ error: 'Invalid path.' });
    return;
  }
  res.sendFile(target, (err) => {
    if (err) {
      res.status(err.statusCode || 404).end();
    }
  });
});

app.post('/api/models/tags', (req, res) => {
  const { name } = req.body || {};
  const tag = ensureModelTag(name);
  if (!tag) {
    res.status(400).json({ error: 'Tag name is required.' });
    return;
  }
  res.status(201).json({ tag });
});

app.listen(port, () => {
  console.log(`[Node Forge Backend] listening on ${port}`);
});
