/**
 * Study Tracker - Complete PWA Application
 * Features:
 * - Offline support with caching
 * - Service Worker for PWA
 * - Background sync
 * - Local storage fallback
 * - Progress tracking
 * - Real-time updates
 * - Error handling
 */

// Configuration
const CONFIG = {
    APP_NAME: 'Study Tracker',
    VERSION: '2.0.0',
    CACHE_NAME: 'study-tracker-cache-v3',
    API_ENDPOINTS: {
        GET_DATA: 'get_data.php',
        UPDATE: 'update.php'
    },
    STORAGE_KEYS: {
        STUDY_DATA: 'study-tracker-data',
        PENDING_UPDATES: 'study-tracker-pending-updates',
        LAST_SYNC: 'study-tracker-last-sync'
    },
    OFFLINE_LIMIT: 100 // Max pending updates before warning
};

// Global state
const AppState = {
    isOnline: navigator.onLine,
    isInitialized: false,
    studyData: null,
    pendingUpdates: [],
    isLoading: false,
    currentWeek: null
};

// DOM Elements cache
const Elements = {
    weeksContainer: null,
    loadingIndicator: null,
    errorContainer: null,
    networkStatus: null,
    retryButton: null,
    syncButton: null,
    debugPanel: null
};

// Initialize application
document.addEventListener('DOMContentLoaded', async () => {
    console.log(`${CONFIG.APP_NAME} v${CONFIG.VERSION} initializing...`);
    
    try {
        await initializeApp();
        console.log('Application initialized successfully');
    } catch (error) {
        console.error('Failed to initialize application:', error);
        showFatalError('Failed to load application. Please refresh the page.');
    }
});

/**
 * Initialize all application components
 */
async function initializeApp() {
    // Cache DOM elements
    cacheElements();
    
    // Register Service Worker
    await registerServiceWorker();
    
    // Setup event listeners
    setupEventListeners();
    
    // Initialize UI
    initializeUI();
    
    // Load data
    await loadStudyData();
    
    // Check for pending updates
    await checkPendingUpdates();
    
    AppState.isInitialized = true;
    
    // Show welcome message (first time only)
    if (!localStorage.getItem('welcome_shown')) {
        showNotification('Welcome to Study Tracker! Your progress is automatically saved.', 'success');
        localStorage.setItem('welcome_shown', 'true');
    }
}

/**
 * Cache DOM elements for better performance
 */
function cacheElements() {
    Elements.weeksContainer = document.getElementById('weeks-container');
    Elements.loadingIndicator = document.getElementById('loading');
    Elements.errorContainer = document.getElementById('error-message');
    Elements.networkStatus = document.getElementById('network-status');
    Elements.retryButton = document.getElementById('retry-btn');
    Elements.syncButton = document.getElementById('sync-btn');
    Elements.debugPanel = document.getElementById('debug-info');
    
    // Create sync button if it doesn't exist
    if (!Elements.syncButton) {
        Elements.syncButton = document.createElement('button');
        Elements.syncButton.id = 'sync-btn';
        Elements.syncButton.innerHTML = '🔄 Sync';
        Elements.syncButton.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 20px;
            padding: 10px 15px;
            background: #2196F3;
            color: white;
            border: none;
            border-radius: 50px;
            cursor: pointer;
            box-shadow: 0 2px 10px rgba(33, 150, 243, 0.3);
            z-index: 1000;
            display: none;
        `;
        Elements.syncButton.onclick = syncPendingUpdates;
        document.body.appendChild(Elements.syncButton);
    }
}

/**
 * Register Service Worker for PWA functionality
 */
async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.register('service-worker.js', {
                scope: './'
            });
            
            console.log('Service Worker registered:', registration);
            
            // Check for updates
            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing;
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        showNotification('New version available! Refresh to update.', 'info');
                    }
                });
            });
            
            // Setup periodic sync (if supported)
            if ('periodicSync' in registration) {
                try {
                    await registration.periodicSync.register('study-sync', {
                        minInterval: 24 * 60 * 60 * 1000 // Daily
                    });
                    console.log('Periodic sync registered');
                } catch (error) {
                    console.log('Periodic sync not supported:', error);
                }
            }
            
            // Setup background sync (if supported)
            if ('sync' in registration) {
                registration.sync.register('study-updates')
                    .then(() => console.log('Background sync registered'))
                    .catch(err => console.log('Background sync not supported:', err));
            }
            
        } catch (error) {
            console.error('Service Worker registration failed:', error);
            showNotification('Some features may not work offline', 'warning');
        }
    }
}

/**
 * Setup all event listeners
 */
function setupEventListeners() {
    // Network status
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    // Retry button
    if (Elements.retryButton) {
        Elements.retryButton.addEventListener('click', loadStudyData);
    }
    
    // Sync button
    Elements.syncButton.addEventListener('click', syncPendingUpdates);
    
    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);
    
    // Beforeunload - save data
    window.addEventListener('beforeunload', () => {
        if (AppState.pendingUpdates.length > 0) {
            return 'You have unsynced changes. Are you sure you want to leave?';
        }
    });
    
    // Visibility change - sync when tab becomes visible
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && AppState.isOnline) {
            loadStudyData();
        }
    });
}

/**
 * Initialize UI components
 */
function initializeUI() {
    updateNetworkStatus();
    showLoading(true);
}

/**
 * Load study data from server or cache
 */
async function loadStudyData() {
    if (AppState.isLoading) return;
    
    AppState.isLoading = true;
    showLoading(true);
    showError(false);
    
    try {
        let data;
        
        if (AppState.isOnline) {
            // Try to fetch from server with timeout
            data = await fetchWithTimeout(CONFIG.API_ENDPOINTS.GET_DATA, {
                timeout: 10000,
                headers: {
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            });
            
            data = await data.json();
            
            // Validate data structure
            if (!Array.isArray(data)) {
                throw new Error('Invalid data format received from server');
            }
            
            // Update local storage
            saveToLocalStorage(CONFIG.STORAGE_KEYS.STUDY_DATA, data);
            saveToLocalStorage(CONFIG.STORAGE_KEYS.LAST_SYNC, new Date().toISOString());
            
            // Sync any pending updates
            if (AppState.pendingUpdates.length > 0) {
                await syncPendingUpdates();
            }
            
        } else {
            // Load from cache
            data = loadFromLocalStorage(CONFIG.STORAGE_KEYS.STUDY_DATA);
            
            if (!data) {
                throw new Error('No cached data available');
            }
            
            showNotification('Using cached data. Some features may be limited.', 'warning');
        }
        
        AppState.studyData = data;
        
        // Render data
        renderStudyData(data);
        
        // Update sync button
        updateSyncButton();
        
    } catch (error) {
        console.error('Error loading study data:', error);
        
        // Try to load from backup cache
        const backupData = loadFromLocalStorage(CONFIG.STORAGE_KEYS.STUDY_DATA);
        
        if (backupData) {
            AppState.studyData = backupData;
            renderStudyData(backupData);
            showNotification('Loaded from backup cache', 'warning');
        } else {
            showError(true, `Failed to load data: ${error.message}`);
        }
        
    } finally {
        AppState.isLoading = false;
        showLoading(false);
    }
}

/**
 * Render study data to the UI
 */
function renderStudyData(data) {
    if (!Elements.weeksContainer) return;
    
    if (!data || data.length === 0) {
        Elements.weeksContainer.innerHTML = `
            <div class="empty-state">
                <h3>📚 No Study Plan Found</h3>
                <p>Set up your study plan in the database.</p>
                <button onclick="loadStudyData()">🔄 Refresh</button>
            </div>
        `;
        return;
    }
    
    let html = '';
    
    data.forEach(weekData => {
        const weekNum = weekData.week;
        const percentage = weekData.percentage || 0;
        const days = weekData.days || [];
        
        const completed = days.filter(d => d.completed).length;
        const total = days.length;
        
        // Calculate days until completion
        const remaining = total - completed;
        const daysText = remaining > 0 ? `${remaining} day${remaining !== 1 ? 's' : ''} left` : 'Completed!';
        
        html += `
            <div class="week-card" data-week="${weekNum}">
                <div class="week-header">
                    <h2>Week ${weekNum}</h2>
                    <span class="week-status ${percentage === 100 ? 'completed' : 'in-progress'}">
                        ${percentage === 100 ? '✅' : '📝'} ${daysText}
                    </span>
                </div>
                
                <div class="progress-container">
                    <div class="progress-text">
                        <span class="progress-label">Progress:</span>
                        <strong class="progress-percent">${percentage}%</strong>
                        <span class="progress-details">(${completed}/${total} days)</span>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${percentage}%"></div>
                        <div class="progress-marker" style="left: ${percentage}%"></div>
                    </div>
                </div>
                
                <div class="week-table-container">
                    <table class="study-table">
                        <thead>
                            <tr>
                                <th width="25%">Day</th>
                                <th width="55%">Topic & Description</th>
                                <th width="20%">Status</th>
                            </tr>
                        </thead>
                        <tbody id="week-${weekNum}-table">
        `;
        
        days.forEach((day, index) => {
            const isCompleted = day.completed;
            const rowClass = isCompleted ? 'completed-row' : '';
            const statusText = isCompleted ? 'Completed' : 'Pending';
            const statusIcon = isCompleted ? '✅' : '⏳';
            
            html += `
                <tr class="${rowClass}" data-day-id="${day.id}">
                    <td>
                        <div class="day-number">${day.day}</div>
                        ${index === 0 ? '<div class="week-start">Start</div>' : ''}
                        ${index === days.length - 1 ? '<div class="week-end">End</div>' : ''}
                    </td>
                    <td>
                        <div class="subject-title">${escapeHtml(day.subject)}</div>
                        <div class="subject-meta">
                            <span class="subject-duration">⏱️ 2-3 hours</span>
                            <span class="subject-difficulty">📊 Medium</span>
                        </div>
                    </td>
                    <td class="status-cell">
                        <label class="checkbox-container">
                            <input type="checkbox" 
                                   class="study-checkbox"
                                   data-id="${day.id}"
                                   data-week="${weekNum}"
                                   ${isCompleted ? 'checked' : ''}
                                   ${!AppState.isOnline ? 'disabled' : ''}>
                            <span class="checkmark"></span>
                            <span class="status-text">${statusIcon} ${statusText}</span>
                        </label>
                    </td>
                </tr>
            `;
        });
        
        html += `
                        </tbody>
                    </table>
                </div>
                
                <div class="week-footer">
                    <div class="week-stats">
                        <span class="stat">📅 ${total} days</span>
                        <span class="stat">✅ ${completed} completed</span>
                        <span class="stat">🎯 ${percentage}% done</span>
                    </div>
                    <button class="week-toggle" onclick="toggleWeekDetails(${weekNum})">
                        📋 Show Details
                    </button>
                </div>
            </div>
        `;
    });
    
    Elements.weeksContainer.innerHTML = html;
    
    // Add event listeners to checkboxes
    attachCheckboxListeners();
    
    // Initialize week toggles
    initializeWeekToggles();
}

/**
 * Attach event listeners to checkboxes
 */
function attachCheckboxListeners() {
    document.querySelectorAll('.study-checkbox').forEach(checkbox => {
        // Remove existing listeners to prevent duplicates
        const newCheckbox = checkbox.cloneNode(true);
        checkbox.parentNode.replaceChild(newCheckbox, checkbox);
        
        newCheckbox.addEventListener('change', handleCheckboxChange);
    });
}

/**
 * Handle checkbox change events
 */
async function handleCheckboxChange(event) {
    const checkbox = event.target;
    const id = checkbox.dataset.id;
    const week = checkbox.dataset.week;
    const completed = checkbox.checked ? 1 : 0;
    
    // Visual feedback
    checkbox.disabled = true;
    const row = checkbox.closest('tr');
    if (row) {
        row.classList.add('updating');
    }
    
    try {
        // Update local state immediately
        updateLocalStudyData(id, completed, week);
        
        // Update UI
        updateWeekProgress(week);
        updateRowStatus(row, completed === 1);
        
        // Save to pending updates
        const updateId = addPendingUpdate(id, completed);
        
        // Try to sync immediately if online
        if (AppState.isOnline) {
            await syncSingleUpdate({ id, completed, updateId });
        } else {
            showNotification('Change saved locally. Will sync when online.', 'info');
        }
        
        // Update overall progress
        updateOverallProgress();
        
    } catch (error) {
        console.error('Error updating progress:', error);
        checkbox.checked = !checkbox.checked; // Revert visual state
        showNotification('Failed to save change. Please try again.', 'error');
    } finally {
        checkbox.disabled = false;
        if (row) {
            row.classList.remove('updating');
        }
        updateSyncButton();
    }
}

/**
 * Update local study data
 */
function updateLocalStudyData(id, completed, week) {
    if (!AppState.studyData) return;
    
    const weekData = AppState.studyData.find(w => w.week == week);
    if (!weekData) return;
    
    const day = weekData.days.find(d => d.id == id);
    if (day) {
        day.completed = completed === 1;
        
        // Recalculate percentage
        const completedDays = weekData.days.filter(d => d.completed).length;
        const totalDays = weekData.days.length;
        weekData.percentage = totalDays > 0 ? Math.round((completedDays / totalDays) * 100) : 0;
        
        // Save to localStorage
        saveToLocalStorage(CONFIG.STORAGE_KEYS.STUDY_DATA, AppState.studyData);
    }
}

/**
 * Update week progress in UI
 */
function updateWeekProgress(weekNum) {
    const weekCard = document.querySelector(`[data-week="${weekNum}"]`);
    if (!weekCard || !AppState.studyData) return;
    
    const weekData = AppState.studyData.find(w => w.week == weekNum);
    if (!weekData) return;
    
    const percentage = weekData.percentage || 0;
    const completed = weekData.days.filter(d => d.completed).length;
    const total = weekData.days.length;
    
    // Update progress bar
    const progressFill = weekCard.querySelector('.progress-fill');
    const progressPercent = weekCard.querySelector('.progress-percent');
    const progressDetails = weekCard.querySelector('.progress-details');
    
    if (progressFill) progressFill.style.width = `${percentage}%`;
    if (progressPercent) progressPercent.textContent = `${percentage}%`;
    if (progressDetails) progressDetails.textContent = `(${completed}/${total} days)`;
    
    // Update week status
    const weekStatus = weekCard.querySelector('.week-status');
    if (weekStatus) {
        const remaining = total - completed;
        const daysText = remaining > 0 ? `${remaining} day${remaining !== 1 ? 's' : ''} left` : 'Completed!';
        weekStatus.innerHTML = `${percentage === 100 ? '✅' : '📝'} ${daysText}`;
        weekStatus.className = `week-status ${percentage === 100 ? 'completed' : 'in-progress'}`;
    }
    
    // Update footer stats
    const weekStats = weekCard.querySelector('.week-stats');
    if (weekStats) {
        weekStats.innerHTML = `
            <span class="stat">📅 ${total} days</span>
            <span class="stat">✅ ${completed} completed</span>
            <span class="stat">🎯 ${percentage}% done</span>
        `;
    }
}

/**
 * Update row status
 */
function updateRowStatus(row, isCompleted) {
    if (!row) return;
    
    if (isCompleted) {
        row.classList.add('completed-row');
        row.classList.remove('pending-row');
    } else {
        row.classList.remove('completed-row');
        row.classList.add('pending-row');
    }
    
    const statusText = row.querySelector('.status-text');
    if (statusText) {
        statusText.innerHTML = `${isCompleted ? '✅' : '⏳'} ${isCompleted ? 'Completed' : 'Pending'}`;
    }
}

/**
 * Add pending update to queue
 */
function addPendingUpdate(id, completed) {
    const updateId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    const update = {
        id,
        completed,
        updateId,
        timestamp: new Date().toISOString(),
        attempts: 0
    };
    
    AppState.pendingUpdates.push(update);
    saveToLocalStorage(CONFIG.STORAGE_KEYS.PENDING_UPDATES, AppState.pendingUpdates);
    
    // Show warning if too many pending updates
    if (AppState.pendingUpdates.length >= CONFIG.OFFLINE_LIMIT) {
        showNotification(`You have ${AppState.pendingUpdates.length} unsynced changes. Please connect to the internet.`, 'warning');
    }
    
    return updateId;
}

/**
 * Sync all pending updates
 */
async function syncPendingUpdates() {
    if (!AppState.isOnline || AppState.pendingUpdates.length === 0) {
        return;
    }
    
    Elements.syncButton.disabled = true;
    Elements.syncButton.innerHTML = '🔄 Syncing...';
    
    const updatesToSync = [...AppState.pendingUpdates];
    const successful = [];
    const failed = [];
    
    for (const update of updatesToSync) {
        try {
            await syncSingleUpdate(update);
            successful.push(update.updateId);
        } catch (error) {
            update.attempts++;
            failed.push(update);
        }
    }
    
    // Remove successful updates
    AppState.pendingUpdates = AppState.pendingUpdates.filter(
        update => !successful.includes(update.updateId)
    );
    
    // Keep failed updates (max 3 attempts)
    AppState.pendingUpdates = AppState.pendingUpdates.filter(
        update => update.attempts < 3
    );
    
    saveToLocalStorage(CONFIG.STORAGE_KEYS.PENDING_UPDATES, AppState.pendingUpdates);
    updateSyncButton();
    
    // Show result
    if (successful.length > 0) {
        showNotification(`Synced ${successful.length} update${successful.length !== 1 ? 's' : ''}`, 'success');
        await loadStudyData(); // Refresh data
    }
    
    if (failed.length > 0) {
        showNotification(`${failed.length} update${failed.length !== 1 ? 's' : ''} failed to sync`, 'error');
    }
    
    Elements.syncButton.disabled = false;
    Elements.syncButton.innerHTML = '🔄 Sync';
}

/**
 * Sync single update
 */
async function syncSingleUpdate(update) {
    const response = await fetch(CONFIG.API_ENDPOINTS.UPDATE, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Update-ID': update.updateId
        },
        body: `id=${update.id}&completed=${update.completed}`
    });
    
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    
    const result = await response.json();
    if (!result.success) {
        throw new Error(result.error || 'Update failed');
    }
    
    return result;
}

/**
 * Check for pending updates on startup
 */
async function checkPendingUpdates() {
    const pending = loadFromLocalStorage(CONFIG.STORAGE_KEYS.PENDING_UPDATES) || [];
    AppState.pendingUpdates = pending;
    
    if (pending.length > 0 && AppState.isOnline) {
        // Auto-sync after 5 seconds
        setTimeout(() => {
            if (AppState.isOnline) {
                syncPendingUpdates();
            }
        }, 5000);
    }
    
    updateSyncButton();
}

/**
 * Update sync button visibility
 */
function updateSyncButton() {
    if (!Elements.syncButton) return;
    
    if (AppState.pendingUpdates.length > 0) {
        Elements.syncButton.style.display = 'block';
        Elements.syncButton.innerHTML = `🔄 Sync (${AppState.pendingUpdates.length})`;
        
        // Pulse animation for attention
        Elements.syncButton.style.animation = 'pulse 2s infinite';
        
        // Add pulse animation to CSS if not exists
        if (!document.querySelector('#pulse-animation')) {
            const style = document.createElement('style');
            style.id = 'pulse-animation';
            style.textContent = `
                @keyframes pulse {
                    0% { transform: scale(1); box-shadow: 0 2px 10px rgba(33, 150, 243, 0.3); }
                    50% { transform: scale(1.05); box-shadow: 0 5px 20px rgba(33, 150, 243, 0.5); }
                    100% { transform: scale(1); box-shadow: 0 2px 10px rgba(33, 150, 243, 0.3); }
                }
            `;
            document.head.appendChild(style);
        }
    } else {
        Elements.syncButton.style.display = 'none';
        Elements.syncButton.style.animation = '';
    }
}

/**
 * Handle online/offline events
 */
function handleOnline() {
    AppState.isOnline = true;
    updateNetworkStatus();
    showNotification('You are back online! Syncing changes...', 'success');
    
    // Auto-sync after coming online
    setTimeout(() => {
        if (AppState.isOnline && AppState.pendingUpdates.length > 0) {
            syncPendingUpdates();
        }
    }, 2000);
    
    // Refresh data
    if (AppState.isInitialized) {
        loadStudyData();
    }
}

function handleOffline() {
    AppState.isOnline = false;
    updateNetworkStatus();
    showNotification('You are offline. Changes will be saved locally.', 'warning');
}

/**
 * Update network status display
 */
function updateNetworkStatus() {
    if (!Elements.networkStatus) return;
    
    if (AppState.isOnline) {
        Elements.networkStatus.innerHTML = '';
        Elements.networkStatus.style.display = 'none';
    } else {
        Elements.networkStatus.innerHTML = `
            <div class="offline-banner">
                <span>🌐 Offline Mode</span>
                <span>Changes saved locally (${AppState.pendingUpdates.length} pending)</span>
            </div>
        `;
        Elements.networkStatus.style.display = 'block';
    }
}

/**
 * Update overall progress
 */
function updateOverallProgress() {
    if (!AppState.studyData) return;
    
    const totalDays = AppState.studyData.reduce((sum, week) => sum + week.days.length, 0);
    const completedDays = AppState.studyData.reduce((sum, week) => 
        sum + week.days.filter(d => d.completed).length, 0
    );
    const overallPercentage = totalDays > 0 ? Math.round((completedDays / totalDays) * 100) : 0;
    
    // Update title if needed
    if (overallPercentage === 100) {
        document.title = `✅ ${CONFIG.APP_NAME} - Complete!`;
    } else {
        document.title = `${CONFIG.APP_NAME} - ${overallPercentage}% Complete`;
    }
    
    // Update favicon dynamically (optional)
    updateFavicon(overallPercentage);
}

/**
 * Update favicon based on progress
 */
function updateFavicon(percentage) {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    
    // Draw progress circle
    ctx.beginPath();
    ctx.arc(32, 32, 30, 0, Math.PI * 2);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    
    ctx.beginPath();
    ctx.arc(32, 32, 28, -Math.PI / 2, (-Math.PI / 2) + (Math.PI * 2 * percentage / 100));
    ctx.lineWidth = 4;
    ctx.strokeStyle = percentage === 100 ? '#4CAF50' : '#2196F3';
    ctx.stroke();
    
    // Update favicon
    const link = document.querySelector("link[rel*='icon']") || document.createElement('link');
    link.type = 'image/x-icon';
    link.rel = 'shortcut icon';
    link.href = canvas.toDataURL('image/png');
    document.getElementsByTagName('head')[0].appendChild(link);
}

/**
 * Utility functions
 */
async function fetchWithTimeout(url, options = {}) {
    const { timeout = 10000 } = options;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function saveToLocalStorage(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify(data));
    } catch (error) {
        console.error('Failed to save to localStorage:', error);
        // Try to clear some space
        if (error.name === 'QuotaExceededError') {
            localStorage.clear();
            localStorage.setItem(key, JSON.stringify(data));
        }
    }
}

function loadFromLocalStorage(key) {
    try {
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : null;
    } catch (error) {
        console.error('Failed to load from localStorage:', error);
        return null;
    }
}

function showLoading(show) {
    if (Elements.loadingIndicator) {
        Elements.loadingIndicator.style.display = show ? 'block' : 'none';
    }
    if (Elements.weeksContainer) {
        Elements.weeksContainer.style.opacity = show ? '0.5' : '1';
    }
}

function showError(show, message = '') {
    if (Elements.errorContainer) {
        Elements.errorContainer.style.display = show ? 'block' : 'none';
        if (message && Elements.errorContainer.querySelector('p')) {
            Elements.errorContainer.querySelector('p').textContent = message;
        }
    }
}

function showFatalError(message) {
    document.body.innerHTML = `
        <div style="padding: 40px; text-align: center; color: #d32f2f;">
            <h1>⚠️ Application Error</h1>
            <p>${message}</p>
            <button onclick="location.reload()" style="padding: 10px 20px; margin-top: 20px;">
                🔄 Reload Application
            </button>
        </div>
    `;
}

function showNotification(message, type = 'info') {
    // Remove existing notifications
    document.querySelectorAll('.notification').forEach(n => n.remove());
    
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <span class="notification-icon">${getNotificationIcon(type)}</span>
        <span class="notification-text">${message}</span>
        <button class="notification-close" onclick="this.parentElement.remove()">×</button>
    `;
    
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        background: ${getNotificationColor(type)};
        color: white;
        border-radius: 5px;
        box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        z-index: 10000;
        animation: slideIn 0.3s ease;
        max-width: 400px;
    `;
    
    document.body.appendChild(notification);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }
    }, 5000);
    
    // Add animations if not exist
    if (!document.querySelector('#notification-animations')) {
        const style = document.createElement('style');
        style.id = 'notification-animations';
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            @keyframes slideOut {
                from { transform: translateX(0); opacity: 1; }
                to { transform: translateX(100%); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }
}

function getNotificationIcon(type) {
    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };
    return icons[type] || 'ℹ️';
}

function getNotificationColor(type) {
    const colors = {
        success: '#4CAF50',
        error: '#F44336',
        warning: '#FF9800',
        info: '#2196F3'
    };
    return colors[type] || '#2196F3';
}

/**
 * Handle keyboard shortcuts
 */
function handleKeyboardShortcuts(event) {
    // Ctrl+R to refresh
    if ((event.ctrlKey || event.metaKey) && event.key === 'r') {
        event.preventDefault();
        loadStudyData();
    }
    
    // Ctrl+S to sync
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        syncPendingUpdates();
    }
    
    // Escape to close notifications
    if (event.key === 'Escape') {
        document.querySelectorAll('.notification').forEach(n => n.remove());
    }
}

/**
 * Week detail toggles
 */
function initializeWeekToggles() {
    // Add CSS for week details
    if (!document.querySelector('#week-details-css')) {
        const style = document.createElement('style');
        style.id = 'week-details-css';
        style.textContent = `
            .week-details {
                display: none;
                padding: 15px;
                background: rgba(255,255,255,0.05);
                border-radius: 8px;
                margin-top: 10px;
            }
            .week-details.show {
                display: block;
            }
        `;
        document.head.appendChild(style);
    }
}

function toggleWeekDetails(weekNum) {
    const weekCard = document.querySelector(`[data-week="${weekNum}"]`);
    if (!weekCard) return;
    
    const details = weekCard.querySelector('.week-details');
    const toggleButton = weekCard.querySelector('.week-toggle');
    
    if (!details) {
        // Create details section
        const weekData = AppState.studyData?.find(w => w.week == weekNum);
        if (!weekData) return;
        
        const detailsHtml = `
            <div class="week-details">
                <h4>📊 Week ${weekNum} Statistics</h4>
                <div class="stats-grid">
                    <div class="stat-item">
                        <div class="stat-label">Total Days</div>
                        <div class="stat-value">${weekData.days.length}</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-label">Completed</div>
                        <div class="stat-value">${weekData.days.filter(d => d.completed).length}</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-label">Remaining</div>
                        <div class="stat-value">${weekData.days.length - weekData.days.filter(d => d.completed).length}</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-label">Progress</div>
                        <div class="stat-value">${weekData.percentage}%</div>
                    </div>
                </div>
                <div class="week-notes">
                    <textarea placeholder="Add notes for this week..." rows="3"></textarea>
                </div>
            </div>
        `;
        
        weekCard.insertAdjacentHTML('beforeend', detailsHtml);
        toggleButton.textContent = '📋 Hide Details';
    } else {
        const isShowing = details.classList.contains('show');
        details.classList.toggle('show');
        toggleButton.textContent = isShowing ? '📋 Show Details' : '📋 Hide Details';
    }
}

// Export functions to global scope for HTML event handlers
window.toggleWeekDetails = toggleWeekDetails;
window.syncPendingUpdates = syncPendingUpdates;
window.loadStudyData = loadStudyData;

console.log('Study Tracker script loaded successfully');