import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Cloud, CloudOff, HardDrive, RefreshCw, Settings } from 'lucide-react';
import './LandingPage.css';
import leftLogo from '../data/logo/logoold.png';
import rightLogo from '../data/logo/logo.png';
import pkg from '../../package.json';

const API_ROOT = process.env.REACT_APP_BACKEND_URL || 'http://localhost:17811';

export default function LandingPage({ onEnter }) {
  const [projects, setProjects] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(() => new Set());
  const [versionsByProject, setVersionsByProject] = useState({});
  const [contextMenu, setContextMenu] = useState(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState('');
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateReady, setUpdateReady] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('nodeforge.theme') || 'obsidian');
  const [cloudStatus, setCloudStatus] = useState({
    status: 'unknown',
    message: '',
    lastAttemptAt: null,
    lastSyncAt: null,
    syncInProgress: false,
    folderId: '',
    configured: false,
    authenticated: false
  });

  const formatTimestamp = useCallback((value) => {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }, []);

  const formatDateTime = useCallback((value) => {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString();
  }, []);

  const loadProjects = useCallback(async () => {
    try {
      const response = await fetch(`${API_ROOT}/api/projects`);
      const data = await response.json();
      setProjects(Array.isArray(data.projects) ? data.projects : []);
      setError('');
    } catch (err) {
      setError('Backend is offline. Start the desktop backend to list projects.');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleDeleteProject = useCallback(async (project) => {
    if (!project) return;
    setDeleteTarget(project);
  }, []);

  const confirmDeleteProject = useCallback(async (project) => {
    try {
      await fetch(`${API_ROOT}/api/projects/${project.id}`, { method: 'DELETE' });
      await loadProjects();
    } catch (err) {
      setError('Failed to delete project.');
    }
  }, [loadProjects]);

  const loadCloudStatus = useCallback(async () => {
    try {
      const response = await fetch(`${API_ROOT}/api/cloud/status`);
      const data = await response.json();
      setCloudStatus(data.status || {
        status: 'unknown',
        message: '',
        lastAttemptAt: null,
        lastSyncAt: null,
        syncInProgress: false,
        folderId: '',
        configured: false,
        authenticated: false
      });
    } catch (err) {
      setCloudStatus((prev) => ({
        ...prev,
        status: 'error',
        message: 'Unable to reach cloud sync service.',
        syncInProgress: false
      }));
    }
  }, []);

  const handleCloudSync = useCallback(async () => {
    try {
      setCloudStatus((prev) => ({
        ...prev,
        status: 'syncing',
        syncInProgress: true,
        message: 'Syncing...'
      }));
      const response = await fetch(`${API_ROOT}/api/cloud/sync`, { method: 'POST' });
      const data = await response.json();
      if (data && data.status) {
        setCloudStatus(data.status);
      } else {
        setCloudStatus((prev) => ({
          ...prev,
          status: 'error',
          message: 'Unexpected sync response.',
          syncInProgress: false
        }));
      }
      await loadProjects();
    } catch (err) {
      setCloudStatus((prev) => ({
        ...prev,
        status: 'error',
        message: 'Failed to sync.',
        syncInProgress: false
      }));
    }
  }, [loadProjects]);

  const handleConnectDrive = useCallback(async () => {
    if (!cloudStatus.configured) {
      setCloudStatus((prev) => ({
        ...prev,
        message: 'Add client ID/secret to node-forge.config.json and restart the app.'
      }));
      return;
    }
    try {
      const response = await fetch(`${API_ROOT}/api/cloud/auth/url`);
      const data = await response.json();
      if (data?.url) {
        window.open(data.url, '_blank', 'noopener,noreferrer');
        setCloudStatus((prev) => ({
          ...prev,
          message: 'Complete Google sign-in in the browser, then click Resync.'
        }));
      } else {
        setCloudStatus((prev) => ({
          ...prev,
          message: 'Unable to start Drive authorization.'
        }));
      }
    } catch (err) {
      setCloudStatus((prev) => ({
        ...prev,
        message: 'Unable to start Drive authorization.'
      }));
    }
  }, [cloudStatus.configured]);

  useEffect(() => {
    let active = true;
    (async () => {
      await Promise.all([loadProjects(), loadCloudStatus()]);
      if (!active) return;
    })();
    const interval = setInterval(() => {
      loadCloudStatus();
    }, 5000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [loadProjects, loadCloudStatus]);

  useEffect(() => {
    try {
      localStorage.setItem('nodeforge.theme', theme);
    } catch {}
  }, [theme]);

  useEffect(() => {
    if (!window?.nodeForge?.on) return;
    const off = window.nodeForge.on('update-status', (payload) => {
      if (!payload) return;
      switch (payload.status) {
        case 'checking':
          setUpdateStatus('Checking for updates...');
          setUpdateInfo(null);
          setUpdateReady(false);
          break;
        case 'available':
          setUpdateStatus('Update available. Downloading...');
          setUpdateInfo(payload.info || null);
          setUpdateReady(false);
          break;
        case 'downloading':
          setUpdateStatus(`Downloading update... ${payload.percent || 0}%`);
          setUpdateReady(false);
          break;
        case 'downloaded':
          setUpdateStatus('Update ready to install.');
          setUpdateInfo(payload.info || null);
          setUpdateReady(true);
          break;
        case 'not-available':
          setUpdateStatus('You are on the latest version.');
          setUpdateInfo(payload.info || null);
          setUpdateReady(false);
          break;
        case 'error':
          setUpdateStatus(payload.message || 'Update error.');
          setUpdateReady(false);
          break;
        default:
          break;
      }
      if (payload.status !== 'downloaded') {
        setTimeout(() => setUpdateStatus(''), 3200);
      }
    });
    return () => off && off();
  }, []);

  const themes = [
    { id: 'obsidian', label: 'Obsidian' },
    { id: 'aurora', label: 'Aurora' },
    { id: 'ember', label: 'Ember' },
    { id: 'neon', label: 'Neon' },
  ];

  const handleCheckUpdates = () => {
    if (window?.nodeForge?.send) {
      window.nodeForge.send('check-updates');
      return;
    }
    setUpdateStatus('Update service only available in desktop app.');
    setTimeout(() => setUpdateStatus(''), 3200);
  };

  const handleInstallUpdate = () => {
    if (window?.nodeForge?.send) {
      window.nodeForge.send('install-update');
    }
  };

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return projects;
    return projects.filter((project) => project.name.toLowerCase().includes(trimmed));
  }, [projects, query]);

  const toggleProject = useCallback(
    async (project) => {
      const isOpen = expanded.has(project.id);
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(project.id)) {
          next.delete(project.id);
        } else {
          next.add(project.id);
        }
        return next;
      });

      if (isOpen) return;
      if (versionsByProject[project.id]?.loading) return;
      setVersionsByProject((prev) => ({
        ...prev,
        [project.id]: {
          versions: prev[project.id]?.versions,
          loading: true,
          error: '',
        },
      }));
      try {
        const response = await fetch(`${API_ROOT}/api/projects/${project.id}/versions`);
        const data = await response.json();
        setVersionsByProject((prev) => ({
          ...prev,
          [project.id]: {
            versions: Array.isArray(data?.versions) ? data.versions : [],
            loading: false,
            error: '',
          },
        }));
      } catch (err) {
        setVersionsByProject((prev) => ({
          ...prev,
          [project.id]: {
            versions: [],
            loading: false,
            error: 'Unable to load versions.',
          },
        }));
      }
    },
    [expanded, versionsByProject]
  );

  const cloudState = useMemo(() => {
    switch (cloudStatus.status) {
      case 'ok':
        return { label: 'Synced', tone: 'ok' };
      case 'syncing':
        return { label: 'Syncing', tone: 'syncing' };
      case 'not_configured':
        return cloudStatus.configured && !cloudStatus.authenticated
          ? { label: 'Connect', tone: 'error' }
          : { label: 'Not configured', tone: 'error' };
      case 'error':
        return { label: 'Unable to sync', tone: 'error' };
      default:
        return { label: 'Unknown', tone: 'idle' };
    }
  }, [cloudStatus.status]);

  const cloudOk = cloudStatus.status === 'ok';
  const cloudSyncing = cloudStatus.status === 'syncing' || cloudStatus.syncInProgress;
  const cloudNeedsAuth = !cloudStatus.authenticated;
  const cloudTitle = cloudOk
    ? 'Synced with cloud'
    : cloudStatus.status === 'not_configured'
      ? 'Cloud sync not configured'
      : 'Cloud sync unavailable';

  return (
    <div className={`lander theme-${theme}`}>
      <div className="lander-shell">
        <header className="lander-topbar">
          <div className="lander-logo-slot left">
            <img src={leftLogo} alt="Node Forge mark" />
          </div>
          <div className="lander-top-center">
            <div className="lander-brand">Node Forge</div>
            <div className="lander-version">v{pkg.version}</div>
            <div className="lander-kicker">Spatial Systems Console</div>
          </div>
          <div className="lander-logo-slot right">
            <img src={rightLogo} alt="Network globe" />
          </div>
          <button
            type="button"
            className="lander-settings-btn"
            aria-label="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings size={18} />
          </button>
        </header>

        <div className="lander-grid">
          <section className="lander-projects">
            <div className="lander-panel-card projects">
              <div className="lander-panel-header">
                <div className="lander-panel-title">Saved Projects</div>
                <button
                  className="lander-new-project"
                  type="button"
                  onClick={() => {
                    setNewProjectName('');
                    setNewProjectOpen(true);
                  }}
                  aria-label="Create new project"
                  title="New Project"
                >
                  +
                </button>
              </div>
              <input
                className="lander-search"
                type="search"
                placeholder="Search projects"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <div className="lander-cloud-status">
                <div className="lander-cloud-row">
                  <div className="lander-cloud-left">
                    <span className={`lander-cloud-dot ${cloudState.tone}`} />
                    <span className="lander-cloud-label">Cloud Sync</span>
                    <span className={`lander-cloud-state ${cloudState.tone}`}>{cloudState.label}</span>
                  </div>
                  {cloudNeedsAuth ? (
                    <button
                      className="lander-cloud-button"
                      type="button"
                      onClick={handleConnectDrive}
                      disabled={cloudSyncing || !cloudStatus.configured}
                    >
                      <Cloud size={14} />
                      Connect Drive
                    </button>
                  ) : (
                    <button
                      className="lander-cloud-button"
                      type="button"
                      onClick={handleCloudSync}
                      disabled={cloudSyncing}
                    >
                      <RefreshCw size={14} />
                      {cloudSyncing ? 'Syncing' : 'Resync'}
                    </button>
                  )}
                </div>
                <div className="lander-cloud-meta">
                  <span>Drive folder {cloudStatus.folderId || 'not set'}</span>
                  <span>
                    {cloudStatus.lastSyncAt
                      ? `Last sync ${formatDateTime(cloudStatus.lastSyncAt)}`
                      : 'Last sync: never'}
                  </span>
                </div>
                {cloudStatus.message && (
                  <div className={`lander-cloud-message ${cloudState.tone}`}>{cloudStatus.message}</div>
                )}
              </div>
              <div className="lander-list glass-scroll">
                {loading && <div className="lander-hint">Loading projects...</div>}
                {!loading && error && <div className="lander-error">{error}</div>}
                {!loading && !error && filtered.length === 0 && (
                  <div className="lander-hint">No matching projects yet.</div>
                )}
                {!loading && !error && filtered.map((project) => {
                  const entry = versionsByProject[project.id] || {};
                  const isExpanded = expanded.has(project.id);
                  return (
                    <div
                      key={project.id}
                      className={`lander-project-card${isExpanded ? ' open' : ''}`}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setContextMenu({
                          project,
                          x: event.clientX,
                          y: event.clientY,
                        });
                      }}
                    >
                      <div className="lander-project-row">
                        <button
                          className="lander-project-toggle"
                          type="button"
                          aria-expanded={isExpanded}
                          aria-label={`Toggle versions for ${project.name}`}
                          onClick={() => toggleProject(project)}
                        >
                          <span className="lander-project-chevron" />
                        </button>
                        <button
                          className="lander-project-main"
                          type="button"
                          onClick={() => onEnter({ mode: 'load', project })}
                          title={`Open ${project.name}`}
                        >
                          <div className="lander-project-name">{project.name}</div>
                          <div className="lander-project-sub">
                            <span className="lander-project-updated">
                              {project.updatedAt ? `Updated ${formatTimestamp(project.updatedAt)}` : 'No recent activity'}
                            </span>
                            <span className="lander-project-sources">
                              <span className="lander-source-icon local" title="Stored locally">
                                <HardDrive size={14} />
                              </span>
                              <span
                                className={`lander-source-icon cloud ${cloudOk ? 'ok' : 'error'}${cloudSyncing ? ' syncing' : ''}`}
                                title={cloudTitle}
                              >
                                {cloudOk ? <Cloud size={14} /> : <CloudOff size={14} />}
                              </span>
                            </span>
                          </div>
                        </button>
                        <div className="lander-project-actions">
                          <div className="lander-project-meta">
                            {project.versionCount} versions
                          </div>
                          <button
                            className="lander-project-open"
                            type="button"
                            onClick={() => onEnter({ mode: 'load', project })}
                          >
                            Open
                          </button>
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="lander-project-versions">
                          {entry.loading && (
                            <div className="lander-version-hint">Loading versions...</div>
                          )}
                          {!entry.loading && entry.error && (
                            <div className="lander-version-error">{entry.error}</div>
                          )}
                          {!entry.loading && !entry.error && (!entry.versions || entry.versions.length === 0) && (
                            <div className="lander-version-hint">No versions saved yet.</div>
                          )}
                          {!entry.loading && !entry.error && entry.versions && entry.versions.map((version) => (
                            <button
                              key={version.id}
                              className="lander-version-row"
                              type="button"
                              onClick={() => onEnter({ mode: 'load', project, versionId: version.id })}
                              title={`Open ${project.name} — ${version.label || 'Version'}`}
                            >
                              <div className="lander-version-label">{version.label || 'Version'}</div>
                              <div className="lander-version-meta">
                                <div className="lander-version-date">
                                  {version.createdAt ? formatTimestamp(version.createdAt) : 'Unknown date'}
                                </div>
                                <div className="lander-version-sources">
                                  <span className="lander-source-icon local" title="Stored locally">
                                    <HardDrive size={12} />
                                  </span>
                                  <span
                                    className={`lander-source-icon cloud ${cloudOk ? 'ok' : 'error'}${cloudSyncing ? ' syncing' : ''}`}
                                    title={cloudTitle}
                                  >
                                    {cloudOk ? <Cloud size={12} /> : <CloudOff size={12} />}
                                  </span>
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="lander-right">
            <div className="lander-hero">
              <div className="lander-hero-core">
                <div className="lander-hero-title">
                  Build worlds, ship topologies, and orchestrate space.
                </div>
                <div className="lander-subtitle">
                  Node Forge is your desktop command deck for spatial storytelling and network design.
                  Version fast, merge clean, and keep every iteration local.
                </div>
                <div className="lander-actions">
                  <button
                    className="lander-button ghost"
                    type="button"
                    onClick={loadProjects}
                  >
                    Refresh List
                  </button>
                </div>
                <div className="lander-footnote">
                  Local data stays on this machine. Everything else stays blazing fast.
                </div>
              </div>
              <div className="lander-hero-orbit">
                <div className="lander-orbit-ring" />
                <div className="lander-orbit-ring ring-2" />
                <div className="lander-orbit-ring ring-3" />
              </div>
              <div className="lander-signal-stack">
                <div className="lander-signal-line" />
                <div className="lander-signal-line" />
                <div className="lander-signal-line" />
              </div>
            </div>

            <div className="lander-panel">
              <div className="lander-panel-card">
                <div className="lander-panel-title">Mission Status</div>
                <div className="lander-panel-body">
                  <div className="lander-panel-item">
                    <span>Projects</span>
                    <strong>{projects.length}</strong>
                  </div>
                  <div className="lander-panel-item">
                    <span>Backend</span>
                    <strong>{error ? 'Offline' : 'Connected'}</strong>
                  </div>
                  <div className="lander-panel-item">
                    <span>Mode</span>
                    <strong>Desktop</strong>
                  </div>
                </div>
                <div className="lander-panel-glow" />
              </div>
              <div className="lander-panel-card secondary">
                <div className="lander-panel-title">Quick Signals</div>
                <div className="lander-panel-body">
                  <div className="lander-panel-item">
                    <span>Local storage</span>
                    <strong>Armed</strong>
                  </div>
                  <div className="lander-panel-item">
                    <span>Render</span>
                    <strong>Ultra</strong>
                  </div>
                  <div className="lander-panel-item">
                    <span>Viewport</span>
                    <strong>3D Ready</strong>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
      {contextMenu && (
        <div
          className="lander-context-scrim"
          onPointerDown={() => setContextMenu(null)}
        >
          <div
            className="lander-context-menu"
            style={{
              left: Math.min(contextMenu.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 220),
              top: Math.min(contextMenu.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 120),
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                const target = contextMenu.project;
                setContextMenu(null);
                if (target) handleDeleteProject(target);
              }}
            >
              Delete Project
            </button>
          </div>
        </div>
      )}
      {newProjectOpen && (
        <div
          className="lander-context-scrim"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setNewProjectOpen(false);
            }
          }}
        >
          <div
            className="lander-new-project-modal"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="lander-new-project-title">New Project</div>
            <input
              className="lander-new-project-input"
              value={newProjectName}
              onChange={(event) => setNewProjectName(event.target.value)}
              placeholder="Project name"
              onMouseDown={(event) => event.stopPropagation()}
              autoFocus
            />
            <div className="lander-new-project-actions">
              <button
                type="button"
                className="lander-new-project-cancel"
                onClick={() => setNewProjectOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="lander-new-project-confirm"
                onClick={() => {
                  const name = newProjectName.trim();
                  if (!name) return;
                  setNewProjectOpen(false);
                  onEnter({ mode: 'new', projectName: name });
                }}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteTarget && (
        <div
          className="lander-context-scrim"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setDeleteTarget(null);
            }
          }}
        >
          <div
            className="lander-delete-modal"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="lander-delete-title">Delete Project</div>
            <div className="lander-delete-body">
              This will permanently delete “{deleteTarget.name}” and all saved versions.
            </div>
            <div className="lander-delete-actions">
              <button
                type="button"
                className="lander-new-project-cancel"
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="lander-delete-confirm"
                onClick={async () => {
                  const target = deleteTarget;
                  setDeleteTarget(null);
                  await confirmDeleteProject(target);
                }}
              >
                Delete Project
              </button>
            </div>
          </div>
        </div>
      )}
      {settingsOpen && (
        <div
          className="lander-context-scrim"
          onPointerDown={() => setSettingsOpen(false)}
        >
          <div
            className="lander-settings-menu"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="lander-settings-title">Settings</div>
            <div className="lander-settings-section">
              <div className="lander-settings-label">Updates</div>
              <button
                type="button"
                className="lander-settings-action"
                onClick={handleCheckUpdates}
              >
                Check for updates
              </button>
              {updateStatus && (
                <div className="lander-settings-note">{updateStatus}</div>
              )}
              {updateReady && (
                <button
                  type="button"
                  className="lander-settings-action"
                  onClick={handleInstallUpdate}
                >
                  Install update
                </button>
              )}
            </div>
            <div className="lander-settings-section">
              <div className="lander-settings-label">Theme</div>
              <div className="lander-settings-themes">
                {themes.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`lander-theme-pill${theme === t.id ? ' active' : ''}`}
                    onClick={() => setTheme(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
