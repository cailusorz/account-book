// ========== 云端记账本 - 主逻辑文件 ==========
// 全局变量
let userData = {
    records: [],
    categories: {
        '收入': ['工资', '奖金', '投资', '兼职', '其他收入'],
        '支出': ['餐饮', '交通', '购物', '娱乐', '住房', '医疗', '教育', '其他支出'],
        '借贷': ['借款', '还款']
    },
    budgets: {},
    totalExpenseBudget: null,
    settings: {},
    created: new Date().toISOString(),
    lastSync: new Date().toISOString(),
    version: 1
};

let currentUser = null;
let currentRepo = null;
let currentToken = null;
let syncTimer = null;
let isSyncing = false;
let lastSyncSuccess = false;
let pendingSync = false;
let syncRetryCount = 0;
const MAX_SYNC_RETRIES = 7;
const SYNC_TIMEOUT = 120000;

// 同步队列：保证所有同步请求按顺序执行
let syncQueue = Promise.resolve();

// 图表实例
let expenseChart = null;
let incomeChart = null;
let trendChart = null;
let monthlyChart = null;
let yearlyChart = null;

// UI 状态变量
let currentPage = 1;
const recordsPerPage = 10;
let editingRecordId = null;
let isAddingRecord = false;
let currentModal = null;
let currentDateRange = 'month';
let customStartDate = null;
let customEndDate = null;

// 导出到全局
window.userData = userData;
window.currentUser = currentUser;
window.currentRepo = currentRepo;
window.currentToken = currentToken;
window.isSyncing = isSyncing;
window.pendingSync = pendingSync;
window.expenseChart = expenseChart;
window.incomeChart = incomeChart;
window.trendChart = trendChart;
window.monthlyChart = monthlyChart;
window.yearlyChart = yearlyChart;
window.currentPage = currentPage;
window.recordsPerPage = recordsPerPage;
window.editingRecordId = editingRecordId;
window.isAddingRecord = isAddingRecord;
window.currentModal = currentModal;
window.currentDateRange = currentDateRange;
window.customStartDate = customStartDate;
window.customEndDate = customEndDate;

// ========== 工具函数 ==========
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}
window.generateId = generateId;

function showLoading() {
    const el = document.getElementById('loading');
    if (el) el.style.display = 'flex';
}
window.showLoading = showLoading;

function hideLoading() {
    const el = document.getElementById('loading');
    if (el) el.style.display = 'none';
}
window.hideLoading = hideLoading;

function showMessage(text, type = 'info') {
    const msg = document.createElement('div');
    msg.className = `message ${type}`;
    msg.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : type === 'warning' ? 'exclamation-triangle' : 'exclamation-circle'}"></i>${text}`;
    msg.style.position = 'fixed';
    msg.style.top = '20px';
    msg.style.right = '20px';
    msg.style.zIndex = '10000';
    msg.style.maxWidth = '300px';
    document.body.appendChild(msg);
    setTimeout(() => msg.remove(), 3000);
}
window.showMessage = showMessage;

function showFormMessage(text, type = 'info') {
    const container = document.getElementById('formMessage');
    if (container) {
        container.innerHTML = `<div class="message ${type}"><i class="fas fa-${type === 'success' ? 'check-circle' : type === 'warning' ? 'exclamation-triangle' : 'exclamation-circle'}"></i>${text}</div>`;
    }
}
window.showFormMessage = showFormMessage;

// ========== 新增：安全表达式求值函数 ==========
function safeEvaluate(expr) {
    if (typeof expr !== 'string') return expr;
    // 去除空格
    expr = expr.trim();
    if (expr === '') return NaN;
    // 如果已经是纯数字，直接返回数字
    if (/^-?\d+(\.\d+)?$/.test(expr)) {
        return parseFloat(expr);
    }
    // 检查是否只包含允许的字符：数字、小数点、运算符 + - * / ( )
    if (!/^[\d\s\.\+\-\*\/\(\)]+$/.test(expr)) {
        throw new Error('表达式包含非法字符');
    }
    try {
        // 使用 Function 构造器进行求值（比 eval 安全一些）
        const result = new Function('return ' + expr)();
        if (typeof result !== 'number' || isNaN(result) || !isFinite(result)) {
            throw new Error('计算结果无效');
        }
        return result;
    } catch (e) {
        throw new Error('表达式格式错误');
    }
}
window.safeEvaluate = safeEvaluate;

// ========== 增强版带超时和重试的 fetch ==========
async function fetchWithTimeout(url, options = {}, timeout = SYNC_TIMEOUT) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
}

async function retryFetch(url, options = {}, retries = MAX_SYNC_RETRIES, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fetchWithTimeout(url, options);
        } catch (error) {
            if (error.status === 401 || error.status === 403) {
                throw new Error('GitHub Token 无效或已过期，请重新登录');
            }
            if (i === retries - 1) throw error;
            const waitTime = Math.min(delay * Math.pow(2, i), 30000);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }
}

// ========== 登录验证 ==========
async function checkLoginStatus() {
    try {
        const config = localStorage.getItem('accountConfig');
        if (!config) {
            window.location.href = './index.html';
            return;
        }
        const parsed = JSON.parse(config);
        currentUser = parsed.username;
        currentRepo = parsed.repo || 'cailusorz/account-book';
        currentToken = parsed.token;
        window.currentUser = currentUser;
        window.currentRepo = currentRepo;
        window.currentToken = currentToken;

        document.getElementById('sidebarUsername').textContent = currentUser;
        document.getElementById('sidebarRepo').textContent = '仓库: ' + currentRepo;
        document.getElementById('settingsUsername').value = currentUser;
        document.getElementById('settingsRepo').value = currentRepo;

        const savedTheme = localStorage.getItem('theme') || 'auto';
        document.getElementById('themeSelect').value = savedTheme;
        applyTheme(savedTheme);
    } catch (error) {
        console.error('登录验证失败:', error);
        alert('登录验证失败，请重新登录');
        localStorage.removeItem('accountConfig');
        window.location.href = './index.html';
    }
}
window.checkLoginStatus = checkLoginStatus;

// ========== 主题自动适配系统 ==========
function applyTheme(theme) {
    if (theme === 'dark') {
        document.body.classList.add('dark-theme');
        document.querySelector('.theme-btn i').className = 'fas fa-sun';
    } else if (theme === 'light') {
        document.body.classList.remove('dark-theme');
        document.querySelector('.theme-btn i').className = 'fas fa-moon';
    } else {
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.body.classList.add('dark-theme');
            document.querySelector('.theme-btn i').className = 'fas fa-sun';
        } else {
            document.body.classList.remove('dark-theme');
            document.querySelector('.theme-btn i').className = 'fas fa-moon';
        }
    }

    // 更新浏览器状态栏颜色（theme-color）
    const isDark = document.body.classList.contains('dark-theme');
    const themeColor = isDark ? '#121212' : '#F8F9FA';
    let meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
        meta.content = themeColor;
    }
}

function toggleTheme() {
    const currentTheme = localStorage.getItem('theme') || 'light';
    let newTheme;
    if (currentTheme === 'light') {
        newTheme = 'dark';
    } else if (currentTheme === 'dark') {
        newTheme = 'auto';
    } else {
        newTheme = 'light';
    }
    localStorage.setItem('theme', newTheme);
    applyTheme(newTheme);
    document.getElementById('themeSelect').value = newTheme;
}
window.toggleTheme = toggleTheme;

function changeTheme(theme) {
    localStorage.setItem('theme', theme);
    applyTheme(theme);
}
window.changeTheme = changeTheme;

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
    const theme = localStorage.getItem('theme') || 'auto';
    if (theme === 'auto') {
        applyTheme('auto');
    }
});

// ========== GitHub 数据同步（队列版）==========
async function loadFromGitHub() {
    const [owner, repoName] = currentRepo.split('/');
    const filePath = `data/${currentUser}.json`;
    const headers = { 'Accept': 'application/vnd.github.v3+json' };
    if (currentToken) headers['Authorization'] = `token ${currentToken}`;

    const response = await retryFetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${filePath}`, { headers });
    if (response.ok) {
        const data = await response.json();
        let content;
        try {
            content = decodeURIComponent(atob(data.content));
        } catch {
            content = atob(data.content);
        }
        userData = JSON.parse(content);
        window.userData = userData;
        userData.lastSync = new Date().toISOString();
        updateLastSyncTime();
        localStorage.setItem(`backup_${currentUser}`, JSON.stringify(userData));
    } else if (response.status === 404) {
        userData.created = new Date().toISOString();
        window.userData = userData;
        await saveToGitHub(true);
    } else {
        const errorText = await response.text();
        throw new Error(`无法加载数据: ${response.status} - ${response.statusText}`);
    }
}
window.loadFromGitHub = loadFromGitHub;

async function doSync(forceCreate = false, showUserMessage = true) {
    if (isSyncing && !forceCreate) return false;
    if (!navigator.onLine) {
        localStorage.setItem(`backup_${currentUser}`, JSON.stringify(userData));
        pendingSync = true;
        window.pendingSync = pendingSync;
        updateSyncStatus('offline');
        if (showUserMessage) showMessage('当前处于离线状态，数据已保存到本地，联网后将自动同步', 'warning');
        return false;
    }

    isSyncing = true;
    window.isSyncing = isSyncing;
    updateSyncStatus('syncing');

    try {
        const [owner, repoName] = currentRepo.split('/');
        const filePath = `data/${currentUser}.json`;
        userData.lastSync = new Date().toISOString();
        window.userData = userData;
        const content = btoa(encodeURIComponent(JSON.stringify(userData, null, 2)));

        let sha = null;
        const headers = { 'Accept': 'application/vnd.github.v3+json' };
        if (currentToken) headers['Authorization'] = `token ${currentToken}`;
        try {
            const check = await retryFetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${filePath}`, { headers });
            if (check.ok) {
                const fileData = await check.json();
                sha = fileData.sha;
            }
        } catch { /* 文件不存在 */ }

        const body = {
            message: `更新记账数据: ${new Date().toLocaleString('zh-CN')}`,
            content: content,
            sha: sha
        };
        const putHeaders = {
            'Content-Type': 'application/json',
            'Accept': 'application/vnd.github.v3+json'
        };
        if (currentToken) putHeaders['Authorization'] = `token ${currentToken}`;

        const response = await retryFetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${filePath}`, {
            method: 'PUT',
            headers: putHeaders,
            body: JSON.stringify(body)
        });

        if (response.ok) {
            localStorage.setItem(`backup_${currentUser}`, JSON.stringify(userData));
            isSyncing = false;
            pendingSync = false;
            syncRetryCount = 0;
            window.isSyncing = isSyncing;
            window.pendingSync = pendingSync;
            updateSyncStatus('success');
            updateLastSyncTime();
            lastSyncSuccess = true;
            window.lastSyncSuccess = lastSyncSuccess;
            if (showUserMessage) showMessage('数据同步成功', 'success');
            return true;
        } else {
            const errorData = await response.text();
            if (response.status === 401 || response.status === 403) {
                throw new Error('GitHub Token 无效或权限不足，请检查 Token');
            } else if (response.status === 409) {
                throw new Error('同步冲突，请稍后重试');
            } else {
                throw new Error(`GitHub API 错误: ${response.status} - ${errorData}`);
            }
        }
    } catch (error) {
        console.error('保存到GitHub失败:', error);
        localStorage.setItem(`backup_${currentUser}`, JSON.stringify(userData));
        isSyncing = false;
        pendingSync = true;
        window.isSyncing = isSyncing;
        window.pendingSync = pendingSync;
        updateSyncStatus('error');
        lastSyncSuccess = false;
        window.lastSyncSuccess = lastSyncSuccess;

        if (error.message.includes('Token') || error.message.includes('401') || error.message.includes('403')) {
            if (showUserMessage) showMessage('同步失败: ' + error.message, 'error');
        } else {
            if (navigator.onLine && syncRetryCount < MAX_SYNC_RETRIES) {
                syncRetryCount++;
                const delay = Math.min(1000 * Math.pow(2, syncRetryCount - 1), 30000);
                setTimeout(() => {
                    enqueueSync(false, false);
                }, delay);
                if (showUserMessage) showMessage(`同步失败，${delay/1000}秒后自动重试 (${syncRetryCount}/${MAX_SYNC_RETRIES})`, 'warning');
            } else {
                if (showUserMessage) showMessage('同步失败，数据已保存到本地，将在网络恢复后自动重试', 'warning');
            }
        }
        return false;
    }
}

function enqueueSync(forceCreate = false, showUserMessage = true) {
    const resultPromise = syncQueue.then(() => doSync(forceCreate, showUserMessage)).catch(err => {
        console.error('队列同步错误:', err);
        return false;
    });
    syncQueue = resultPromise;
    return resultPromise;
}

async function saveToGitHub(forceCreate = false, showUserMessage = true) {
    return enqueueSync(forceCreate, showUserMessage);
}
window.saveToGitHub = saveToGitHub;

async function loadUserData() {
    try {
        showLoading();
        await loadFromGitHub();
        updateDashboard();
        updateRecentRecords();
        updateAllRecords();
        updateCategoriesDropdown();
        updateBudgetList();
        updateAnalytics();
        startAutoSync();
    } catch (error) {
        console.error('加载用户数据失败:', error);
        showMessage('同步失败: ' + error.message, 'error');
        const backup = localStorage.getItem(`backup_${currentUser}`);
        if (backup) {
            userData = JSON.parse(backup);
            window.userData = userData;
            showMessage('使用本地备份数据', 'warning');
            updateDashboard();
        }
    } finally {
        hideLoading();
    }
}
window.loadUserData = loadUserData;

function updateSyncStatus(status) {
    const el = document.getElementById('syncStatus');
    if (!el) return;
    el.className = `sync-status ${status}`;
    if (status === 'syncing') {
        el.innerHTML = '<i class="fas fa-sync fa-spin"></i><span>同步中...</span>';
    } else if (status === 'success') {
        el.innerHTML = '<i class="fas fa-check-circle"></i><span>已同步</span>';
    } else if (status === 'offline') {
        el.innerHTML = '<i class="fas fa-wifi-slash"></i><span>待同步</span>';
    } else {
        el.innerHTML = '<i class="fas fa-exclamation-circle"></i><span>同步失败</span>';
    }
}
window.updateSyncStatus = updateSyncStatus;

function updateLastSyncTime() {
    const el = document.getElementById('lastSyncTime');
    if (el && userData.lastSync) {
        el.textContent = '最后同步: ' + new Date(userData.lastSync).toLocaleString('zh-CN');
    }
}
window.updateLastSyncTime = updateLastSyncTime;

function startAutoSync() {
    const config = JSON.parse(localStorage.getItem('accountConfig')) || {};
    if (config.autoSync !== false) {
        syncTimer = setInterval(async () => {
            if (!isSyncing && navigator.onLine && pendingSync) {
                await enqueueSync(false, false);
            }
        }, 5 * 60 * 1000);
    }
}
window.startAutoSync = startAutoSync;

function updateConnectionStatus() {
    const el = document.getElementById('connectionStatus');
    if (!el) return;
    const online = navigator.onLine;
    el.innerHTML = `<div class="connection-indicator ${online ? 'online' : 'offline'}"></div><span>${online ? '在线' : '离线'}</span>`;
    if (online && pendingSync) {
        enqueueSync(false, true);
    }
}
window.updateConnectionStatus = updateConnectionStatus;

async function clearGitHubCache() {
    if (!confirm('确定要清理GitHub缓存吗？这将清除所有本地缓存和Service Worker缓存，然后重新同步数据。')) return;
    showLoading();
    try {
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            const channel = new MessageChannel();
            const clearPromise = new Promise(resolve => {
                channel.port1.onmessage = e => { if (e.data?.success) resolve(true); };
            });
            navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHE' }, [channel.port2]);
            await clearPromise;
        }
        if (currentUser) localStorage.removeItem(`backup_${currentUser}`);
        await loadFromGitHub();
        updateDashboard();
        updateRecentRecords();
        updateAllRecords();
        updateCategoriesDropdown();
        updateBudgetList();
        updateAnalytics();
        showMessage('GitHub缓存清理完成，数据已重新同步', 'success');
    } catch (error) {
        showMessage('清理缓存失败: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}
window.clearGitHubCache = clearGitHubCache;

// 定期备份
setInterval(() => {
    if (userData.records.length > 0) {
        localStorage.setItem(`backup_${currentUser}`, JSON.stringify(userData));
    }
}, 30000);

// ========== 日期范围过滤 ==========
function filterRecordsByDateRange(records, range) {
    if (!records || records.length === 0) return [];

    const now = new Date();

    function toLocalDateStr(date) {
        const d = new Date(date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    if (range === 'custom' && window.customStartDate && window.customEndDate) {
        const startStr = window.customStartDate;
        const endStr = window.customEndDate;
        return records.filter(r => {
            const recordDateStr = toLocalDateStr(r.date);
            return recordDateStr >= startStr && recordDateStr <= endStr;
        });
    }

    let startStr, endStr;
    switch (range) {
        case 'today':
            startStr = toLocalDateStr(now);
            endStr = startStr;
            return records.filter(r => toLocalDateStr(r.date) === startStr);
        case 'week':
            const firstDay = new Date(now);
            firstDay.setDate(now.getDate() - now.getDay());
            startStr = toLocalDateStr(firstDay);
            const lastDay = new Date(firstDay);
            lastDay.setDate(firstDay.getDate() + 6);
            endStr = toLocalDateStr(lastDay);
            break;
        case 'month':
            startStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01';
            const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
            nextMonth.setDate(nextMonth.getDate() - 1);
            endStr = toLocalDateStr(nextMonth);
            break;
        case 'year':
            startStr = now.getFullYear() + '-01-01';
            endStr = now.getFullYear() + '-12-31';
            break;
        case 'all':
        default:
            return records;
    }

    return records.filter(r => {
        const recordDateStr = toLocalDateStr(r.date);
        return recordDateStr >= startStr && recordDateStr <= endStr;
    });
}
window.filterRecordsByDateRange = filterRecordsByDateRange;

function getCurrentDateRange() {
    return currentDateRange;
}
window.getCurrentDateRange = getCurrentDateRange;

// ========== 仪表盘 ==========
function updateDashboard() {
    const range = getCurrentDateRange() || 'month';
    const filtered = filterRecordsByDateRange(userData.records, range);
    let income = 0, expense = 0, loan = 0, repayment = 0;
    filtered.forEach(r => {
        const amt = r.amount;
        if (r.type === '收入') income += amt;
        else if (r.type === '支出') expense += amt;
        else if (r.type === '借贷') {
            if (r.category === '借款') loan += amt;
            else if (r.category === '还款') repayment += amt;
        }
    });
    const netLoan = loan - repayment;
    const balance = income - expense + netLoan;
    document.getElementById('totalIncome').textContent = '¥' + income.toFixed(2);
    document.getElementById('totalExpense').textContent = '¥' + expense.toFixed(2);
    document.getElementById('totalLoan').textContent = '¥' + netLoan.toFixed(2);
    document.getElementById('balance').textContent = '¥' + balance.toFixed(2);
    updateCharts();
}
window.updateDashboard = updateDashboard;

// ========== 图表 ==========
function updateCharts() {
    updateExpenseChart();
    updateMonthlyChart();
    updateIncomeChart();
    updateTrendChart();
    updateYearlyChart();
}
window.updateCharts = updateCharts;

function updateExpenseChart() {
    const canvas = document.getElementById('expenseChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const parent = canvas.parentElement;

    const oldEmpty = parent.querySelector('.empty-state');
    if (oldEmpty) oldEmpty.remove();

    const range = getCurrentDateRange() || 'month';
    const filtered = filterRecordsByDateRange(userData.records, range).filter(r => r.type === '支出');
    const cats = userData.categories['支出'] || [];
    const data = cats.map(c => filtered.filter(r => r.category === c).reduce((s, r) => s + r.amount, 0));
    const labels = [], values = [];
    cats.forEach((c, i) => { if (data[i] > 0) { labels.push(c); values.push(data[i]); } });

    if (window.expenseChart) window.expenseChart.destroy();

    if (values.length === 0) {
        canvas.style.display = 'none';
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-state';
        emptyDiv.innerHTML = '<div class="empty-state-icon"><i class="fas fa-chart-pie"></i></div><div class="empty-state-title">暂无支出数据</div>';
        parent.appendChild(emptyDiv);
        return;
    }

    canvas.style.display = 'block';
    window.expenseChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: ['#FF6B6B','#4ECDC4','#FFD166','#7B8FA1','#6BCF7F','#FF9E9E','#7EE9E0','#FFE085','#9FAFBF','#8DD18D'],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { usePointStyle: true, font: { size: 12 } } },
                tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ¥${ctx.raw.toFixed(2)}` } }
            }
        }
    });

    canvas.ondblclick = null;
    canvas.ondblclick = (e) => {
        if (!window.expenseChart) return;
        let activePoints;
        if (typeof window.expenseChart.getElementsAtEventForMode === 'function') {
            activePoints = window.expenseChart.getElementsAtEventForMode(e, 'nearest', { intersect: true }, false);
        } else {
            activePoints = window.expenseChart.getElementsAtEvent(e);
        }
        if (activePoints && activePoints.length > 0) {
            const index = activePoints[0].index;
            const category = labels[index];
            const typeSelect = document.getElementById('filterType');
            const catSelect = document.getElementById('filterCategory');
            if (typeSelect && catSelect) {
                typeSelect.value = '支出';
                updateCategoryFilter(); // 更新分类下拉框
                catSelect.value = category; // 设置分类值
                
                // 跳转到所有记录页面，不重置筛选条件
                switchSection('records', false);
                
                // 刷新记录列表
                filterRecords();
                
                // 确保分类值被正确设置（有时 filterRecords 会重新生成下拉框导致值丢失）
                if (catSelect.value !== category) {
                    // 重新设置并再次刷新
                    catSelect.value = category;
                    filterRecords();
                }
            }
        }
    };
}
window.updateExpenseChart = updateExpenseChart;

function updateMonthlyChart() {
    const canvas = document.getElementById('monthlyChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const range = getCurrentDateRange() || 'month';
    const filtered = filterRecordsByDateRange(userData.records, range);
    const monthly = Array(12).fill().map(() => ({ income: 0, expense: 0 }));
    filtered.forEach(r => {
        const m = new Date(r.date).getMonth();
        const amt = r.isNegative ? -r.amount : r.amount;
        if (r.type === '收入') monthly[m].income += amt;
        else if (r.type === '支出') monthly[m].expense += amt;
    });
    if (window.monthlyChart) window.monthlyChart.destroy();
    window.monthlyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'],
            datasets: [
                { label: '收入', data: monthly.map(d => d.income), backgroundColor: '#6BCF7F', borderColor: '#6BCF7F', borderWidth: 1 },
                { label: '支出', data: monthly.map(d => d.expense), backgroundColor: '#FF6B6B', borderColor: '#FF6B6B', borderWidth: 1 }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { callback: v => '¥' + v } } }, plugins: { legend: { position: 'top' } } }
    });
}
window.updateMonthlyChart = updateMonthlyChart;

function updateIncomeChart() {
    const canvas = document.getElementById('incomeChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const parent = canvas.parentElement;

    const oldEmpty = parent.querySelector('.empty-state');
    if (oldEmpty) oldEmpty.remove();

    const range = getCurrentDateRange() || 'month';
    const filtered = filterRecordsByDateRange(userData.records, range);
    const totalIncome = filtered.filter(r => r.type === '收入').reduce((s, r) => s + (r.isNegative ? -r.amount : r.amount), 0);
    const totalExpense = filtered.filter(r => r.type === '支出').reduce((s, r) => s + r.amount, 0);

    if (window.incomeChart) window.incomeChart.destroy();

    if (totalIncome === 0 && totalExpense === 0) {
        canvas.style.display = 'none';
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-state';
        emptyDiv.innerHTML = '<div class="empty-state-icon"><i class="fas fa-chart-pie"></i></div><div class="empty-state-title">暂无收支数据</div>';
        parent.appendChild(emptyDiv);
        return;
    }

    canvas.style.display = 'block';
    window.incomeChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: ['收入', '支出'],
            datasets: [{ data: [totalIncome, totalExpense], backgroundColor: ['#6BCF7F', '#FF6B6B'], borderWidth: 1 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right' },
                tooltip: {
                    callbacks: {
                        label: ctx => {
                            const val = ctx.parsed;
                            const total = totalIncome + totalExpense;
                            const pct = total ? ((val / total) * 100).toFixed(1) : 0;
                            return `${ctx.label}: ¥${val.toFixed(2)} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}
window.updateIncomeChart = updateIncomeChart;

function updateTrendChart() {
    const canvas = document.getElementById('trendChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const range = getCurrentDateRange() || 'month';
    const filtered = filterRecordsByDateRange(userData.records, range);
    const map = {};
    filtered.forEach(r => {
        const d = new Date(r.date).toISOString().split('T')[0];
        if (!map[d]) map[d] = { income: 0, expense: 0 };
        const amt = r.isNegative ? -r.amount : r.amount;
        if (r.type === '收入') map[d].income += amt;
        else if (r.type === '支出') map[d].expense += amt;
    });
    const dates = Object.keys(map).sort();
    const incomeData = dates.map(d => map[d].income);
    const expenseData = dates.map(d => map[d].expense);
    if (window.trendChart) window.trendChart.destroy();
    window.trendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates.map(d => d.split('-')[1] + '/' + d.split('-')[2]),
            datasets: [
                { label: '收入', data: incomeData, borderColor: '#6BCF7F', backgroundColor: 'rgba(107,207,127,0.1)', tension: 0.4, fill: true },
                { label: '支出', data: expenseData, borderColor: '#FF6B6B', backgroundColor: 'rgba(255,107,107,0.1)', tension: 0.4, fill: true }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { callback: v => '¥' + v } } }, plugins: { legend: { position: 'top' } } }
    });
}
window.updateTrendChart = updateTrendChart;

function updateYearlyChart() {
    const canvas = document.getElementById('yearlyChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const yearSelect = document.getElementById('analyticsYear');
    const selectedYear = parseInt(yearSelect?.value) || new Date().getFullYear();

    const years = new Set();
    userData.records.forEach(r => years.add(new Date(r.date).getFullYear()));
    yearSelect.innerHTML = '';
    Array.from(years).sort((a,b)=>b-a).forEach(y => {
        const opt = document.createElement('option');
        opt.value = y; opt.textContent = y + '年';
        if (y === selectedYear) opt.selected = true;
        yearSelect.appendChild(opt);
    });

    const monthly = Array(12).fill().map(() => ({ income: 0, expense: 0, balance: 0 }));
    userData.records.forEach(r => {
        const d = new Date(r.date);
        if (d.getFullYear() === selectedYear) {
            const m = d.getMonth();
            const amt = r.isNegative ? -r.amount : r.amount;
            if (r.type === '收入') { monthly[m].income += amt; monthly[m].balance += amt; }
            else if (r.type === '支出') { monthly[m].expense += amt; monthly[m].balance -= amt; }
        }
    });

    if (window.yearlyChart) window.yearlyChart.destroy();
    window.yearlyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'],
            datasets: [
                { label: '收入', data: monthly.map(d => d.income), backgroundColor: '#6BCF7F', borderColor: '#6BCF7F', borderWidth: 1 },
                { label: '支出', data: monthly.map(d => d.expense), backgroundColor: '#FF6B6B', borderColor: '#FF6B6B', borderWidth: 1 },
                { label: '结余', data: monthly.map(d => d.balance), type: 'line', borderColor: '#4ECDC4', backgroundColor: 'transparent', borderWidth: 2, tension: 0.4 }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { callback: v => '¥' + v } } }, plugins: { legend: { position: 'top' } } }
    });
}
window.updateYearlyChart = updateYearlyChart;

function updateAnalytics() {
    updateYearlyChart();
    updateCategoryStats();
}
window.updateAnalytics = updateAnalytics;

function updateCategoryStats() {
    const incContainer = document.getElementById('incomeCategories');
    const expContainer = document.getElementById('expenseCategories');
    if (!incContainer || !expContainer) return;
    const range = getCurrentDateRange() || 'month';
    const filtered = filterRecordsByDateRange(userData.records, range);
    const incomeRecords = filtered.filter(r => r.type === '收入');
    const totalIncome = incomeRecords.reduce((s, r) => s + (r.isNegative ? -r.amount : r.amount), 0);
    let incHtml = '';
    (userData.categories['收入'] || []).forEach(cat => {
        const catTotal = incomeRecords.filter(r => r.category === cat).reduce((s, r) => s + (r.isNegative ? -r.amount : r.amount), 0);
        if (catTotal > 0) {
            const pct = totalIncome ? ((catTotal / totalIncome) * 100).toFixed(1) : 0;
            incHtml += `<div class="category-item"><div class="category-info"><span class="category-name">${cat}</span><span class="category-amount">¥${catTotal.toFixed(2)}</span></div><div class="category-percentage"><div class="percentage-bar" style="background: linear-gradient(90deg, #6BCF7F ${pct}%, var(--input-bg) ${pct}%);"></div><span>${pct}%</span></div></div>`;
        }
    });
    incContainer.innerHTML = incHtml || '<div style="color: var(--text-secondary); text-align: center; padding: 20px;">暂无收入数据</div>';

    const expenseRecords = filtered.filter(r => r.type === '支出');
    const totalExpense = expenseRecords.reduce((s, r) => s + r.amount, 0);
    let expHtml = '';
    (userData.categories['支出'] || []).forEach(cat => {
        const catTotal = expenseRecords.filter(r => r.category === cat).reduce((s, r) => s + r.amount, 0);
        if (catTotal > 0) {
            const pct = totalExpense ? ((catTotal / totalExpense) * 100).toFixed(1) : 0;
            expHtml += `<div class="category-item"><div class="category-info"><span class="category-name">${cat}</span><span class="category-amount">¥${catTotal.toFixed(2)}</span></div><div class="category-percentage"><div class="percentage-bar" style="background: linear-gradient(90deg, #FF6B6B ${pct}%, var(--input-bg) ${pct}%);"></div><span>${pct}%</span></div></div>`;
        }
    });
    expContainer.innerHTML = expHtml || '<div style="color: var(--text-secondary); text-align: center; padding: 20px;">暂无支出数据</div>';
}
window.updateCategoryStats = updateCategoryStats;

// ========== 记录列表 ==========
function updateRecentRecords() {
    const container = document.getElementById('recentRecords');
    if (!container) return;
    const sorted = [...userData.records].sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0,5);
    if (sorted.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><i class="fas fa-receipt"></i></div><div class="empty-state-title">暂无记录</div><div class="empty-state-text">开始记录您的第一笔账单吧</div></div>`;
        return;
    }
    let html = '';
    sorted.forEach(r => {
        const d = new Date(r.date).toLocaleDateString('zh-CN');
        const amt = r.isNegative ? -r.amount : r.amount;
        let icon = 'fas fa-exchange-alt', cls = 'loan';
        if (r.type === '收入') { icon = 'fas fa-money-bill-wave'; cls = 'income'; }
        else if (r.type === '支出') { icon = 'fas fa-shopping-cart'; cls = 'expense'; }
        else if (r.type === '借贷') { icon = 'fas fa-hand-holding-usd'; cls = r.category === '还款' ? 'repayment' : 'loan'; }
        html += `<div class="record-item"><div class="record-icon ${cls}"><i class="${icon}"></i></div><div class="record-details"><div class="record-title">${r.description || '无描述'}</div><div class="record-meta"><span class="record-category">${r.type} · ${r.category}</span><span>${d}</span></div></div><div class="record-amount ${cls}">${amt >= 0 ? '+' : ''}¥${amt.toFixed(2)}</div><div class="record-actions"><button onclick="editRecord('${r.id}')"><i class="fas fa-edit"></i></button><button class="delete-btn" onclick="deleteRecord('${r.id}')"><i class="fas fa-trash"></i></button></div></div>`;
    });
    container.innerHTML = html;
}
window.updateRecentRecords = updateRecentRecords;

function updateAllRecords() {
    const container = document.getElementById('allRecords');
    if (!container) return;

    // 保存当前筛选值
    const typeSelect = document.getElementById('filterType');
    const catSelect = document.getElementById('filterCategory');
    const kwInput = document.getElementById('filterKeyword');
    const currentType = typeSelect ? typeSelect.value : '';
    const currentCat = catSelect ? catSelect.value : '';
    const currentKw = kwInput ? kwInput.value : '';

    const range = getCurrentDateRange() || 'month';
    let filtered = filterRecordsByDateRange(userData.records, range);

    filtered = filtered.sort((a,b) => new Date(b.date) - new Date(a.date));
    if (currentType) filtered = filtered.filter(r => r.type === currentType);
    if (currentCat) filtered = filtered.filter(r => r.category === currentCat);
    if (currentKw) filtered = filtered.filter(r => (r.description || '').toLowerCase().includes(currentKw.toLowerCase()) || (r.category || '').toLowerCase().includes(currentKw.toLowerCase()));

    // 更新分类下拉框选项（基于当前类型）
    updateCategoryFilter();

    // 恢复筛选值（确保分类下拉框显示正确的选中项）
    if (typeSelect) typeSelect.value = currentType;
    if (catSelect) catSelect.value = currentCat;
    if (kwInput) kwInput.value = currentKw;

    const totalPages = Math.ceil(filtered.length / recordsPerPage);
    const start = (currentPage - 1) * recordsPerPage;
    const pageRecords = filtered.slice(start, start + recordsPerPage);
    if (pageRecords.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><i class="fas fa-search"></i></div><div class="empty-state-title">没有找到记录</div><div class="empty-state-text">尝试调整筛选条件</div></div>`;
        updatePagination(1, 0);
        return;
    }
    let html = '';
    pageRecords.forEach(r => {
        const d = new Date(r.date).toLocaleDateString('zh-CN');
        const amt = r.isNegative ? -r.amount : r.amount;
        let icon = 'fas fa-exchange-alt', cls = 'loan';
        if (r.type === '收入') { icon = 'fas fa-money-bill-wave'; cls = 'income'; }
        else if (r.type === '支出') { icon = 'fas fa-shopping-cart'; cls = 'expense'; }
        else if (r.type === '借贷') { icon = 'fas fa-hand-holding-usd'; cls = r.category === '还款' ? 'repayment' : 'loan'; }
        html += `<div class="record-item"><div class="record-icon ${cls}"><i class="${icon}"></i></div><div class="record-details"><div class="record-title">${r.description || '无描述'}</div><div class="record-meta"><span class="record-category">${r.type} · ${r.category}</span><span>${d}</span></div></div><div class="record-amount ${cls}">${amt >= 0 ? '+' : ''}¥${amt.toFixed(2)}</div><div class="record-actions"><button onclick="editRecord('${r.id}')"><i class="fas fa-edit"></i></button><button class="delete-btn" onclick="deleteRecord('${r.id}')"><i class="fas fa-trash"></i></button></div></div>`;
    });
    container.innerHTML = html;
    updatePagination(currentPage, totalPages);
}
window.updateAllRecords = updateAllRecords;

function filterRecords() {
    currentPage = 1;
    window.currentPage = currentPage;
    updateAllRecords();
}
window.filterRecords = filterRecords;

function updatePagination(current, total) {
    const container = document.getElementById('pagination');
    if (!container) return;
    if (total <= 1) { container.innerHTML = ''; return; }
    let html = `<button class="btn-secondary" ${current <= 1 ? 'disabled' : ''} onclick="changePage(${current - 1})"><i class="fas fa-chevron-left"></i></button>`;
    const maxButtons = 5;
    let start = Math.max(1, current - Math.floor(maxButtons / 2));
    let end = Math.min(total, start + maxButtons - 1);
    if (end - start + 1 < maxButtons) start = Math.max(1, end - maxButtons + 1);
    for (let i = start; i <= end; i++) {
        html += `<button class="${i === current ? 'btn-primary' : 'btn-secondary'}" onclick="changePage(${i})">${i}</button>`;
    }
    html += `<button class="btn-secondary" ${current >= total ? 'disabled' : ''} onclick="changePage(${current + 1})"><i class="fas fa-chevron-right"></i></button>`;
    container.innerHTML = html;
}
window.updatePagination = updatePagination;

function changePage(page) {
    currentPage = page;
    window.currentPage = currentPage;
    updateAllRecords();
}
window.changePage = changePage;

function updateCategoriesDropdown() {
    const sel = document.getElementById('filterCategory');
    if (!sel) return;
    const all = [];
    for (const cats of Object.values(userData.categories)) cats.forEach(c => { if (!all.includes(c)) all.push(c); });
    all.sort();
    let opts = '<option value="">所有分类</option>';
    all.forEach(c => opts += `<option value="${c}">${c}</option>`);
    sel.innerHTML = opts;
}
window.updateCategoriesDropdown = updateCategoriesDropdown;

function updateCategoryFilter() {
    const type = document.getElementById('filterType')?.value;
    const sel = document.getElementById('filterCategory');
    if (!sel) return;
    if (type && userData.categories[type]) {
        let opts = '<option value="">所有分类</option>';
        userData.categories[type].forEach(c => opts += `<option value="${c}">${c}</option>`);
        sel.innerHTML = opts;
    } else {
        updateCategoriesDropdown();
    }
}
window.updateCategoryFilter = updateCategoryFilter;

// ========== 记账表单 ==========
function updateCategories() {
    const type = document.getElementById('recordType').value;
    const sel = document.getElementById('recordCategory');
    sel.innerHTML = '<option value="">选择分类</option>';
    if (type && userData.categories[type]) {
        userData.categories[type].forEach(c => {
            const opt = document.createElement('option');
            opt.value = c; opt.textContent = c;
            sel.appendChild(opt);
        });
    }
}
window.updateCategories = updateCategories;

// ========== 修改点：addRecord 使用 safeEvaluate 解析金额 ==========
async function addRecord() {
    if (isAddingRecord) return;
    isAddingRecord = true; window.isAddingRecord = isAddingRecord;
    const type = document.getElementById('recordType').value;
    const cat = document.getElementById('recordCategory').value;
    const desc = document.getElementById('recordDescription').value.trim();
    let amountInput = document.getElementById('recordAmount').value.trim();
    const date = document.getElementById('recordDate').value;
    
    if (!type || !cat || !amountInput) {
        showFormMessage('请填写完整信息', 'error');
        isAddingRecord = false; window.isAddingRecord = isAddingRecord; return;
    }

    // 解析金额表达式
    let amount;
    try {
        amount = safeEvaluate(amountInput);
        if (isNaN(amount) || amount <= 0) {
            showFormMessage('金额必须为正数', 'error');
            isAddingRecord = false; window.isAddingRecord = isAddingRecord; return;
        }
    } catch (e) {
        showFormMessage('金额格式错误：' + e.message, 'error');
        isAddingRecord = false; window.isAddingRecord = isAddingRecord; return;
    }

    let isNegative = false;
    if (type === '借贷' && cat === '还款') isNegative = true;
    const newRecord = {
        id: generateId(),
        type, category: cat, description: desc || '',
        amount: Math.abs(amount), isNegative,
        date: date ? new Date(date).toISOString() : new Date().toISOString(),
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
    userData.records.unshift(newRecord);
    window.userData = userData;
    updateDashboard();
    updateRecentRecords();
    updateAllRecords();
    updateAnalytics();
    updateBudgetList();
    document.getElementById('recordType').value = '';
    document.getElementById('recordCategory').value = '';
    document.getElementById('recordDescription').value = '';
    document.getElementById('recordAmount').value = '';
    document.getElementById('recordDate').value = new Date().toISOString().split('T')[0];
    showFormMessage('记录添加成功！正在同步到云端...', 'success');
    
    updateSyncStatus('syncing');
    enqueueSync(false, true).then(success => {
        if (success) {
            showFormMessage('记录已成功同步到云端！', 'success');
            setTimeout(() => switchSection('records'), 1500);
        } else {
            showFormMessage('记录已保存到本地，云端同步失败', 'warning');
        }
    }).catch(() => {
        showFormMessage('同步过程中出现错误', 'error');
    }).finally(() => {
        isAddingRecord = false; window.isAddingRecord = isAddingRecord;
    });
}
window.addRecord = addRecord;

function editRecord(id) {
    const record = userData.records.find(r => r.id === id);
    if (!record) return;
    switchSection('add-record');
    editingRecordId = id; window.editingRecordId = editingRecordId;
    setTimeout(() => {
        document.getElementById('recordType').value = record.type;
        updateCategories();
        setTimeout(() => {
            document.getElementById('recordCategory').value = record.category;
            document.getElementById('recordDescription').value = record.description;
            // 修改点：编辑时显示原金额（不带负号）
            document.getElementById('recordAmount').value = Math.abs(record.amount).toString();
            document.getElementById('recordDate').value = new Date(record.date).toISOString().split('T')[0];
            const btn = document.querySelector('#add-record .submit-btn');
            btn.innerHTML = '<i class="fas fa-save"></i>更新记录';
            btn.setAttribute('data-record-id', id);
            btn.onclick = function() { updateRecord(this.getAttribute('data-record-id')); };
            showMessage('正在编辑记录，修改后点击"更新记录"', 'info');
        }, 100);
    }, 100);
}
window.editRecord = editRecord;

// ========== 修改点：updateRecord 使用 safeEvaluate 解析金额 ==========
async function updateRecord(id) {
    if (isAddingRecord) return;
    isAddingRecord = true; window.isAddingRecord = isAddingRecord;
    const type = document.getElementById('recordType').value;
    const cat = document.getElementById('recordCategory').value;
    const desc = document.getElementById('recordDescription').value.trim();
    let amountInput = document.getElementById('recordAmount').value.trim();
    const date = document.getElementById('recordDate').value;
    
    if (!type || !cat || !amountInput) {
        showFormMessage('请填写完整信息', 'error');
        isAddingRecord = false; window.isAddingRecord = isAddingRecord; return;
    }

    // 解析金额表达式
    let amount;
    try {
        amount = safeEvaluate(amountInput);
        if (isNaN(amount) || amount <= 0) {
            showFormMessage('金额必须为正数', 'error');
            isAddingRecord = false; window.isAddingRecord = isAddingRecord; return;
        }
    } catch (e) {
        showFormMessage('金额格式错误：' + e.message, 'error');
        isAddingRecord = false; window.isAddingRecord = isAddingRecord; return;
    }

    const index = userData.records.findIndex(r => r.id === id);
    if (index === -1) {
        showFormMessage('记录不存在', 'error');
        isAddingRecord = false; window.isAddingRecord = isAddingRecord; return;
    }
    let isNegative = false;
    if (type === '借贷' && cat === '还款') isNegative = true;
    userData.records[index] = {
        ...userData.records[index],
        type, category: cat, description: desc || '',
        amount: Math.abs(amount), isNegative,
        date: date ? new Date(date).toISOString() : new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    window.userData = userData;
    updateDashboard();
    updateRecentRecords();
    updateAllRecords();
    updateAnalytics();
    updateBudgetList();
    showFormMessage('记录更新成功！正在同步到云端...', 'success');
    
    updateSyncStatus('syncing');
    try {
        const saved = await enqueueSync(false, true);
        if (saved) {
            showFormMessage('记录已成功同步到云端！', 'success');
            setTimeout(() => {
                document.getElementById('recordType').value = '';
                document.getElementById('recordCategory').value = '';
                document.getElementById('recordDescription').value = '';
                document.getElementById('recordAmount').value = '';
                document.getElementById('recordDate').value = new Date().toISOString().split('T')[0];
                const btn = document.querySelector('#add-record .submit-btn');
                btn.innerHTML = '<i class="fas fa-check"></i>添加记录';
                btn.removeAttribute('data-record-id');
                btn.onclick = addRecord;
                setTimeout(() => switchSection('records'), 1000);
            }, 1000);
        } else {
            showFormMessage('记录已保存到本地，云端同步失败', 'warning');
        }
    } catch (e) {
        showFormMessage('更新过程中出现错误', 'error');
    } finally {
        isAddingRecord = false; window.isAddingRecord = isAddingRecord;
        editingRecordId = null; window.editingRecordId = editingRecordId;
    }
}
window.updateRecord = updateRecord;

function deleteRecord(id) {
    if (!confirm('确定要删除这条记录吗？')) return;
    const index = userData.records.findIndex(r => r.id === id);
    if (index > -1) {
        userData.records.splice(index, 1);
        window.userData = userData;
        updateDashboard();
        updateRecentRecords();
        updateAllRecords();
        updateBudgetList();
        showMessage('记录删除成功！正在同步到云端...', 'success');
        updateSyncStatus('syncing');
        enqueueSync(false, true).then(() => showMessage('记录删除成功', 'success'));
    }
}
window.deleteRecord = deleteRecord;

// ========== 预算管理 ==========
function updateBudgetList() {
    const container = document.getElementById('budgetList');
    if (!container) return;
    const budgets = userData.budgets || {};
    const totalBudget = userData.totalExpenseBudget;
    if (Object.keys(budgets).length === 0 && !totalBudget) {
        container.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><i class="fas fa-wallet"></i></div><div class="empty-state-title">暂无预算</div><div class="empty-state-text">添加预算来跟踪您的支出</div></div>`;
        return;
    }
    let html = '';
    const currentMonth = new Date().toISOString().slice(0, 7);
    if (totalBudget) {
        const monthExpense = userData.records.filter(r => r.type === '支出' && r.date.startsWith(currentMonth)).reduce((s, r) => s + r.amount, 0);
        const pct = totalBudget ? (monthExpense / totalBudget * 100) : 0;
        const cls = pct < 70 ? 'safe' : pct < 90 ? 'warning' : 'danger';
        html += `<div class="budget-item"><div class="budget-header"><div class="budget-category"><i class="fas fa-chart-line"></i>总支出</div><span class="budget-badge ${cls}">${pct.toFixed(1)}%</span></div><div class="budget-amount">¥${totalBudget.toFixed(2)}</div><div class="budget-progress-container"><div class="budget-progress-info"><span>已用: ¥${monthExpense.toFixed(2)}</span><span>剩余: ¥${Math.max(0, totalBudget - monthExpense).toFixed(2)}</span></div><div class="budget-progress"><div class="budget-progress-bar ${cls}" style="width: ${Math.min(100, pct)}%"></div></div></div><div style="margin-top:16px;display:flex;gap:8px;"><button class="btn-secondary" style="flex:1;" onclick="editTotalExpenseBudget()"><i class="fas fa-edit"></i>编辑</button><button class="danger-btn" style="flex:1;" onclick="deleteTotalExpenseBudget()"><i class="fas fa-trash"></i>删除</button></div></div>`;
    }
    for (const [cat, amt] of Object.entries(budgets)) {
        const monthExpense = userData.records.filter(r => r.type === '支出' && r.category === cat && r.date.startsWith(currentMonth)).reduce((s, r) => s + r.amount, 0);
        const pct = amt ? (monthExpense / amt * 100) : 0;
        const cls = pct < 70 ? 'safe' : pct < 90 ? 'warning' : 'danger';
        html += `<div class="budget-item"><div class="budget-header"><div class="budget-category"><i class="fas fa-tag"></i>${cat}</div><span class="budget-badge ${cls}">${pct.toFixed(1)}%</span></div><div class="budget-amount">¥${amt.toFixed(2)}</div><div class="budget-progress-container"><div class="budget-progress-info"><span>已用: ¥${monthExpense.toFixed(2)}</span><span>剩余: ¥${Math.max(0, amt - monthExpense).toFixed(2)}</span></div><div class="budget-progress"><div class="budget-progress-bar ${cls}" style="width: ${Math.min(100, pct)}%"></div></div></div><div style="margin-top:16px;display:flex;gap:8px;"><button class="btn-secondary" style="flex:1;" onclick="editBudget('${cat}')"><i class="fas fa-edit"></i>编辑</button><button class="danger-btn" style="flex:1;" onclick="deleteBudget('${cat}')"><i class="fas fa-trash"></i>删除</button></div></div>`;
    }
    container.innerHTML = html;
    updateBudgetWarning();
}
window.updateBudgetList = updateBudgetList;

function updateBudgetWarning() {
    const warning = document.getElementById('budgetWarning');
    if (!warning) return;
    const bar = document.getElementById('warningProgress');
    const budgets = userData.budgets || {};
    if (Object.keys(budgets).length === 0 && !userData.totalExpenseBudget) {
        warning.style.display = 'none';
        return;
    }
    const currentMonth = new Date().toISOString().slice(0,7);
    let warnCount = 0, total = 0;
    if (userData.totalExpenseBudget) {
        total++;
        const monthExpense = userData.records.filter(r => r.type === '支出' && r.date.startsWith(currentMonth)).reduce((s, r) => s + r.amount, 0);
        if (monthExpense / userData.totalExpenseBudget * 100 >= 80) warnCount++;
    }
    for (const [cat, amt] of Object.entries(budgets)) {
        if (amt > 0) {
            total++;
            const monthExpense = userData.records.filter(r => r.type === '支出' && r.category === cat && r.date.startsWith(currentMonth)).reduce((s, r) => s + r.amount, 0);
            if (monthExpense / amt * 100 >= 80) warnCount++;
        }
    }
    if (warnCount > 0) {
        bar.style.width = ((warnCount / total) * 100).toFixed(0) + '%';
        warning.style.display = 'block';
        warning.onclick = () => switchSection('budgets');
    } else {
        warning.style.display = 'none';
    }
}
window.updateBudgetWarning = updateBudgetWarning;

function showAddBudgetModal() {
    const cats = userData.categories['支出'] || [];
    let opts = '<option value="总支出">总支出</option>';
    cats.forEach(c => { if (!userData.budgets[c]) opts += `<option value="${c}">${c}</option>`; });
    currentModal = { type: 'addBudget' }; window.currentModal = currentModal;
    document.getElementById('modalTitle').textContent = '添加预算';
    document.getElementById('modalBody').innerHTML = `<div style="padding:20px;"><div class="form-group"><label class="form-label">选择分类</label><select class="form-select" id="modalCategory">${opts}</select></div><div class="form-group"><label class="form-label">预算金额 (元)</label><input type="number" class="form-input" id="modalAmount" min="1" step="0.01" value="1000"></div><div class="form-group"><label class="form-label">周期</label><select class="form-select" id="modalPeriod"><option value="monthly">每月</option><option value="weekly">每周</option><option value="yearly">每年</option></select></div></div>`;
    document.getElementById('modal').classList.add('active');
}
window.showAddBudgetModal = showAddBudgetModal;

function addBudget() {
    const cat = document.getElementById('modalCategory').value;
    const amt = parseFloat(document.getElementById('modalAmount').value);
    if (!cat || !amt || amt <= 0) { showMessage('请输入有效的预算金额', 'error'); return; }
    if (cat === '总支出') userData.totalExpenseBudget = amt;
    else userData.budgets[cat] = amt;
    window.userData = userData;
    updateSyncStatus('syncing');
    enqueueSync(false, true).then(() => { updateBudgetList(); closeModal(); showMessage('预算添加成功', 'success'); });
}
window.addBudget = addBudget;

function editBudget(cat) {
    const amt = userData.budgets[cat] || 0;
    currentModal = { type: 'editBudget', data: { cat } }; window.currentModal = currentModal;
    document.getElementById('modalTitle').textContent = '编辑预算';
    document.getElementById('modalBody').innerHTML = `<div style="padding:20px;"><div class="form-group"><label class="form-label">分类</label><input type="text" class="form-input" value="${cat}" readonly></div><div class="form-group"><label class="form-label">预算金额 (元)</label><input type="number" class="form-input" id="modalAmount" min="1" step="0.01" value="${amt}"></div></div>`;
    document.getElementById('modal').classList.add('active');
}
window.editBudget = editBudget;

function editTotalExpenseBudget() {
    const amt = userData.totalExpenseBudget || 0;
    currentModal = { type: 'editTotalExpenseBudget' }; window.currentModal = currentModal;
    document.getElementById('modalTitle').textContent = '编辑总支出预算';
    document.getElementById('modalBody').innerHTML = `<div style="padding:20px;"><div class="form-group"><label class="form-label">分类</label><input type="text" class="form-input" value="总支出" readonly></div><div class="form-group"><label class="form-label">预算金额 (元)</label><input type="number" class="form-input" id="modalAmount" min="1" step="0.01" value="${amt}"></div></div>`;
    document.getElementById('modal').classList.add('active');
}
window.editTotalExpenseBudget = editTotalExpenseBudget;

function deleteBudget(cat) {
    if (confirm(`确定要删除"${cat}"的预算吗？`)) {
        delete userData.budgets[cat];
        window.userData = userData;
        updateSyncStatus('syncing');
        enqueueSync(false, true).then(() => { updateBudgetList(); showMessage('预算删除成功', 'success'); });
    }
}
window.deleteBudget = deleteBudget;

function deleteTotalExpenseBudget() {
    if (confirm('确定要删除总支出预算吗？')) {
        userData.totalExpenseBudget = null;
        window.userData = userData;
        updateSyncStatus('syncing');
        enqueueSync(false, true).then(() => { updateBudgetList(); showMessage('总支出预算删除成功', 'success'); });
    }
}
window.deleteTotalExpenseBudget = deleteTotalExpenseBudget;

function saveAlertSettings() {
    const threshold = document.getElementById('alertThreshold').value;
    const email = document.getElementById('enableEmailAlert').checked;
    const push = document.getElementById('enablePushAlert').checked;
    userData.settings.alertThreshold = threshold;
    userData.settings.enableEmailAlert = email;
    userData.settings.enablePushAlert = push;
    window.userData = userData;
    updateSyncStatus('syncing');
    enqueueSync(false, true).then(() => showMessage('预警设置保存成功', 'success'));
}
window.saveAlertSettings = saveAlertSettings;

// ========== 分类管理 ==========
function updateAllCategoriesList() {
    const container = document.getElementById('allCategoriesList');
    if (!container) return;
    let html = '';
    for (const [type, cats] of Object.entries(userData.categories)) {
        html += `<div style="margin-bottom:24px;"><h5 style="color: var(--text-primary); margin-bottom:12px; display:flex; align-items:center; gap:8px;"><i class="fas fa-${type === '收入' ? 'money-bill-wave' : type === '支出' ? 'shopping-cart' : 'hand-holding-usd'}"></i>${type}</h5><div style="display:flex; flex-wrap:wrap; gap:8px;">`;
        cats.forEach(c => {
            const count = userData.records.filter(r => r.type === type && r.category === c).length;
            html += `<div style="background:var(--card-bg); border:1px solid var(--card-border); border-radius:var(--radius); padding:12px 16px; display:flex; align-items:center; gap:12px;"><span>${c}</span><span style="font-size:12px; color:var(--text-secondary);">(${count})</span><button onclick="editCategory('${type}','${c}')" style="background:none; border:none; color:var(--primary); cursor:pointer;"><i class="fas fa-edit"></i></button>${count === 0 ? `<button onclick="deleteCategory('${type}','${c}')" style="background:none; border:none; color:var(--danger); cursor:pointer;"><i class="fas fa-trash"></i></button>` : ''}</div>`;
        });
        html += `</div></div>`;
    }
    container.innerHTML = html;
}
window.updateAllCategoriesList = updateAllCategoriesList;

function showAddCategoryModal() {
    currentModal = { type: 'addCategory' }; window.currentModal = currentModal;
    document.getElementById('modalTitle').textContent = '添加分类';
    document.getElementById('modalBody').innerHTML = `<div style="padding:20px;"><div class="form-group"><label class="form-label">类型</label><select class="form-select" id="modalCategoryType"><option value="收入">收入</option><option value="支出">支出</option><option value="借贷">借贷</option></select></div><div class="form-group"><label class="form-label">分类名称</label><input type="text" class="form-input" id="modalCategoryName" placeholder="请输入分类名称"></div></div>`;
    document.getElementById('modal').classList.add('active');
}
window.showAddCategoryModal = showAddCategoryModal;

function addCategory() {
    const type = document.getElementById('modalCategoryType').value;
    const name = document.getElementById('modalCategoryName').value.trim();
    if (!name) { showMessage('请输入分类名称', 'error'); return; }
    if (!userData.categories[type]) userData.categories[type] = [];
    if (userData.categories[type].includes(name)) { showMessage('该分类已存在', 'error'); return; }
    userData.categories[type].push(name);
    window.userData = userData;
    updateSyncStatus('syncing');
    enqueueSync(false, true).then(() => {
        updateCategoriesDropdown();
        updateAllCategoriesList();
        closeModal();
        showMessage('分类添加成功', 'success');
    });
}
window.addCategory = addCategory;

function editCategory(type, oldName) {
    currentModal = { type: 'editCategory', data: { type, oldName } }; window.currentModal = currentModal;
    document.getElementById('modalTitle').textContent = '编辑分类';
    document.getElementById('modalBody').innerHTML = `<div style="padding:20px;"><div class="form-group"><label class="form-label">类型</label><input type="text" class="form-input" value="${type}" readonly></div><div class="form-group"><label class="form-label">新分类名称</label><input type="text" class="form-input" id="modalCategoryName" value="${oldName}"></div></div>`;
    document.getElementById('modal').classList.add('active');
}
window.editCategory = editCategory;

function deleteCategory(type, name) {
    if (!confirm(`确定要删除"${name}"分类吗？此操作不可撤销。`)) return;
    const idx = userData.categories[type].indexOf(name);
    if (idx > -1) {
        userData.categories[type].splice(idx, 1);
        userData.records.forEach(r => {
            if (r.type === type && r.category === name) {
                r.category = userData.categories[type][0] || '其他';
            }
        });
        window.userData = userData;
        updateSyncStatus('syncing');
        enqueueSync(false, true).then(() => {
            updateCategoriesDropdown();
            updateAllCategoriesList();
            updateAllRecords();
            showMessage('分类删除成功', 'success');
        });
    }
}
window.deleteCategory = deleteCategory;

// ========== 导出 ==========
function exportToCSV() {
    const sorted = [...userData.records].sort((a,b) => new Date(a.date) - new Date(b.date));
    const headers = ['消费日期','记账日期','类型','分类','描述','金额','是否还款'];
    const rows = sorted.map(r => [
        new Date(r.date).toLocaleDateString('zh-CN'),
        new Date(r.createdAt).toLocaleDateString('zh-CN'),
        r.type, r.category, r.description,
        (r.isNegative ? '-' : '') + r.amount.toFixed(2),
        r.isNegative ? '是' : '否'
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `记账记录_${new Date().toISOString().split('T')[0]}.csv`; a.click();
    URL.revokeObjectURL(url);
    showMessage('CSV导出成功', 'success');
}
window.exportToCSV = exportToCSV;

function exportToJSON() {
    const sortedData = { ...userData, records: [...userData.records].sort((a,b) => new Date(a.date) - new Date(b.date)) };
    const json = JSON.stringify(sortedData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `记账数据_${new Date().toISOString().split('T')[0]}.json`; a.click();
    URL.revokeObjectURL(url);
    showMessage('JSON导出成功', 'success');
}
window.exportToJSON = exportToJSON;

function exportToExcel() {
    exportToCSV();
    showMessage('Excel导出功能开发中，已导出为CSV格式', 'info');
}
window.exportToExcel = exportToExcel;

function printRecords() {
    const w = window.open('', '_blank');
    const sorted = [...userData.records].sort((a,b) => new Date(a.date) - new Date(b.date));
    w.document.write(`
        <!DOCTYPE html>
        <html><head><title>记账报表 - ${new Date().toLocaleDateString('zh-CN')}</title>
        <style>
            body{font-family:Arial;margin:20px;}
            h1{color:#333;}
            table{width:100%;border-collapse:collapse;margin-top:20px;}
            th,td{border:1px solid #ddd;padding:8px;text-align:left;}
            th{background:#f2f2f2;}
            .total{font-weight:bold;margin-top:20px;}
            .close-btn{position:fixed;top:20px;right:20px;padding:10px 20px;background:#4ECDC4;color:white;border:none;border-radius:8px;cursor:pointer;font-size:16px;}
            .close-btn:hover{background:#2EB3AA;}
            @media print{.close-btn{display:none;}}
        </style>
        </head><body>
        <button class="close-btn" onclick="window.close()">关闭窗口</button>
        <h1>记账报表</h1>
        <p>生成时间: ${new Date().toLocaleString('zh-CN')}</p>
        <p>用户: ${currentUser}</p>
        <button onclick="window.print()">打印</button>
        <table>
            <tr><th>消费日期</th><th>类型</th><th>分类</th><th>描述</th><th>金额</th></tr>
    `);
    let inc = 0, exp = 0;
    sorted.forEach(r => {
        const amt = r.isNegative ? -r.amount : r.amount;
        if (r.type === '收入') inc += amt;
        if (r.type === '支出') exp += amt;
        w.document.write(`<tr><td>${new Date(r.date).toLocaleDateString('zh-CN')}</td><td>${r.type}</td><td>${r.category}</td><td>${r.description || ''}</td><td>${amt >= 0 ? '+' : ''}¥${amt.toFixed(2)}</td></tr>`);
    });
    w.document.write(`</table><div class="total"><p>总收入: ¥${inc.toFixed(2)}</p><p>总支出: ¥${exp.toFixed(2)}</p><p>结余: ¥${(inc - exp).toFixed(2)}</p></div></body></html>`);
    w.document.close();
}
window.printRecords = printRecords;

function startExport() {
    const range = document.getElementById('exportDateRange').value;
    showMessage('开始导出数据...', 'info');
    setTimeout(() => {
        if (range === 'all') exportToJSON();
        else exportToCSV();
    }, 500);
}
window.startExport = startExport;

// ========== 设置（包含修改密码）==========
function saveSettings() {
    const repo = document.getElementById('settingsRepo').value.trim();
    const token = document.getElementById('settingsToken').value.trim();
    if (repo && !repo.includes('/')) { showMessage('仓库格式不正确，应为"用户名/仓库名"', 'error'); return; }
    const config = JSON.parse(localStorage.getItem('accountConfig')) || {};
    if (repo) { config.repo = repo; currentRepo = repo; window.currentRepo = currentRepo; }
    if (token) { config.token = token; currentToken = token; window.currentToken = currentToken; }
    config.autoSync = document.getElementById('autoSync').checked;
    config.syncOnChange = document.getElementById('syncOnChange').checked;
    config.syncOnStart = document.getElementById('syncOnStart').checked;
    localStorage.setItem('accountConfig', JSON.stringify(config));
    document.getElementById('sidebarRepo').textContent = '仓库: ' + currentRepo;
    showMessage('设置保存成功', 'success');
    if (token) testGitHubToken();
}
window.saveSettings = saveSettings;

async function testGitHubToken() {
    try {
        const [owner, repoName] = currentRepo.split('/');
        const res = await retryFetch(`https://api.github.com/repos/${owner}/${repoName}`, {
            headers: { 'Authorization': `token ${currentToken}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        showMessage(res.ok ? 'GitHub Token验证成功' : 'GitHub Token验证失败，请检查权限', res.ok ? 'success' : 'warning');
    } catch { showMessage('Token验证失败', 'error'); }
}
window.testGitHubToken = testGitHubToken;

async function changePassword() {
    const currentPwd = document.getElementById('currentPassword').value;
    const newPwd = document.getElementById('newPassword').value;
    const confirmPwd = document.getElementById('confirmNewPassword').value;

    if (!currentPwd || !newPwd || !confirmPwd) {
        showMessage('请填写所有密码字段', 'error');
        return;
    }
    if (newPwd.length < 6) {
        showMessage('新密码至少需要6位', 'error');
        return;
    }
    if (newPwd !== confirmPwd) {
        showMessage('新密码两次输入不一致', 'error');
        return;
    }

    try {
        showLoading();
        const userConfig = await getUserConfig(currentToken, currentRepo, currentUser);
        if (!userConfig) throw new Error('无法获取用户配置');
        const encryptedCurrent = btoa(encodeURIComponent(currentPwd));
        if (userConfig.password !== encryptedCurrent) throw new Error('当前密码错误');

        userConfig.password = btoa(encodeURIComponent(newPwd));
        userConfig.updatedAt = new Date().toISOString();

        const saved = await saveUserConfig(currentToken, currentRepo, currentUser, userConfig);
        if (saved) {
            showMessage('密码修改成功', 'success');
            document.getElementById('currentPassword').value = '';
            document.getElementById('newPassword').value = '';
            document.getElementById('confirmNewPassword').value = '';
        } else {
            throw new Error('保存失败');
        }
    } catch (error) {
        showMessage('修改密码失败: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}
window.changePassword = changePassword;

async function getUserConfig(token, repo, username) {
    try {
        const [owner, repoName] = repo.split('/');
        const filePath = `data/users/${username}.json`;
        const response = await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${filePath}`, {
            headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        if (response.ok) {
            const data = await response.json();
            return JSON.parse(decodeURIComponent(atob(data.content)));
        }
        return null;
    } catch (error) {
        console.error('获取用户配置失败:', error);
        return null;
    }
}

async function saveUserConfig(token, repo, username, config) {
    try {
        const [owner, repoName] = repo.split('/');
        const filePath = `data/users/${username}.json`;
        const content = btoa(encodeURIComponent(JSON.stringify(config, null, 2)));

        let sha = null;
        try {
            const checkResponse = await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${filePath}`, {
                headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }
            });
            if (checkResponse.ok) {
                const fileData = await checkResponse.json();
                sha = fileData.sha;
            }
        } catch (e) {}

        const body = { message: `更新用户密码: ${username}`, content: content, sha: sha };
        const response = await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${filePath}`, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify(body)
        });
        return response.ok;
    } catch (error) {
        console.error('保存用户配置失败:', error);
        return false;
    }
}

function clearLocalData() {
    if (confirm('确定要清除本地数据吗？云端数据不会受影响。')) {
        localStorage.removeItem(`backup_${currentUser}`);
        showMessage('本地数据已清除', 'success');
        setTimeout(() => loadUserData(), 1000);
    }
}
window.clearLocalData = clearLocalData;

function deleteAccount() {
    if (confirm('确定要删除账户吗？此操作将删除云端数据，不可恢复！')) {
        showMessage('账户删除中...', 'warning');
        localStorage.removeItem('accountConfig');
        localStorage.removeItem(`backup_${currentUser}`);
        setTimeout(() => window.location.href = './index.html', 2000);
    }
}
window.deleteAccount = deleteAccount;

// ========== 导航 ==========
function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            const target = this.getAttribute('data-target');
            if (target) switchSection(target);
        });
    });
}
window.setupNavigation = setupNavigation;

/**
 * 切换页面
 * @param {string} sectionId - 页面ID
 * @param {boolean} resetFilters - 是否重置“所有记录”页面的筛选条件（默认为 true）
 */
function switchSection(sectionId, resetFilters = true) {
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    const sec = document.getElementById(sectionId);
    if (sec) {
        sec.classList.add('active');
        document.getElementById('pageTitle').innerHTML = `<i class="fas fa-${sectionId === 'dashboard' ? 'home' : sectionId === 'add-record' ? 'plus-circle' : sectionId === 'records' ? 'list' : sectionId === 'analytics' ? 'chart-line' : sectionId === 'budgets' ? 'wallet' : sectionId === 'categories' ? 'tags' : sectionId === 'export' ? 'download' : 'cog'}"></i><span>${sectionId === 'dashboard' ? '仪表盘' : sectionId === 'add-record' ? '记账' : sectionId === 'records' ? '所有记录' : sectionId === 'analytics' ? '数据分析' : sectionId === 'budgets' ? '预算管理' : sectionId === 'categories' ? '分类管理' : sectionId === 'export' ? '导出数据' : '设置'}</span>`;
        window.scrollTo(0,0);

        // 如果切换到“所有记录”页面且需要重置筛选条件
        if (sectionId === 'records' && resetFilters) {
            const typeSelect = document.getElementById('filterType');
            const catSelect = document.getElementById('filterCategory');
            const kwInput = document.getElementById('filterKeyword');
            if (typeSelect) typeSelect.value = '';
            if (catSelect) {
                // 清空分类下拉框并重新加载所有分类
                updateCategoriesDropdown();
            }
            if (kwInput) kwInput.value = '';
            filterRecords();
        }
    }
    document.querySelectorAll('.nav-item, .bottom-nav-item').forEach(n => {
        n.classList.remove('active');
        if (n.getAttribute('data-target') === sectionId) n.classList.add('active');
    });
    const moreMenu = document.getElementById('moreMenu');
    if (moreMenu) moreMenu.classList.remove('active');
}
window.switchSection = switchSection;

function initMobileNav() {
    document.querySelectorAll('.bottom-nav-item[data-target]').forEach(item => {
        item.addEventListener('click', function() { switchSection(this.getAttribute('data-target')); });
    });
    const toggle = document.getElementById('moreMenuToggle');
    const menu = document.getElementById('moreMenu');
    if (toggle && menu) {
        toggle.addEventListener('click', e => { e.stopPropagation(); menu.classList.toggle('active'); });
        menu.querySelectorAll('.more-menu-item').forEach(item => {
            item.addEventListener('click', function(e) {
                e.stopPropagation();
                const target = this.getAttribute('data-target');
                if (target) switchSection(target);
                else if (this.getAttribute('onclick')) eval(this.getAttribute('onclick'));
                menu.classList.remove('active');
            });
        });
        document.addEventListener('click', () => menu.classList.remove('active'));
        menu.addEventListener('click', e => e.stopPropagation());
    }
}
window.initMobileNav = initMobileNav;

// ========== 日期筛选UI ==========
function initDateFilter() {
    const display = document.getElementById('dateFilterDisplay');
    const dropdown = document.getElementById('dateDropdown');
    const presets = document.querySelectorAll('.date-presets li');
    const customPicker = document.getElementById('customRangePicker');
    const startInput = document.getElementById('startDate');
    const endInput = document.getElementById('endDate');
    const applyBtn = document.getElementById('applyCustomRange');
    const rangeText = document.getElementById('dateRangeText');
    if (!display || !dropdown) return;

    currentDateRange = 'month'; window.currentDateRange = currentDateRange;
    rangeText.textContent = '本月';

    display.addEventListener('click', e => { e.stopPropagation(); dropdown.classList.toggle('active'); });
    presets.forEach(item => {
        item.addEventListener('click', function() {
            const val = this.getAttribute('data-value');
            presets.forEach(p => p.classList.remove('active'));
            this.classList.add('active');
            if (val === 'custom') {
                customPicker.style.display = 'flex';
                const today = new Date();
                const seven = new Date(today); seven.setDate(today.getDate() - 7);
                startInput.value = seven.toISOString().split('T')[0];
                endInput.value = today.toISOString().split('T')[0];
            } else {
                customPicker.style.display = 'none';
                currentDateRange = val; window.currentDateRange = val;
                rangeText.textContent = { 'today':'今天', 'week':'本周', 'month':'本月', 'year':'本年', 'all':'全部' }[val] || val;
                dropdown.classList.remove('active');
                updateDashboard();
                updateAnalytics();
                if (document.getElementById('records').classList.contains('active')) {
                    filterRecords();
                }
            }
        });
    });
    if (applyBtn) {
        applyBtn.addEventListener('click', function() {
            if (!startInput.value || !endInput.value) { showMessage('请选择开始和结束日期', 'warning'); return; }
            if (new Date(startInput.value) > new Date(endInput.value)) { showMessage('开始日期不能晚于结束日期', 'error'); return; }
            currentDateRange = 'custom'; window.currentDateRange = 'custom';
            rangeText.textContent = `自定义: ${startInput.value.split('-').slice(1).join('/')} - ${endInput.value.split('-').slice(1).join('/')}`;
            dropdown.classList.remove('active');
            window.customStartDate = startInput.value;
            window.customEndDate = endInput.value;
            updateDashboard();
            updateAnalytics();
            if (document.getElementById('records').classList.contains('active')) {
                filterRecords();
            }
        });
    }
    document.addEventListener('click', () => dropdown.classList.remove('active'));
    dropdown.addEventListener('click', e => e.stopPropagation());
}
window.initDateFilter = initDateFilter;

function initDatePickers() {
    const el = document.getElementById('recordDate');
    if (el) el.value = new Date().toISOString().split('T')[0];
}
window.initDatePickers = initDatePickers;

// ========== 模态框 ==========
function closeModal() {
    document.getElementById('modal').classList.remove('active');
    currentModal = null; window.currentModal = currentModal;
}
window.closeModal = closeModal;

function confirmModal() {
    if (!currentModal) return;
    if (currentModal.type === 'addBudget') addBudget();
    else if (currentModal.type === 'editBudget') {
        const amt = parseFloat(document.getElementById('modalAmount').value);
        if (amt && amt > 0) {
            userData.budgets[currentModal.data.cat] = amt;
            window.userData = userData;
            updateSyncStatus('syncing');
            enqueueSync(false, true).then(() => { updateBudgetList(); closeModal(); showMessage('预算更新成功', 'success'); });
        }
    } else if (currentModal.type === 'editTotalExpenseBudget') {
        const amt = parseFloat(document.getElementById('modalAmount').value);
        if (amt && amt > 0) {
            userData.totalExpenseBudget = amt;
            window.userData = userData;
            updateSyncStatus('syncing');
            enqueueSync(false, true).then(() => { updateBudgetList(); closeModal(); showMessage('总支出预算更新成功', 'success'); });
        }
    } else if (currentModal.type === 'addCategory') addCategory();
    else if (currentModal.type === 'editCategory') {
        const newName = document.getElementById('modalCategoryName').value.trim();
        if (newName) {
            const { type, oldName } = currentModal.data;
            const idx = userData.categories[type].indexOf(oldName);
            if (idx > -1) {
                userData.categories[type][idx] = newName;
                userData.records.forEach(r => { if (r.type === type && r.category === oldName) r.category = newName; });
                window.userData = userData;
                updateSyncStatus('syncing');
                enqueueSync(false, true).then(() => {
                    updateCategoriesDropdown();
                    updateAllCategoriesList();
                    updateAllRecords();
                    closeModal();
                    showMessage('分类更新成功', 'success');
                });
            }
        }
    }
}
window.confirmModal = confirmModal;

// ========== 登出（保留配置，不清除Token）==========
function logout() {
    if (confirm('确定要退出登录吗？')) {
        const config = JSON.parse(localStorage.getItem('accountConfig')) || {};
        config.autoLogin = false;
        localStorage.setItem('accountConfig', JSON.stringify(config));
        window.location.href = './index.html';
    }
}
window.logout = logout;

// ========== 事件监听 ==========
function setupEventListeners() {
    const modal = document.getElementById('modal');
    if (modal) modal.addEventListener('click', function(e) { if (e.target === this) closeModal(); });
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeModal(); });
}
window.setupEventListeners = setupEventListeners;

// ========== 页面初始化 ==========
document.addEventListener('DOMContentLoaded', function() {
    checkLoginStatus();
    initDatePickers();
    setupNavigation();
    initMobileNav();
    setupEventListeners();
    window.addEventListener('online', updateConnectionStatus);
    window.addEventListener('offline', updateConnectionStatus);
    const threshold = document.getElementById('alertThreshold');
    if (threshold) threshold.addEventListener('input', function() { document.getElementById('thresholdValue').textContent = this.value + '%'; });
    document.getElementById('recordType')?.addEventListener('change', updateCategories);
    initDateFilter();
    loadUserData();
});

window.addEventListener('beforeunload', async function(e) {
    if (!isSyncing && userData.records.length > 0) {
        localStorage.setItem(`backup_${currentUser}`, JSON.stringify(userData));
        if (navigator.onLine) {
            e.preventDefault();
            e.returnValue = '数据正在保存，请稍候...';
            await saveToGitHub(false, false);
        }
    }
});

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js')
            .then(reg => console.log('ServiceWorker注册成功:', reg.scope))
            .catch(err => console.log('ServiceWorker注册失败:', err));
    });
}
