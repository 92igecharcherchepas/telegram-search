// DOM Elements
const navItems = document.querySelectorAll('.nav-item');
const sections = document.querySelectorAll('.section');
const refreshBtn = document.getElementById('refresh-btn');
const openDbBtn = document.getElementById('open-db-btn');
const openDataBtn = document.getElementById('open-data-btn');
const botStatus = document.getElementById('bot-status');

// State
let currentSection = 'dashboard';
let dashboardData = null;
let refreshTimer = null;

// Navigation
navItems.forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const section = item.dataset.section;
    switchSection(section);
  });
});

function switchSection(sectionName) {
  navItems.forEach(item => {
    item.classList.toggle('active', item.dataset.section === sectionName);
  });

  sections.forEach(section => {
    section.classList.toggle('active', section.id === sectionName);
  });

  currentSection = sectionName;
}

// Fetch Real Dashboard Data from Bot
async function fetchDashboardData() {
  try {
    if (window.electron && window.electron.ipcRenderer) {
      const data = await window.electron.ipcRenderer.invoke('getDashboard');
      dashboardData = data;
      renderDashboard(data);
      updateStatusIndicator(data.status.status === 'online');
    } else {
      console.log('Using demo data - Electron IPC not available');
      await new Promise(r => setTimeout(r, 100));
      fetchDashboardData();
    }
  } catch (error) {
    console.error('Error:', error);
    updateStatusIndicator(false);
  }
}

function updateStatusIndicator(isOnline) {
  const statusDot = botStatus.querySelector('.status-dot');
  const statusText = botStatus.querySelector('.status-text');
  if (isOnline) {
    statusDot.classList.add('online');
    statusText.textContent = '✓ En ligne';
  } else {
    statusDot.classList.remove('online');
    statusText.textContent = '✗ Hors ligne';
  }
}

// Format Utilities
function formatDate(dateString) {
  if (!dateString) return '—';
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '—';
    const now = new Date();
    const diff = now - date;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (minutes < 1) return 'À l\'instant';
    if (minutes < 60) return `Il y a ${minutes}m`;
    if (hours < 24) return `Il y a ${hours}h`;
    
    return date.toLocaleString('fr-FR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (e) {
    return '—';
  }
}

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '—';
  if (bytes > 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  if (bytes > 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  if (bytes > 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return bytes + ' B';
}

function formatNumber(num) {
  if (!num) return '0';
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// Main Render Function
function renderDashboard(data) {
  if (!data) return;

  // Stats
  document.getElementById('stat-profiles').textContent = formatNumber(data.dbStats.loadedCount);
  document.getElementById('stat-files').textContent = data.dbStats.fileCount;
  document.getElementById('stat-users').textContent = formatNumber(data.totals.users);
  
  const staffCount = data.users.filter(u => u.isStaff).length;
  document.getElementById('stat-staff').textContent = staffCount;
  
  const searchCount = data.events.filter(e => e.type === 'search').length;
  document.getElementById('stat-searches').textContent = formatNumber(data.totals.searches);
  document.getElementById('stat-today').textContent = formatNumber(searchCount);
  document.getElementById('stat-events').textContent = formatNumber(data.totals.events);
  
  const uptime = data.status.timestamp ? formatDate(data.status.timestamp) : '—';
  document.getElementById('stat-update').textContent = uptime;

  // Overview
  const lastReload = data.dbStats.timestamp ? formatDate(data.dbStats.timestamp) : '—';
  document.getElementById('info-status').textContent = data.status.status === 'online' ? '✓ Actif' : '✗ Inactif';
  document.getElementById('info-uptime').textContent = lastReload;
  document.getElementById('info-staff-mode').textContent = data.env.STAFF_MODE === 'true' ? '🔒 ON' : '🔓 OFF';

  // Top Queries
  renderTopQueries(data.topQueries);

  // Events Log
  renderEventsLog(data.events);

  // Users Table
  renderUsersTable(data.users);

  // Files Table
  renderFilesTable(data.fileInfo);

  // Recent Searches
  renderRecentSearches(data.events);

  // Configuration
  document.getElementById('config-staff').value = data.env.STAFF_IDS || '—';
  document.getElementById('config-staffmode').checked = data.env.STAFF_MODE === 'true';
}

function renderTopQueries(queries) {
  const container = document.getElementById('top-queries');
  if (!queries || queries.length === 0) {
    container.innerHTML = '<div class="empty-state">Aucune recherche enregistrée</div>';
    return;
  }

  let maxCount = Math.max(...queries.map(q => q.count));
  container.innerHTML = queries.map((q, i) => {
    const percentage = ((q.count / maxCount) * 100).toFixed(0);
    return `
      <div class="list-item">
        <div class="list-item-text">
          <div class="list-item-title">
            <span class="query-rank">#${i + 1}</span> ${q.query}
          </div>
          <div class="progress-bar" style="--percent: ${percentage}%"></div>
        </div>
        <div class="list-item-badge">${q.count}</div>
      </div>
    `;
  }).join('');
}

function renderEventsLog(events) {
  const container = document.getElementById('events-log');
  if (!events || events.length === 0) {
    container.innerHTML = '<div class="empty-state">Aucun événement</div>';
    return;
  }

  container.innerHTML = events.slice(0, 15).map(e => {
    let icon = '📝';
    let label = e.type || 'unknown';
    
    if (e.type === 'search') {
      icon = '🔍';
      label = `Recherche: "${e.query || '—'}"`;
    } else if (e.type === 'db-reload') {
      icon = '💾';
      label = `DB rechargée (${e.loadedCount} profils)`;
    } else if (e.type === 'access-denied') {
      icon = '🚫';
      label = 'Accès refusé';
    } else if (e.type === 'bot-status') {
      icon = '⚡';
      label = `Bot ${e.status}`;
    } else if (e.type === 'command') {
      icon = '⚙️';
      label = `Commande: /${e.command}`;
    }

    return `
      <div class="log-item" data-type="${e.type}">
        <span class="log-icon">${icon}</span>
        <div class="log-content">
          <div class="log-label">${label}</div>
          <div class="log-meta">
            <span>${e.chatId ? 'ID: ' + e.chatId : 'Système'}</span>
            <span class="log-time">${formatDate(e.timestamp)}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderUsersTable(users) {
  const tbody = document.getElementById('users-table');
  if (!users || users.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="5" class="empty-state">Aucun utilisateur</td></tr>';
    return;
  }

  tbody.innerHTML = users.slice(0, 20).map(u => {
    const searchCount = u.searchCount || 0;
    const lastActivity = formatDate(u.lastSeen);
    const badge = u.isStaff ? '<span class="user-badge staff">👤 Staff</span>' : '<span class="user-badge">👤 User</span>';
    
    return `
      <tr>
        <td><code>${u.chatId}</code></td>
        <td>${u.username || u.firstName || 'Anonyme'}</td>
        <td class="text-center"><strong>${searchCount}</strong></td>
        <td>${lastActivity}</td>
        <td>${badge}</td>
      </tr>
    `;
  }).join('');
}

function renderFilesTable(files) {
  const tbody = document.getElementById('files-table');
  if (!files || files.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="6" class="empty-state">Aucun fichier</td></tr>';
    return;
  }

  tbody.innerHTML = files.map(f => {
    const fileName = f.path ? f.path.split('\\').pop() : 'unknown';
    const loadStatus = f.loaded ? '<span class="file-badge loaded">✓ Chargé</span>' : '<span class="file-badge cached">⚡ Cache</span>';
    const size = formatFileSize(f.size);
    const modified = f.mtimeMs ? formatDate(new Date(f.mtimeMs).toISOString()) : '—';
    
    return `
      <tr>
        <td><strong>${fileName}</strong></td>
        <td class="text-center"><code>${f.type.toUpperCase()}</code></td>
        <td class="text-right">${size}</td>
        <td>—</td>
        <td>${modified}</td>
        <td>${loadStatus}</td>
      </tr>
    `;
  }).join('');
}

function renderRecentSearches(events) {
  const container = document.getElementById('recent-searches');
  const searches = events.filter(e => e.type === 'search').slice(0, 12);
  
  if (!searches || searches.length === 0) {
    container.innerHTML = '<div class="empty-state">Aucune recherche</div>';
    return;
  }

  container.innerHTML = searches.map(s => {
    const resultText = s.resultCount > 1 ? 'résultats' : 'résultat';
    const bgColor = s.resultCount > 100 ? '#35d07f' : s.resultCount > 10 ? '#5a82ff' : '#ffc34d';
    
    return `
      <div class="list-item search-item">
        <div class="list-item-text">
          <div class="list-item-title">
            <strong>"${s.query}"</strong>
          </div>
          <div class="list-item-meta">${formatDate(s.timestamp)}</div>
        </div>
        <div class="list-item-badge" style="background: ${bgColor}20; color: ${bgColor}; border: 1px solid ${bgColor}">
          ${s.resultCount} ${resultText}
        </div>
      </div>
    `;
  }).join('');
}

// Event Listeners
refreshBtn.addEventListener('click', fetchDashboardData);

openDbBtn.addEventListener('click', () => {
  if (window.electron && window.electron.ipcRenderer) {
    window.electron.ipcRenderer.invoke('openDbFolder');
  }
});

openDataBtn.addEventListener('click', () => {
  if (window.electron && window.electron.ipcRenderer) {
    window.electron.ipcRenderer.invoke('openDataFolder');
  }
});

// Auto Refresh
function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  fetchDashboardData();
  refreshTimer = setInterval(fetchDashboardData, 3000);
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  startAutoRefresh();
});

// Cleanup on unload
window.addEventListener('beforeunload', () => {
  if (refreshTimer) clearInterval(refreshTimer);
});

