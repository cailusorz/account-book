// 云端记账本 Service Worker
// 版本: 2.0.1 (修复主屏幕启动空白问题)

const CACHE_NAME = 'mywebfinance-v2.0.1';
const APP_VERSION = '2.0.1';

// 需要缓存的核心文件列表 - 增加所有HTML页面和关键资源
const CORE_CACHE_FILES = [
  './',
  './index.html',
  './app.html',
  './admin.html',
  './style.css',
  './manifest.json',
  './icons/favicon.ico',
  './icons/favicon.svg',
  './icons/favicon-96x96.png',
  './icons/apple-touch-icon.png',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/chart.js',
  './app.js',
  './admin.js'
];

// 动态缓存的文件类型
const DYNAMIC_CACHE_PATTERNS = [
  /\.html$/i,
  /\.css$/i,
  /\.js$/i,
  /\.json$/i,
  /\.png$/i,
  /\.jpg$/i,
  /\.jpeg$/i,
  /\.gif$/i,
  /\.svg$/i,
  /\.ico$/i,
  /\.woff$/i,
  /\.woff2$/i,
  /\.ttf$/i,
  /\.eot$/i
];

// 安装阶段
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(CORE_CACHE_FILES))
      .then(() => self.skipWaiting())
  );
});

// 激活阶段
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 获取请求
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  // 忽略非GET请求和扩展请求
  if (request.method !== 'GET') return;
  if (url.protocol.startsWith('chrome-extension')) return;
  if (url.hostname.includes('browser-sync')) return;

  // 图标特殊处理
  if (url.pathname.includes('favicon') || url.pathname.includes('icon')) {
    event.respondWith(handleIconRequest(event));
    return;
  }

  // GitHub API 不缓存，直接网络请求，失败时返回离线提示
  if (url.hostname === 'api.github.com') {
    event.respondWith(handleApiRequest(event));
    return;
  }

  // 对于HTML导航请求（用户直接访问页面），采用网络优先策略，确保获取最新页面
  if (request.mode === 'navigate' || (request.headers.get('Accept') && request.headers.get('Accept').includes('text/html'))) {
    event.respondWith(
      fetch(request)
        .then(response => {
          // 缓存成功的响应
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, responseToCache));
          }
          return response;
        })
        .catch(() => {
          // 网络失败，尝试从缓存返回
          return caches.match(request).then(cachedResponse => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // 如果连缓存都没有，返回离线页面（可选）
            return caches.match('./index.html');
          });
        })
    );
    return;
  }

  // 其他资源（CSS、JS、图片等）：缓存优先，后台更新
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) {
        // 在后台更新缓存
        updateCacheInBackground(event);
        return cached;
      }
      return fetch(request).then(network => {
        if (network && network.status === 200 && shouldCacheRequest(request)) {
          const responseToCache = network.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, responseToCache));
        }
        return network;
      }).catch(() => {
        // 如果是图片等资源，可以返回默认占位图，这里简单返回空响应
        return new Response('', { status: 503, statusText: 'Service Unavailable' });
      });
    })
  );
});

function handleIconRequest(event) {
  return caches.match(event.request)
    .then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(network => {
        if (network && network.status === 200) {
          const responseToCache = network.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
        }
        return network;
      }).catch(() => caches.match('./icons/favicon-96x96.png'));
    });
}

function handleApiRequest(event) {
  return fetch(event.request).catch(() => {
    return new Response(JSON.stringify({
      error: '网络连接失败',
      message: '请检查网络连接后重试'
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  });
}

function updateCacheInBackground(event) {
  fetch(event.request).then(network => {
    if (network && network.status === 200 && shouldCacheRequest(event.request)) {
      const responseToCache = network.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
    }
  }).catch(() => {});
}

function shouldCacheRequest(request) {
  const url = new URL(request.url);
  // 只缓存同源或CDN资源
  if (url.origin !== self.location.origin && 
      !url.href.includes('cdnjs.cloudflare.com') &&
      !url.href.includes('cdn.jsdelivr.net')) {
    return false;
  }
  return DYNAMIC_CACHE_PATTERNS.some(pattern => pattern.test(request.url));
}

// 消息处理
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.keys().then(cacheNames => {
      return Promise.all(cacheNames.map(cacheName => caches.delete(cacheName)));
    }).then(() => {
      caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_CACHE_FILES));
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({ success: true });
      }
    });
  }
});

// 后台同步（预留）
self.addEventListener('sync', event => {
  if (event.tag === 'sync-records') {
    event.waitUntil(Promise.resolve());
  }
});

// 推送通知
self.addEventListener('push', event => {
  const options = {
    body: event.data?.text() || '云端记账本提醒',
    icon: './icons/favicon-96x96.png',
    badge: './icons/favicon-96x96.png',
    vibrate: [100, 50, 100],
    data: { dateOfArrival: Date.now(), primaryKey: '1' },
    actions: [
      { action: 'open', title: '打开记账本' },
      { action: 'close', title: '关闭' }
    ]
  };
  event.waitUntil(
    self.registration.showNotification('云端记账本', options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'open') {
    event.waitUntil(clients.openWindow('./app.html'));
  }
});
