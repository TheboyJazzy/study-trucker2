
/**
 * STUDY TRACKER - ENHANCED SERVICE WORKER
 * With offline sync and update detection
 */

const APP_VERSION = '3.0.0';
const CACHE_NAMES = {
    STATIC: `study-tracker-static-v${APP_VERSION}`,
    DYNAMIC: `study-tracker-dynamic-v${APP_VERSION}`,
    API: `study-tracker-api-v${APP_VERSION}`
};

// Files to cache on install
const STATIC_ASSETS = [
    './',
    './index.html',
    './css/style.css',
    './script.js',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './offline.html'
];

// Install Service Worker
self.addEventListener('install', event => {
    console.log(`[Service Worker ${APP_VERSION}] Installing...`);
    
    event.waitUntil(
        caches.open(CACHE_NAMES.STATIC)
            .then(cache => {
                console.log('[Service Worker] Caching static assets');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => {
                console.log('[Service Worker] Install completed');
                return self.skipWaiting();
            })
    );
});

// Activate Service Worker - Clean old caches
self.addEventListener('activate', event => {
    console.log(`[Service Worker ${APP_VERSION}] Activating...`);
    
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    // Delete caches that aren't current
                    if (!Object.values(CACHE_NAMES).includes(cacheName)) {
                        console.log('[Service Worker] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
        .then(() => {
            // Claim all clients immediately
            return self.clients.claim();
        })
        .then(() => {
            // Send message to all clients about new version
            return self.clients.matchAll().then(clients => {
                clients.forEach(client => {
                    client.postMessage({
                        type: 'NEW_VERSION_AVAILABLE',
                        version: APP_VERSION
                    });
                });
            });
        })
    );
});

// Fetch Event
self.addEventListener('fetch', event => {
    // Skip non-GET requests
    if (event.request.method !== 'GET') return;
    
    // Skip Chrome extensions
    if (event.request.url.startsWith('chrome-extension://')) return;
    
    // Handle API calls
    if (event.request.url.includes('/api/') || 
        event.request.url.includes('.php')) {
        event.respondWith(networkFirstWithQueue(event.request));
        return;
    }
    
    // Cache first for static assets
    event.respondWith(cacheFirst(event.request));
});

// Cache First Strategy
async function cacheFirst(request) {
    try {
        const cachedResponse = await caches.match(request);
        
        if (cachedResponse) {
            // Update cache in background
            updateCache(request);
            return cachedResponse;
        }
        
        const networkResponse = await fetch(request);
        
        // Cache the response
        const cache = await caches.open(CACHE_NAMES.DYNAMIC);
        await cache.put(request, networkResponse.clone());
        
        return networkResponse;
        
    } catch (error) {
        // Return offline page for HTML requests
        if (request.headers.get('accept')?.includes('text/html')) {
            return caches.match('./offline.html');
        }
        
        // Return cached version if available
        const cached = await caches.match(request);
        if (cached) return cached;
        
        throw error;
    }
}

// Network First with Queue for API calls
async function networkFirstWithQueue(request) {
    try {
        const networkResponse = await fetch(request.clone());
        
        // Cache successful responses
        if (networkResponse.ok) {
            const cache = await caches.open(CACHE_NAMES.API);
            await cache.put(request, networkResponse.clone());
            
            // Try to sync pending updates if this was an update request
            if (request.url.includes('update.php') && request.method === 'POST') {
                await syncPendingUpdates();
            }
        }
        
        return networkResponse;
        
    } catch (error) {
        console.log('[Service Worker] Network failed, checking cache/queue:', request.url);
        
        // For POST requests, add to queue
        if (request.method === 'POST') {
            return queueUpdate(request);
        }
        
        // For GET requests, try cache
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        // Return empty/default response for API failures
        return createOfflineResponse(request);
    }
}

// Queue failed updates
async function queueUpdate(request) {
    try {
        // Clone request to read body multiple times
        const requestClone = request.clone();
        const body = await requestClone.text();
        
        // Store in IndexedDB for later sync
        await storePendingUpdate({
            url: request.url,
            method: request.method,
            body: body,
            headers: Object.fromEntries(request.headers.entries()),
            timestamp: new Date().toISOString()
        });
        
        // Return success response to user
        return new Response(JSON.stringify({
            success: true,
            queued: true,
            message: 'Update queued for sync when online'
        }), {
            headers: { 'Content-Type': 'application/json' }
        });
        
    } catch (error) {
        console.error('[Service Worker] Failed to queue update:', error);
        throw error;
    }
}

// Sync pending updates when back online
async function syncPendingUpdates() {
    try {
        const updates = await getPendingUpdates();
        
        for (const update of updates) {
            try {
                const response = await fetch(update.url, {
                    method: update.method,
                    headers: update.headers,
                    body: update.body
                });
                
                if (response.ok) {
                    // Remove from queue
                    await removePendingUpdate(update.id);
                    console.log('[Service Worker] Synced update:', update.id);
                }
            } catch (error) {
                console.warn('[Service Worker] Failed to sync update:', error);
            }
        }
        
    } catch (error) {
        console.error('[Service Worker] Sync failed:', error);
    }
}

// Update cache in background
async function updateCache(request) {
    try {
        const response = await fetch(request);
        if (response.ok) {
            const cache = await caches.open(CACHE_NAMES.DYNAMIC);
            await cache.put(request, response);
        }
    } catch (error) {
        // Silently fail - we already have cached version
    }
}

// Create offline response
function createOfflineResponse(request) {
    if (request.url.includes('get_data.php')) {
        return new Response(JSON.stringify([]), {
            headers: { 'Content-Type': 'application/json' }
        });
    }
    
    return new Response(JSON.stringify({
        success: false,
        error: 'Offline - Please check your connection'
    }), {
        headers: { 'Content-Type': 'application/json' },
        status: 503
    });
}

// Background Sync
self.addEventListener('sync', event => {
    if (event.tag === 'sync-updates') {
        console.log('[Service Worker] Background sync triggered');
        event.waitUntil(syncPendingUpdates());
    }
    
    if (event.tag === 'update-check') {
        event.waitUntil(checkForUpdates());
    }
});

// Check for updates
async function checkForUpdates() {
    try {
        const response = await fetch('./version.json?t=' + Date.now());
        const data = await response.json();
        
        if (data.version !== APP_VERSION) {
            self.clients.matchAll().then(clients => {
                clients.forEach(client => {
                    client.postMessage({
                        type: 'UPDATE_AVAILABLE',
                        version: data.version
                    });
                });
            });
        }
    } catch (error) {
        console.log('[Service Worker] Update check failed:', error);
    }
}

// Handle messages from clients
self.addEventListener('message', event => {
    if (event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    
    if (event.data.type === 'SYNC_NOW') {
        syncPendingUpdates();
    }
});

// IndexedDB for pending updates
const DB_NAME = 'StudyTrackerDB';
const DB_VERSION = 1;
const STORE_NAME = 'pendingUpdates';

async function getDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }
        };
        
        request.onsuccess = (event) => resolve(event.target.result);
        request.onerror = (event) => reject(event.target.error);
    });
}

async function storePendingUpdate(update) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.add(update);
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function getPendingUpdates() {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function removePendingUpdate(id) {
    const db = await getDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);
        
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

// Push notifications
self.addEventListener('push', event => {
    const data = event.data?.json() || { 
        title: 'Study Tracker', 
        body: 'New update available' 
    };
    
    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: './icons/icon-192.png',
            badge: './icons/icon-192.png',
            tag: 'update-notification',
            data: data.url || './',
            actions: [
                { action: 'open', title: 'Open App' },
                { action: 'dismiss', title: 'Dismiss' }
            ]
        })
    );
});

// Notification click handler
self.addEventListener('notificationclick', event => {
    event.notification.close();
    
    if (event.action === 'open') {
        event.waitUntil(
            clients.matchAll({ type: 'window' }).then(clientList => {
                for (const client of clientList) {
                    if (client.url.includes('/study-tracker/') && 'focus' in client) {
                        return client.focus();
                    }
                }
                if (clients.openWindow) {
                    return clients.openWindow(event.notification.data || './');
                }
            })
        );
    }
});

// Periodic sync (if supported)
if ('periodicSync' in self.registration) {
    self.addEventListener('periodicsync', event => {
        if (event.tag === 'update-check') {
            event.waitUntil(checkForUpdates());
        }
    });
}
[file content end]