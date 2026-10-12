import { supabase } from './supabaseClient.js';
import type { Subject, EnrollmentLink, EnrollmentRequest, EnrolledStudent } from './types.js';

// Declare external globals for jsPDF
declare global {
  interface Window {
    jspdf?: {
      jsPDF: any;
    };
    singleAssign?: (reqId: string) => void;
    deleteRequest?: (reqId: string) => void;
    deleteSubject?: (subjId: string, enrolledCount: number) => void;
    openEditStudent?: (studentId: string) => void;
    removeStudent?: (studentId: string, requestId?: string) => void;
    copyLink?: (token: string) => void;
    toggleLinkStatus?: (linkId: string, currentStatus: string) => void;
    deleteLink?: (linkId: string) => void;
  }
}

// State Variables
let currentAdmin: any = null;
let currentEnrollmentToken: string | null = null;
let allStudents: EnrolledStudent[] = [];
let allRequests: EnrollmentRequest[] = [];
let allSubjects: Subject[] = [];
let selectedRequests = new Set<string>();
let selectedStudents = new Set<string>();
let realtimeChannel: any = null;

// DOM Elements
const views = {
  loader: document.getElementById('global-loader'),
  login: document.getElementById('login-view'),
  admin: document.getElementById('admin-view'),
  student: document.getElementById('student-view')
};

// Application Bootstrap
window.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');

  if (token) {
    currentEnrollmentToken = token;
    validateEnrollmentToken(token);
  } else {
    setupAuthObserver();
  }
});

// ======================================================
// AUTHENTICATION & ROUTING
// ======================================================

async function setupAuthObserver(): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  handleAuthState(session?.user ?? null);

  supabase.auth.onAuthStateChange((_event, session) => {
    handleAuthState(session?.user ?? null);
  });
}

function handleAuthState(user: any): void {
  hideLoader();
  if (user) {
    currentAdmin = user;
    const emailEl = document.getElementById('admin-user-email');
    if (emailEl) emailEl.textContent = user.email || 'Admin';
    showView('admin');
    initAdminDashboard();
  } else {
    currentAdmin = null;
    if (realtimeChannel) {
      supabase.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
    showView('login');
  }
}

function showView(viewName: keyof typeof views): void {
  Object.values(views).forEach(v => {
    if (v && !v.classList.contains('global-loader')) v.classList.add('hidden');
  });
  if (views[viewName]) views[viewName]!.classList.remove('hidden');
}

function hideLoader(): void {
  if (views.loader) views.loader.classList.add('hidden');
}

// Admin Login
document.getElementById('login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const emailInput = document.getElementById('login-email') as HTMLInputElement;
  const pwdInput = document.getElementById('login-password') as HTMLInputElement;
  const errorEl = document.getElementById('login-error');
  const btnText = document.getElementById('login-btn-text');
  const spinner = document.getElementById('login-spinner');

  if (!emailInput || !pwdInput) return;
  const email = emailInput.value.trim();
  const password = pwdInput.value;

  if (errorEl) errorEl.textContent = '';
  btnText?.classList.add('hidden');
  spinner?.classList.remove('hidden');

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    // Handled by onAuthStateChange
  } catch (error: any) {
    if (errorEl) {
      errorEl.textContent = error.message || 'Invalid credentials. Please try again.';
    }
    btnText?.classList.remove('hidden');
    spinner?.classList.add('hidden');
  }
});

// Toggle Password Visibility
document.getElementById('toggle-pwd')?.addEventListener('click', (e) => {
  const pwdInput = document.getElementById('login-password') as HTMLInputElement;
  const target = e.currentTarget as HTMLElement;
  if (!pwdInput) return;
  if (pwdInput.type === 'password') {
    pwdInput.type = 'text';
    target.classList.replace('bx-hide', 'bx-show');
  } else {
    pwdInput.type = 'password';
    target.classList.replace('bx-show', 'bx-hide');
  }
});

// Logout
document.getElementById('btn-logout')?.addEventListener('click', async () => {
  try {
    if (realtimeChannel) {
      await supabase.removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
    await supabase.auth.signOut();
    showToast('Logged out successfully', 'success');
  } catch (err) {
    showToast('Error logging out', 'error');
  }
});

// ======================================================
// STUDENT ENROLLMENT (PUBLIC)
// ======================================================

async function validateEnrollmentToken(token: string): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('enrollment_links')
      .select('*')
      .eq('token', token)
      .eq('status', 'active')
      .single();

    hideLoader();
    showView('student');

    if (error || !data) {
      document.getElementById('student-form-container')?.classList.add('hidden');
      document.getElementById('student-error-container')?.classList.remove('hidden');
    } else {
      document.getElementById('student-form-container')?.classList.remove('hidden');
    }
  } catch (error) {
    hideLoader();
    showView('student');
    document.getElementById('student-form-container')?.classList.add('hidden');
    document.getElementById('student-error-container')?.classList.remove('hidden');
    const msgEl = document.getElementById('student-error-msg');
    if (msgEl) msgEl.textContent = 'Connection error. Please try again later.';
  }
}

document.getElementById('enrollment-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nameInput = document.getElementById('student-name') as HTMLInputElement;
  const rollInput = document.getElementById('student-roll') as HTMLInputElement;

  if (!nameInput || !rollInput) return;
  const name = nameInput.value.trim().toUpperCase();
  const roll = parseInt(rollInput.value.trim(), 10);

  if (!name || isNaN(roll)) return;

  const btnSubmit = document.getElementById('btn-submit-enrollment') as HTMLButtonElement;
  const btnText = document.getElementById('enrollment-btn-text');
  const spinner = document.getElementById('enrollment-spinner');

  btnText?.classList.add('hidden');
  spinner?.classList.remove('hidden');
  if (btnSubmit) btnSubmit.disabled = true;

  try {
    // Check if link is auto-assigned to a subject
    const { data: linkData } = await supabase
      .from('enrollment_links')
      .select('*')
      .eq('token', currentEnrollmentToken)
      .single();

    const subjectId = linkData?.subject_id || null;
    const subjectName = linkData?.subject_name || null;

    if (subjectId) {
      // Auto-Accept Flow
      const { data: reqData, error: reqErr } = await supabase
        .from('enrollment_requests')
        .insert({
          student_name: name,
          roll_number: roll,
          enrollment_token: currentEnrollmentToken,
          status: 'accepted',
          assigned_subject_id: subjectId,
          assigned_subject_name: subjectName,
          accepted_at: new Date().toISOString()
        })
        .select()
        .single();

      if (reqErr) throw reqErr;

      await supabase.from('enrolled_students').insert({
        request_id: reqData.id,
        name: name,
        roll_number: roll,
        subject_id: subjectId,
        subject_name: subjectName
      });
    } else {
      // Normal Pending Flow
      const { error: reqErr } = await supabase
        .from('enrollment_requests')
        .insert({
          student_name: name,
          roll_number: roll,
          enrollment_token: currentEnrollmentToken,
          status: 'pending'
        });

      if (reqErr) throw reqErr;
    }

    document.getElementById('student-form-container')?.classList.add('hidden');
    document.getElementById('student-success-container')?.classList.remove('hidden');
  } catch (error) {
    console.error(error);
    showToast('Error submitting request. Please try again.', 'error');
    btnText?.classList.remove('hidden');
    spinner?.classList.add('hidden');
    if (btnSubmit) btnSubmit.disabled = false;
  }
});

// ======================================================
// ADMIN DASHBOARD
// ======================================================

function initAdminDashboard(): void {
  setupNavigation();
  loadAllData();
  setupRealtimeListeners();
  setupModals();
  setupSearchAndFilters();
}

function setupNavigation(): void {
  const navLinks = document.querySelectorAll('.nav-links li, .btn-nav');
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      const targetId = (e.currentTarget as HTMLElement).getAttribute('data-target');
      if (!targetId) return;

      if ((e.currentTarget as HTMLElement).tagName === 'LI') {
        document.querySelectorAll('.nav-links li').forEach(l => l.classList.remove('active'));
        (e.currentTarget as HTMLElement).classList.add('active');
      } else {
        document.querySelectorAll('.nav-links li').forEach(l => {
          l.classList.remove('active');
          if (l.getAttribute('data-target') === targetId) l.classList.add('active');
        });
      }

      document.querySelectorAll('.page-section').forEach(sec => sec.classList.remove('active'));
      document.getElementById(targetId)?.classList.add('active');

      document.getElementById('sidebar')?.classList.remove('open');
    });
  });

  document.getElementById('mobile-menu-toggle')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.add('open');
  });
  document.getElementById('mobile-menu-close')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.remove('open');
  });
}

// Data loaders
async function loadAllData(): Promise<void> {
  await Promise.all([loadRequests(), loadSubjects(), loadStudents(), loadLinks()]);
}

async function loadRequests(): Promise<void> {
  const { data, error } = await supabase
    .from('enrollment_requests')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error loading requests:', error);
    return;
  }

  allRequests = data || [];
  let pendingCount = 0;
  let todayCount = 0;
  let acceptedTotal = 0;
  let rejectedTotal = 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  allRequests.forEach(req => {
    if (req.status === 'pending') pendingCount++;
    if (req.status === 'accepted') acceptedTotal++;
    if (req.status === 'rejected') rejectedTotal++;

    if (req.created_at && new Date(req.created_at) >= today) {
      todayCount++;
    }
  });

  const statPending = document.getElementById('stat-pending-requests');
  if (statPending) statPending.textContent = String(pendingCount);

  const statToday = document.getElementById('stat-today-requests');
  if (statToday) statToday.textContent = String(todayCount);

  const navPendingBadge = document.getElementById('nav-pending-badge');
  if (navPendingBadge) navPendingBadge.textContent = String(pendingCount);

  const analyticsToday = document.getElementById('analytics-today');
  if (analyticsToday) analyticsToday.textContent = String(todayCount);

  const analyticsAccepted = document.getElementById('analytics-accepted');
  if (analyticsAccepted) analyticsAccepted.textContent = String(acceptedTotal);

  const analyticsRejected = document.getElementById('analytics-rejected');
  if (analyticsRejected) analyticsRejected.textContent = String(rejectedTotal);

  renderRequestsTable();
  renderDashRecentRequests();
}

async function loadSubjects(): Promise<void> {
  const { data, error } = await supabase
    .from('subjects')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error loading subjects:', error);
    return;
  }

  allSubjects = data || [];
  const statSubjects = document.getElementById('stat-total-subjects');
  if (statSubjects) statSubjects.textContent = String(allSubjects.length);

  renderSubjectsTable();
  updateSubjectSelects();
}

async function loadStudents(): Promise<void> {
  const { data, error } = await supabase
    .from('enrolled_students')
    .select('*')
    .order('enrolled_at', { ascending: false });

  if (error) {
    console.error('Error loading students:', error);
    return;
  }

  allStudents = data || [];
  const statStudents = document.getElementById('stat-total-students');
  if (statStudents) statStudents.textContent = String(allStudents.length);

  renderStudentsTable();
  renderDashRecentStudents();
  renderDigitChart();
  renderSubjectsTable();
}

async function loadLinks(): Promise<void> {
  const { data, error } = await supabase
    .from('enrollment_links')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error loading links:', error);
    return;
  }

  const linksBody = document.getElementById('links-tbody');
  if (!linksBody) return;
  linksBody.innerHTML = '';

  (data || []).forEach((link: EnrollmentLink) => {
    const date = link.created_at ? new Date(link.created_at).toLocaleDateString() : 'N/A';
    const statusClass = link.status === 'active' ? 'active' : 'inactive';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><code>${link.token.substring(0, 8)}...</code></td>
      <td>${date}</td>
      <td><span class="status-badge ${statusClass}">${link.status}</span></td>
      <td>
        <button class="btn-text" onclick="copyLink('${link.token}')">Copy Link</button>
        <button class="btn-text" style="margin-left:10px" onclick="toggleLinkStatus('${link.id}', '${link.status}')">
          ${link.status === 'active' ? 'Deactivate' : 'Activate'}
        </button>
        <button class="btn-text text-red" style="margin-left:10px" onclick="deleteLink('${link.id}')" title="Delete Permanently">
          <i class='bx bx-trash'></i>
        </button>
      </td>
    `;
    linksBody.appendChild(tr);
  });
}

function setupRealtimeListeners(): void {
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
  }

  realtimeChannel = supabase
    .channel('enrollment-smart-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'enrollment_requests' }, () => {
      loadRequests();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'subjects' }, () => {
      loadSubjects();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'enrolled_students' }, () => {
      loadStudents();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'enrollment_links' }, () => {
      loadLinks();
    })
    .subscribe();
}

// ======================================================
// RENDER VIEWS
// ======================================================

function renderDashRecentRequests(): void {
  const tbody = document.getElementById('dash-recent-requests');
  if (!tbody) return;
  tbody.innerHTML = '';

  allRequests.slice(0, 5).forEach(req => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${req.student_name}</td>
      <td>${req.roll_number}</td>
      <td><span class="status-badge ${req.status}">${req.status}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

function renderDashRecentStudents(): void {
  const tbody = document.getElementById('dash-recent-students');
  if (!tbody) return;
  tbody.innerHTML = '';

  allStudents.slice(0, 5).forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${s.name}</td>
      <td>${s.subject_name || '-'}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderRequestsTable(): void {
  const tbody = document.getElementById('requests-tbody');
  const filterStatusEl = document.getElementById('request-status-filter') as HTMLSelectElement;
  const filterStatus = filterStatusEl ? filterStatusEl.value : 'all';
  const searchInput = document.getElementById('global-search') as HTMLInputElement;
  const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';

  if (!tbody) return;
  tbody.innerHTML = '';

  allRequests
    .filter(r => filterStatus === 'all' || r.status === filterStatus)
    .filter(r => r.student_name.toLowerCase().includes(searchTerm) || String(r.roll_number).includes(searchTerm))
    .forEach(req => {
      const date = req.created_at ? new Date(req.created_at).toLocaleDateString() : 'N/A';
      const tr = document.createElement('tr');
      const isChecked = selectedRequests.has(req.id) ? 'checked' : '';

      tr.innerHTML = `
        <td><input type="checkbox" class="req-checkbox" value="${req.id}" ${isChecked}></td>
        <td><strong>${req.student_name}</strong></td>
        <td>${req.roll_number}</td>
        <td><span class="status-badge ${req.status}">${req.status.toUpperCase()}</span></td>
        <td>${date}</td>
        <td>
          ${req.status === 'pending' ? `<button class="btn-text" onclick="singleAssign('${req.id}')" style="margin-right: 5px;">Assign</button>` : ''}
          <button class="btn-text text-red" onclick="deleteRequest('${req.id}')" title="Delete Permanently">Delete</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

  attachCheckboxListeners();
}

function renderSubjectsTable(): void {
  const tbody = document.getElementById('subjects-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  allSubjects.forEach(sub => {
    const enrolledCount = allStudents.filter(s => s.subject_id === sub.id).length;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${sub.name}</strong></td>
      <td>${sub.description || '-'}</td>
      <td>${enrolledCount} students</td>
      <td>
        <button class="btn-text text-red" onclick="deleteSubject('${sub.id}', ${enrolledCount})">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function updateSubjectSelects(): void {
  const selects = [
    document.getElementById('assign-subject-select') as HTMLSelectElement,
    document.getElementById('link-subject-select') as HTMLSelectElement,
    document.getElementById('filter-subject') as HTMLSelectElement
  ];

  selects.forEach(select => {
    if (!select) return;
    const currentValue = select.value;
    select.innerHTML = select.id === 'filter-subject'
      ? '<option value="">All Subjects</option>'
      : '<option value="">-- Choose Subject --</option>';

    allSubjects.forEach(sub => {
      const opt = document.createElement('option');
      opt.value = sub.id;
      opt.textContent = sub.name;
      select.appendChild(opt);
    });

    select.value = currentValue;
  });
}

function renderStudentsTable(): void {
  const tbody = document.getElementById('students-tbody');
  const searchInput = document.getElementById('students-search') as HTMLInputElement;
  const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
  const filterSubjectEl = document.getElementById('filter-subject') as HTMLSelectElement;
  const filterSubjectId = filterSubjectEl ? filterSubjectEl.value : '';

  if (!tbody) return;
  tbody.innerHTML = '';

  const sortedStudents = [...allStudents].sort((a, b) => a.roll_number - b.roll_number);

  sortedStudents
    .filter(s => {
      const matchSearch = s.name.toLowerCase().includes(searchTerm) || String(s.roll_number).includes(searchTerm);
      const matchSubject = filterSubjectId === '' || s.subject_id === filterSubjectId;
      return matchSearch && matchSubject;
    })
    .forEach((s, index) => {
      const isChecked = selectedStudents.has(s.id) ? 'checked' : '';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="checkbox" class="student-checkbox" value="${s.id}" ${isChecked}></td>
        <td><strong class="text-green">#${index + 1}</strong></td>
        <td><strong>${s.name}</strong></td>
        <td>${s.roll_number}</td>
        <td><span class="status-badge active">${s.subject_name || '-'}</span></td>
        <td>
          <button class="btn-text" onclick="openEditStudent('${s.id}')" style="margin-right: 5px;">Edit</button>
          <button class="btn-text text-red" onclick="removeStudent('${s.id}', '${s.request_id || ''}')" title="Delete Permanently">Delete</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
}

document.getElementById('filter-subject')?.addEventListener('change', renderStudentsTable);

// PDF Export
document.getElementById('btn-download-pdf')?.addEventListener('click', () => {
  const filterSubjectEl = document.getElementById('filter-subject') as HTMLSelectElement;
  const filterSubjectId = filterSubjectEl ? filterSubjectEl.value : '';
  const searchInput = document.getElementById('global-search') as HTMLInputElement;
  const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';

  const sortedStudents = [...allStudents]
    .filter(s => {
      const matchSearch = s.name.toLowerCase().includes(searchTerm) || String(s.roll_number).includes(searchTerm);
      const matchSubject = filterSubjectId === '' || s.subject_id === filterSubjectId;
      return matchSearch && matchSubject;
    })
    .sort((a, b) => a.roll_number - b.roll_number);

  if (sortedStudents.length === 0) {
    showToast('No students to download matching the current filters', 'error');
    return;
  }

  if (!window.jspdf?.jsPDF) {
    showToast('PDF library is not loaded', 'error');
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  const tableData = sortedStudents.map((s, index) => [
    index + 1,
    s.name,
    s.roll_number,
    s.subject_name || '-'
  ]);

  let title = 'Students Enrollment Record';
  if (filterSubjectId) {
    const selectedSubject = allSubjects.find(sub => sub.id === filterSubjectId);
    if (selectedSubject) title += ` - ${selectedSubject.name}`;
  }

  doc.setFontSize(18);
  doc.text(title, 14, 22);

  doc.autoTable({
    startY: 30,
    head: [['Pos', 'Name', 'Roll No', 'Subject']],
    body: tableData,
    theme: 'grid',
    headStyles: { fillColor: [79, 70, 229] },
    alternateRowStyles: { fillColor: [248, 250, 252] }
  });

  let filename = 'students_record.pdf';
  if (filterSubjectId) {
    const selectedSubject = allSubjects.find(sub => sub.id === filterSubjectId);
    if (selectedSubject) filename = `${selectedSubject.name.replace(/\s+/g, '_')}_record.pdf`;
  }

  doc.save(filename);
  showToast('PDF downloaded successfully', 'success');
});

// Digit Chart Analytics
function renderDigitChart(): void {
  const container = document.getElementById('digit-chart');
  if (!container) return;
  container.innerHTML = '';

  const freq: Record<number, number> = {};
  for (let i = 0; i <= 9; i++) freq[i] = 0;

  allStudents.forEach(s => {
    const lastDigit = parseInt(String(s.roll_number).slice(-1), 10);
    if (!isNaN(lastDigit)) freq[lastDigit]++;
  });

  const maxVal = Math.max(...Object.values(freq), 1);

  for (let i = 0; i <= 9; i++) {
    const heightPct = (freq[i] / maxVal) * 100;
    const wrapper = document.createElement('div');
    wrapper.className = 'chart-bar-wrapper';
    wrapper.innerHTML = `
      <div style="font-size:12px; margin-bottom:5px;">${freq[i]}</div>
      <div class="chart-bar" style="height: ${heightPct}%"></div>
      <div class="chart-label">${i}</div>
    `;
    container.appendChild(wrapper);
  }
}

// ======================================================
// BULK ACTIONS & CHECKBOXES
// ======================================================

function attachCheckboxListeners(): void {
  const selectAll = document.getElementById('select-all-requests') as HTMLInputElement;
  const checkboxes = document.querySelectorAll('.req-checkbox') as NodeListOf<HTMLInputElement>;
  const bulkBar = document.getElementById('bulk-action-bar');
  const bulkCount = document.getElementById('selected-count');

  function updateBulkBar(): void {
    if (selectedRequests.size > 0) {
      bulkBar?.classList.remove('hidden');
      if (bulkCount) bulkCount.textContent = `${selectedRequests.size} selected`;
      const filterEl = document.getElementById('request-status-filter') as HTMLSelectElement;
      const tab = filterEl ? filterEl.value : 'all';
      if (tab === 'pending' || tab === 'all') {
        document.getElementById('btn-bulk-assign')?.classList.remove('hidden');
      } else {
        document.getElementById('btn-bulk-assign')?.classList.add('hidden');
      }
    } else {
      bulkBar?.classList.add('hidden');
    }
  }

  if (selectAll) {
    selectAll.addEventListener('change', (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      checkboxes.forEach(cb => {
        cb.checked = checked;
        if (checked) selectedRequests.add(cb.value);
        else selectedRequests.delete(cb.value);
      });
      updateBulkBar();
    });
  }

  checkboxes.forEach(cb => {
    cb.addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      if (input.checked) selectedRequests.add(input.value);
      else selectedRequests.delete(input.value);

      if (selectAll) selectAll.checked = (selectedRequests.size === checkboxes.length && checkboxes.length > 0);
      updateBulkBar();
    });
  });
}

// Window Global actions for HTML bindings
window.singleAssign = (reqId: string) => {
  selectedRequests.clear();
  selectedRequests.add(reqId);
  const textEl = document.getElementById('assign-count-text');
  if (textEl) textEl.textContent = 'Assigning 1 student';
  openModal('modal-assign');
};

document.getElementById('btn-bulk-assign')?.addEventListener('click', () => {
  const textEl = document.getElementById('assign-count-text');
  if (textEl) textEl.textContent = `Assigning ${selectedRequests.size} students`;
  openModal('modal-assign');
});

// Select All Students
document.addEventListener('change', (e) => {
  const target = e.target as HTMLElement;
  if (target.id === 'select-all-students') {
    const isChecked = (target as HTMLInputElement).checked;
    const checkboxes = document.querySelectorAll('.student-checkbox') as NodeListOf<HTMLInputElement>;
    selectedStudents.clear();
    checkboxes.forEach(cb => {
      cb.checked = isChecked;
      if (isChecked) selectedStudents.add(cb.value);
    });
    updateStudentsBulkActionBar();
  } else if (target.classList.contains('student-checkbox')) {
    const cb = target as HTMLInputElement;
    if (cb.checked) selectedStudents.add(cb.value);
    else selectedStudents.delete(cb.value);

    const total = document.querySelectorAll('.student-checkbox').length;
    const selectAll = document.getElementById('select-all-students') as HTMLInputElement;
    if (selectAll) selectAll.checked = (selectedStudents.size === total && total > 0);
    updateStudentsBulkActionBar();
  }
});

function updateStudentsBulkActionBar(): void {
  const bar = document.getElementById('students-bulk-action-bar');
  const count = document.getElementById('students-selected-count');
  if (selectedStudents.size > 0) {
    bar?.classList.remove('hidden');
    if (count) count.textContent = `${selectedStudents.size} selected`;
  } else {
    bar?.classList.add('hidden');
  }
}

// Bulk Delete Students
document.getElementById('btn-bulk-delete-students')?.addEventListener('click', async () => {
  if (selectedStudents.size === 0) return;
  if (!confirm(`Are you sure you want to permanently delete ${selectedStudents.size} students? This cannot be undone.`)) return;

  try {
    const studentIds = Array.from(selectedStudents);
    const studentsToDelete = allStudents.filter(s => studentIds.includes(s.id));
    const requestIds = studentsToDelete.map(s => s.request_id).filter(Boolean) as string[];

    await supabase.from('enrolled_students').delete().in('id', studentIds);
    if (requestIds.length > 0) {
      await supabase.from('enrollment_requests').delete().in('id', requestIds);
    }

    showToast(`Deleted ${selectedStudents.size} students permanently`, 'success');
    selectedStudents.clear();
    const selectAll = document.getElementById('select-all-students') as HTMLInputElement;
    if (selectAll) selectAll.checked = false;
    document.getElementById('students-bulk-action-bar')?.classList.add('hidden');
    await loadAllData();
  } catch (err) {
    showToast('Error deleting students', 'error');
  }
});

// Bulk Delete Requests
document.getElementById('btn-bulk-delete')?.addEventListener('click', async () => {
  if (selectedRequests.size === 0) return;
  if (!confirm(`Are you sure you want to permanently delete ${selectedRequests.size} requests?`)) return;

  try {
    const reqIds = Array.from(selectedRequests);
    await supabase.from('enrollment_requests').delete().in('id', reqIds);
    await supabase.from('enrolled_students').delete().in('request_id', reqIds);

    showToast(`Deleted ${selectedRequests.size} requests permanently`, 'success');
    selectedRequests.clear();
    const selectAll = document.getElementById('select-all-requests') as HTMLInputElement;
    if (selectAll) selectAll.checked = false;
    document.getElementById('bulk-action-bar')?.classList.add('hidden');
    await loadAllData();
  } catch (err) {
    console.error(err);
    showToast('Error deleting requests', 'error');
  }
});

window.deleteRequest = async (reqId: string) => {
  if (!confirm('Are you sure you want to permanently delete this request?')) return;
  try {
    await supabase.from('enrollment_requests').delete().eq('id', reqId);
    await supabase.from('enrolled_students').delete().eq('request_id', reqId);
    showToast('Request deleted', 'success');
    await loadAllData();
  } catch (err) {
    console.error(err);
    showToast('Error deleting request', 'error');
  }
};

// Form Assign Submission
document.getElementById('form-assign')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const selectEl = document.getElementById('assign-subject-select') as HTMLSelectElement;
  const subjId = selectEl.value;
  const subject = allSubjects.find(s => s.id === subjId);

  if (!subject || selectedRequests.size === 0) return;

  try {
    const reqIds = Array.from(selectedRequests);
    for (const reqId of reqIds) {
      const req = allRequests.find(r => r.id === reqId);
      if (!req) continue;

      // Update Request status
      await supabase
        .from('enrollment_requests')
        .update({
          status: 'accepted',
          assigned_subject_id: subject.id,
          assigned_subject_name: subject.name,
          accepted_at: new Date().toISOString()
        })
        .eq('id', reqId);

      // Check deduplication
      const alreadyExists = allStudents.some(
        s => s.roll_number === req.roll_number && s.subject_id === subject.id
      );

      if (!alreadyExists) {
        await supabase.from('enrolled_students').insert({
          request_id: reqId,
          name: req.student_name,
          roll_number: req.roll_number,
          subject_id: subject.id,
          subject_name: subject.name
        });
      }
    }

    closeModals();
    showToast(`Processed ${selectedRequests.size} requests successfully`, 'success');
    selectedRequests.clear();
    const selectAll = document.getElementById('select-all-requests') as HTMLInputElement;
    if (selectAll) selectAll.checked = false;
    document.getElementById('bulk-action-bar')?.classList.add('hidden');
    await loadAllData();
  } catch (err) {
    showToast('Error assigning students', 'error');
  }
});

// Remove Student
window.removeStudent = async (studentId: string, requestId?: string) => {
  if (!confirm('Are you sure you want to permanently delete this student? This action cannot be undone.')) return;
  try {
    await supabase.from('enrolled_students').delete().eq('id', studentId);
    if (requestId) {
      await supabase.from('enrollment_requests').delete().eq('id', requestId);
    }
    showToast('Student deleted permanently', 'success');
    await loadAllData();
  } catch (err) {
    showToast('Error deleting student', 'error');
  }
};

window.openEditStudent = (studentId: string) => {
  const student = allStudents.find(s => s.id === studentId);
  if (!student) return;

  (document.getElementById('edit-student-id') as HTMLInputElement).value = student.id;
  (document.getElementById('edit-request-id') as HTMLInputElement).value = student.request_id || '';
  (document.getElementById('edit-student-name') as HTMLInputElement).value = student.name;
  (document.getElementById('edit-student-roll') as HTMLInputElement).value = String(student.roll_number);

  openModal('modal-edit-student');
};

document.getElementById('form-edit-student')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const id = (document.getElementById('edit-student-id') as HTMLInputElement).value;
  const reqId = (document.getElementById('edit-request-id') as HTMLInputElement).value;
  const newName = (document.getElementById('edit-student-name') as HTMLInputElement).value.trim().toUpperCase();
  const newRoll = parseInt((document.getElementById('edit-student-roll') as HTMLInputElement).value.trim(), 10);

  if (!newName || isNaN(newRoll)) return;

  try {
    await supabase.from('enrolled_students').update({
      name: newName,
      roll_number: newRoll
    }).eq('id', id);

    if (reqId) {
      await supabase.from('enrollment_requests').update({
        student_name: newName,
        roll_number: newRoll
      }).eq('id', reqId);
    }

    closeModals();
    showToast('Student updated successfully', 'success');
    await loadAllData();
  } catch (err) {
    console.error(err);
    showToast('Error updating student', 'error');
  }
});

// ======================================================
// SUBJECT MANAGEMENT
// ======================================================

document.getElementById('btn-create-subject')?.addEventListener('click', () => {
  (document.getElementById('form-subject') as HTMLFormElement)?.reset();
  openModal('modal-subject');
});

document.getElementById('form-subject')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nameInput = document.getElementById('subj-name') as HTMLInputElement;
  const descInput = document.getElementById('subj-desc') as HTMLInputElement;
  const name = nameInput.value.trim();
  const desc = descInput.value.trim();

  if (allSubjects.find(s => s.name.toLowerCase() === name.toLowerCase())) {
    showToast('A subject with this name already exists', 'error');
    return;
  }

  try {
    const { error } = await supabase.from('subjects').insert({
      name,
      description: desc
    });
    if (error) throw error;

    closeModals();
    showToast('Subject created successfully', 'success');
    await loadSubjects();
  } catch (err) {
    showToast('Error creating subject', 'error');
  }
});

window.deleteSubject = async (subjId: string, enrolledCount: number) => {
  if (enrolledCount > 0) {
    alert(`Cannot delete this subject. There are ${enrolledCount} students enrolled. Remove them first.`);
    return;
  }
  if (!confirm('Delete this subject?')) return;
  try {
    const { error } = await supabase.from('subjects').delete().eq('id', subjId);
    if (error) throw error;
    showToast('Subject deleted', 'success');
    await loadSubjects();
  } catch (err) {
    showToast('Error deleting subject', 'error');
  }
};

// ======================================================
// ENROLLMENT LINKS GENERATION
// ======================================================

function generateUniqueToken(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

const openGenerateModalHandler = () => {
  (document.getElementById('link-subject-select') as HTMLSelectElement).value = '';
  openModal('modal-generate-link');
};

const confirmGenerateLinkHandler = async () => {
  const token = generateUniqueToken();
  const selectEl = document.getElementById('link-subject-select') as HTMLSelectElement;
  const subjId = selectEl.value;
  const subject = allSubjects.find(s => s.id === subjId);

  if (!subject) {
    showToast('Please select a subject first', 'error');
    return;
  }

  try {
    const { error } = await supabase.from('enrollment_links').insert({
      token: token,
      status: 'active',
      subject_id: subject.id,
      subject_name: subject.name
    });
    if (error) throw error;

    const baseUrl = window.location.origin + window.location.pathname;
    const fullUrl = `${baseUrl}?token=${token}`;

    closeModals();
    const urlInput = document.getElementById('generated-link-url') as HTMLInputElement;
    if (urlInput) urlInput.value = fullUrl;
    openModal('modal-link');

    showToast('Auto-assign link generated!', 'success');
    await loadLinks();
  } catch (error) {
    console.error(error);
    showToast('Error generating link', 'error');
  }
};

document.getElementById('btn-generate-link-dash')?.addEventListener('click', openGenerateModalHandler);
document.getElementById('btn-generate-link')?.addEventListener('click', openGenerateModalHandler);
document.getElementById('btn-generate-link-page')?.addEventListener('click', openGenerateModalHandler);
document.getElementById('btn-confirm-generate')?.addEventListener('click', confirmGenerateLinkHandler);

document.getElementById('btn-copy-link')?.addEventListener('click', () => {
  const input = document.getElementById('generated-link-url') as HTMLInputElement;
  if (!input) return;
  input.select();
  navigator.clipboard.writeText(input.value).then(() => {
    showToast('Link copied to clipboard', 'success');
  });
});

window.copyLink = (token: string) => {
  const baseUrl = window.location.origin + window.location.pathname;
  const fullUrl = `${baseUrl}?token=${token}`;
  navigator.clipboard.writeText(fullUrl).then(() => {
    showToast('Link copied', 'success');
  });
};

window.toggleLinkStatus = async (linkId: string, currentStatus: string) => {
  const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
  try {
    const { error } = await supabase
      .from('enrollment_links')
      .update({ status: newStatus })
      .eq('id', linkId);
    if (error) throw error;
    showToast(`Link ${newStatus} successfully`, 'success');
    await loadLinks();
  } catch (err) {
    showToast('Error updating link', 'error');
  }
};

window.deleteLink = async (linkId: string) => {
  if (confirm('Are you sure you want to permanently delete this link?')) {
    try {
      const { error } = await supabase.from('enrollment_links').delete().eq('id', linkId);
      if (error) throw error;
      showToast('Link deleted permanently', 'success');
      await loadLinks();
    } catch (err) {
      console.error(err);
      showToast('Error deleting link', 'error');
    }
  }
};

// ======================================================
// MODALS, TOASTS & SEARCH
// ======================================================

function openModal(modalId: string): void {
  document.getElementById('modal-backdrop')?.classList.remove('hidden');
  document.getElementById(modalId)?.classList.remove('hidden');
}

function closeModals(): void {
  document.getElementById('modal-backdrop')?.classList.add('hidden');
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
}

document.querySelectorAll('.close-modal, .close-modal-btn, .modal-backdrop').forEach(btn => {
  btn.addEventListener('click', closeModals);
});

function showToast(message: string, type: 'success' | 'error' = 'success'): void {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icon = type === 'success' ? 'bx-check-circle' : 'bx-x-circle';
  toast.innerHTML = `<i class='bx ${icon}'></i> <span>${message}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

document.getElementById('global-search')?.addEventListener('input', () => {
  renderRequestsTable();
});

document.getElementById('students-search')?.addEventListener('input', () => {
  renderStudentsTable();
});

document.getElementById('request-status-filter')?.addEventListener('change', () => {
  selectedRequests.clear();
  document.getElementById('bulk-action-bar')?.classList.add('hidden');
  const selectAll = document.getElementById('select-all-requests') as HTMLInputElement;
  if (selectAll) selectAll.checked = false;
  renderRequestsTable();
});

function setupModals(): void {
  // Event listeners are attached
}

function setupSearchAndFilters(): void {
  // Filter handlers attached
}
