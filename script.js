// ======================================================
// FIREBASE CONFIGURATION
// Replace ONLY the placeholder values below with your
// Firebase project configuration.
// ======================================================

const firebaseConfig = {
  apiKey: "AIzaSyD5mGOzs5cJhWg7xac1ONJOJds4GkwjemA",
  authDomain: "attendance-apk-8f619.firebaseapp.com",
  databaseURL: "https://attendance-apk-8f619-default-rtdb.firebaseio.com",
  projectId: "attendance-apk-8f619",
  storageBucket: "attendance-apk-8f619.firebasestorage.app",
  messagingSenderId: "922973833002",
  appId: "1:922973833002:web:d2f41a023c73017c258053"
};

// Import Firebase SDKs from CDN
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getAuth, 
    signInWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    getFirestore, 
    collection, 
    addDoc, 
    getDocs, 
    getDoc,
    doc,
    updateDoc, 
    deleteDoc, 
    query, 
    where,
    orderBy,
    onSnapshot,
    serverTimestamp,
    writeBatch
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// State Variables
let currentAdmin = null;
let currentEnrollmentToken = null;
let allStudents = [];
let allRequests = [];
let allSubjects = [];
let selectedRequests = new Set();
let unsubscribeListeners = [];

// DOM Elements
const views = {
    loader: document.getElementById('global-loader'),
    login: document.getElementById('login-view'),
    admin: document.getElementById('admin-view'),
    student: document.getElementById('student-view')
};

// Init Application Routing
window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    if (token) {
        // Student Enrollment View
        currentEnrollmentToken = token;
        validateEnrollmentToken(token);
    } else {
        // Admin Auth Flow
        setupAuthObserver();
    }
});

// ======================================================
// AUTHENTICATION & ROUTING
// ======================================================

function setupAuthObserver() {
    onAuthStateChanged(auth, (user) => {
        hideLoader();
        if (user) {
            currentAdmin = user;
            document.getElementById('admin-user-email').textContent = user.email;
            showView('admin');
            initAdminDashboard();
        } else {
            currentAdmin = null;
            showView('login');
        }
    });
}

function showView(viewName) {
    Object.values(views).forEach(v => {
        if(v && !v.classList.contains('global-loader')) v.classList.add('hidden');
    });
    if(views[viewName]) views[viewName].classList.remove('hidden');
}

function hideLoader() {
    if(views.loader) views.loader.classList.add('hidden');
}

// Login Logic
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const pwd = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');
    const btnText = document.getElementById('login-btn-text');
    const spinner = document.getElementById('login-spinner');
    
    errorEl.textContent = '';
    btnText.classList.add('hidden');
    spinner.classList.remove('hidden');

    try {
        await signInWithEmailAndPassword(auth, email, pwd);
        // Observer will handle redirect
    } catch (error) {
        let msg = "Invalid credentials. Please try again.";
        if(error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
            msg = "Incorrect email or password.";
        } else if (error.code === 'auth/too-many-requests') {
            msg = "Too many attempts. Try again later.";
        }
        errorEl.textContent = msg;
        btnText.classList.remove('hidden');
        spinner.classList.add('hidden');
    }
});

// Toggle Password
document.getElementById('toggle-pwd').addEventListener('click', (e) => {
    const pwdInput = document.getElementById('login-password');
    if (pwdInput.type === 'password') {
        pwdInput.type = 'text';
        e.target.classList.replace('bx-hide', 'bx-show');
    } else {
        pwdInput.type = 'password';
        e.target.classList.replace('bx-show', 'bx-hide');
    }
});

// Logout
document.getElementById('btn-logout').addEventListener('click', async () => {
    try {
        unsubscribeAll();
        await signOut(auth);
    } catch(err) {
        showToast("Error logging out", "error");
    }
});

// ======================================================
// STUDENT ENROLLMENT LOGIC (PUBLIC)
// ======================================================

async function validateEnrollmentToken(token) {
    try {
        const q = query(collection(db, "enrollmentLinks"), where("token", "==", token), where("status", "==", "active"));
        const snapshot = await getDocs(q);
        
        hideLoader();
        showView('student');
        
        if (snapshot.empty) {
            document.getElementById('student-form-container').classList.add('hidden');
            document.getElementById('student-error-container').classList.remove('hidden');
        } else {
            // Valid token
            document.getElementById('student-form-container').classList.remove('hidden');
        }
    } catch (error) {
        hideLoader();
        showView('student');
        document.getElementById('student-form-container').classList.add('hidden');
        document.getElementById('student-error-container').classList.remove('hidden');
        document.getElementById('student-error-msg').textContent = "Connection error. Please try again later.";
    }
}

document.getElementById('enrollment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('student-name').value.trim().toUpperCase();
    const roll = document.getElementById('student-roll').value.trim();
    
    if(!name || !roll) return;

    const btnText = document.getElementById('enrollment-btn-text');
    const spinner = document.getElementById('enrollment-spinner');
    
    btnText.classList.add('hidden');
    spinner.classList.remove('hidden');
    document.getElementById('btn-submit-enrollment').disabled = true;

    try {
        // Find if link has a pre-assigned subject
        const q = query(collection(db, "enrollmentLinks"), where("token", "==", currentEnrollmentToken));
        const snapshot = await getDocs(q);
        
        let subjectId = null;
        let subjectName = null;
        if (!snapshot.empty) {
            const linkData = snapshot.docs[0].data();
            subjectId = linkData.subjectId || null;
            subjectName = linkData.subjectName || null;
        }

        if (subjectId) {
            // Auto Accept Flow
            const reqRef = await addDoc(collection(db, "enrollmentRequests"), {
                studentName: name,
                rollNumber: parseInt(roll, 10),
                enrollmentToken: currentEnrollmentToken,
                status: "accepted",
                assignedSubjectId: subjectId,
                assignedSubjectName: subjectName,
                createdAt: serverTimestamp(),
                acceptedAt: serverTimestamp()
            });

            // IMPORTANT: Requires Firestore rule allowing public create on 'students'
            await addDoc(collection(db, "students"), {
                requestId: reqRef.id,
                name: name,
                rollNumber: parseInt(roll, 10),
                subjectId: subjectId,
                subjectName: subjectName,
                enrolledAt: serverTimestamp()
            });
        } else {
            // Normal Pending Flow
            await addDoc(collection(db, "enrollmentRequests"), {
                studentName: name,
                rollNumber: parseInt(roll, 10),
                enrollmentToken: currentEnrollmentToken,
                status: "pending",
                createdAt: serverTimestamp()
            });
        }

        document.getElementById('student-form-container').classList.add('hidden');
        document.getElementById('student-success-container').classList.remove('hidden');
    } catch (error) {
        console.error(error);
        showToast("Error submitting request. Please try again.", "error");
        btnText.classList.remove('hidden');
        spinner.classList.add('hidden');
        document.getElementById('btn-submit-enrollment').disabled = false;
    }
});

// ======================================================
// ADMIN DASHBOARD CORE LOGIC
// ======================================================

function initAdminDashboard() {
    setupNavigation();
    setupRealtimeListeners();
    setupModals();
    setupSearchAndFilters();
}

function unsubscribeAll() {
    unsubscribeListeners.forEach(unsub => unsub());
    unsubscribeListeners = [];
}

// Navigation
function setupNavigation() {
    const navLinks = document.querySelectorAll('.nav-links li, .btn-nav');
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            const targetId = e.currentTarget.getAttribute('data-target');
            if(!targetId) return;
            
            // Handle sidebar active state
            if(e.currentTarget.tagName === 'LI') {
                document.querySelectorAll('.nav-links li').forEach(l => l.classList.remove('active'));
                e.currentTarget.classList.add('active');
            } else {
                // If clicked from a button, sync sidebar
                document.querySelectorAll('.nav-links li').forEach(l => {
                    l.classList.remove('active');
                    if(l.getAttribute('data-target') === targetId) l.classList.add('active');
                });
            }

            // Show target section
            document.querySelectorAll('.page-section').forEach(sec => sec.classList.remove('active'));
            document.getElementById(targetId).classList.add('active');
            
            // Close mobile menu
            document.getElementById('sidebar').classList.remove('open');
        });
    });

    document.getElementById('mobile-menu-toggle').addEventListener('click', () => {
        document.getElementById('sidebar').classList.add('open');
    });
    document.getElementById('mobile-menu-close').addEventListener('click', () => {
        document.getElementById('sidebar').classList.remove('open');
    });
}

// ======================================================
// REALTIME DATA LISTENERS
// ======================================================

function setupRealtimeListeners() {
    // 1. Listen to Requests
    const reqQ = query(collection(db, "enrollmentRequests"), orderBy("createdAt", "desc"));
    const unsubReq = onSnapshot(reqQ, (snapshot) => {
        allRequests = [];
        let pendingCount = 0;
        let todayCount = 0;
        let acceptedTotal = 0;
        let rejectedTotal = 0;
        
        const today = new Date();
        today.setHours(0,0,0,0);

        snapshot.forEach(doc => {
            const data = doc.data();
            const req = { id: doc.id, ...data };
            allRequests.push(req);
            
            if(req.status === 'pending') pendingCount++;
            if(req.status === 'accepted') acceptedTotal++;
            if(req.status === 'rejected') rejectedTotal++;
            
            if(req.createdAt && req.createdAt.toDate() >= today) {
                todayCount++;
            }
        });

        // Update Dashboard Stats
        document.getElementById('stat-pending-requests').textContent = pendingCount;
        document.getElementById('stat-today-requests').textContent = todayCount;
        document.getElementById('nav-pending-badge').textContent = pendingCount;
        
        // Analytics
        document.getElementById('analytics-today').textContent = todayCount;
        document.getElementById('analytics-accepted').textContent = acceptedTotal;
        document.getElementById('analytics-rejected').textContent = rejectedTotal;

        renderRequestsTable();
        renderDashRecentRequests();
    }, (error) => {
        console.error("Firebase Rule Error or Connection Error:", error);
    });
    
    // 2. Listen to Subjects
    const subjQ = query(collection(db, "subjects"), orderBy("createdAt", "desc"));
    const unsubSubj = onSnapshot(subjQ, (snapshot) => {
        allSubjects = [];
        snapshot.forEach(doc => allSubjects.push({ id: doc.id, ...doc.data() }));
        document.getElementById('stat-total-subjects').textContent = allSubjects.length;
        renderSubjectsTable();
        updateSubjectSelects();
    });

    // 3. Listen to Students (Accepted Requests essentially, or separate Students collection)
    const studQ = query(collection(db, "students"), orderBy("enrolledAt", "desc"));
    const unsubStud = onSnapshot(studQ, (snapshot) => {
        allStudents = [];
        const seenRolls = new Set();
        
        snapshot.forEach(doc => {
            const data = doc.data();
            // Deduplicate by Roll Number + Subject ID
            const uniqueKey = data.rollNumber + '_' + data.subjectId;
            if (!seenRolls.has(uniqueKey)) {
                allStudents.push({ id: doc.id, ...data });
                seenRolls.add(uniqueKey);
            }
        });
        
        document.getElementById('stat-total-students').textContent = allStudents.length;
        renderStudentsTable();
        renderDashRecentStudents();
        renderDigitChart();
    });

    // 4. Listen to Links
    const linkQ = query(collection(db, "enrollmentLinks"), orderBy("createdAt", "desc"));
    const unsubLink = onSnapshot(linkQ, (snapshot) => {
        const linksBody = document.getElementById('links-tbody');
        linksBody.innerHTML = '';
        snapshot.forEach(doc => {
            const data = doc.data();
            const date = data.createdAt ? data.createdAt.toDate().toLocaleDateString() : 'N/A';
            const statusClass = data.status === 'active' ? 'active' : 'inactive';
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><code>${data.token.substring(0,8)}...</code></td>
                <td>${date}</td>
                <td><span class="status-badge ${statusClass}">${data.status}</span></td>
                <td>
                    <button class="btn-text" onclick="copyLink('${data.token}')">Copy Link</button>
                    <button class="btn-text" style="margin-left:10px" onclick="toggleLinkStatus('${doc.id}', '${data.status}')">
                        ${data.status === 'active' ? 'Deactivate' : 'Activate'}
                    </button>
                    <button class="btn-text text-red" style="margin-left:10px" onclick="deleteLink('${doc.id}')" title="Delete Permanently">
                        <i class='bx bx-trash'></i>
                    </button>
                </td>
            `;
            linksBody.appendChild(tr);
        });
    });

    unsubscribeListeners.push(unsubReq, unsubSubj, unsubStud, unsubLink);
}

// ======================================================
// RENDER FUNCTIONS
// ======================================================

function renderDashRecentRequests() {
    const tbody = document.getElementById('dash-recent-requests');
    tbody.innerHTML = '';
    allRequests.slice(0, 5).forEach(req => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${req.studentName}</td>
            <td>${req.rollNumber}</td>
            <td><span class="status-badge ${req.status}">${req.status}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

function renderDashRecentStudents() {
    const tbody = document.getElementById('dash-recent-students');
    tbody.innerHTML = '';
    allStudents.slice(0, 5).forEach(s => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${s.name}</td>
            <td>${s.subjectName}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderRequestsTable() {
    const tbody = document.getElementById('requests-tbody');
    const filterStatus = document.getElementById('request-status-filter').value;
    const searchTerm = document.getElementById('global-search').value.toLowerCase();
    
    tbody.innerHTML = '';
    
    allRequests
        .filter(r => filterStatus === 'all' || r.status === filterStatus)
        .filter(r => r.studentName.toLowerCase().includes(searchTerm) || String(r.rollNumber).includes(searchTerm))
        .forEach(req => {
            const date = req.createdAt ? req.createdAt.toDate().toLocaleString() : 'N/A';
            const tr = document.createElement('tr');
            
            const isChecked = selectedRequests.has(req.id) ? 'checked' : '';
            const canSelect = req.status === 'pending';
            
            tr.innerHTML = `
                <td>
                    ${canSelect ? `<input type="checkbox" class="req-checkbox" data-id="${req.id}" ${isChecked}>` : ''}
                </td>
                <td><strong>${req.studentName}</strong></td>
                <td>${req.rollNumber}</td>
                <td>${date}</td>
                <td><span class="status-badge ${req.status}">${req.status}</span></td>
                <td>
                    ${req.status === 'pending' ? `
                        <button class="btn-outline btn-sm" onclick="singleAssign('${req.id}')">Assign</button>
                        <button class="btn-outline btn-sm text-red" onclick="rejectRequest('${req.id}')">Reject</button>
                    ` : `<span class="text-muted">Processed</span>`}
                </td>
            `;
            tbody.appendChild(tr);
        });

    attachCheckboxListeners();
}

function renderSubjectsTable() {
    const tbody = document.getElementById('subjects-tbody');
    tbody.innerHTML = '';
    allSubjects.forEach(sub => {
        const enrolledCount = allStudents.filter(s => s.subjectId === sub.id).length;
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

function updateSubjectSelects() {
    const selects = [
        document.getElementById('assign-subject-select'), 
        document.getElementById('link-subject-select'),
        document.getElementById('filter-subject')
    ];
    selects.forEach(select => {
        if(!select) return;
        
        const currentValue = select.value;
        select.innerHTML = select.id === 'filter-subject' ? '<option value="">All Subjects</option>' : '<option value="">-- Choose Subject --</option>';
        
        allSubjects.forEach(sub => {
            const opt = document.createElement('option');
            opt.value = sub.id;
            opt.textContent = sub.name;
            select.appendChild(opt);
        });
        
        select.value = currentValue;
    });
}

// ======================================================
// SMART ROLL SEQUENCE ENGINE
// ======================================================

function renderStudentsTable() {
    const tbody = document.getElementById('students-tbody');
    const searchTerm = document.getElementById('global-search').value.toLowerCase();
    const filterSubjectId = document.getElementById('filter-subject').value;
    
    tbody.innerHTML = '';

    // Sort numerically by roll number ascending
    const sortedStudents = [...allStudents].sort((a, b) => a.rollNumber - b.rollNumber);

    sortedStudents
        .filter(s => {
            const matchSearch = s.name.toLowerCase().includes(searchTerm) || String(s.rollNumber).includes(searchTerm);
            const matchSubject = filterSubjectId === "" || s.subjectId === filterSubjectId;
            return matchSearch && matchSubject;
        })
        .forEach((s, index) => {
            const isChecked = selectedStudents.has(s.id) ? 'checked' : '';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><input type="checkbox" class="student-checkbox" value="${s.id}" ${isChecked}></td>
                <td><strong class="text-green">#${index + 1}</strong></td>
                <td><strong>${s.name}</strong></td>
                <td>${s.rollNumber}</td>
                <td><span class="status-badge active">${s.subjectName}</span></td>
                <td>
                    <button class="btn-text" onclick="openEditStudent('${s.id}')" style="margin-right: 5px;">Edit</button>
                    <button class="btn-text text-red" onclick="removeStudent('${s.id}', '${s.requestId}')" title="Delete Permanently">Delete</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
}

// Trigger table render when filter changes
if(document.getElementById('filter-subject')) {
    document.getElementById('filter-subject').addEventListener('change', renderStudentsTable);
}

// Download PDF Logic
document.getElementById('btn-download-pdf').addEventListener('click', () => {
    const filterSubjectId = document.getElementById('filter-subject').value;
    const searchTerm = document.getElementById('global-search').value.toLowerCase();
    
    // Sort and filter students for PDF
    const sortedStudents = [...allStudents]
        .filter(s => {
            const matchSearch = s.name.toLowerCase().includes(searchTerm) || String(s.rollNumber).includes(searchTerm);
            const matchSubject = filterSubjectId === "" || s.subjectId === filterSubjectId;
            return matchSearch && matchSubject;
        })
        .sort((a, b) => a.rollNumber - b.rollNumber);

    if (sortedStudents.length === 0) {
        showToast("No students to download matching the current filters", "error");
        return;
    }

    // Initialize jsPDF
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    // Format data for autotable
    const tableData = sortedStudents.map((s, index) => [
        index + 1,
        s.name,
        s.rollNumber,
        s.subjectName
    ]);

    let title = "Students Enrollment Record";
    if (filterSubjectId) {
        const selectedSubject = allSubjects.find(sub => sub.id === filterSubjectId);
        if (selectedSubject) title += ` - ${selectedSubject.name}`;
    }

    doc.setFontSize(18);
    doc.text(title, 14, 22);
    
    // Generate Table
    doc.autoTable({
        startY: 30,
        head: [['Pos', 'Name', 'Roll No', 'Subject']],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: [79, 70, 229] }, // matches --primary color
        alternateRowStyles: { fillColor: [248, 250, 252] }
    });

    let filename = "students_record.pdf";
    if (filterSubjectId) {
        const selectedSubject = allSubjects.find(sub => sub.id === filterSubjectId);
        if (selectedSubject) filename = `${selectedSubject.name.replace(/\s+/g, '_')}_record.pdf`;
    }

    doc.save(filename);
    showToast("PDF downloaded successfully", "success");
});

function renderDigitChart() {
    const container = document.getElementById('digit-chart');
    container.innerHTML = '';
    
    const freq = {};
    for(let i=0; i<=9; i++) freq[i] = 0;
    
    allStudents.forEach(s => {
        const lastDigit = String(s.rollNumber).slice(-1);
        freq[lastDigit]++;
    });

    const maxVal = Math.max(...Object.values(freq), 1); // Avoid div by 0

    for(let i=0; i<=9; i++) {
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

function attachCheckboxListeners() {
    const selectAll = document.getElementById('select-all-requests');
    const checkboxes = document.querySelectorAll('.req-checkbox');
    const bulkBar = document.getElementById('bulk-action-bar');
    const bulkCount = document.getElementById('bulk-count');

    function updateBulkBar() {
        if(selectedRequests.size > 0) {
            bulkBar.classList.remove('hidden');
            bulkCount.textContent = `${selectedRequests.size} Selected`;
            if (currentTabStatus === 'pending') {
                document.getElementById('btn-bulk-assign').classList.remove('hidden');
            } else {
                document.getElementById('btn-bulk-assign').classList.add('hidden');
            }
        } else {
            bulkBar.classList.add('hidden');
        }
    };

    if(selectAll) {
        selectAll.addEventListener('change', (e) => {
            if(e.target.checked) {
                checkboxes.forEach(cb => {
                    cb.checked = true;
                    selectedRequests.add(cb.value);
                });
            } else {
                checkboxes.forEach(cb => {
                    cb.checked = false;
                    selectedRequests.delete(cb.value);
                });
            }
            updateBulkBar();
        });
    }

    checkboxes.forEach(cb => {
        cb.addEventListener('change', (e) => {
            if(e.target.checked) selectedRequests.add(e.target.value);
            else selectedRequests.delete(e.target.value);
            
            if(selectAll) selectAll.checked = (selectedRequests.size === checkboxes.length && checkboxes.length > 0);
            updateBulkBar();
        });
    });
}

// ======================================================
// ACTIONS (ASSIGN, REJECT, DELETE)
// ======================================================

window.singleAssign = (reqId) => {
    selectedRequests.clear();
    selectedRequests.add(reqId);
    document.getElementById('assign-count-text').textContent = "Assigning 1 student";
    openModal('modal-assign');
};

document.getElementById('btn-bulk-assign').addEventListener('click', () => {
    document.getElementById('assign-count-text').textContent = `Assigning ${selectedRequests.size} students`;
    openModal('modal-assign');
});

// Select All Students logic
let selectedStudents = new Set();
document.addEventListener('change', (e) => {
    if (e.target.id === 'select-all-students') {
        const checkboxes = document.querySelectorAll('.student-checkbox');
        selectedStudents.clear();
        if (e.target.checked) {
            checkboxes.forEach(cb => {
                cb.checked = true;
                selectedStudents.add(cb.value);
            });
        } else {
            checkboxes.forEach(cb => cb.checked = false);
        }
        updateStudentsBulkActionBar();
    } else if (e.target.classList.contains('student-checkbox')) {
        if (e.target.checked) {
            selectedStudents.add(e.target.value);
        } else {
            selectedStudents.delete(e.target.value);
        }
        const total = document.querySelectorAll('.student-checkbox').length;
        document.getElementById('select-all-students').checked = (selectedStudents.size === total && total > 0);
        updateStudentsBulkActionBar();
    }
});

function updateStudentsBulkActionBar() {
    const bar = document.getElementById('students-bulk-action-bar');
    const count = document.getElementById('students-selected-count');
    if(selectedStudents.size > 0) {
        bar.classList.remove('hidden');
        count.textContent = `${selectedStudents.size} selected`;
    } else {
        bar.classList.add('hidden');
    }
}

// Bulk Delete Students
document.getElementById('btn-bulk-delete-students').addEventListener('click', async () => {
    if(selectedStudents.size === 0) return;
    if(!confirm(`Are you sure you want to permanently delete ${selectedStudents.size} students? This cannot be undone.`)) return;
    
    try {
        const batch = writeBatch(db);
        selectedStudents.forEach(id => {
            batch.delete(doc(db, "students", id));
            const student = allStudents.find(s => s.id === id);
            if(student && student.requestId) {
                batch.delete(doc(db, "enrollmentRequests", student.requestId));
            }
        });
        await batch.commit();
        showToast(`Deleted ${selectedStudents.size} students permanently`, "success");
        selectedStudents.clear();
        document.getElementById('select-all-students').checked = false;
        document.getElementById('students-bulk-action-bar').classList.add('hidden');
    } catch(err) {
        showToast("Error deleting students", "error");
    }
});

// Bulk Delete Requests
document.getElementById('btn-bulk-delete').addEventListener('click', async () => {
    if(selectedRequests.size === 0) return;
    if(!confirm(`Are you sure you want to permanently delete ${selectedRequests.size} requests?`)) return;
    
    try {
        const batch = writeBatch(db);
        selectedRequests.forEach(id => {
            batch.delete(doc(db, "enrollmentRequests", id));
            // Also delete associated student if accepted
            const student = allStudents.find(s => s.requestId === id);
            if(student) {
                batch.delete(doc(db, "students", student.id));
            }
        });
        await batch.commit();
        showToast(`Deleted ${selectedRequests.size} requests permanently`, "success");
        selectedRequests.clear();
        document.getElementById('select-all-requests').checked = false;
        document.getElementById('bulk-action-bar').classList.add('hidden');
    } catch(err) {
        showToast("Error deleting requests", "error");
    }
});

window.deleteRequest = async (reqId) => {
    if(!confirm("Are you sure you want to permanently delete this request?")) return;
    try {
        const batch = writeBatch(db);
        batch.delete(doc(db, "enrollmentRequests", reqId));
        
        // Also delete associated student if accepted
        const student = allStudents.find(s => s.requestId === reqId);
        if(student) {
            batch.delete(doc(db, "students", student.id));
        }
        
        await batch.commit();
        showToast("Request deleted", "success");
    } catch(err) {
        showToast("Error deleting request", "error");
    }
};

// Form Assign Submission
document.getElementById('form-assign').addEventListener('submit', async (e) => {
    e.preventDefault();
    const subjId = document.getElementById('assign-subject-select').value;
    const subject = allSubjects.find(s => s.id === subjId);
    
    if(!subject || selectedRequests.size === 0) return;

    try {
        const batch = writeBatch(db);
        
        selectedRequests.forEach(reqId => {
            const req = allRequests.find(r => r.id === reqId);
            if(!req) return;

            // 1. Update Request
            const reqRef = doc(db, "enrollmentRequests", reqId);
            batch.update(reqRef, { 
                status: 'accepted', 
                acceptedAt: serverTimestamp(),
                assignedSubjectId: subject.id,
                assignedSubjectName: subject.name
            });

            // 2. Check Deduplication before adding Student
            const alreadyExists = allStudents.some(s => s.rollNumber === req.rollNumber && s.subjectId === subject.id);
            if (!alreadyExists) {
                const studRef = doc(collection(db, "students"));
                batch.set(studRef, {
                    requestId: reqId,
                    name: req.studentName,
                    rollNumber: req.rollNumber,
                    subjectId: subject.id,
                    subjectName: subject.name,
                    enrolledAt: serverTimestamp()
                });
            }
        });

        await batch.commit();
        closeModals();
        showToast(`Processed ${selectedRequests.size} requests successfully`, "success");
        selectedRequests.clear();
        document.getElementById('select-all-requests').checked = false;
        document.getElementById('bulk-action-bar').classList.add('hidden');
    } catch(err) {
        showToast("Error assigning students", "error");
    }
});

// Remove Student
window.removeStudent = async (studentId, requestId) => {
    if(!confirm("Are you sure you want to permanently delete this student? This action cannot be undone.")) return;
    try {
        const batch = writeBatch(db);
        batch.delete(doc(db, "students", studentId));
        if(requestId) {
            batch.delete(doc(db, "enrollmentRequests", requestId));
        }
        await batch.commit();
        showToast("Student deleted permanently", "success");
    } catch(err) {
        showToast("Error deleting student", "error");
    }
};

window.openEditStudent = (studentId) => {
    const student = allStudents.find(s => s.id === studentId);
    if (!student) return;
    
    document.getElementById('edit-student-id').value = student.id;
    document.getElementById('edit-request-id').value = student.requestId || '';
    document.getElementById('edit-student-name').value = student.name;
    document.getElementById('edit-student-roll').value = student.rollNumber;
    
    openModal('modal-edit-student');
};

document.getElementById('form-edit-student').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const id = document.getElementById('edit-student-id').value;
    const reqId = document.getElementById('edit-request-id').value;
    const newName = document.getElementById('edit-student-name').value.trim().toUpperCase();
    const newRoll = parseInt(document.getElementById('edit-student-roll').value.trim(), 10);
    
    if (!newName || isNaN(newRoll)) return;

    try {
        const batch = writeBatch(db);
        
        batch.update(doc(db, "students", id), {
            name: newName,
            rollNumber: newRoll
        });
        
        if (reqId) {
            batch.update(doc(db, "enrollmentRequests", reqId), {
                studentName: newName,
                rollNumber: newRoll
            });
        }
        
        await batch.commit();
        closeModals();
        showToast("Student updated successfully", "success");
    } catch(err) {
        console.error(err);
        showToast("Error updating student", "error");
    }
});

// ======================================================
// SUBJECT MANAGEMENT
// ======================================================

document.getElementById('btn-create-subject').addEventListener('click', () => {
    document.getElementById('form-subject').reset();
    openModal('modal-subject');
});

document.getElementById('form-subject').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('subj-name').value.trim();
    const desc = document.getElementById('subj-desc').value.trim();
    
    // Simple deduplication check client-side
    if(allSubjects.find(s => s.name.toLowerCase() === name.toLowerCase())) {
        showToast("A subject with this name already exists", "error");
        return;
    }

    try {
        await addDoc(collection(db, "subjects"), {
            name,
            description: desc,
            createdAt: serverTimestamp()
        });
        closeModals();
        showToast("Subject created successfully", "success");
    } catch(err) {
        showToast("Error creating subject", "error");
    }
});

window.deleteSubject = async (subjId, enrolledCount) => {
    if(enrolledCount > 0) {
        alert(`Cannot delete this subject. There are ${enrolledCount} students enrolled. Remove them first.`);
        return;
    }
    if(!confirm("Delete this subject?")) return;
    try {
        await deleteDoc(doc(db, "subjects", subjId));
        showToast("Subject deleted", "success");
    } catch(err) {
        showToast("Error deleting subject", "error");
    }
};

// ======================================================
// ENROLLMENT LINKS GENERATION
// ======================================================

function generateUniqueToken() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

const openGenerateModalHandler = () => {
    document.getElementById('link-subject-select').value = ""; // reset
    openModal('modal-generate-link');
};

const confirmGenerateLinkHandler = async () => {
    const token = generateUniqueToken();
    const subjId = document.getElementById('link-subject-select').value;
    const subject = allSubjects.find(s => s.id === subjId);
    
    if(!subject) {
        showToast("Please select a subject first", "error");
        return;
    }

    try {
        await addDoc(collection(db, "enrollmentLinks"), {
            token: token,
            status: "active",
            subjectId: subject.id,
            subjectName: subject.name,
            createdAt: serverTimestamp()
        });
        
        const baseUrl = window.location.origin + window.location.pathname;
        const fullUrl = `${baseUrl}?token=${token}`;
        
        closeModals();
        document.getElementById('generated-link-url').value = fullUrl;
        openModal('modal-link');
        
        showToast("Auto-assign link generated!", "success");
    } catch(error) {
        console.error(error);
        showToast("Error generating link. Is Firestore enabled?", "error");
    }
};

document.getElementById('btn-generate-link-dash').addEventListener('click', openGenerateModalHandler);
if (document.getElementById('btn-generate-link')) document.getElementById('btn-generate-link').addEventListener('click', openGenerateModalHandler);
if (document.getElementById('btn-generate-link-page')) document.getElementById('btn-generate-link-page').addEventListener('click', openGenerateModalHandler);

document.getElementById('btn-confirm-generate').addEventListener('click', confirmGenerateLinkHandler);

document.getElementById('btn-copy-link').addEventListener('click', () => {
    const input = document.getElementById('generated-link-url');
    input.select();
    document.execCommand('copy');
    showToast("Link copied to clipboard", "success");
});

window.copyLink = (token) => {
    const baseUrl = window.location.origin + window.location.pathname;
    const fullUrl = `${baseUrl}?token=${token}`;
    navigator.clipboard.writeText(fullUrl).then(() => {
        showToast("Link copied", "success");
    });
};

window.toggleLinkStatus = async (linkId, currentStatus) => {
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
    try {
        await updateDoc(doc(db, "enrollmentLinks", linkId), { status: newStatus });
        showToast(`Link ${newStatus} successfully`, "success");
    } catch(err) {
        showToast("Error updating link", "error");
    }
};

window.deleteLink = async (linkId) => {
    if (confirm("Are you sure you want to permanently delete this link?")) {
        try {
            await deleteDoc(doc(db, "enrollmentLinks", linkId));
            showToast("Link deleted permanently", "success");
        } catch(err) {
            console.error(err);
            showToast("Error deleting link", "error");
        }
    }
};

// ======================================================
// UTILITIES (Modals, Toasts, Search)
// ======================================================

function openModal(modalId) {
    document.getElementById('modal-backdrop').classList.remove('hidden');
    document.getElementById(modalId).classList.remove('hidden');
}

function closeModals() {
    document.getElementById('modal-backdrop').classList.add('hidden');
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
}

document.querySelectorAll('.close-modal, .close-modal-btn, .modal-backdrop').forEach(btn => {
    btn.addEventListener('click', closeModals);
});

function showToast(message, type = "success") {
    const container = document.getElementById('toast-container');
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

document.getElementById('global-search').addEventListener('input', () => {
    renderRequestsTable();
    renderStudentsTable();
});

document.getElementById('request-status-filter').addEventListener('change', () => {
    renderRequestsTable();
});
