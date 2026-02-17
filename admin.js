// ========== 云端记账本 - 管理员逻辑文件 ==========
// 全局变量
let adminConfig = null;
let currentUser = null; // 管理员自己的用户名
let currentRepo = null;
let currentToken = null;
let selectedUsername = null; // 当前选中的要查看的用户
let selectedUserData = null; // 当前选中用户的数据

// 管理员仪表盘日期筛选变量
let adminDateRange = 'month'; // 默认本月
let adminCustomStartDate = null;
let adminCustomEndDate = null;

// 图表实例
let adminExpenseChart = null;
let adminMonthlyChart = null;

// UI状态
let currentPage = 'user-management';

// ========== 工具函数 ==========
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

async function fetchWithTimeout(url, options = {}, timeout = 60000) {
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

async function retryFetch(url, options = {}, retries = 3, delay = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fetchWithTimeout(url, options);
        } catch (error) {
            if (i === retries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
        }
    }
}

// ========== 日期筛选函数（修复所有范围，基于本地日期字符串） ==========
function filterRecordsByDateRange(records, range) {
    if (!records || records.length === 0) return [];

    // 辅助函数：获取本地日期字符串 YYYY-MM-DD
    function toLocalDateStr(date) {
        const d = new Date(date);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    const now = new Date();

    // 自定义范围
    if (range === 'custom' && adminCustomStartDate && adminCustomEndDate) {
        const startStr = adminCustomStartDate;
        const endStr = adminCustomEndDate;
        return records.filter(r => {
            const recordDateStr = toLocalDateStr(r.date);
            return recordDateStr >= startStr && recordDateStr <= endStr;
        });
    }

    // 根据 range 计算起始和结束的本地日期字符串
    let startStr, endStr;
    switch (range) {
        case 'today':
            startStr = toLocalDateStr(now);
            endStr = startStr;
            return records.filter(r => toLocalDateStr(r.date) === startStr);

        case 'week':
            // 获取本周的第一天（周日）
            const firstDay = new Date(now);
            firstDay.setDate(now.getDate() - now.getDay());
            startStr = toLocalDateStr(firstDay);
            // 本周最后一天（周六）
            const lastDay = new Date(firstDay);
            lastDay.setDate(firstDay.getDate() + 6);
            endStr = toLocalDateStr(lastDay);
            break;

        case 'month':
            startStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01';
            // 下个月的第一天减一天
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
            return records; // 全部返回
    }

    return records.filter(r => {
        const recordDateStr = toLocalDateStr(r.date);
        return recordDateStr >= startStr && recordDateStr <= endStr;
    });
}

// 初始化管理员仪表盘日期筛选
function initAdminDateFilter() {
    const display = document.getElementById('adminDateFilterDisplay');
    const dropdown = document.getElementById('adminDateDropdown');
    const presets = document.querySelectorAll('#adminDateDropdown .date-presets li');
    const customPicker = document.getElementById('adminCustomRangePicker');
    const startInput = document.getElementById('adminStartDate');
    const endInput = document.getElementById('adminEndDate');
    const applyBtn = document.getElementById('adminApplyCustomRange');
    const rangeText = document.getElementById('adminDateRangeText');
    if (!display || !dropdown) return;

    adminDateRange = 'month';
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
                adminDateRange = val;
                rangeText.textContent = { 'today':'今天', 'week':'本周', 'month':'本月', 'year':'本年', 'all':'全部' }[val] || val;
                dropdown.classList.remove('active');
                if (selectedUserData) {
                    updateAdminStats();
                    updateAdminCharts();
                    updateAdminRecordsList();
                }
            }
        });
    });
    if (applyBtn) {
        applyBtn.addEventListener('click', function() {
            if (!startInput.value || !endInput.value) { showMessage('请选择开始和结束日期', 'warning'); return; }
            if (new Date(startInput.value) > new Date(endInput.value)) { showMessage('开始日期不能晚于结束日期', 'error'); return; }
            adminDateRange = 'custom';
            rangeText.textContent = `自定义: ${startInput.value.split('-').slice(1).join('/')} - ${endInput.value.split('-').slice(1).join('/')}`;
            dropdown.classList.remove('active');
            adminCustomStartDate = startInput.value;
            adminCustomEndDate = endInput.value;
            if (selectedUserData) {
                updateAdminStats();
                updateAdminCharts();
                updateAdminRecordsList();
            }
        });
    }
    document.addEventListener('click', () => dropdown.classList.remove('active'));
    dropdown.addEventListener('click', e => e.stopPropagation());
}

// ========== 初始化 ==========
async function initAdmin() {
    try {
        const config = localStorage.getItem('accountConfig');
        if (!config) {
            window.location.href = './index.html';
            return;
        }
        adminConfig = JSON.parse(config);
        if (!adminConfig.isAdmin && adminConfig.username !== 'admin') {
            alert('您不是管理员，无法访问此页面');
            window.location.href = './app.html';
            return;
        }
        currentUser = adminConfig.username;
        currentRepo = adminConfig.repo;
        currentToken = adminConfig.token;

        // 填充设置表单
        document.getElementById('sidebarAdmin').textContent = currentUser;
        document.getElementById('sidebarRepo').textContent = '仓库: ' + currentRepo;
        document.getElementById('adminUsername').value = currentUser;
        document.getElementById('adminRepo').value = currentRepo;
        document.getElementById('adminToken').value = ''; // Token不显示明文，留空

        // 同步设置复选框
        document.getElementById('adminAutoSync').checked = adminConfig.autoSync !== false;
        document.getElementById('adminSyncOnChange').checked = adminConfig.syncOnChange !== false;
        document.getElementById('adminSyncOnStart').checked = adminConfig.syncOnStart !== false;

        // 加载用户列表
        await loadUserList();

        // 初始化主题
        const savedTheme = localStorage.getItem('theme') || 'auto';
        document.getElementById('adminThemeSelect').value = savedTheme;
        applyTheme(savedTheme);

        // 设置导航
        setupNavigation();

        // 初始化日期筛选
        initAdminDateFilter();

        // 监听系统主题变化
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
            const theme = localStorage.getItem('theme') || 'auto';
            if (theme === 'auto') applyTheme('auto');
        });
    } catch (error) {
        console.error('初始化失败:', error);
        alert('初始化失败，请重新登录');
        localStorage.removeItem('accountConfig');
        window.location.href = './index.html';
    }
}

// ========== 主题 ==========
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
    const current = localStorage.getItem('theme') || 'light';
    let next;
    if (current === 'light') next = 'dark';
    else if (current === 'dark') next = 'auto';
    else next = 'light';
    localStorage.setItem('theme', next);
    applyTheme(next);
    document.getElementById('adminThemeSelect').value = next;
}
window.toggleTheme = toggleTheme;

function changeAdminTheme(theme) {
    localStorage.setItem('theme', theme);
    applyTheme(theme);
}
window.changeAdminTheme = changeAdminTheme;

// ========== 保存管理员设置 ==========
function saveAdminSettings() {
    const repo = document.getElementById('adminRepo').value.trim();
    const token = document.getElementById('adminToken').value.trim();
    if (repo && !repo.includes('/')) {
        showMessage('仓库格式不正确，应为"用户名/仓库名"', 'error');
        return;
    }

    const config = JSON.parse(localStorage.getItem('accountConfig')) || {};
    if (repo) {
        config.repo = repo;
        currentRepo = repo;
        document.getElementById('sidebarRepo').textContent = '仓库: ' + currentRepo;
    }
    if (token) {
        config.token = token;
        currentToken = token;
    }
    config.autoSync = document.getElementById('adminAutoSync').checked;
    config.syncOnChange = document.getElementById('adminSyncOnChange').checked;
    config.syncOnStart = document.getElementById('adminSyncOnStart').checked;
    localStorage.setItem('accountConfig', JSON.stringify(config));

    showMessage('设置保存成功', 'success');
    if (token) testAdminToken();
}
window.saveAdminSettings = saveAdminSettings;

// ========== 测试GitHub Token ==========
async function testAdminToken() {
    if (!currentRepo || !currentToken) {
        showMessage('请先保存仓库和Token', 'warning');
        return;
    }
    try {
        const [owner, repoName] = currentRepo.split('/');
        const res = await retryFetch(`https://api.github.com/repos/${owner}/${repoName}`, {
            headers: { 'Authorization': `token ${currentToken}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        showMessage(res.ok ? 'GitHub Token验证成功' : 'GitHub Token验证失败，请检查权限', res.ok ? 'success' : 'warning');
    } catch {
        showMessage('Token验证失败', 'error');
    }
}
window.testAdminToken = testAdminToken;

// ========== 导航 ==========
function setupNavigation() {
    document.querySelectorAll('.nav-item, .bottom-nav-item').forEach(item => {
        item.addEventListener('click', function(e) {
            e.preventDefault();
            const target = this.getAttribute('data-target');
            if (target) switchSection(target);
            else if (this.getAttribute('onclick')) return;
        });
    });
}

function switchSection(sectionId) {
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    const sec = document.getElementById(sectionId);
    if (sec) {
        sec.classList.add('active');
        const titleMap = {
            'user-management': { icon: 'users', text: '用户管理' },
            'admin-dashboard': { icon: 'chart-line', text: '管理仪表盘' },
            'system-settings': { icon: 'cog', text: '系统设置' }
        };
        const info = titleMap[sectionId] || { icon: 'users', text: '用户管理' };
        document.getElementById('pageTitle').innerHTML = `<i class="fas fa-${info.icon}"></i><span>${info.text}</span>`;

        document.querySelectorAll('.nav-item, .bottom-nav-item').forEach(n => {
            n.classList.remove('active');
            if (n.getAttribute('data-target') === sectionId) n.classList.add('active');
        });

        const dateFilter = document.getElementById('adminDateFilter');
        if (dateFilter) {
            dateFilter.style.display = sectionId === 'admin-dashboard' ? 'flex' : 'none';
        }

        if (sectionId === 'admin-dashboard' && selectedUsername) {
            loadUserData(selectedUsername);
        }
    }
}
window.switchSection = switchSection;

// ========== 用户列表 ==========
async function loadUserList() {
    const container = document.getElementById('userList');
    if (!container) return;
    container.innerHTML = '<div class="loading"><div class="loading-spinner"></div><div class="loading-text">加载用户列表...</div></div>';

    try {
        const [owner, repoName] = currentRepo.split('/');
        const response = await retryFetch(`https://api.github.com/repos/${owner}/${repoName}/contents/data/users`, {
            headers: {
                'Authorization': `token ${currentToken}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        if (!response.ok) throw new Error('无法获取用户列表');

        const files = await response.json();
        const userFiles = files.filter(f => f.name.endsWith('.json'));
        let html = '';

        for (const file of userFiles) {
            const username = file.name.replace('.json', '');
            const userConfig = await getUserConfig(username);
            const isAdmin = userConfig && userConfig.isAdmin === true;
            const createdAt = userConfig ? new Date(userConfig.createdAt).toLocaleDateString() : '未知';

            html += `
                <div class="user-item ${selectedUsername === username ? 'selected' : ''}" onclick="selectUser('${username}')">
                    <div class="user-info">
                        <strong>${username}</strong>
                        ${isAdmin ? '<span style="color: var(--primary); margin-left: 8px;">(管理员)</span>' : ''}
                        <div><small>注册: ${createdAt}</small></div>
                    </div>
                    <div class="user-actions">
                        <button class="btn-secondary" style="padding: 6px 12px;" onclick="event.stopPropagation(); showEditUserModal('${username}')"><i class="fas fa-edit"></i></button>
                        ${!isAdmin ? `<button class="danger-btn" style="padding: 6px 12px;" onclick="event.stopPropagation(); deleteUser('${username}')"><i class="fas fa-trash"></i></button>` : ''}
                    </div>
                </div>
            `;
        }

        if (html === '') {
            html = '<div class="empty-state"><div class="empty-state-icon"><i class="fas fa-users"></i></div><div class="empty-state-title">暂无用户</div></div>';
        }

        container.innerHTML = html;
    } catch (error) {
        console.error('加载用户列表失败:', error);
        container.innerHTML = '<div class="message error">加载失败，请重试</div>';
    }
}

async function getUserConfig(username) {
    try {
        const [owner, repoName] = currentRepo.split('/');
        const filePath = `data/users/${username}.json`;
        const response = await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${filePath}`, {
            headers: {
                'Authorization': `token ${currentToken}`,
                'Accept': 'application/vnd.github.v3+json'
            }
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

// ========== 选择用户并加载数据 ==========
async function selectUser(username) {
    selectedUsername = username;
    document.querySelectorAll('.user-item').forEach(item => {
        item.classList.remove('selected');
        if (item.textContent.includes(username)) {
            item.classList.add('selected');
        }
    });
    switchSection('admin-dashboard');
    await loadUserData(username);
}

async function loadUserData(username) {
    showLoading();
    try {
        document.getElementById('currentViewingUser').textContent = username;
        document.getElementById('selectedUserDisplay').style.display = 'flex';

        const [owner, repoName] = currentRepo.split('/');
        const filePath = `data/${username}.json`;
        const response = await retryFetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${filePath}`, {
            headers: {
                'Authorization': `token ${currentToken}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        if (!response.ok) throw new Error('无法加载用户数据');

        const data = await response.json();
        const content = decodeURIComponent(atob(data.content));
        selectedUserData = JSON.parse(content);

        updateAdminStats();
        updateAdminCharts();
        updateAdminRecordsList();
    } catch (error) {
        console.error('加载用户数据失败:', error);
        showMessage('加载用户数据失败: ' + error.message, 'error');
        selectedUserData = null;
    } finally {
        hideLoading();
    }
}

function updateAdminStats() {
    if (!selectedUserData) return;
    const records = selectedUserData.records || [];
    const filtered = filterRecordsByDateRange(records, adminDateRange);
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
    document.getElementById('adminTotalIncome').textContent = '¥' + income.toFixed(2);
    document.getElementById('adminTotalExpense').textContent = '¥' + expense.toFixed(2);
    document.getElementById('adminTotalLoan').textContent = '¥' + netLoan.toFixed(2);
    document.getElementById('adminBalance').textContent = '¥' + balance.toFixed(2);
}

function updateAdminCharts() {
    if (!selectedUserData) return;
    updateAdminExpenseChart();
    updateAdminMonthlyChart();
}

// 修复：支出分类分布饼图 - 添加空状态管理
function updateAdminExpenseChart() {
    const canvas = document.getElementById('adminExpenseChart');
    if (!canvas || !selectedUserData) return;
    const ctx = canvas.getContext('2d');
    const parent = canvas.parentElement;

    // 移除之前的空状态元素
    const oldEmpty = parent.querySelector('.empty-state');
    if (oldEmpty) oldEmpty.remove();

    const records = selectedUserData.records || [];
    const filtered = filterRecordsByDateRange(records.filter(r => r.type === '支出'), adminDateRange);
    const cats = (selectedUserData.categories && selectedUserData.categories['支出']) || [];
    const data = cats.map(c => filtered.filter(r => r.category === c).reduce((s, r) => s + r.amount, 0));
    const labels = [], values = [];
    cats.forEach((c, i) => { if (data[i] > 0) { labels.push(c); values.push(data[i]); } });

    if (adminExpenseChart) adminExpenseChart.destroy();

    if (values.length === 0) {
        canvas.style.display = 'none';
        // 创建空状态
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'empty-state';
        emptyDiv.innerHTML = '<div class="empty-state-icon"><i class="fas fa-chart-pie"></i></div><div class="empty-state-title">暂无支出数据</div>';
        parent.appendChild(emptyDiv);
        return;
    }

    canvas.style.display = 'block';
    adminExpenseChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: ['#FF6B6B','#4ECDC4','#FFD166','#7B8FA1','#6BCF7F','#FF9E9E','#7EE9E0','#FFE085','#9FAFBF','#8DD18D'],
                borderWidth: 1
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
    });
}

// 月度趋势柱状图（无需空状态，因为即使数据为0也会显示柱）
function updateAdminMonthlyChart() {
    const canvas = document.getElementById('adminMonthlyChart');
    if (!canvas || !selectedUserData) return;
    const ctx = canvas.getContext('2d');
    const records = selectedUserData.records || [];
    const filtered = filterRecordsByDateRange(records, adminDateRange);
    const monthly = Array(12).fill().map(() => ({ income: 0, expense: 0 }));
    filtered.forEach(r => {
        const m = new Date(r.date).getMonth();
        const amt = r.isNegative ? -r.amount : r.amount;
        if (r.type === '收入') monthly[m].income += amt;
        else if (r.type === '支出') monthly[m].expense += amt;
    });
    if (adminMonthlyChart) adminMonthlyChart.destroy();
    adminMonthlyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'],
            datasets: [
                { label: '收入', data: monthly.map(d => d.income), backgroundColor: '#6BCF7F' },
                { label: '支出', data: monthly.map(d => d.expense), backgroundColor: '#FF6B6B' }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { callback: v => '¥' + v } } } }
    });
}

function updateAdminRecordsList() {
    const container = document.getElementById('adminRecordsList');
    if (!container || !selectedUserData) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><i class="fas fa-receipt"></i></div><div class="empty-state-title">请先选择一个用户</div></div>';
        return;
    }
    const records = selectedUserData.records || [];
    const filtered = filterRecordsByDateRange(records, adminDateRange);
    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-icon"><i class="fas fa-receipt"></i></div><div class="empty-state-title">该用户暂无记录</div></div>';
        return;
    }
    const sorted = [...filtered].sort((a,b) => new Date(b.date) - new Date(a.date));
    let html = '';
    sorted.forEach(r => {
        const d = new Date(r.date).toLocaleDateString('zh-CN');
        const amt = r.isNegative ? -r.amount : r.amount;
        let icon = 'fas fa-exchange-alt', cls = 'loan';
        if (r.type === '收入') { icon = 'fas fa-money-bill-wave'; cls = 'income'; }
        else if (r.type === '支出') { icon = 'fas fa-shopping-cart'; cls = 'expense'; }
        else if (r.type === '借贷') { icon = 'fas fa-hand-holding-usd'; cls = r.category === '还款' ? 'repayment' : 'loan'; }
        html += `<div class="record-item">
            <div class="record-icon ${cls}"><i class="${icon}"></i></div>
            <div class="record-details">
                <div class="record-title">${r.description || '无描述'}</div>
                <div class="record-meta"><span class="record-category">${r.type} · ${r.category}</span><span>${d}</span></div>
            </div>
            <div class="record-amount ${cls}">${amt >= 0 ? '+' : ''}¥${amt.toFixed(2)}</div>
            <div class="record-actions">
                <button onclick="adminEditRecord('${r.id}')"><i class="fas fa-edit"></i></button>
                <button class="delete-btn" onclick="adminDeleteRecord('${r.id}')"><i class="fas fa-trash"></i></button>
            </div>
        </div>`;
    });
    container.innerHTML = html;
}

// ========== 管理员编辑/删除用户记录 ==========
let editingRecordId = null;
let currentModal = null;

function adminEditRecord(id) {
    if (!selectedUserData) return;
    const record = selectedUserData.records.find(r => r.id === id);
    if (!record) return;
    editingRecordId = id;
    currentModal = { type: 'editRecord' };
    document.getElementById('modalTitle').textContent = '编辑记录';
    document.getElementById('modalBody').innerHTML = `
        <div style="padding:20px;">
            <div class="form-group"><label class="form-label">类型</label><select class="form-select" id="modalRecordType">
                <option value="收入" ${record.type==='收入'?'selected':''}>收入</option>
                <option value="支出" ${record.type==='支出'?'selected':''}>支出</option>
                <option value="借贷" ${record.type==='借贷'?'selected':''}>借贷</option>
            </select></div>
            <div class="form-group"><label class="form-label">分类</label><input type="text" class="form-input" id="modalRecordCategory" value="${record.category}"></div>
            <div class="form-group"><label class="form-label">描述</label><input type="text" class="form-input" id="modalRecordDescription" value="${record.description || ''}"></div>
            <div class="form-group"><label class="form-label">金额</label><input type="number" class="form-input" id="modalRecordAmount" value="${Math.abs(record.amount)}" step="0.01"></div>
            <div class="form-group"><label class="form-label">日期</label><input type="date" class="form-input" id="modalRecordDate" value="${new Date(record.date).toISOString().split('T')[0]}"></div>
        </div>
    `;
    document.getElementById('modal').classList.add('active');
}

function adminDeleteRecord(id) {
    if (!selectedUserData || !confirm('确定要删除这条记录吗？')) return;
    const index = selectedUserData.records.findIndex(r => r.id === id);
    if (index > -1) {
        selectedUserData.records.splice(index, 1);
        saveUserDataToGitHub(selectedUsername, selectedUserData);
        updateAdminRecordsList();
        updateAdminStats();
        updateAdminCharts();
        showMessage('记录已删除', 'success');
    }
}

async function saveUserDataToGitHub(username, data) {
    try {
        const [owner, repoName] = currentRepo.split('/');
        const filePath = `data/${username}.json`;
        const content = btoa(encodeURIComponent(JSON.stringify(data, null, 2)));

        let sha = null;
        try {
            const check = await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${filePath}`, {
                headers: { 'Authorization': `token ${currentToken}`, 'Accept': 'application/vnd.github.v3+json' }
            });
            if (check.ok) {
                const fileData = await check.json();
                sha = fileData.sha;
            }
        } catch (e) {}

        const body = { message: `管理员更新用户数据: ${username}`, content: content, sha: sha };
        const response = await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${filePath}`, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${currentToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify(body)
        });
        if (response.ok) {
            showMessage('用户数据已保存', 'success');
        } else {
            throw new Error('保存失败');
        }
    } catch (error) {
        console.error('保存用户数据失败:', error);
        showMessage('保存失败: ' + error.message, 'error');
    }
}

// ========== 用户管理操作 ==========
function showAddUserModal() {
    currentModal = { type: 'addUser' };
    document.getElementById('modalTitle').textContent = '添加新用户';
    document.getElementById('modalBody').innerHTML = `
        <div style="padding:20px;">
            <div class="form-group"><label class="form-label">用户名</label><input type="text" class="form-input" id="modalUsername" placeholder="仅字母数字"></div>
            <div class="form-group"><label class="form-label">密码</label><input type="password" class="form-input" id="modalPassword" placeholder="至少6位"></div>
            <div class="form-group"><label class="form-label">确认密码</label><input type="password" class="form-input" id="modalConfirmPassword"></div>
            <div class="form-group"><label class="checkbox-label"><input type="checkbox" id="modalIsAdmin"> 设为管理员</label></div>
        </div>
    `;
    document.getElementById('modal').classList.add('active');
}

function showEditUserModal(username) {
    currentModal = { type: 'editUser', data: { username } };
    document.getElementById('modalTitle').textContent = '修改用户密码';
    document.getElementById('modalBody').innerHTML = `
        <div style="padding:20px;">
            <div class="form-group"><label class="form-label">用户名</label><input type="text" class="form-input" value="${username}" readonly></div>
            <div class="form-group"><label class="form-label">新密码</label><input type="password" class="form-input" id="modalNewPassword" placeholder="留空则不修改"></div>
            <div class="form-group"><label class="form-label">确认新密码</label><input type="password" class="form-input" id="modalConfirmNewPassword"></div>
        </div>
    `;
    document.getElementById('modal').classList.add('active');
}

async function deleteUser(username) {
    if (!confirm(`确定要删除用户 ${username} 吗？此操作不可逆！`)) return;
    showLoading();
    try {
        const [owner, repoName] = currentRepo.split('/');
        const userFilePath = `data/users/${username}.json`;
        let userSha = null;
        const userRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${userFilePath}`, {
            headers: { 'Authorization': `token ${currentToken}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        if (userRes.ok) {
            const userData = await userRes.json();
            userSha = userData.sha;
        }
        if (userSha) {
            await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${userFilePath}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `token ${currentToken}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/vnd.github.v3+json'
                },
                body: JSON.stringify({ message: `删除用户: ${username}`, sha: userSha })
            });
        }

        const dataFilePath = `data/${username}.json`;
        let dataSha = null;
        const dataRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${dataFilePath}`, {
            headers: { 'Authorization': `token ${currentToken}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        if (dataRes.ok) {
            const dataFile = await dataRes.json();
            dataSha = dataFile.sha;
        }
        if (dataSha) {
            await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${dataFilePath}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `token ${currentToken}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/vnd.github.v3+json'
                },
                body: JSON.stringify({ message: `删除用户数据: ${username}`, sha: dataSha })
            });
        }

        showMessage('用户已删除', 'success');
        await loadUserList();
        if (selectedUsername === username) {
            selectedUsername = null;
            selectedUserData = null;
            switchSection('user-management');
        }
    } catch (error) {
        console.error('删除用户失败:', error);
        showMessage('删除失败: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// ========== 模态框确认 ==========
function closeModal() {
    document.getElementById('modal').classList.remove('active');
    currentModal = null;
    editingRecordId = null;
}
window.closeModal = closeModal;

function confirmModal() {
    if (!currentModal) return;
    if (currentModal.type === 'addUser') {
        const username = document.getElementById('modalUsername').value.trim();
        const pwd = document.getElementById('modalPassword').value;
        const confirm = document.getElementById('modalConfirmPassword').value;
        const isAdmin = document.getElementById('modalIsAdmin').checked;
        if (!username || !pwd) { showMessage('请填写用户名和密码', 'error'); return; }
        if (!/^[A-Za-z0-9]+$/.test(username)) { showMessage('用户名只能包含字母和数字', 'error'); return; }
        if (pwd.length < 6) { showMessage('密码至少6位', 'error'); return; }
        if (pwd !== confirm) { showMessage('两次密码不一致', 'error'); return; }
        createUser(username, pwd, isAdmin);
    } else if (currentModal.type === 'editUser') {
        const username = currentModal.data.username;
        const newPwd = document.getElementById('modalNewPassword').value;
        const confirmPwd = document.getElementById('modalConfirmNewPassword').value;
        if (newPwd && newPwd !== confirmPwd) { showMessage('两次密码不一致', 'error'); return; }
        if (newPwd && newPwd.length < 6) { showMessage('密码至少6位', 'error'); return; }
        updateUserPassword(username, newPwd);
    } else if (currentModal.type === 'editRecord') {
        if (!selectedUserData) return;
        const id = editingRecordId;
        const type = document.getElementById('modalRecordType').value;
        const cat = document.getElementById('modalRecordCategory').value.trim();
        const desc = document.getElementById('modalRecordDescription').value.trim();
        const amount = parseFloat(document.getElementById('modalRecordAmount').value);
        const date = document.getElementById('modalRecordDate').value;
        if (!cat || !amount || amount <= 0) { showMessage('请填写完整信息', 'error'); return; }
        const recordIndex = selectedUserData.records.findIndex(r => r.id === id);
        if (recordIndex === -1) return;
        let isNegative = false;
        if (type === '借贷' && cat === '还款') isNegative = true;
        selectedUserData.records[recordIndex] = {
            ...selectedUserData.records[recordIndex],
            type, category: cat, description: desc,
            amount: Math.abs(amount), isNegative,
            date: date ? new Date(date).toISOString() : new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        saveUserDataToGitHub(selectedUsername, selectedUserData);
        updateAdminRecordsList();
        updateAdminStats();
        updateAdminCharts();
        closeModal();
        showMessage('记录已更新', 'success');
    }
}
window.confirmModal = confirmModal;

async function createUser(username, password, isAdmin) {
    showLoading();
    try {
        const [owner, repoName] = currentRepo.split('/');
        const checkRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/data/users/${username}.json`, {
            headers: { 'Authorization': `token ${currentToken}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        if (checkRes.ok) {
            showMessage('用户名已存在', 'error');
            return;
        }

        const userConfig = {
            username: username,
            password: btoa(encodeURIComponent(password)),
            createdAt: new Date().toISOString(),
            lastLogin: null,
            isAdmin: isAdmin
        };
        const userContent = btoa(encodeURIComponent(JSON.stringify(userConfig, null, 2)));
        await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/data/users/${username}.json`, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${currentToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify({ message: `管理员创建用户: ${username}`, content: userContent })
        });

        const initialData = {
            records: [],
            categories: {
                '收入': ['工资', '奖金', '投资', '兼职', '其他收入'],
                '支出': ['餐饮', '交通', '购物', '娱乐', '住房', '医疗', '教育', '其他支出'],
                '借贷': ['借款', '还款']
            },
            budgets: {},
            created: new Date().toISOString(),
            lastSync: new Date().toISOString(),
            version: 1
        };
        const dataContent = btoa(encodeURIComponent(JSON.stringify(initialData, null, 2)));
        await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/data/${username}.json`, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${currentToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify({ message: `创建用户数据: ${username}`, content: dataContent })
        });

        showMessage('用户创建成功', 'success');
        closeModal();
        await loadUserList();
    } catch (error) {
        console.error('创建用户失败:', error);
        showMessage('创建失败: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

async function updateUserPassword(username, newPassword) {
    if (!newPassword) {
        closeModal();
        return;
    }
    showLoading();
    try {
        const userConfig = await getUserConfig(username);
        if (!userConfig) throw new Error('用户不存在');
        userConfig.password = btoa(encodeURIComponent(newPassword));
        userConfig.updatedAt = new Date().toISOString();

        const [owner, repoName] = currentRepo.split('/');
        const filePath = `data/users/${username}.json`;
        const content = btoa(encodeURIComponent(JSON.stringify(userConfig, null, 2)));

        let sha = null;
        const check = await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${filePath}`, {
            headers: { 'Authorization': `token ${currentToken}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        if (check.ok) {
            const fileData = await check.json();
            sha = fileData.sha;
        }

        await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${filePath}`, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${currentToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify({ message: `管理员修改用户密码: ${username}`, content: content, sha: sha })
        });

        showMessage('密码已更新', 'success');
        closeModal();
    } catch (error) {
        console.error('更新密码失败:', error);
        showMessage('更新失败: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}

// ========== 修改管理员自己的密码 ==========
async function changeAdminPassword() {
    const currentPwd = document.getElementById('adminCurrentPwd').value;
    const newPwd = document.getElementById('adminNewPwd').value;
    const confirmPwd = document.getElementById('adminConfirmPwd').value;
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

    showLoading();
    try {
        const userConfig = await getUserConfig(currentUser);
        if (!userConfig) throw new Error('无法获取用户配置');
        const encryptedCurrent = btoa(encodeURIComponent(currentPwd));
        if (userConfig.password !== encryptedCurrent) {
            throw new Error('当前密码错误');
        }

        userConfig.password = btoa(encodeURIComponent(newPwd));
        userConfig.updatedAt = new Date().toISOString();

        const [owner, repoName] = currentRepo.split('/');
        const filePath = `data/users/${currentUser}.json`;
        const content = btoa(encodeURIComponent(JSON.stringify(userConfig, null, 2)));

        let sha = null;
        const check = await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${filePath}`, {
            headers: { 'Authorization': `token ${currentToken}`, 'Accept': 'application/vnd.github.v3+json' }
        });
        if (check.ok) {
            const fileData = await check.json();
            sha = fileData.sha;
        }

        await fetch(`https://api.github.com/repos/${owner}/${repoName}/contents/${filePath}`, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${currentToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify({ message: `管理员修改自身密码`, content: content, sha: sha })
        });

        showMessage('密码修改成功', 'success');
        document.getElementById('adminCurrentPwd').value = '';
        document.getElementById('adminNewPwd').value = '';
        document.getElementById('adminConfirmPwd').value = '';
    } catch (error) {
        showMessage('修改失败: ' + error.message, 'error');
    } finally {
        hideLoading();
    }
}
window.changeAdminPassword = changeAdminPassword;

// ========== 导出用户记录 ==========
function exportUserRecords() {
    if (!selectedUserData) {
        showMessage('请先选择一个用户', 'warning');
        return;
    }
    const records = selectedUserData.records || [];
    const filtered = filterRecordsByDateRange(records, adminDateRange);
    if (filtered.length === 0) {
        showMessage('该用户在当前时间范围内无记录', 'warning');
        return;
    }
    const sorted = [...filtered].sort((a,b) => new Date(a.date) - new Date(b.date));
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
    a.href = url; a.download = `${selectedUsername}_记录_${new Date().toISOString().split('T')[0]}.csv`; a.click();
    URL.revokeObjectURL(url);
    showMessage('导出成功', 'success');
}
window.exportUserRecords = exportUserRecords;

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

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', initAdmin);
