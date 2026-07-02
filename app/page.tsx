"use client";

import { useEffect, useMemo, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "../lib/firebase";

type ProjectStatus = "Belum Mulai" | "Proses" | "Menunggu" | "Hold" | "Selesai";
type ProjectPriority = "Rendah" | "Normal" | "Penting" | "Urgent";
type ActiveMenu = "dashboard" | "tambah" | "project" | "riwayat" | "settings";

type WorkProject = {
  id: string;
  userId: string;
  title: string;
  client: string;
  masukDate: string;
  deadlineDate: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  notes: string;
  createdAtText: string;
  createdAtMillis: number;
};

type ProjectNote = {
  id: string;
  projectId: string;
  noteDate: string;
  note: string;
  createdAtText: string;
  createdAtMillis: number;
};

type HistoryActivity = {
  id: string;
  type: "Project Dibuat" | "Project Selesai" | "Note Progress";
  title: string;
  projectId: string;
  projectTitle: string;
  client: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  activityDate: string;
  description: string;
  createdAtText: string;
  createdAtMillis: number;
};

const statusOptions: ProjectStatus[] = [
  "Belum Mulai",
  "Proses",
  "Menunggu",
  "Hold",
  "Selesai",
];

const priorityOptions: ProjectPriority[] = ["Rendah", "Normal", "Penting", "Urgent"];

const allowedUsernames = ["alya-kerja", "alya"];

const getTodayInputDate = () => {
  const today = new Date();
  const localDate = new Date(today.getTime() - today.getTimezoneOffset() * 60000);
  return localDate.toISOString().split("T")[0];
};

const usernameToEmail = (username: string) => `${username.trim().toLowerCase()}@office.local`;

const getUsernameFromEmail = (email?: string | null) => {
  if (!email) return "-";
  return email.split("@")[0];
};

const formatDateTime = (value: unknown) => {
  if (value instanceof Timestamp) {
    return value.toDate().toLocaleString("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  return "-";
};

const getDaysLeft = (deadlineDate: string) => {
  const today = new Date(getTodayInputDate()).getTime();
  const deadline = new Date(deadlineDate).getTime();
  return Math.ceil((deadline - today) / 86400000);
};

const getDeadlineLabel = (project: WorkProject) => {
  if (project.status === "Selesai") return "Selesai";

  const daysLeft = getDaysLeft(project.deadlineDate);
  if (daysLeft < 0) return `Lewat ${Math.abs(daysLeft)} hari`;
  if (daysLeft === 0) return "Deadline hari ini";
  return `H-${daysLeft}`;
};

const getDeadlineClass = (project: WorkProject) => {
  if (project.status === "Selesai") return "bg-emerald-100 text-emerald-700";

  const daysLeft = getDaysLeft(project.deadlineDate);
  if (daysLeft < 0) return "bg-red-100 text-red-700";
  if (daysLeft <= 3) return "bg-amber-100 text-amber-700";
  return "bg-blue-100 text-blue-700";
};

export default function Home() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [loginUsername, setLoginUsername] = useState("alya-kerja");
  const [loginPassword, setLoginPassword] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [activeMenu, setActiveMenu] = useState<ActiveMenu>("dashboard");
  const [isDarkMode, setIsDarkMode] = useState(true);

  const [projects, setProjects] = useState<WorkProject[]>([]);
  const [notes, setNotes] = useState<ProjectNote[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");

  const [title, setTitle] = useState("");
  const [client, setClient] = useState("");
  const [masukDate, setMasukDate] = useState(getTodayInputDate());
  const [deadlineDate, setDeadlineDate] = useState(getTodayInputDate());
  const [status, setStatus] = useState<ProjectStatus>("Belum Mulai");
  const [priority, setPriority] = useState<ProjectPriority>("Normal");
  const [projectNotes, setProjectNotes] = useState("");

  const [noteText, setNoteText] = useState("");
  const [noteDate, setNoteDate] = useState(getTodayInputDate());
  const [isSavingNote, setIsSavingNote] = useState(false);

  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<ProjectStatus | "">("");
  const [filterPriority, setFilterPriority] = useState<ProjectPriority | "">("");

  const username = getUsernameFromEmail(currentUser?.email);

  const pageBg = isDarkMode ? "bg-[#111214] text-white" : "bg-neutral-100 text-neutral-900";
  const cardBg = isDarkMode ? "bg-[#1A1C1F] text-white" : "bg-white text-neutral-900";
  const softCardBg = isDarkMode ? "bg-[#2A2D31]" : "bg-neutral-50";
  const borderColor = isDarkMode ? "border-[#2B2F34]" : "border-neutral-200";
  const mutedText = isDarkMode ? "text-[#B8BDC7]" : "text-neutral-500";
  const inputClass = isDarkMode
    ? "w-full rounded-2xl border border-[#3A3F45] bg-[#111214] px-4 py-3 text-white outline-none focus:border-[#A7F3D0]"
    : "w-full rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-neutral-900 outline-none focus:border-green-600";

  const selectedProject = projects.find((item) => item.id === selectedProjectId) ?? null;
  const selectedProjectNotes = notes
    .filter((item) => item.projectId === selectedProjectId)
    .sort((a, b) => b.createdAtMillis - a.createdAtMillis);

  const filteredProjects = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return projects.filter((project) => {
      const matchesSearch = normalizedSearch
        ? [project.title, project.client, project.notes, project.status, project.priority]
            .join(" ")
            .toLowerCase()
            .includes(normalizedSearch)
        : true;

      const matchesStatus = filterStatus ? project.status === filterStatus : true;
      const matchesPriority = filterPriority ? project.priority === filterPriority : true;

      return matchesSearch && matchesStatus && matchesPriority;
    });
  }, [projects, search, filterStatus, filterPriority]);

  const activeProjects = projects.filter((item) => item.status !== "Selesai");
  const doneProjects = projects.filter((item) => item.status === "Selesai");
  const nearDeadlineProjects = activeProjects.filter((item) => {
    const daysLeft = getDaysLeft(item.deadlineDate);
    return daysLeft >= 0 && daysLeft <= 3;
  });
  const overdueProjects = activeProjects.filter((item) => getDaysLeft(item.deadlineDate) < 0);

  const historyActivities = useMemo<HistoryActivity[]>(() => {
    const projectMap = new Map(projects.map((project) => [project.id, project]));

    const projectActivities = projects.map((project) => ({
      id: `project-${project.id}`,
      type: (project.status === "Selesai" ? "Project Selesai" : "Project Dibuat") as const,
      title: project.status === "Selesai" ? "Project ditandai selesai" : "Project dibuat",
      projectId: project.id,
      projectTitle: project.title,
      client: project.client,
      status: project.status,
      priority: project.priority,
      activityDate: project.createdAtText,
      description: project.notes || `Deadline ${project.deadlineDate}`,
      createdAtText: project.createdAtText,
      createdAtMillis: project.createdAtMillis,
    }));

    const noteActivities = notes.map((note) => {
      const project = projectMap.get(note.projectId);

      return {
        id: `note-${note.id}`,
        type: "Note Progress" as const,
        title: "Note progress ditambahkan",
        projectId: note.projectId,
        projectTitle: project?.title ?? "Project tidak ditemukan",
        client: project?.client ?? "",
        status: project?.status ?? "Belum Mulai",
        priority: project?.priority ?? "Normal",
        activityDate: note.noteDate,
        description: note.note,
        createdAtText: note.createdAtText,
        createdAtMillis: note.createdAtMillis,
      };
    });

    return [...noteActivities, ...projectActivities].sort(
      (a, b) => b.createdAtMillis - a.createdAtMillis
    );
  }, [projects, notes]);

  const resetForm = () => {
    setEditingProjectId("");
    setTitle("");
    setClient("");
    setMasukDate(getTodayInputDate());
    setDeadlineDate(getTodayInputDate());
    setStatus("Belum Mulai");
    setPriority("Normal");
    setProjectNotes("");
  };

  const fetchProjects = async () => {
    if (!currentUser) return;

    try {
      setIsLoadingProjects(true);

      const projectQuery = query(
        collection(db, "workProjects"),
        where("userId", "==", currentUser.uid)
      );

      const noteQuery = query(
        collection(db, "workProjectNotes"),
        where("userId", "==", currentUser.uid)
      );

      const [projectSnapshot, noteSnapshot] = await Promise.all([
        getDocs(projectQuery),
        getDocs(noteQuery),
      ]);

      const mappedProjects = projectSnapshot.docs
        .map((item) => {
          const data = item.data();

          return {
            id: item.id,
            userId: data.userId ?? "",
            title: data.title ?? "",
            client: data.client ?? "",
            masukDate: data.masukDate ?? "",
            deadlineDate: data.deadlineDate ?? "",
            status: (data.status ?? "Belum Mulai") as ProjectStatus,
            priority: (data.priority ?? "Normal") as ProjectPriority,
            notes: data.notes ?? "",
            createdAtText: formatDateTime(data.createdAt),
            createdAtMillis: data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : 0,
          };
        })
        .sort((a, b) => a.deadlineDate.localeCompare(b.deadlineDate));

      const mappedNotes = noteSnapshot.docs
        .map((item) => {
          const data = item.data();

          return {
            id: item.id,
            projectId: data.projectId ?? "",
            noteDate: data.noteDate ?? "",
            note: data.note ?? "",
            createdAtText: formatDateTime(data.createdAt),
            createdAtMillis: data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : 0,
          };
        })
        .sort((a, b) => b.createdAtMillis - a.createdAtMillis);

      setProjects(mappedProjects);
      setNotes(mappedNotes);

      if (!selectedProjectId && mappedProjects.length > 0) {
        setSelectedProjectId(mappedProjects[0].id);
      }
    } catch (error) {
      console.error(error);
      alert("Gagal mengambil data project. Cek Firestore Rules ya.");
    } finally {
      setIsLoadingProjects(false);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setIsCheckingAuth(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    fetchProjects();
  }, [currentUser?.uid]);

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const cleanUsername = loginUsername.trim().toLowerCase();

    if (!allowedUsernames.includes(cleanUsername)) {
      alert("Username belum diizinkan untuk aplikasi kerja.");
      return;
    }

    if (!loginPassword) {
      alert("Password wajib diisi.");
      return;
    }

    try {
      setIsLoggingIn(true);
      await signInWithEmailAndPassword(auth, usernameToEmail(cleanUsername), loginPassword);
    } catch (error) {
      console.error(error);
      alert("Login gagal. Cek username/password Firebase Auth.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const saveProject = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!currentUser) {
      alert("Login dulu ya.");
      return;
    }

    if (!title.trim()) {
      alert("Nama project wajib diisi.");
      return;
    }

    if (!deadlineDate) {
      alert("Deadline wajib diisi.");
      return;
    }

    try {
      setIsSaving(true);

      const payload = {
        userId: currentUser.uid,
        title: title.trim(),
        client: client.trim(),
        masukDate,
        deadlineDate,
        status,
        priority,
        notes: projectNotes.trim(),
        updatedAt: serverTimestamp(),
      };

      if (editingProjectId) {
        await updateDoc(doc(db, "workProjects", editingProjectId), payload);
        alert("Project berhasil diupdate.");
      } else {
        const created = await addDoc(collection(db, "workProjects"), {
          ...payload,
          createdAt: serverTimestamp(),
        });
        setSelectedProjectId(created.id);
        alert("Project berhasil disimpan.");
      }

      resetForm();
      setActiveMenu("project");
      await fetchProjects();
    } catch (error) {
      console.error(error);
      alert("Gagal menyimpan project.");
    } finally {
      setIsSaving(false);
    }
  };

  const startEditProject = (project: WorkProject) => {
    setEditingProjectId(project.id);
    setTitle(project.title);
    setClient(project.client);
    setMasukDate(project.masukDate);
    setDeadlineDate(project.deadlineDate);
    setStatus(project.status);
    setPriority(project.priority);
    setProjectNotes(project.notes);
    setActiveMenu("tambah");
  };

  const deleteProject = async (project: WorkProject) => {
    const ok = window.confirm(`Hapus project ${project.title}? Note project ini juga akan dihapus dari tampilan.`);
    if (!ok) return;

    try {
      await deleteDoc(doc(db, "workProjects", project.id));

      const relatedNotes = notes.filter((item) => item.projectId === project.id);
      await Promise.all(relatedNotes.map((item) => deleteDoc(doc(db, "workProjectNotes", item.id))));

      if (selectedProjectId === project.id) setSelectedProjectId("");
      await fetchProjects();
      alert("Project berhasil dihapus.");
    } catch (error) {
      console.error(error);
      alert("Gagal menghapus project.");
    }
  };

  const saveNote = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!currentUser || !selectedProject) {
      alert("Pilih project dulu ya.");
      return;
    }

    if (!noteText.trim()) {
      alert("Isi note dulu ya.");
      return;
    }

    try {
      setIsSavingNote(true);

      await addDoc(collection(db, "workProjectNotes"), {
        userId: currentUser.uid,
        projectId: selectedProject.id,
        projectTitle: selectedProject.title,
        noteDate,
        note: noteText.trim(),
        createdAt: serverTimestamp(),
      });

      setNoteText("");
      setNoteDate(getTodayInputDate());
      await fetchProjects();
    } catch (error) {
      console.error(error);
      alert("Gagal menyimpan note.");
    } finally {
      setIsSavingNote(false);
    }
  };

  const deleteNote = async (noteId: string) => {
    const ok = window.confirm("Hapus note ini?");
    if (!ok) return;

    try {
      await deleteDoc(doc(db, "workProjectNotes", noteId));
      await fetchProjects();
    } catch (error) {
      console.error(error);
      alert("Gagal menghapus note.");
    }
  };

  if (isCheckingAuth) {
    return <main className={`min-h-screen ${pageBg} p-6`}>Loading...</main>;
  }

  if (!currentUser) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#111214] p-6 text-white">
        <section className="w-full max-w-md rounded-[2rem] border border-[#2B2F34] bg-[#1A1C1F] p-6 shadow-2xl">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-3xl bg-[#A7F3D0] text-2xl">
              🗂️
            </div>
            <h1 className="text-2xl font-black">Office Tracker</h1>
            <p className="mt-1 text-sm text-[#B8BDC7]">Catat project, deadline, dan note kerjaan.</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-bold text-[#B8BDC7]">Username</label>
              <input
                value={loginUsername}
                onChange={(event) => setLoginUsername(event.target.value)}
                className="w-full rounded-2xl border border-[#3A3F45] bg-[#111214] px-4 py-3 text-white outline-none focus:border-[#A7F3D0]"
                placeholder="alya-kerja"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-[#B8BDC7]">Password</label>
              <input
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                type="password"
                className="w-full rounded-2xl border border-[#3A3F45] bg-[#111214] px-4 py-3 text-white outline-none focus:border-[#A7F3D0]"
                placeholder="Password Firebase Auth"
              />
            </div>

            <button
              disabled={isLoggingIn}
              className="w-full rounded-2xl bg-[#A7F3D0] px-4 py-3 font-black text-[#111214] disabled:opacity-60"
            >
              {isLoggingIn ? "Masuk..." : "Masuk"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className={`min-h-screen pb-28 ${pageBg}`}>
      <section className="mx-auto max-w-5xl px-4 py-5">
        <header className={`mb-4 rounded-[2rem] border ${borderColor} ${cardBg} p-5 shadow-sm`}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className={`text-xs font-bold uppercase tracking-wide ${mutedText}`}>Office Tracker</p>
              <h1 className="mt-1 text-2xl font-black">Hai, {username}</h1>
              <p className={`mt-1 text-sm ${mutedText}`}>Project kantor, deadline, dan note kerjaan.</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setIsDarkMode((current) => !current)}
                className={`rounded-2xl border ${borderColor} ${softCardBg} px-3 py-2 text-sm font-bold`}
              >
                {isDarkMode ? "☀️" : "🌙"}
              </button>
              <button
                onClick={() => signOut(auth)}
                className="rounded-2xl bg-red-100 px-3 py-2 text-sm font-bold text-red-700"
              >
                Logout
              </button>
            </div>
          </div>
        </header>

        {activeMenu === "dashboard" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                ["Project Aktif", activeProjects.length],
                ["Deadline Dekat", nearDeadlineProjects.length],
                ["Lewat Deadline", overdueProjects.length],
                ["Selesai", doneProjects.length],
              ].map(([label, value]) => (
                <div key={label} className={`rounded-[1.5rem] border ${borderColor} ${cardBg} p-4`}>
                  <p className={`text-xs font-bold ${mutedText}`}>{label}</p>
                  <p className="mt-2 text-3xl font-black">{value}</p>
                </div>
              ))}
            </div>

            <section className={`rounded-[2rem] border ${borderColor} ${cardBg} p-5`}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black">Deadline Terdekat</h2>
                  <p className={`text-sm ${mutedText}`}>Yang perlu dipantau duluan.</p>
                </div>
                <button
                  onClick={() => setActiveMenu("tambah")}
                  className="rounded-2xl bg-[#A7F3D0] px-4 py-2 text-sm font-black text-[#111214]"
                >
                  + Project
                </button>
              </div>

              {isLoadingProjects ? (
                <p className={mutedText}>Loading project...</p>
              ) : activeProjects.length === 0 ? (
                <p className={mutedText}>Belum ada project aktif.</p>
              ) : (
                <div className="space-y-3">
                  {[...activeProjects]
                    .sort((a, b) => a.deadlineDate.localeCompare(b.deadlineDate))
                    .slice(0, 5)
                    .map((project) => (
                      <button
                        key={project.id}
                        onClick={() => {
                          setSelectedProjectId(project.id);
                          setActiveMenu("project");
                        }}
                        className={`w-full rounded-3xl border ${borderColor} ${softCardBg} p-4 text-left`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="font-black">{project.title}</h3>
                            <p className={`mt-1 text-sm ${mutedText}`}>{project.client || "Tanpa client/divisi"}</p>
                            <p className={`mt-1 text-xs ${mutedText}`}>Masuk {project.masukDate} · Deadline {project.deadlineDate}</p>
                          </div>
                          <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${getDeadlineClass(project)}`}>
                            {getDeadlineLabel(project)}
                          </span>
                        </div>
                      </button>
                    ))}
                </div>
              )}
            </section>
          </div>
        ) : null}

        {activeMenu === "tambah" ? (
          <section className={`rounded-[2rem] border ${borderColor} ${cardBg} p-5`}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-black">{editingProjectId ? "Edit Project" : "Tambah Project"}</h2>
                <p className={`text-sm ${mutedText}`}>Isi tanggal masuk, deadline, status, prioritas, dan note.</p>
              </div>
              {editingProjectId ? (
                <button onClick={resetForm} className={`rounded-2xl border ${borderColor} px-3 py-2 text-sm font-bold`}>
                  Batal Edit
                </button>
              ) : null}
            </div>

            <form onSubmit={saveProject} className="space-y-4">
              <div>
                <label className={`mb-1 block text-xs font-bold ${mutedText}`}>Nama Project</label>
                <input value={title} onChange={(event) => setTitle(event.target.value)} className={inputClass} placeholder="Contoh: Report Bake NTF" />
              </div>

              <div>
                <label className={`mb-1 block text-xs font-bold ${mutedText}`}>Client / Divisi</label>
                <input value={client} onChange={(event) => setClient(event.target.value)} className={inputClass} placeholder="Contoh: BAKE / Finance / Atasan" />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className={`mb-1 block text-xs font-bold ${mutedText}`}>Tanggal Masuk Project</label>
                  <input type="date" value={masukDate} onChange={(event) => setMasukDate(event.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className={`mb-1 block text-xs font-bold ${mutedText}`}>Deadline</label>
                  <input type="date" value={deadlineDate} onChange={(event) => setDeadlineDate(event.target.value)} className={inputClass} />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className={`mb-1 block text-xs font-bold ${mutedText}`}>Status</label>
                  <select value={status} onChange={(event) => setStatus(event.target.value as ProjectStatus)} className={inputClass}>
                    {statusOptions.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </div>
                <div>
                  <label className={`mb-1 block text-xs font-bold ${mutedText}`}>Prioritas</label>
                  <select value={priority} onChange={(event) => setPriority(event.target.value as ProjectPriority)} className={inputClass}>
                    {priorityOptions.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className={`mb-1 block text-xs font-bold ${mutedText}`}>Note Awal</label>
                <textarea value={projectNotes} onChange={(event) => setProjectNotes(event.target.value)} className={`${inputClass} min-h-28`} placeholder="Catatan requirement, PIC, link, atau hal penting lainnya" />
              </div>

              <button disabled={isSaving} className="w-full rounded-2xl bg-[#A7F3D0] px-4 py-3 font-black text-[#111214] disabled:opacity-60">
                {isSaving ? "Menyimpan..." : editingProjectId ? "Update Project" : "Simpan Project"}
              </button>
            </form>
          </section>
        ) : null}

        {activeMenu === "project" ? (
          <section className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
            <div className={`rounded-[2rem] border ${borderColor} ${cardBg} p-5`}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black">Daftar Project</h2>
                  <p className={`text-sm ${mutedText}`}>{filteredProjects.length} project tampil</p>
                </div>
                <button onClick={fetchProjects} className={`rounded-2xl border ${borderColor} px-3 py-2 text-sm font-bold`}>Refresh</button>
              </div>

              <div className="mb-4 space-y-2">
                <input value={search} onChange={(event) => setSearch(event.target.value)} className={inputClass} placeholder="Cari project/client/note" />
                <div className="grid grid-cols-2 gap-2">
                  <select value={filterStatus} onChange={(event) => setFilterStatus(event.target.value as ProjectStatus | "")} className={inputClass}>
                    <option value="">Semua Status</option>
                    {statusOptions.map((item) => <option key={item}>{item}</option>)}
                  </select>
                  <select value={filterPriority} onChange={(event) => setFilterPriority(event.target.value as ProjectPriority | "")} className={inputClass}>
                    <option value="">Semua Prioritas</option>
                    {priorityOptions.map((item) => <option key={item}>{item}</option>)}
                  </select>
                </div>
              </div>

              <div className="space-y-3">
                {filteredProjects.length === 0 ? (
                  <p className={mutedText}>Project belum ada.</p>
                ) : (
                  filteredProjects.map((project) => (
                    <button
                      key={project.id}
                      onClick={() => setSelectedProjectId(project.id)}
                      className={`w-full rounded-3xl border p-4 text-left transition ${
                        selectedProjectId === project.id
                          ? "border-[#A7F3D0] bg-[#A7F3D0]/10"
                          : `${borderColor} ${softCardBg}`
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate font-black">{project.title}</h3>
                          <p className={`mt-1 truncate text-sm ${mutedText}`}>{project.client || "Tanpa client/divisi"}</p>
                          <p className={`mt-1 text-xs ${mutedText}`}>Deadline {project.deadlineDate}</p>
                        </div>
                        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${getDeadlineClass(project)}`}>
                          {getDeadlineLabel(project)}
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className={`rounded-[2rem] border ${borderColor} ${cardBg} p-5`}>
              {!selectedProject ? (
                <p className={mutedText}>Pilih project untuk lihat detail dan tambah note.</p>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-black">{selectedProject.title}</h2>
                      <p className={`mt-1 text-sm ${mutedText}`}>{selectedProject.client || "Tanpa client/divisi"}</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-black ${getDeadlineClass(selectedProject)}`}>
                      {getDeadlineLabel(selectedProject)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className={`rounded-2xl ${softCardBg} p-3`}>
                      <p className={`text-xs font-bold ${mutedText}`}>Tanggal Masuk</p>
                      <p className="font-black">{selectedProject.masukDate}</p>
                    </div>
                    <div className={`rounded-2xl ${softCardBg} p-3`}>
                      <p className={`text-xs font-bold ${mutedText}`}>Deadline</p>
                      <p className="font-black">{selectedProject.deadlineDate}</p>
                    </div>
                    <div className={`rounded-2xl ${softCardBg} p-3`}>
                      <p className={`text-xs font-bold ${mutedText}`}>Status</p>
                      <p className="font-black">{selectedProject.status}</p>
                    </div>
                    <div className={`rounded-2xl ${softCardBg} p-3`}>
                      <p className={`text-xs font-bold ${mutedText}`}>Prioritas</p>
                      <p className="font-black">{selectedProject.priority}</p>
                    </div>
                  </div>

                  {selectedProject.notes ? (
                    <div className={`rounded-3xl ${softCardBg} p-4`}>
                      <p className={`mb-1 text-xs font-bold ${mutedText}`}>Note Awal</p>
                      <p className="whitespace-pre-wrap text-sm leading-6">{selectedProject.notes}</p>
                    </div>
                  ) : null}

                  <div className="flex gap-2">
                    <button onClick={() => startEditProject(selectedProject)} className="flex-1 rounded-2xl bg-[#A7F3D0] px-4 py-3 font-black text-[#111214]">Edit</button>
                    <button onClick={() => deleteProject(selectedProject)} className="flex-1 rounded-2xl bg-red-100 px-4 py-3 font-black text-red-700">Hapus</button>
                  </div>

                  <form onSubmit={saveNote} className={`rounded-3xl border ${borderColor} ${softCardBg} p-4`}>
                    <h3 className="mb-3 font-black">Tambah Note Progress</h3>
                    <div className="space-y-3">
                      <input type="date" value={noteDate} onChange={(event) => setNoteDate(event.target.value)} className={inputClass} />
                      <textarea value={noteText} onChange={(event) => setNoteText(event.target.value)} className={`${inputClass} min-h-24`} placeholder="Contoh: sudah follow up, masih tunggu data, revisi bagian report..." />
                      <button disabled={isSavingNote} className="w-full rounded-2xl bg-[#A7F3D0] px-4 py-3 font-black text-[#111214] disabled:opacity-60">
                        {isSavingNote ? "Menyimpan..." : "Simpan Note"}
                      </button>
                    </div>
                  </form>

                  <div className="space-y-3">
                    <h3 className="font-black">Timeline Note</h3>
                    {selectedProjectNotes.length === 0 ? (
                      <p className={mutedText}>Belum ada note progress.</p>
                    ) : (
                      selectedProjectNotes.map((item) => (
                        <div key={item.id} className={`rounded-3xl border ${borderColor} ${softCardBg} p-4`}>
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <p className="font-black">{item.noteDate}</p>
                            <button onClick={() => deleteNote(item.id)} className="text-xs font-bold text-red-500">Hapus</button>
                          </div>
                          <p className="whitespace-pre-wrap text-sm leading-6">{item.note}</p>
                          <p className={`mt-2 text-xs ${mutedText}`}>{item.createdAtText}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>
        ) : null}

        {activeMenu === "riwayat" ? (
          <section className={`rounded-[2rem] border ${borderColor} ${cardBg} p-5`}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-black">Riwayat Aktivitas</h2>
                <p className={`text-sm ${mutedText}`}>
                  Timeline semua update project dan note progress.
                </p>
              </div>
              <button onClick={fetchProjects} className={`rounded-2xl border ${borderColor} px-3 py-2 text-sm font-bold`}>
                Refresh
              </button>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                ["Total Aktivitas", historyActivities.length],
                ["Note Progress", notes.length],
                ["Project Aktif", activeProjects.length],
                ["Project Selesai", doneProjects.length],
              ].map(([label, value]) => (
                <div key={label} className={`rounded-[1.5rem] border ${borderColor} ${softCardBg} p-4`}>
                  <p className={`text-xs font-bold ${mutedText}`}>{label}</p>
                  <p className="mt-2 text-2xl font-black">{value}</p>
                </div>
              ))}
            </div>

            {historyActivities.length === 0 ? (
              <p className={mutedText}>Belum ada riwayat aktivitas.</p>
            ) : (
              <div className="space-y-3">
                {historyActivities.map((activity) => (
                  <button
                    key={activity.id}
                    type="button"
                    onClick={() => {
                      if (activity.projectId) {
                        setSelectedProjectId(activity.projectId);
                        setActiveMenu("project");
                      }
                    }}
                    className={`w-full rounded-3xl border ${borderColor} ${softCardBg} p-4 text-left transition hover:border-[#A7F3D0]`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-[#A7F3D0] px-3 py-1 text-[10px] font-black text-[#111214]">
                            {activity.type}
                          </span>
                          <span
                            className={`rounded-full px-3 py-1 text-[10px] font-black ${
                              activity.status === "Selesai"
                                ? "bg-emerald-100 text-emerald-700"
                                : activity.status === "Hold"
                                ? "bg-neutral-200 text-neutral-700"
                                : activity.status === "Menunggu"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-blue-100 text-blue-700"
                            }`}
                          >
                            {activity.status}
                          </span>
                          <span className={`text-xs ${mutedText}`}>{activity.priority}</span>
                        </div>
                        <h3 className="font-black">{activity.projectTitle}</h3>
                        <p className={`mt-1 text-sm ${mutedText}`}>
                          {activity.client || "Tanpa client/divisi"} · {activity.activityDate || activity.createdAtText}
                        </p>
                        <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{activity.description}</p>
                        <p className={`mt-2 text-xs ${mutedText}`}>Dicatat: {activity.createdAtText}</p>
                      </div>
                      <span className="shrink-0 text-xl">{activity.type === "Note Progress" ? "📝" : activity.type === "Project Selesai" ? "✅" : "🗂️"}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        ) : null}

        {activeMenu === "settings" ? (
          <section className={`rounded-[2rem] border ${borderColor} ${cardBg} p-5`}>
            <h2 className="text-xl font-black">Settings</h2>
            <p className={`mt-1 text-sm ${mutedText}`}>Untuk versi awal, setting baru dark/light mode dan logout.</p>
            <div className="mt-4 grid gap-2 md:grid-cols-2">
              <button onClick={() => setIsDarkMode((current) => !current)} className={`rounded-2xl border ${borderColor} ${softCardBg} px-4 py-3 font-black`}>
                {isDarkMode ? "Aktifkan Light Mode" : "Aktifkan Dark Mode"}
              </button>
              <button onClick={() => signOut(auth)} className="rounded-2xl bg-red-100 px-4 py-3 font-black text-red-700">
                Logout
              </button>
            </div>
          </section>
        ) : null}
      </section>

      <nav className={`fixed bottom-0 left-0 right-0 z-50 border-t ${borderColor} ${isDarkMode ? "bg-[#141518]/95" : "bg-white/95"} backdrop-blur`}>
        <div className="mx-auto grid max-w-5xl grid-cols-5 gap-1 px-2 py-2">
          {[
            ["dashboard", "🏠", "Home"],
            ["tambah", "＋", "Tambah"],
            ["project", "🗂️", "Project"],
            ["riwayat", "🧾", "Riwayat"],
            ["settings", "⚙️", "Set"],
          ].map(([id, icon, label]) => (
            <button
              key={id}
              onClick={() => setActiveMenu(id as ActiveMenu)}
              className={`rounded-2xl px-2 py-2 text-xs font-black transition ${
                activeMenu === id
                  ? "bg-[#A7F3D0] text-[#111214]"
                  : isDarkMode
                  ? "text-[#B8BDC7]"
                  : "text-neutral-500"
              }`}
            >
              <div className="text-lg">{icon}</div>
              {label}
            </button>
          ))}
        </div>
      </nav>
    </main>
  );
}
