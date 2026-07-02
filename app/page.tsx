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
type ActiveMenu = "dashboard" | "tambah" | "project" | "riwayat" | "tugas" | "catatan" | "laporan" | "settings";

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

type WorkTask = {
  id: string;
  userId: string;
  projectId: string;
  title: string;
  taskDate: string;
  isDone: boolean;
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

const getDaysLeft = (deadlineDate?: string) => {
  if (!deadlineDate) return null;

  const today = new Date(getTodayInputDate()).getTime();
  const deadline = new Date(deadlineDate).getTime();

  if (!Number.isFinite(deadline)) return null;

  return Math.ceil((deadline - today) / 86400000);
};

const getDeadlineSortValue = (deadlineDate?: string) => {
  if (!deadlineDate) return Number.MAX_SAFE_INTEGER;

  const value = new Date(deadlineDate).getTime();
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
};

const formatDeadlineDate = (deadlineDate?: string) => {
  return deadlineDate ? deadlineDate : "Belum ada deadline";
};

const getDeadlineLabel = (project: WorkProject) => {
  if (project.status === "Selesai") return "Selesai";
  if (!project.deadlineDate) return "Tanpa deadline";

  const daysLeft = getDaysLeft(project.deadlineDate);
  if (daysLeft === null) return "Tanpa deadline";
  if (daysLeft < 0) return `Lewat ${Math.abs(daysLeft)} hari`;
  if (daysLeft === 0) return "Deadline hari ini";
  return `H-${daysLeft}`;
};

const getDeadlineClass = (project: WorkProject) => {
  if (project.status === "Selesai") return "bg-emerald-100 text-emerald-700";
  if (!project.deadlineDate) return "bg-neutral-100 text-neutral-700";

  const daysLeft = getDaysLeft(project.deadlineDate);
  if (daysLeft === null) return "bg-neutral-100 text-neutral-700";
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
  const [isNavigationMenuOpen, setIsNavigationMenuOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);

  const [projects, setProjects] = useState<WorkProject[]>([]);
  const [notes, setNotes] = useState<ProjectNote[]>([]);
  const [tasks, setTasks] = useState<WorkTask[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");

  const [title, setTitle] = useState("");
  const [client, setClient] = useState("");
  const [masukDate, setMasukDate] = useState(getTodayInputDate());
  const [deadlineDate, setDeadlineDate] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("Belum Mulai");
  const [priority, setPriority] = useState<ProjectPriority>("Normal");
  const [projectNotes, setProjectNotes] = useState("");

  const [noteText, setNoteText] = useState("");
  const [noteDate, setNoteDate] = useState(getTodayInputDate());
  const [isSavingNote, setIsSavingNote] = useState(false);

  const [catatanProjectId, setCatatanProjectId] = useState("");
  const [catatanText, setCatatanText] = useState("");
  const [catatanDate, setCatatanDate] = useState(getTodayInputDate());
  const [catatanSearch, setCatatanSearch] = useState("");
  const [catatanFilterProjectId, setCatatanFilterProjectId] = useState("");
  const [isSavingCatatan, setIsSavingCatatan] = useState(false);

  const [taskProjectId, setTaskProjectId] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDate, setTaskDate] = useState(getTodayInputDate());
  const [isSavingTask, setIsSavingTask] = useState(false);
  const [selectedHistoryProjectId, setSelectedHistoryProjectId] = useState("");

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

  const pendingTasks = tasks
    .filter((item) => !item.isDone)
    .sort((a, b) => a.taskDate.localeCompare(b.taskDate));

  const doneTasks = tasks
    .filter((item) => item.isDone)
    .sort((a, b) => b.createdAtMillis - a.createdAtMillis);

  const taskProjectOptions = projects.filter((item) => item.status !== "Selesai");

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
  const projectsWithDeadline = activeProjects.filter((item) => Boolean(item.deadlineDate));
  const projectsWithoutDeadline = activeProjects.filter((item) => !item.deadlineDate);
  const nearDeadlineProjects = projectsWithDeadline.filter((item) => {
    const daysLeft = getDaysLeft(item.deadlineDate);
    return daysLeft !== null && daysLeft >= 0 && daysLeft <= 3;
  });
  const overdueProjects = projectsWithDeadline.filter((item) => {
    const daysLeft = getDaysLeft(item.deadlineDate);
    return daysLeft !== null && daysLeft < 0;
  });

  const activityRows = useMemo(() => {
    const projectActivities = projects.map((project) => ({
      id: `project-${project.id}`,
      type: project.status === "Selesai" ? "Project Selesai" : "Project Dibuat",
      title: project.status === "Selesai" ? "Project ditandai selesai" : "Project dibuat",
      projectId: project.id,
      projectTitle: project.title,
      client: project.client,
      status: project.status,
      priority: project.priority,
      date: project.createdAtText,
      dateValue: project.createdAtMillis || new Date(project.masukDate).getTime(),
      note: project.notes,
      icon: project.status === "Selesai" ? "✅" : "🗂️",
    }));

    const noteActivities = notes.map((note) => {
      const project = projects.find((item) => item.id === note.projectId);

      return {
        id: `note-${note.id}`,
        type: "Note Progress",
        title: "Note progress ditambahkan",
        projectId: note.projectId,
        projectTitle: project?.title ?? "Project tidak ditemukan",
        client: project?.client ?? "",
        status: project?.status ?? "Belum Mulai",
        priority: project?.priority ?? "Normal",
        date: note.createdAtText,
        dateValue: note.createdAtMillis || new Date(note.noteDate).getTime(),
        note: note.note,
        icon: "📝",
      };
    });

    const taskActivities = tasks.map((task) => {
      const project = projects.find((item) => item.id === task.projectId);

      return {
        id: `task-${task.id}`,
        type: task.isDone ? "Tugas Selesai" : "Tugas Dibuat",
        title: task.isDone ? "Tugas ditandai selesai" : "Tugas ditambahkan",
        projectId: task.projectId,
        projectTitle: project?.title ?? "Project tidak ditemukan",
        client: project?.client ?? "",
        status: project?.status ?? "Belum Mulai",
        priority: project?.priority ?? "Normal",
        date: task.createdAtText,
        dateValue: task.createdAtMillis || new Date(task.taskDate).getTime(),
        note: task.title,
        icon: task.isDone ? "✅" : "☑️",
      };
    });

    return [...projectActivities, ...noteActivities, ...taskActivities].sort((a, b) => b.dateValue - a.dateValue);
  }, [projects, notes, tasks]);

  const filteredActivityRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return activityRows.filter((activity) => {
      const matchesSearch = normalizedSearch
        ? [
            activity.type,
            activity.title,
            activity.projectTitle,
            activity.client,
            activity.status,
            activity.priority,
            activity.note,
          ]
            .join(" ")
            .toLowerCase()
            .includes(normalizedSearch)
        : true;

      const matchesStatus = filterStatus ? activity.status === filterStatus : true;
      const matchesPriority = filterPriority ? activity.priority === filterPriority : true;

      return matchesSearch && matchesStatus && matchesPriority;
    });
  }, [activityRows, search, filterStatus, filterPriority]);

  const historyProjectRows = useMemo(() => {
    return filteredProjects
      .map((project) => {
        const projectActivities = activityRows.filter((activity) => activity.projectId === project.id);
        const lastActivity = [...projectActivities].sort((a, b) => b.dateValue - a.dateValue)[0];
        const noteCount = notes.filter((item) => item.projectId === project.id).length;
        const taskCount = tasks.filter((item) => item.projectId === project.id).length;
        const pendingCount = tasks.filter((item) => item.projectId === project.id && !item.isDone).length;

        return {
          ...project,
          activityCount: projectActivities.length,
          noteCount,
          taskCount,
          pendingCount,
          lastActivityText: lastActivity?.date ?? project.createdAtText,
          lastActivityValue: lastActivity?.dateValue ?? project.createdAtMillis,
        };
      })
      .sort((a, b) => b.lastActivityValue - a.lastActivityValue);
  }, [filteredProjects, activityRows, notes, tasks]);

  const selectedHistoryProject =
    projects.find((item) => item.id === selectedHistoryProjectId) ?? historyProjectRows[0] ?? null;

  const selectedHistoryActivities = selectedHistoryProject
    ? filteredActivityRows.filter((activity) => activity.projectId === selectedHistoryProject.id)
    : [];

  const reportProjectRows = filteredProjects.map((project) => {
    const projectTasks = tasks.filter((item) => item.projectId === project.id);
    const projectNotes = notes.filter((item) => item.projectId === project.id);
    const pendingCount = projectTasks.filter((item) => !item.isDone).length;
    const doneCount = projectTasks.filter((item) => item.isDone).length;

    return {
      ...project,
      deadlineLabel: getDeadlineLabel(project),
      totalTasks: projectTasks.length,
      pendingTasks: pendingCount,
      doneTasks: doneCount,
      totalNotes: projectNotes.length,
    };
  });

  const reportTaskRows = tasks
    .map((task) => {
      const project = projects.find((item) => item.id === task.projectId);

      return {
        ...task,
        projectTitle: project?.title ?? "Project tidak ditemukan",
        client: project?.client ?? "",
        projectStatus: project?.status ?? "Belum Mulai",
        projectPriority: project?.priority ?? "Normal",
      };
    })
    .filter((task) => {
      const normalizedSearch = search.trim().toLowerCase();
      const matchesSearch = normalizedSearch
        ? [task.title, task.projectTitle, task.client, task.projectStatus, task.projectPriority]
            .join(" ")
            .toLowerCase()
            .includes(normalizedSearch)
        : true;
      const matchesStatus = filterStatus ? task.projectStatus === filterStatus : true;
      const matchesPriority = filterPriority ? task.projectPriority === filterPriority : true;

      return matchesSearch && matchesStatus && matchesPriority;
    })
    .sort((a, b) => a.taskDate.localeCompare(b.taskDate));

  const reportNoteRows = notes
    .map((note) => {
      const project = projects.find((item) => item.id === note.projectId);

      return {
        ...note,
        projectTitle: project?.title ?? "Project tidak ditemukan",
        client: project?.client ?? "",
        projectStatus: project?.status ?? "Belum Mulai",
        projectPriority: project?.priority ?? "Normal",
      };
    })
    .filter((note) => {
      const normalizedSearch = search.trim().toLowerCase();
      const matchesSearch = normalizedSearch
        ? [note.note, note.projectTitle, note.client, note.projectStatus, note.projectPriority]
            .join(" ")
            .toLowerCase()
            .includes(normalizedSearch)
        : true;
      const matchesStatus = filterStatus ? note.projectStatus === filterStatus : true;
      const matchesPriority = filterPriority ? note.projectPriority === filterPriority : true;

      return matchesSearch && matchesStatus && matchesPriority;
    })
    .sort((a, b) => b.createdAtMillis - a.createdAtMillis);

  const catatanRows = useMemo(() => {
    const normalizedSearch = catatanSearch.trim().toLowerCase();

    return notes
      .map((note) => {
        const project = projects.find((item) => item.id === note.projectId);

        return {
          ...note,
          projectTitle: project?.title ?? "Project tidak ditemukan",
          client: project?.client ?? "",
          projectStatus: project?.status ?? "Belum Mulai",
          projectPriority: project?.priority ?? "Normal",
        };
      })
      .filter((note) => {
        const matchesProject = catatanFilterProjectId ? note.projectId === catatanFilterProjectId : true;
        const matchesSearch = normalizedSearch
          ? [note.note, note.projectTitle, note.client, note.projectStatus, note.projectPriority, note.noteDate]
              .join(" ")
              .toLowerCase()
              .includes(normalizedSearch)
          : true;

        return matchesProject && matchesSearch;
      })
      .sort((a, b) => b.createdAtMillis - a.createdAtMillis);
  }, [notes, projects, catatanSearch, catatanFilterProjectId]);

  const selectedCatatanProject = projects.find((item) => item.id === catatanProjectId) ?? null;

  const reportSummaryRows = [
    { label: "Total Project", value: filteredProjects.length },
    { label: "Project Aktif", value: filteredProjects.filter((item) => item.status !== "Selesai").length },
    { label: "Project Selesai", value: filteredProjects.filter((item) => item.status === "Selesai").length },
    { label: "Deadline Dekat", value: filteredProjects.filter((item) => { const daysLeft = getDaysLeft(item.deadlineDate); return item.status !== "Selesai" && daysLeft !== null && daysLeft >= 0 && daysLeft <= 3; }).length },
    { label: "Lewat Deadline", value: filteredProjects.filter((item) => { const daysLeft = getDaysLeft(item.deadlineDate); return item.status !== "Selesai" && daysLeft !== null && daysLeft < 0; }).length },
    { label: "Tugas Pending", value: reportTaskRows.filter((item) => !item.isDone).length },
    { label: "Tugas Selesai", value: reportTaskRows.filter((item) => item.isDone).length },
    { label: "Total Note", value: reportNoteRows.length },
  ];

  const resetForm = () => {
    setEditingProjectId("");
    setTitle("");
    setClient("");
    setMasukDate(getTodayInputDate());
    setDeadlineDate("");
    setStatus("Belum Mulai");
    setPriority("Normal");
    setProjectNotes("");
  };

  const openMenuPage = (menuId: ActiveMenu) => {
    setActiveMenu(menuId);
    setIsNavigationMenuOpen(false);

    window.setTimeout(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 0);
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

      const taskQuery = query(
        collection(db, "workProjectTasks"),
        where("userId", "==", currentUser.uid)
      );

      const [projectSnapshot, noteSnapshot, taskSnapshot] = await Promise.all([
        getDocs(projectQuery),
        getDocs(noteQuery),
        getDocs(taskQuery),
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
        .sort((a, b) => getDeadlineSortValue(a.deadlineDate) - getDeadlineSortValue(b.deadlineDate));

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

      const mappedTasks = taskSnapshot.docs
        .map((item) => {
          const data = item.data();

          return {
            id: item.id,
            userId: data.userId ?? "",
            projectId: data.projectId ?? "",
            title: data.title ?? "",
            taskDate: data.taskDate ?? "",
            isDone: Boolean(data.isDone),
            createdAtText: formatDateTime(data.createdAt),
            createdAtMillis: data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : 0,
          };
        })
        .sort((a, b) => a.taskDate.localeCompare(b.taskDate));

      setProjects(mappedProjects);
      setNotes(mappedNotes);
      setTasks(mappedTasks);

      if (!selectedProjectId && mappedProjects.length > 0) {
        setSelectedProjectId(mappedProjects[0].id);
      }

      if (!taskProjectId && mappedProjects.length > 0) {
        setTaskProjectId(mappedProjects[0].id);
      }

      if (!catatanProjectId && mappedProjects.length > 0) {
        setCatatanProjectId(mappedProjects[0].id);
      }

      if (!selectedHistoryProjectId && mappedProjects.length > 0) {
        setSelectedHistoryProjectId(mappedProjects[0].id);
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

    try {
      setIsSaving(true);

      const payload = {
        userId: currentUser.uid,
        title: title.trim(),
        client: client.trim(),
        masukDate,
        deadlineDate: deadlineDate || "",
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

  const saveCatatan = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!currentUser) {
      alert("Login dulu ya.");
      return;
    }

    const targetProject = projects.find((item) => item.id === catatanProjectId);

    if (!targetProject) {
      alert("Pilih project untuk catatan ini dulu ya.");
      return;
    }

    if (!catatanText.trim()) {
      alert("Isi catatan dulu ya.");
      return;
    }

    try {
      setIsSavingCatatan(true);

      await addDoc(collection(db, "workProjectNotes"), {
        userId: currentUser.uid,
        projectId: targetProject.id,
        projectTitle: targetProject.title,
        noteDate: catatanDate,
        note: catatanText.trim(),
        createdAt: serverTimestamp(),
      });

      setCatatanText("");
      setCatatanDate(getTodayInputDate());
      await fetchProjects();
      alert("Catatan berhasil disimpan.");
    } catch (error) {
      console.error(error);
      alert("Gagal menyimpan catatan.");
    } finally {
      setIsSavingCatatan(false);
    }
  };

  const saveTask = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!currentUser) {
      alert("Login dulu ya.");
      return;
    }

    if (!taskProjectId) {
      alert("Pilih project dulu ya.");
      return;
    }

    if (!taskTitle.trim()) {
      alert("Isi pekerjaan dulu ya.");
      return;
    }

    try {
      setIsSavingTask(true);

      await addDoc(collection(db, "workProjectTasks"), {
        userId: currentUser.uid,
        projectId: taskProjectId,
        title: taskTitle.trim(),
        taskDate,
        isDone: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setTaskTitle("");
      setTaskDate(getTodayInputDate());
      await fetchProjects();
    } catch (error) {
      console.error(error);
      alert("Gagal menyimpan pekerjaan.");
    } finally {
      setIsSavingTask(false);
    }
  };

  const toggleTaskDone = async (task: WorkTask) => {
    try {
      await updateDoc(doc(db, "workProjectTasks", task.id), {
        isDone: !task.isDone,
        updatedAt: serverTimestamp(),
      });
      await fetchProjects();
    } catch (error) {
      console.error(error);
      alert("Gagal mengubah status pekerjaan.");
    }
  };

  const deleteTask = async (taskId: string) => {
    const ok = window.confirm("Hapus pekerjaan ini?");
    if (!ok) return;

    try {
      await deleteDoc(doc(db, "workProjectTasks", taskId));
      await fetchProjects();
    } catch (error) {
      console.error(error);
      alert("Gagal menghapus pekerjaan.");
    }
  };

  const escapeReportCell = (value: unknown) => {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;");
  };

  const buildExcelWorksheet = (name: string, rows: (string | number | boolean | null | undefined)[][]) => {
    const safeName = escapeReportCell(name);
    const tableRows = rows
      .map((row, rowIndex) => {
        const cells = row
          .map((cell) => {
            const isNumber = typeof cell === "number" && Number.isFinite(cell);
            const styleAttribute = rowIndex === 0 ? ' ss:StyleID="Header"' : "";
            return `<Cell${styleAttribute}><Data ss:Type="${isNumber ? "Number" : "String"}">${escapeReportCell(cell)}</Data></Cell>`;
          })
          .join("");

        return `<Row>${cells}</Row>`;
      })
      .join("");

    return `<Worksheet ss:Name="${safeName}"><Table>${tableRows}</Table></Worksheet>`;
  };

  const exportExcelReport = () => {
    const generatedAt = new Date().toLocaleString("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    });

    const excelStyles = `
      <Styles>
        <Style ss:ID="Header">
          <Font ss:Bold="1"/>
          <Interior ss:Color="#E5E7EB" ss:Pattern="Solid"/>
        </Style>
      </Styles>`;

    const worksheets = [
      buildExcelWorksheet("Ringkasan", [
        ["Office Tracker"],
        ["User", username],
        ["Dibuat", generatedAt],
        ["Filter Search", search || "Semua"],
        ["Filter Status", filterStatus || "Semua"],
        ["Filter Prioritas", filterPriority || "Semua"],
        [],
        ["Metrik", "Jumlah"],
        ...reportSummaryRows.map((row) => [row.label, row.value]),
      ]),
      buildExcelWorksheet("Project", [
        ["Nama Project", "Client/Divisi", "Tanggal Masuk", "Deadline", "Status", "Prioritas", "Deadline Info", "Total Tugas", "Pending", "Selesai", "Total Note", "Note Awal"],
        ...reportProjectRows.map((project) => [
          project.title,
          project.client || "-",
          project.masukDate,
          formatDeadlineDate(project.deadlineDate),
          project.status,
          project.priority,
          project.deadlineLabel,
          project.totalTasks,
          project.pendingTasks,
          project.doneTasks,
          project.totalNotes,
          project.notes || "-",
        ]),
      ]),
      buildExcelWorksheet("Tugas", [
        ["Target Tanggal", "Project", "Client/Divisi", "Pekerjaan", "Status Tugas", "Status Project", "Prioritas Project", "Dibuat"],
        ...reportTaskRows.map((task) => [
          task.taskDate,
          task.projectTitle,
          task.client || "-",
          task.title,
          task.isDone ? "Selesai" : "Pending",
          task.projectStatus,
          task.projectPriority,
          task.createdAtText,
        ]),
      ]),
      buildExcelWorksheet("Note Progress", [
        ["Tanggal Note", "Project", "Client/Divisi", "Note", "Status Project", "Prioritas Project", "Dibuat"],
        ...reportNoteRows.map((note) => [
          note.noteDate,
          note.projectTitle,
          note.client || "-",
          note.note,
          note.projectStatus,
          note.projectPriority,
          note.createdAtText,
        ]),
      ]),
      buildExcelWorksheet("Riwayat", [
        ["Tanggal", "Jenis Aktivitas", "Project", "Client/Divisi", "Judul", "Catatan", "Status", "Prioritas"],
        ...filteredActivityRows.map((activity) => [
          activity.date,
          activity.type,
          activity.projectTitle,
          activity.client || "-",
          activity.title,
          activity.note || "-",
          activity.status,
          activity.priority,
        ]),
      ]),
    ];

    const workbook = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  ${excelStyles}
  ${worksheets.join("\n")}
</Workbook>`;

    const blob = new Blob([workbook], {
      type: "application/vnd.ms-excel;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `office-tracker-report-${getTodayInputDate()}.xls`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const printReport = () => {
    const generatedAt = new Date().toLocaleString("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    });

    const summaryCards = reportSummaryRows
      .map(
        (row) => `
          <div class="summary-card">
            <div class="summary-label">${escapeReportCell(row.label)}</div>
            <div class="summary-value">${escapeReportCell(row.value)}</div>
          </div>
        `
      )
      .join("");

    const projectRows = reportProjectRows
      .map(
        (project) => `
          <tr>
            <td>${escapeReportCell(project.title)}</td>
            <td>${escapeReportCell(project.client || "-")}</td>
            <td>${escapeReportCell(project.masukDate)}</td>
            <td>${escapeReportCell(formatDeadlineDate(project.deadlineDate))}</td>
            <td>${escapeReportCell(project.status)}</td>
            <td>${escapeReportCell(project.priority)}</td>
            <td>${escapeReportCell(project.deadlineLabel)}</td>
            <td class="number">${escapeReportCell(project.pendingTasks)}/${escapeReportCell(project.totalTasks)}</td>
            <td class="number">${escapeReportCell(project.totalNotes)}</td>
          </tr>
        `
      )
      .join("");

    const taskRows = reportTaskRows
      .map(
        (task) => `
          <tr>
            <td>${escapeReportCell(task.taskDate)}</td>
            <td>${escapeReportCell(task.projectTitle)}</td>
            <td>${escapeReportCell(task.title)}</td>
            <td>${escapeReportCell(task.isDone ? "Selesai" : "Pending")}</td>
            <td>${escapeReportCell(task.projectStatus)}</td>
            <td>${escapeReportCell(task.projectPriority)}</td>
          </tr>
        `
      )
      .join("");

    const noteRows = reportNoteRows
      .map(
        (note) => `
          <tr>
            <td>${escapeReportCell(note.noteDate)}</td>
            <td>${escapeReportCell(note.projectTitle)}</td>
            <td>${escapeReportCell(note.note)}</td>
            <td>${escapeReportCell(note.projectStatus)}</td>
            <td>${escapeReportCell(note.projectPriority)}</td>
          </tr>
        `
      )
      .join("");

    const html = `
      <!doctype html>
      <html lang="id">
        <head>
          <meta charset="utf-8" />
          <title>Laporan Office Tracker</title>
          <style>
            @page { size: A4; margin: 14mm; }
            * { box-sizing: border-box; }
            body { margin: 0; color: #111827; font-family: Arial, Helvetica, sans-serif; background: #fff; font-size: 12px; }
            .header { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #111827; padding-bottom: 12px; margin-bottom: 14px; }
            .app-name { font-size: 11px; color: #6b7280; margin: 0 0 4px; }
            h1 { font-size: 22px; margin: 0; }
            h2 { font-size: 15px; margin: 18px 0 8px; }
            .meta { text-align: right; color: #374151; line-height: 1.6; }
            .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 14px 0; }
            .summary-card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 10px; background: #f9fafb; }
            .summary-label { color: #6b7280; font-size: 10px; margin-bottom: 5px; }
            .summary-value { font-weight: 800; font-size: 17px; }
            table { width: 100%; border-collapse: collapse; margin-top: 8px; }
            thead { display: table-header-group; }
            th { text-align: left; background: #111827; color: #fff; padding: 8px; font-size: 10px; border: 1px solid #111827; }
            td { padding: 7px; border: 1px solid #e5e7eb; vertical-align: top; }
            .number { text-align: right; white-space: nowrap; }
            .print-actions { position: fixed; right: 16px; bottom: 16px; display: flex; gap: 8px; }
            .print-actions button { border: 0; border-radius: 999px; background: #111827; color: #fff; padding: 10px 14px; cursor: pointer; font-weight: 800; }
            @media print { .print-actions { display: none; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
          </style>
        </head>
        <body>
          <div class="header">
            <div>
              <p class="app-name">Office Tracker</p>
              <h1>Laporan Project Kerja</h1>
            </div>
            <div class="meta">
              <div><b>${escapeReportCell(username)}</b></div>
              <div>Dibuat: ${escapeReportCell(generatedAt)}</div>
              <div>Filter: ${escapeReportCell([search ? `Cari ${search}` : "", filterStatus ? `Status ${filterStatus}` : "", filterPriority ? `Prioritas ${filterPriority}` : ""].filter(Boolean).join(" · ") || "Semua data")}</div>
            </div>
          </div>

          <div class="summary-grid">${summaryCards}</div>

          <h2>Daftar Project</h2>
          <table>
            <thead>
              <tr><th>Project</th><th>Client/Divisi</th><th>Masuk</th><th>Deadline</th><th>Status</th><th>Prioritas</th><th>Info</th><th>Tugas</th><th>Note</th></tr>
            </thead>
            <tbody>${projectRows || `<tr><td colspan="9">Belum ada project.</td></tr>`}</tbody>
          </table>

          <h2>Daftar Tugas</h2>
          <table>
            <thead>
              <tr><th>Target</th><th>Project</th><th>Pekerjaan</th><th>Status Tugas</th><th>Status Project</th><th>Prioritas</th></tr>
            </thead>
            <tbody>${taskRows || `<tr><td colspan="6">Belum ada tugas.</td></tr>`}</tbody>
          </table>

          <h2>Note Progress</h2>
          <table>
            <thead>
              <tr><th>Tanggal</th><th>Project</th><th>Note</th><th>Status Project</th><th>Prioritas</th></tr>
            </thead>
            <tbody>${noteRows || `<tr><td colspan="5">Belum ada note.</td></tr>`}</tbody>
          </table>

          <div class="print-actions">
            <button onclick="window.print()">Cetak / Simpan PDF</button>
            <button onclick="window.close()">Tutup</button>
          </div>
        </body>
      </html>
    `;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      alert("Popup diblokir browser. Izinkan popup dulu ya.");
      return;
    }

    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
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
              <p className={`mt-1 text-sm ${mutedText}`}>Project kantor, deadline, tugas, dan catatan kerjaan.</p>
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
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {[
                ["Project Aktif", activeProjects.length],
                ["Deadline Dekat", nearDeadlineProjects.length],
                ["Lewat Deadline", overdueProjects.length],
                ["Tugas Pending", pendingTasks.length],
                ["Tanpa Deadline", projectsWithoutDeadline.length],
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
                    .sort((a, b) => getDeadlineSortValue(a.deadlineDate) - getDeadlineSortValue(b.deadlineDate))
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
                            <p className={`mt-1 text-xs ${mutedText}`}>Masuk {project.masukDate} · Deadline {formatDeadlineDate(project.deadlineDate)}</p>
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
                <p className={`text-sm ${mutedText}`}>Isi tanggal masuk, status, prioritas, note, dan deadline kalau memang ada.</p>
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
                  <label className={`mb-1 block text-xs font-bold ${mutedText}`}>Deadline <span className="font-normal">(opsional)</span></label>
                  <div className="flex gap-2">
                    <input type="date" value={deadlineDate} onChange={(event) => setDeadlineDate(event.target.value)} className={inputClass} />
                    {deadlineDate ? (
                      <button type="button" onClick={() => setDeadlineDate("")} className={`shrink-0 rounded-2xl border ${borderColor} px-3 py-2 text-xs font-black`}>
                        Kosongkan
                      </button>
                    ) : null}
                  </div>
                  <p className={`mt-1 text-xs ${mutedText}`}>Boleh dikosongkan kalau project belum punya deadline.</p>
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
                          <p className={`mt-1 text-xs ${mutedText}`}>Deadline {formatDeadlineDate(project.deadlineDate)}</p>
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
                      <p className="font-black">{formatDeadlineDate(selectedProject.deadlineDate)}</p>
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
          <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <div className={`rounded-[2rem] border ${borderColor} ${cardBg} p-5`}>
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-xl font-black">Riwayat per Project</h2>
                  <p className={`text-sm ${mutedText}`}>Pilih main project dulu, baru lihat semua riwayatnya.</p>
                </div>
                <button onClick={fetchProjects} className={`rounded-2xl border ${borderColor} px-3 py-2 text-sm font-bold`}>Refresh</button>
              </div>

              <div className="mb-4 space-y-2">
                <input value={search} onChange={(event) => setSearch(event.target.value)} className={inputClass} placeholder="Cari project/client/status" />
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

              {historyProjectRows.length === 0 ? (
                <div className={`rounded-3xl border ${borderColor} ${softCardBg} p-5 text-center`}>
                  <p className="font-black">Belum ada project.</p>
                  <p className={`mt-1 text-sm ${mutedText}`}>Project yang dibuat akan muncul di sini.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {historyProjectRows.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => setSelectedHistoryProjectId(project.id)}
                      className={`w-full rounded-3xl border p-4 text-left transition ${
                        selectedHistoryProject?.id === project.id
                          ? "border-[#A7F3D0] bg-[#A7F3D0]/10"
                          : `${borderColor} ${softCardBg}`
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate font-black">{project.title}</h3>
                          <p className={`mt-1 truncate text-sm ${mutedText}`}>{project.client || "Tanpa client/divisi"}</p>
                          <p className={`mt-1 text-xs ${mutedText}`}>Aktivitas terakhir: {project.lastActivityText}</p>
                        </div>
                        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${getDeadlineClass(project)}`}>
                          {getDeadlineLabel(project)}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className={`rounded-full ${softCardBg} px-3 py-1 text-xs font-bold`}>{project.activityCount} aktivitas</span>
                        <span className={`rounded-full ${softCardBg} px-3 py-1 text-xs font-bold`}>{project.noteCount} note</span>
                        <span className={`rounded-full ${softCardBg} px-3 py-1 text-xs font-bold`}>{project.pendingCount}/{project.taskCount} tugas pending</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className={`rounded-[2rem] border ${borderColor} ${cardBg} p-5`}>
              {!selectedHistoryProject ? (
                <p className={mutedText}>Pilih project untuk lihat riwayatnya.</p>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-black">{selectedHistoryProject.title}</h2>
                      <p className={`mt-1 text-sm ${mutedText}`}>Riwayat note, tugas, dan perubahan utama project ini.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedProjectId(selectedHistoryProject.id);
                        setActiveMenu("project");
                      }}
                      className="rounded-2xl bg-[#A7F3D0] px-4 py-2 text-sm font-black text-[#111214]"
                    >
                      Buka Detail
                    </button>
                  </div>

                  {selectedHistoryActivities.length === 0 ? (
                    <div className={`rounded-3xl border ${borderColor} ${softCardBg} p-5 text-center`}>
                      <p className="font-black">Belum ada riwayat untuk project ini.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {selectedHistoryActivities.map((activity) => (
                        <div key={activity.id} className={`rounded-3xl border ${borderColor} ${softCardBg} p-4`}>
                          <div className="flex items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#A7F3D0] text-lg text-[#111214]">
                              {activity.icon}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full bg-[#A7F3D0]/20 px-3 py-1 text-[11px] font-black text-[#A7F3D0]">
                                  {activity.type}
                                </span>
                                <span className={`text-xs ${mutedText}`}>{activity.date}</span>
                              </div>
                              <h3 className="mt-2 font-black">{activity.title}</h3>
                              {activity.note ? (
                                <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{activity.note}</p>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        ) : null}

        {activeMenu === "tugas" ? (
          <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <div className={`rounded-[2rem] border ${borderColor} ${cardBg} p-5`}>
              <div className="mb-4">
                <h2 className="text-xl font-black">Rencana Kerja</h2>
                <p className={`text-sm ${mutedText}`}>Catat pekerjaan kecil yang akan dikerjakan untuk setiap project.</p>
              </div>

              <form onSubmit={saveTask} className="space-y-4">
                <div>
                  <label className={`mb-1 block text-xs font-bold ${mutedText}`}>Project</label>
                  <select value={taskProjectId} onChange={(event) => setTaskProjectId(event.target.value)} className={inputClass}>
                    <option value="">Pilih Project</option>
                    {taskProjectOptions.map((project) => (
                      <option key={project.id} value={project.id}>{project.title}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={`mb-1 block text-xs font-bold ${mutedText}`}>Pekerjaan</label>
                  <textarea value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} className={`${inputClass} min-h-24`} placeholder="Contoh: rapihkan filter report, cek data approval, follow up revisi..." />
                </div>
                <div>
                  <label className={`mb-1 block text-xs font-bold ${mutedText}`}>Target Tanggal</label>
                  <input type="date" value={taskDate} onChange={(event) => setTaskDate(event.target.value)} className={inputClass} />
                </div>
                <button disabled={isSavingTask} className="w-full rounded-2xl bg-[#A7F3D0] px-4 py-3 font-black text-[#111214] disabled:opacity-60">
                  {isSavingTask ? "Menyimpan..." : "Simpan Rencana Kerja"}
                </button>
              </form>
            </div>

            <div className={`rounded-[2rem] border ${borderColor} ${cardBg} p-5`}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black">Pekerjaan Pending</h2>
                  <p className={`text-sm ${mutedText}`}>{pendingTasks.length} pekerjaan belum selesai</p>
                </div>
                <button onClick={fetchProjects} className={`rounded-2xl border ${borderColor} px-3 py-2 text-sm font-bold`}>Refresh</button>
              </div>

              <div className="space-y-3">
                {pendingTasks.length === 0 ? (
                  <p className={mutedText}>Belum ada pekerjaan pending.</p>
                ) : (
                  pendingTasks.map((task) => {
                    const project = projects.find((item) => item.id === task.projectId);

                    return (
                      <div key={task.id} className={`rounded-3xl border ${borderColor} ${softCardBg} p-4`}>
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            onClick={() => toggleTaskDone(task)}
                            className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#A7F3D0] text-sm font-black text-[#A7F3D0]"
                            title="Tandai selesai"
                          >
                            ✓
                          </button>
                          <div className="min-w-0 flex-1">
                            <p className="whitespace-pre-wrap font-black leading-6">{task.title}</p>
                            <p className={`mt-1 text-sm ${mutedText}`}>{project?.title ?? "Project tidak ditemukan"}</p>
                            <p className={`mt-1 text-xs ${mutedText}`}>Target {task.taskDate}</p>
                            <div className="mt-3 flex gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedProjectId(task.projectId);
                                  setActiveMenu("project");
                                }}
                                className="rounded-2xl bg-[#A7F3D0] px-3 py-2 text-xs font-black text-[#111214]"
                              >
                                Buka Project
                              </button>
                              <button type="button" onClick={() => deleteTask(task.id)} className="rounded-2xl bg-red-100 px-3 py-2 text-xs font-black text-red-700">
                                Hapus
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {doneTasks.length > 0 ? (
                <div className="mt-6 space-y-3">
                  <h3 className="font-black">Selesai Terbaru</h3>
                  {doneTasks.slice(0, 5).map((task) => {
                    const project = projects.find((item) => item.id === task.projectId);

                    return (
                      <div key={task.id} className={`rounded-3xl border ${borderColor} ${softCardBg} p-4 opacity-80`}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-black line-through">{task.title}</p>
                            <p className={`mt-1 text-xs ${mutedText}`}>{project?.title ?? "Project tidak ditemukan"}</p>
                          </div>
                          <button type="button" onClick={() => toggleTaskDone(task)} className="text-xs font-bold text-[#A7F3D0]">Batal</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {activeMenu === "catatan" ? (
          <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <div className={`rounded-[2rem] border ${borderColor} ${cardBg} p-5`}>
              <div className="mb-4">
                <h2 className="text-xl font-black">Catatan</h2>
                <p className={`text-sm ${mutedText}`}>Catat hal penting, progress, link, atau reminder kecil tanpa membuka detail project.</p>
              </div>

              <form onSubmit={saveCatatan} className="space-y-4">
                <div>
                  <label className={`mb-1 block text-xs font-bold ${mutedText}`}>Project</label>
                  <select value={catatanProjectId} onChange={(event) => setCatatanProjectId(event.target.value)} className={inputClass}>
                    <option value="">Pilih Project</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>{project.title}</option>
                    ))}
                  </select>
                  {selectedCatatanProject ? (
                    <p className={`mt-1 text-xs ${mutedText}`}>{selectedCatatanProject.client || "Tanpa client/divisi"} · {selectedCatatanProject.status}</p>
                  ) : null}
                </div>
                <div>
                  <label className={`mb-1 block text-xs font-bold ${mutedText}`}>Tanggal Catatan</label>
                  <input type="date" value={catatanDate} onChange={(event) => setCatatanDate(event.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className={`mb-1 block text-xs font-bold ${mutedText}`}>Isi Catatan</label>
                  <textarea
                    value={catatanText}
                    onChange={(event) => setCatatanText(event.target.value)}
                    className={`${inputClass} min-h-36`}
                    placeholder="Contoh: masih tunggu data dari user, link deploy, catatan revisi, atau reminder follow up..."
                  />
                </div>
                <button disabled={isSavingCatatan} className="w-full rounded-2xl bg-[#A7F3D0] px-4 py-3 font-black text-[#111214] disabled:opacity-60">
                  {isSavingCatatan ? "Menyimpan..." : "Simpan Catatan"}
                </button>
              </form>
            </div>

            <div className={`rounded-[2rem] border ${borderColor} ${cardBg} p-5`}>
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="text-xl font-black">Daftar Catatan</h2>
                  <p className={`text-sm ${mutedText}`}>{catatanRows.length} catatan tampil dari {notes.length} total catatan</p>
                </div>
                <button type="button" onClick={fetchProjects} className={`rounded-2xl border ${borderColor} px-3 py-2 text-sm font-bold`}>Refresh</button>
              </div>

              <div className="mb-4 grid gap-2 md:grid-cols-[1.2fr_1fr]">
                <input value={catatanSearch} onChange={(event) => setCatatanSearch(event.target.value)} className={inputClass} placeholder="Cari isi catatan/project/client" />
                <select value={catatanFilterProjectId} onChange={(event) => setCatatanFilterProjectId(event.target.value)} className={inputClass}>
                  <option value="">Semua Project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.title}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-3">
                {catatanRows.length === 0 ? (
                  <div className={`rounded-3xl border ${borderColor} ${softCardBg} p-5 text-center`}>
                    <p className="font-black">Belum ada catatan.</p>
                    <p className={`mt-1 text-sm ${mutedText}`}>Catatan yang kamu simpan akan muncul di sini.</p>
                  </div>
                ) : (
                  catatanRows.map((note) => (
                    <div key={note.id} className={`rounded-3xl border ${borderColor} ${softCardBg} p-4`}>
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-black">{note.projectTitle}</p>
                          <p className={`mt-1 text-xs ${mutedText}`}>{note.client || "Tanpa client/divisi"} · {note.noteDate}</p>
                        </div>
                        <button type="button" onClick={() => deleteNote(note.id)} className="shrink-0 rounded-2xl bg-red-100 px-3 py-2 text-xs font-black text-red-700">
                          Hapus
                        </button>
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-6">{note.note}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-bold">
                        <span className="rounded-full bg-[#A7F3D0]/20 px-3 py-1 text-[#A7F3D0]">{note.projectStatus}</span>
                        <span className={`rounded-full ${softCardBg} px-3 py-1`}>{note.projectPriority}</span>
                        <span className={`rounded-full ${softCardBg} px-3 py-1`}>{note.createdAtText}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedProjectId(note.projectId);
                            setActiveMenu("project");
                          }}
                          className="rounded-full bg-[#A7F3D0] px-3 py-1 text-[#111214]"
                        >
                          Buka Project
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        ) : null}

        {activeMenu === "laporan" ? (
          <section className="space-y-4">
            <div className={`rounded-[2rem] border ${borderColor} ${cardBg} p-5`}>
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <h2 className="text-xl font-black">Laporan Kerjaan</h2>
                  <p className={`mt-1 text-sm ${mutedText}`}>Ringkasan project, tugas, note progress, dan riwayat aktivitas.</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={exportExcelReport}
                    className="rounded-2xl bg-[#A7F3D0] px-4 py-3 text-sm font-black text-[#111214]"
                  >
                    Export Excel
                  </button>
                  <button
                    type="button"
                    onClick={printReport}
                    className={`rounded-2xl border ${borderColor} ${softCardBg} px-4 py-3 text-sm font-black`}
                  >
                    Cetak / PDF
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-2 md:grid-cols-[1.4fr_1fr_1fr]">
                <input value={search} onChange={(event) => setSearch(event.target.value)} className={inputClass} placeholder="Cari project/client/note/tugas" />
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

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {reportSummaryRows.map((row) => (
                <div key={row.label} className={`rounded-[1.5rem] border ${borderColor} ${cardBg} p-4`}>
                  <p className={`text-xs font-bold ${mutedText}`}>{row.label}</p>
                  <p className="mt-2 text-3xl font-black">{row.value}</p>
                </div>
              ))}
            </div>

            <div className={`rounded-[2rem] border ${borderColor} ${cardBg} p-5`}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-black">Preview Project</h3>
                  <p className={`text-sm ${mutedText}`}>{reportProjectRows.length} project sesuai filter.</p>
                </div>
                <button type="button" onClick={fetchProjects} className={`rounded-2xl border ${borderColor} px-3 py-2 text-sm font-bold`}>Refresh</button>
              </div>

              <div className="space-y-3">
                {reportProjectRows.length === 0 ? (
                  <p className={mutedText}>Belum ada data laporan.</p>
                ) : (
                  reportProjectRows.slice(0, 8).map((project) => (
                    <div key={project.id} className={`rounded-3xl border ${borderColor} ${softCardBg} p-4`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="truncate font-black">{project.title}</h4>
                          <p className={`mt-1 text-sm ${mutedText}`}>{project.client || "Tanpa client/divisi"}</p>
                          <p className={`mt-1 text-xs ${mutedText}`}>Masuk {project.masukDate} · Deadline {formatDeadlineDate(project.deadlineDate)}</p>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold">
                            <span className={`rounded-full ${softCardBg} px-3 py-1`}>{project.pendingTasks}/{project.totalTasks} tugas pending</span>
                            <span className={`rounded-full ${softCardBg} px-3 py-1`}>{project.totalNotes} note</span>
                            <span className={`rounded-full ${softCardBg} px-3 py-1`}>{project.priority}</span>
                          </div>
                        </div>
                        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${getDeadlineClass(project)}`}>
                          {project.deadlineLabel}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
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

      {isNavigationMenuOpen ? (
        <div className="fixed inset-0 z-[70] bg-black/35 px-3 pb-24 backdrop-blur-sm" onClick={() => setIsNavigationMenuOpen(false)}>
          <div
            onClick={(event) => event.stopPropagation()}
            className={`absolute bottom-24 left-3 right-3 mx-auto max-w-3xl rounded-[2rem] border ${borderColor} ${cardBg} p-4 shadow-2xl md:bottom-28 md:p-5`}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className={`text-xs font-bold uppercase tracking-wide ${mutedText}`}>Menu</p>
                <h2 className="mt-1 text-xl font-black">Pilih halaman</h2>
                <p className={`mt-1 text-sm ${mutedText}`}>Menu dibuat ringkas supaya nyaman di HP, tablet, dan laptop.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsNavigationMenuOpen(false)}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border ${borderColor} ${softCardBg} text-lg font-black`}
                aria-label="Tutup menu"
              >
                ×
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[
                ["dashboard", "🏠", "Dashboard", "Ringkasan deadline"],
                ["tambah", "＋", "Tambah", "Input project baru"],
                ["project", "🗂️", "Project", "Detail project"],
                ["tugas", "☑️", "Tugas", "Pekerjaan pending"],
                ["catatan", "📝", "Catatan", "Notes terpisah"],
                ["riwayat", "🧾", "Riwayat", "Aktivitas per project"],
                ["laporan", "📊", "Laporan", "Excel dan PDF"],
                ["settings", "⚙️", "Settings", "Mode dan logout"],
              ].map(([id, icon, label, description]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => openMenuPage(id as ActiveMenu)}
                  className={`rounded-3xl border p-4 text-left transition ${
                    activeMenu === id
                      ? "border-[#A7F3D0] bg-[#A7F3D0]/10"
                      : `${borderColor} ${softCardBg}`
                  }`}
                >
                  <div className="text-2xl">{icon}</div>
                  <p className="mt-2 font-black">{label}</p>
                  <p className={`mt-1 text-xs ${mutedText}`}>{description}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <nav className={`fixed bottom-0 left-0 right-0 z-[60] border-t ${borderColor} ${isDarkMode ? "bg-[#141518]/95" : "bg-white/95"} pb-[env(safe-area-inset-bottom)] backdrop-blur`}>
        <div className="mx-auto grid max-w-3xl grid-cols-5 gap-1 px-2 py-2 md:px-4">
          {[
            ["dashboard", "🏠", "Home"],
            ["tambah", "＋", "Tambah"],
            ["project", "🗂️", "Project"],
            ["tugas", "☑️", "Tugas"],
          ].map(([id, icon, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => openMenuPage(id as ActiveMenu)}
              className={`rounded-2xl px-2 py-2 text-xs font-black transition md:py-3 ${
                activeMenu === id
                  ? "bg-[#A7F3D0] text-[#111214]"
                  : isDarkMode
                  ? "text-[#B8BDC7]"
                  : "text-neutral-500"
              }`}
            >
              <div className="text-lg md:text-xl">{icon}</div>
              <span className="text-[10px] sm:text-xs">{label}</span>
            </button>
          ))}

          <button
            type="button"
            onClick={() => setIsNavigationMenuOpen((current) => !current)}
            className={`rounded-2xl px-2 py-2 text-xs font-black transition md:py-3 ${
              isNavigationMenuOpen || ["catatan", "riwayat", "laporan", "settings"].includes(activeMenu)
                ? "bg-[#A7F3D0] text-[#111214]"
                : isDarkMode
                ? "text-[#B8BDC7]"
                : "text-neutral-500"
            }`}
          >
            <div className="text-lg md:text-xl">☰</div>
            <span className="text-[10px] sm:text-xs">Menu</span>
          </button>
        </div>
      </nav>
    </main>
  );
}
