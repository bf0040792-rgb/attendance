# School Management & Smart Enrollment Portal

This project has been upgraded and migrated:
1. **Backend Migration**: Shifted from **Firebase Firestore & Firebase Auth** to **Supabase (PostgreSQL, Realtime, & Auth)**.
2. **Language & Architecture Upgrade**: Shifted to **TypeScript** with strongly-typed data models, interfaces, and modular structure.

---

## 🚀 Features

- **Tokenized Student Enrollment**: Secure enrollment requests via auto-expiring or subject-specific tokens (`?token=...`).
- **Realtime Admin Dashboard**: Realtime sync via Supabase Realtime Channels (`postgres_changes`).
- **Subject Management**: Add and manage courses/subjects with student count tracking.
- **Smart Roll Sequence**: Auto-sorted roll numbering and digit-distribution analytics chart.
- **Bulk Operations**: Bulk assign students to subjects, bulk delete requests and students.
- **PDF Export**: Generate clean, formatted PDF records via jsPDF and jsPDF-autotable.
- **Supabase Authentication**: Secure admin login and session management via Supabase Auth.

---

## 🗄️ Supabase Database Architecture

The following tables are configured on Supabase:
- `public.subjects` - Subject name, description, created timestamp.
- `public.enrollment_links` - Unique tokens, link status, assigned subject details.
- `public.enrollment_requests` - Student name, roll number, token, status (`pending`, `accepted`, `rejected`), assigned subject.
- `public.enrolled_students` - Accepted student records linked to subjects and requests.

All tables have **Row Level Security (RLS)** configured and are published to `supabase_realtime`.

---

## 📁 Project Structure

```text
├── index.html              # Modern, responsive UI layout
├── style.css               # Clean dashboard and enrollment form styling
├── script.js               # Browser-ready ES module powered by Supabase
├── package.json            # Project dependencies and build scripts
├── tsconfig.json           # TypeScript configuration
├── src/
│   ├── types.ts            # TypeScript interfaces (Subject, EnrollmentRequest, etc.)
│   ├── supabaseClient.ts   # Supabase client connection
│   └── app.ts              # Strongly-typed TypeScript controller logic
└── README.md               # Project documentation
```

---

## 🛠️ TypeScript Development

To type-check or build from TypeScript source:

```bash
# Install dependencies
npm install

# Build TypeScript to dist/
npm run build

# Watch mode during development
npm run watch
```
