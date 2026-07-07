// Add these functions to your existing script.js file:

// Add to CONFIG object:
const CONFIG = {
    // ... existing config ...
    APP_VERSION: '3.0.0',
    UPDATE_CHECK_INTERVAL: 3600000, // 1 hour
    OFFLINE_QUEUE_KEY: 'study_tracker_offline_queue'
};

// Add to AppState:
const AppState = {
    // ... existing state ...
    isUpdateAvailable: false,
    newVersion: null,
    offlineQueue: []
};

// Add these functions after initializeApp:

/**
 * Check for Updates
 */
async function checkForUpdates() {
    try {
        const response = await fetch('./version.json?t=' + Date.now());
        const data = await response.json();
        
        if (data.version !== CONFIG.APP_VERSION) {
            AppState.isUpdateAvailable = true;
            AppState.newVersion = data.version;
            showUpdateNotification();
        }
    } catch (error) {
        console.log('Update check failed:', error);
    }
}

/**
 * Show Update Notification
 */
function showUpdateNotification() {
    if (!AppState.isUpdateAvailable) return;
    
    const notification = document.createElement('div');
    notification.className = 'update-notification';
    notification.innerHTML = `
        <div class="update-content">
            <span class="update-icon">🔄</span>
            <div class="update-text">
                <strong>New Update Available!</strong>
                <p>Version ${AppState.newVersion} is ready.</p>
            </div>
            <button onclick="installUpdate()" class="btn-update">Update Now</button>
            <button onclick="dismissUpdate()" class="btn-dismiss">Later</button>
        </div>
    `;
    
    notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 15px 20px;
        border-radius: 10px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        z-index: 10000;
        animation: slideInUp 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    // Add styles if not exists
    if (!document.querySelector('#update-styles')) {
        const style = document.createElement('style');
        style.id = 'update-styles';
        style.textContent = `
            .update-content {
                display: flex;
                align-items: center;
                gap: 15px;
            }
            .update-icon {
                font-size: 24px;
            }
            .update-text {
                flex: 1;
            }
            .btn-update, .btn-dismiss {
                padding: 8px 16px;
                border: none;
                border-radius: 5px;
                cursor: pointer;
                font-weight: 600;
                transition: opacity 0.3s;
            }
            .btn-update {
                background: white;
                color: #667eea;
            }
            .btn-dismiss {
                background: transparent;
                color: white;
                border: 1px solid rgba(255,255,255,0.3);
            }
            .btn-update:hover, .btn-dismiss:hover {
                opacity: 0.9;
            }
            @keyframes slideInUp {
                from { transform: translateY(100%); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }
}

/**
 * Install Update
 */
function installUpdate() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(registration => {
            registration.waiting.postMessage({ type: 'SKIP_WAITING' });
            
            // Reload page after update
            setTimeout(() => {
                window.location.reload();
            }, 100);
        });
    }
}

/**
 * Dismiss Update
 */
function dismissUpdate() {
    AppState.isUpdateAvailable = false;
    document.querySelector('.update-notification')?.remove();
    
    // Show again in 24 hours
    setTimeout(() => {
        AppState.isUpdateAvailable = true;
        showUpdateNotification();
    }, 24 * 60 * 60 * 1000);
}

/**
 * Enhanced Update Handler with Offline Queue
 */
async function handleCheckboxChange(event) {
    const checkbox = event.target;
    const id = parseInt(checkbox.dataset.id);
    const week = parseInt(checkbox.dataset.week);
    const completed = checkbox.checked ? 1 : 0;
    
    // Visual feedback
    checkbox.disabled = true;
    const row = checkbox.closest('tr');
    if (row) row.classList.add('updating');
    
    try {
        // Update local state
        updateLocalData(id, completed, week);
        
        // Update UI
        updateWeekProgress(week);
        updateOverallProgress();
        
        // Try to update server
        if (AppState.isOnline) {
            await sendUpdateToServer(id, completed);
            showNotification('Progress saved!', 'success');
        } else {
            // Queue for offline sync
            addToOfflineQueue(id, completed);
            showNotification('Saved offline - will sync when online', 'info');
        }
        
    } catch (error) {
        console.error('Error updating:', error);
        checkbox.checked = !checkbox.checked; // Revert UI
        
        if (!AppState.isOnline) {
            showNotification('Failed to save. Working offline.', 'warning');
        } else {
            showNotification('Failed to save. Please try again.', 'error');
        }
        
    } finally {
        checkbox.disabled = false;
        if (row) row.classList.remove('updating');
        updateSyncButton();
    }
}

/**
 * Send Update to Server with retry logic
 */
async function sendUpdateToServer(id, completed, retryCount = 0) {
    try {
        const response = await fetch(CONFIG.API_ENDPOINTS.UPDATE, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ id, completed })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || 'Update failed');
        }
        
        return result;
        
    } catch (error) {
        if (retryCount < CONFIG.UPDATE_OPTIONS.MAX_RETRIES) {
            // Retry after delay
            await new Promise(resolve => 
                setTimeout(resolve, CONFIG.UPDATE_OPTIONS.RETRY_DELAY)
            );
            return sendUpdateToServer(id, completed, retryCount + 1);
        } else {
            // Add to offline queue after max retries
            addToOfflineQueue(id, completed);
            throw error;
        }
    }
}

/**
 * Add to Offline Queue
 */
function addToOfflineQueue(id, completed) {
    const update = {
        id,
        completed,
        timestamp: new Date().toISOString(),
        attempts: 0
    };
    
    AppState.offlineQueue.push(update);
    
    // Save to localStorage
    localStorage.setItem(
        CONFIG.OFFLINE_QUEUE_KEY,
        JSON.stringify(AppState.offlineQueue)
    );
    
    // Update UI
    updateSyncButton();
    updateNetworkStatus();
    
    // Register for background sync
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
        navigator.serviceWorker.ready.then(registration => {
            registration.sync.register('sync-updates');
        });
    }
}

/**
 * Sync Offline Queue
 */
async function syncOfflineQueue() {
    if (AppState.offlineQueue.length === 0 || !AppState.isOnline) {
        return;
    }
    
    const successful = [];
    const failed = [];
    
    for (const update of [...AppState.offlineQueue]) {
        try {
            await sendUpdateToServer(update.id, update.completed);
            successful.push(update.id);
            
            // Remove from queue
            AppState.offlineQueue = AppState.offlineQueue.filter(
                u => u.id !== update.id
            );
            
        } catch (error) {
            update.attempts++;
            failed.push(update);
            console.warn('Failed to sync update:', update.id, error);
        }
    }
    
    // Save updated queue
    localStorage.setItem(
        CONFIG.OFFLINE_QUEUE_KEY,
        JSON.stringify(AppState.offlineQueue)
    );
    
    // Show results
    if (successful.length > 0) {
        showNotification(`Synced ${successful.length} update(s)`, 'success');
        // Reload fresh data
        await loadStudyData();
    }
    
    updateSyncButton();
}

/**
 * Load Offline Queue
 */
function loadOfflineQueue() {
    try {
        const saved = localStorage.getItem(CONFIG.OFFLINE_QUEUE_KEY);
        if (saved) {
            AppState.offlineQueue = JSON.parse(saved);
        }
    } catch (error) {
        console.error('Error loading offline queue:', error);
        AppState.offlineQueue = [];
    }
}

// Update initializeApp to load offline queue
async function initializeApp() {
    // ... existing code ...
    
    // Load offline queue
    loadOfflineQueue();
    
    // Check for updates periodically
    setInterval(checkForUpdates, CONFIG.UPDATE_CHECK_INTERVAL);
    
    // Initial update check
    setTimeout(checkForUpdates, 5000);
    
    // ... rest of existing code ...
}

// Listen for service worker updates
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
    });
    
    // Listen for update messages
    navigator.serviceWorker.addEventListener('message', event => {
        if (event.data.type === 'UPDATE_AVAILABLE') {
            AppState.isUpdateAvailable = true;
            AppState.newVersion = event.data.version;
            showUpdateNotification();
        }
    });
}