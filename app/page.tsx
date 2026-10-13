"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import {
  addDoc,
  arrayUnion,
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

type ProjectStatus =
  "Belum Mulai" | "Proses" | "Menunggu" | "Testing" | "Hold" | "Selesai";
type CaseKind = "Bug" | "Revisi" | "Fitur" | "Support";
type CaseActivity = {
  id: string;
  title: string;
  note: string;
  date: string;
  recordedAt: number;
};
type ProjectPriority = "Rendah" | "Normal" | "Penting" | "Urgent";
type ActiveMenu =
  | "client"
  | "dashboard"
  | "tambah"
  | "project"
  | "riwayat"
  | "tugas"
  | "catatan"
  | "laporan"
  | "settings"
  | "query";

type WorkSavedQuery = {
  id: string;
  userId: string;
  title: string;
  queryText: string;
  createdAtMillis: number;
  updatedAtMillis: number;
};

type WorkProject = {
  id: string;
  userId: string;
  title: string;
  client: string;
  module: string;
  bladeForm: string;
  requesterPic: string;
  caseKind: CaseKind;
  waitingReason: string;
  completedDate: string;
  updatedAtMillis: number;
  activityHistory: CaseActivity[];
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
  updatedAtText: string;
  updatedAtMillis: number;
  createdAtText: string;
  createdAtMillis: number;
};

const statusOptions: ProjectStatus[] = [
  "Belum Mulai",
  "Proses",
  "Menunggu",
  "Testing",
  "Hold",
  "Selesai",
];

const priorityOptions: ProjectPriority[] = [
  "Rendah",
  "Normal",
  "Penting",
  "Urgent",
];

const defaultClients = [
  "BAKE",
  "TKM",
  "YPKPLN",
  "ITPLN",
  "YAKKAP",
  "LISNA",
  "Bhakti Kencana",
];
const caseKinds: CaseKind[] = ["Bug", "Revisi", "Fitur", "Support"];
const UNASSIGNED_CLIENT = "(Belum dikelompokkan)";
const UNASSIGNED_MODULE = "(Tanpa modul)";
const cleanLabel = (value: string) => value.trim().replace(/\s+/g, " ");
const normalizeClient = (value: string) => {
  const clean = cleanLabel(value);
  return (
    defaultClients.find((item) => item.toLowerCase() === clean.toLowerCase()) ??
    clean
  );
};
const uniqueLabels = (values: string[]) => {
  const labels = new Map<string, string>();
  values.forEach((value) => {
    const clean = cleanLabel(value);
    if (clean && !labels.has(clean.toLowerCase()))
      labels.set(clean.toLowerCase(), clean);
  });
  return [...labels.values()];
};
const formatInputDate = (value: string) => {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : value;
};
const getCaseContext = (project: WorkProject) =>
  `${project.client || UNASSIGNED_CLIENT} · ${project.module || UNASSIGNED_MODULE}`;
const getCaseOption = (project: WorkProject) =>
  `${getCaseContext(project)} — ${project.title}`;
const makeActivity = (
  title: string,
  note: string,
  date = getTodayInputDate(),
): CaseActivity => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  title,
  note,
  date,
  recordedAt: Date.now(),
});

const allowedUsernames = ["alya-kerja", "alya"];

const getTodayInputDate = () => {
  const today = new Date();
  const localDate = new Date(
    today.getTime() - today.getTimezoneOffset() * 60000,
  );
  return localDate.toISOString().split("T")[0];
};

const usernameToEmail = (username: string) =>
  `${username.trim().toLowerCase()}@office.local`;

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
  const activeUserId = useRef<string | null>(null);
  const fetchGeneration = useRef(0);
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
  const [module, setModule] = useState("");
  const [bladeForm, setBladeForm] = useState("");
  const [requesterPic, setRequesterPic] = useState("");
  const [caseKind, setCaseKind] = useState<CaseKind>("Bug");
  const [waitingReason, setWaitingReason] = useState("");
  const [completedDate, setCompletedDate] = useState("");
  const [completionProjectId, setCompletionProjectId] = useState("");
  const [completionDateInput, setCompletionDateInput] =
    useState(getTodayInputDate());
  const [isCompleting, setIsCompleting] = useState(false);
  const [clientHubSelection, setClientHubSelection] = useState("BAKE");
  const [clientHubSearch, setClientHubSearch] = useState("");
  const [filterClient, setFilterClient] = useState("");
  const [filterModule, setFilterModule] = useState("");
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
  const [filterPriority, setFilterPriority] = useState<ProjectPriority | "">(
    "",
  );

  const savedQueryFetchGeneration = useRef(0);
  const [savedQueries, setSavedQueries] = useState<WorkSavedQuery[]>([]);
  const [savedQueryTitle, setSavedQueryTitle] = useState("");
  const [savedQueryText, setSavedQueryText] = useState("");
  const [savedQuerySearch, setSavedQuerySearch] = useState("");
  const [editingSavedQueryId, setEditingSavedQueryId] = useState("");
  const [isSavingSavedQuery, setIsSavingSavedQuery] = useState(false);
  const [isLoadingSavedQueries, setIsLoadingSavedQueries] = useState(false);
  const [savedQueryError, setSavedQueryError] = useState("");
  const [savedQueryNotice, setSavedQueryNotice] = useState("");
  const [viewingSavedQueryId, setViewingSavedQueryId] = useState("");
  const [busySavedQueryId, setBusySavedQueryId] = useState("");

  const username = getUsernameFromEmail(currentUser?.email);

  const pageBg = isDarkMode
    ? "bg-[#111214] text-white"
    : "bg-neutral-100 text-neutral-900";
  const cardBg = isDarkMode
    ? "bg-[#1A1C1F] text-white"
    : "bg-white text-neutral-900";
  const softCardBg = isDarkMode ? "bg-[#2A2D31]" : "bg-neutral-50";
  const borderColor = isDarkMode ? "border-[#2B2F34]" : "border-neutral-200";
  const mutedText = isDarkMode ? "text-[#B8BDC7]" : "text-neutral-500";
  const inputClass = isDarkMode
    ? "w-full min-w-0 min-h-[40px] rounded-xl border border-[#3A3F45] bg-[#111214] px-3 py-2 text-[16px] leading-5 text-white outline-none transition-colors placeholder:text-[#7E8693] focus:border-[#A7F3D0] focus:ring-2 focus:ring-emerald-400/10 disabled:opacity-50 sm:text-[13px]"
    : "w-full min-w-0 min-h-[40px] rounded-xl border border-neutral-200 bg-white px-3 py-2 text-[16px] leading-5 text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-green-600 focus:ring-2 focus:ring-emerald-600/10 disabled:opacity-50 sm:text-[13px]";

  const selectedProject =
    projects.find((item) => item.id === selectedProjectId) ?? null;
  const completionProject =
    projects.find((item) => item.id === completionProjectId) ?? null;
  const clientOptions = uniqueLabels([
    ...defaultClients,
    ...projects.map((item) => item.client),
  ]);
  const moduleOptions = uniqueLabels(
    projects
      .filter(
        (item) =>
          item.client.toLowerCase() === normalizeClient(client).toLowerCase(),
      )
      .map((item) => item.module),
  );
  const filterClientOptions = [
    ...clientOptions,
    ...(projects.some((item) => !item.client) ? [UNASSIGNED_CLIENT] : []),
  ];
  const scopeMatches = (project: Pick<WorkProject, "client" | "module">) =>
    (!filterClient ||
      (project.client || UNASSIGNED_CLIENT).toLowerCase() ===
        filterClient.toLowerCase()) &&
    (!filterModule ||
      (project.module || UNASSIGNED_MODULE).toLowerCase() ===
        filterModule.toLowerCase());
  const filterModuleOptions = uniqueLabels(
    projects
      .filter(
        (item) =>
          !filterClient ||
          (item.client || UNASSIGNED_CLIENT).toLowerCase() ===
            filterClient.toLowerCase(),
      )
      .map((item) => item.module || UNASSIGNED_MODULE),
  );
  const hubProjects = projects.filter(
    (item) =>
      (item.client || UNASSIGNED_CLIENT).toLowerCase() ===
      clientHubSelection.toLowerCase(),
  );
  const hubModules = uniqueLabels(
    hubProjects.map((item) => item.module || UNASSIGNED_MODULE),
  );
  const selectedProjectNotes = notes
    .filter((item) => item.projectId === selectedProjectId)
    .sort((a, b) => b.createdAtMillis - a.createdAtMillis);

  const pendingTasks = tasks
    .filter((item) => !item.isDone)
    .sort((a, b) => a.taskDate.localeCompare(b.taskDate));

  const doneTasks = tasks
    .filter((item) => item.isDone)
    .sort(
      (a, b) =>
        (b.updatedAtMillis || b.createdAtMillis) -
        (a.updatedAtMillis || a.createdAtMillis),
    );

  const taskProjectOptions = projects.filter(
    (item) => item.status !== "Selesai",
  );

  const filteredProjects = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return projects.filter((project) => {
      const matchesSearch = normalizedSearch
        ? [
            project.title,
            project.client,
            project.module,
            project.bladeForm,
            project.requesterPic,
            project.caseKind,
            project.notes,
            project.status,
            project.priority,
          ]
            .join(" ")
            .toLowerCase()
            .includes(normalizedSearch)
        : true;

      const matchesStatus = filterStatus
        ? project.status === filterStatus
        : true;
      const matchesPriority = filterPriority
        ? project.priority === filterPriority
        : true;

      return (
        matchesSearch &&
        matchesStatus &&
        matchesPriority &&
        scopeMatches(project)
      );
    });
  }, [
    projects,
    search,
    filterStatus,
    filterPriority,
    filterClient,
    filterModule,
  ]);

  const activityRows = useMemo(() => {
    const projectActivities = projects.flatMap((project) => {
      const base = {
        projectId: project.id,
        projectTitle: project.title,
        client: project.client,
        module: project.module,
        bladeForm: project.bladeForm,
        requesterPic: project.requesterPic,
        status: project.status,
        priority: project.priority,
      };
      const rows = [
        {
          ...base,
          id: `project-${project.id}`,
          type: "Pengajuan",
          title: "Kasus diajukan",
          date: formatInputDate(project.masukDate),
          dateValue:
            new Date(`${project.masukDate}T00:00:00`).getTime() ||
            project.createdAtMillis,
          note: project.notes,
          icon: "🗂️",
        },
        ...project.activityHistory.map((event) => ({
          ...base,
          id: `event-${project.id}-${event.id}`,
          type: "Perubahan kasus",
          title: event.title,
          date: `${formatInputDate(event.date)} · dicatat ${new Date(event.recordedAt).toLocaleString("id-ID")}`,
          dateValue:
            new Date(`${event.date}T00:00:00`).getTime() || event.recordedAt,
          note: event.note,
          icon: "📝",
        })),
      ];
      // Legacy completed cases have no reliable completion date; never infer it from createdAt.
      return rows;
    });

    const noteActivities = notes.map((note) => {
      const project = projects.find((item) => item.id === note.projectId);

      return {
        id: `note-${note.id}`,
        type: "Note Progress",
        title: "Note progress ditambahkan",
        projectId: note.projectId,
        projectTitle: project?.title ?? "Kasus tidak ditemukan",
        client: project?.client ?? "",
        module: project?.module ?? "",
        bladeForm: project?.bladeForm ?? "",
        requesterPic: project?.requesterPic ?? "",
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
        projectTitle: project?.title ?? "Kasus tidak ditemukan",
        client: project?.client ?? "",
        module: project?.module ?? "",
        bladeForm: project?.bladeForm ?? "",
        requesterPic: project?.requesterPic ?? "",
        status: project?.status ?? "Belum Mulai",
        priority: project?.priority ?? "Normal",
        date:
          task.isDone && task.updatedAtMillis
            ? task.updatedAtText
            : task.createdAtText,
        dateValue:
          (task.isDone ? task.updatedAtMillis : 0) ||
          task.createdAtMillis ||
          new Date(task.taskDate).getTime(),
        note: task.title,
        icon: task.isDone ? "✅" : "☑️",
      };
    });

    return [...projectActivities, ...noteActivities, ...taskActivities].sort(
      (a, b) => b.dateValue - a.dateValue,
    );
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
            activity.module,
            activity.bladeForm,
            activity.requesterPic,
            activity.status,
            activity.priority,
            activity.note,
          ]
            .join(" ")
            .toLowerCase()
            .includes(normalizedSearch)
        : true;

      const matchesStatus = filterStatus
        ? activity.status === filterStatus
        : true;
      const matchesPriority = filterPriority
        ? activity.priority === filterPriority
        : true;

      return (
        matchesSearch &&
        matchesStatus &&
        matchesPriority &&
        scopeMatches(activity)
      );
    });
  }, [
    activityRows,
    search,
    filterStatus,
    filterPriority,
    filterClient,
    filterModule,
  ]);

  const historyProjectRows = useMemo(() => {
    return filteredProjects
      .map((project) => {
        const projectActivities = activityRows.filter(
          (activity) => activity.projectId === project.id,
        );
        const lastActivity = [...projectActivities].sort(
          (a, b) => b.dateValue - a.dateValue,
        )[0];
        const noteCount = notes.filter(
          (item) => item.projectId === project.id,
        ).length;
        const taskCount = tasks.filter(
          (item) => item.projectId === project.id,
        ).length;
        const pendingCount = tasks.filter(
          (item) => item.projectId === project.id && !item.isDone,
        ).length;

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
    historyProjectRows.find((item) => item.id === selectedHistoryProjectId) ??
    historyProjectRows[0] ??
    null;

  const selectedHistoryActivities = selectedHistoryProject
    ? filteredActivityRows.filter(
        (activity) => activity.projectId === selectedHistoryProject.id,
      )
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
        projectTitle: project?.title ?? "Kasus tidak ditemukan",
        client: project?.client ?? "",
        module: project?.module ?? "",
        bladeForm: project?.bladeForm ?? "",
        requesterPic: project?.requesterPic ?? "",
        projectStatus: project?.status ?? "Belum Mulai",
        projectPriority: project?.priority ?? "Normal",
      };
    })
    .filter((task) => {
      const normalizedSearch = search.trim().toLowerCase();
      const matchesSearch = normalizedSearch
        ? [
            task.title,
            task.projectTitle,
            task.client,
            task.module,
            task.bladeForm,
            task.requesterPic,
            task.projectStatus,
            task.projectPriority,
          ]
            .join(" ")
            .toLowerCase()
            .includes(normalizedSearch)
        : true;
      const matchesStatus = filterStatus
        ? task.projectStatus === filterStatus
        : true;
      const matchesPriority = filterPriority
        ? task.projectPriority === filterPriority
        : true;

      return (
        matchesSearch && matchesStatus && matchesPriority && scopeMatches(task)
      );
    })
    .sort((a, b) => a.taskDate.localeCompare(b.taskDate));

  const reportNoteRows = notes
    .map((note) => {
      const project = projects.find((item) => item.id === note.projectId);

      return {
        ...note,
        projectTitle: project?.title ?? "Kasus tidak ditemukan",
        client: project?.client ?? "",
        module: project?.module ?? "",
        bladeForm: project?.bladeForm ?? "",
        requesterPic: project?.requesterPic ?? "",
        projectStatus: project?.status ?? "Belum Mulai",
        projectPriority: project?.priority ?? "Normal",
      };
    })
    .filter((note) => {
      const normalizedSearch = search.trim().toLowerCase();
      const matchesSearch = normalizedSearch
        ? [
            note.note,
            note.projectTitle,
            note.client,
            note.module,
            note.bladeForm,
            note.requesterPic,
            note.projectStatus,
            note.projectPriority,
          ]
            .join(" ")
            .toLowerCase()
            .includes(normalizedSearch)
        : true;
      const matchesStatus = filterStatus
        ? note.projectStatus === filterStatus
        : true;
      const matchesPriority = filterPriority
        ? note.projectPriority === filterPriority
        : true;

      return (
        matchesSearch && matchesStatus && matchesPriority && scopeMatches(note)
      );
    })
    .sort((a, b) => b.createdAtMillis - a.createdAtMillis);

  const catatanRows = useMemo(() => {
    const normalizedSearch = catatanSearch.trim().toLowerCase();

    return notes
      .map((note) => {
        const project = projects.find((item) => item.id === note.projectId);

        return {
          ...note,
          projectTitle: project?.title ?? "Kasus tidak ditemukan",
          client: project?.client ?? "",
          module: project?.module ?? "",
          bladeForm: project?.bladeForm ?? "",
          requesterPic: project?.requesterPic ?? "",
          projectStatus: project?.status ?? "Belum Mulai",
          projectPriority: project?.priority ?? "Normal",
        };
      })
      .filter((note) => {
        const matchesProject = catatanFilterProjectId
          ? note.projectId === catatanFilterProjectId
          : true;
        const matchesSearch = normalizedSearch
          ? [
              note.note,
              note.projectTitle,
              note.client,
              note.projectStatus,
              note.projectPriority,
              note.noteDate,
            ]
              .join(" ")
              .toLowerCase()
              .includes(normalizedSearch)
          : true;

        return matchesProject && matchesSearch;
      })
      .sort((a, b) => b.createdAtMillis - a.createdAtMillis);
  }, [notes, projects, catatanSearch, catatanFilterProjectId]);

  const reportSummaryRows = [
    { label: "Total Kasus", value: filteredProjects.length },
    {
      label: "Kasus Aktif",
      value: filteredProjects.filter((item) => item.status !== "Selesai")
        .length,
    },
    {
      label: "Kasus Selesai",
      value: filteredProjects.filter((item) => item.status === "Selesai")
        .length,
    },
    {
      label: "Deadline Dekat",
      value: filteredProjects.filter((item) => {
        const daysLeft = getDaysLeft(item.deadlineDate);
        return (
          item.status !== "Selesai" &&
          daysLeft !== null &&
          daysLeft >= 0 &&
          daysLeft <= 3
        );
      }).length,
    },
    {
      label: "Lewat Deadline",
      value: filteredProjects.filter((item) => {
        const daysLeft = getDaysLeft(item.deadlineDate);
        return item.status !== "Selesai" && daysLeft !== null && daysLeft < 0;
      }).length,
    },
    {
      label: "Tugas Pending",
      value: reportTaskRows.filter((item) => !item.isDone).length,
    },
    {
      label: "Tugas Selesai",
      value: reportTaskRows.filter((item) => item.isDone).length,
    },
    { label: "Total Note", value: reportNoteRows.length },
  ];

  const resetForm = () => {
    setEditingProjectId("");
    setTitle("");
    setClient("");
    setModule("");
    setBladeForm("");
    setRequesterPic("");
    setCaseKind("Bug");
    setWaitingReason("");
    setCompletedDate("");
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
    const requestedUserId = currentUser.uid;
    const generation = ++fetchGeneration.current;

    try {
      setIsLoadingProjects(true);

      const projectQuery = query(
        collection(db, "workProjects"),
        where("userId", "==", currentUser.uid),
      );

      const noteQuery = query(
        collection(db, "workProjectNotes"),
        where("userId", "==", currentUser.uid),
      );

      const taskQuery = query(
        collection(db, "workProjectTasks"),
        where("userId", "==", currentUser.uid),
      );

      const [projectSnapshot, noteSnapshot, taskSnapshot] = await Promise.all([
        getDocs(projectQuery),
        getDocs(noteQuery),
        getDocs(taskQuery),
      ]);

      if (
        activeUserId.current !== requestedUserId ||
        generation !== fetchGeneration.current
      )
        return;

      const mappedProjects = projectSnapshot.docs
        .map((item) => {
          const data = item.data();

          return {
            id: item.id,
            userId: data.userId ?? "",
            title: data.title ?? "",
            client: normalizeClient(data.client ?? ""),
            module: cleanLabel(data.module ?? ""),
            bladeForm: data.bladeForm ?? "",
            requesterPic: data.requesterPic ?? "",
            caseKind: (caseKinds.includes(data.caseKind)
              ? data.caseKind
              : "Support") as CaseKind,
            waitingReason: data.waitingReason ?? "",
            completedDate: data.completedDate ?? "",
            updatedAtMillis:
              data.updatedAt instanceof Timestamp
                ? data.updatedAt.toMillis()
                : 0,
            activityHistory: Array.isArray(data.activityHistory)
              ? data.activityHistory.filter(
                  (event: CaseActivity) =>
                    event &&
                    typeof event.id === "string" &&
                    typeof event.title === "string" &&
                    typeof event.date === "string" &&
                    typeof event.recordedAt === "number",
                )
              : [],
            masukDate: data.masukDate ?? "",
            deadlineDate: data.deadlineDate ?? "",
            status: (data.status ?? "Belum Mulai") as ProjectStatus,
            priority: (data.priority ?? "Normal") as ProjectPriority,
            notes: data.notes ?? "",
            createdAtText: formatDateTime(data.createdAt),
            createdAtMillis:
              data.createdAt instanceof Timestamp
                ? data.createdAt.toMillis()
                : 0,
          };
        })
        .sort(
          (a, b) =>
            getDeadlineSortValue(a.deadlineDate) -
            getDeadlineSortValue(b.deadlineDate),
        );

      const mappedNotes = noteSnapshot.docs
        .map((item) => {
          const data = item.data();

          return {
            id: item.id,
            projectId: data.projectId ?? "",
            noteDate: data.noteDate ?? "",
            note: data.note ?? "",
            createdAtText: formatDateTime(data.createdAt),
            createdAtMillis:
              data.createdAt instanceof Timestamp
                ? data.createdAt.toMillis()
                : 0,
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
            updatedAtText: formatDateTime(data.updatedAt),
            updatedAtMillis:
              data.updatedAt instanceof Timestamp
                ? data.updatedAt.toMillis()
                : 0,
            createdAtText: formatDateTime(data.createdAt),
            createdAtMillis:
              data.createdAt instanceof Timestamp
                ? data.createdAt.toMillis()
                : 0,
          };
        })
        .sort((a, b) => a.taskDate.localeCompare(b.taskDate));

      setProjects(mappedProjects);
      setNotes(mappedNotes);
      setTasks(mappedTasks);

      if (
        !mappedProjects.some((item) => item.id === selectedProjectId) &&
        mappedProjects.length > 0
      ) {
        setSelectedProjectId(mappedProjects[0].id);
      }

      if (
        !mappedProjects.some(
          (item) => item.id === taskProjectId && item.status !== "Selesai",
        )
      ) {
        setTaskProjectId(
          mappedProjects.find((item) => item.status !== "Selesai")?.id ?? "",
        );
      }

      if (
        !mappedProjects.some((item) => item.id === catatanProjectId) &&
        mappedProjects.length > 0
      ) {
        setCatatanProjectId(mappedProjects[0].id);
      }

      if (
        !mappedProjects.some((item) => item.id === selectedHistoryProjectId) &&
        mappedProjects.length > 0
      ) {
        setSelectedHistoryProjectId(mappedProjects[0].id);
      }
    } catch (error) {
      if (
        activeUserId.current !== requestedUserId ||
        generation !== fetchGeneration.current
      )
        return;
      console.error(error);
      alert("Gagal mengambil data maintenance. Cek Firestore Rules ya.");
    } finally {
      if (
        activeUserId.current === requestedUserId &&
        generation === fetchGeneration.current
      )
        setIsLoadingProjects(false);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      activeUserId.current = user?.uid ?? null;
      setCurrentUser(user);
      setIsCheckingAuth(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    setProjects([]);
    setNotes([]);
    setTasks([]);
    setSelectedProjectId("");
    setTaskProjectId("");
    setCatatanProjectId("");
    setSelectedHistoryProjectId("");
    setCompletionProjectId("");
    resetForm();
    if (!currentUser) return;
    fetchProjects();
  }, [currentUser?.uid]);

  const resetSavedQueryForm = () => {
    setEditingSavedQueryId("");
    setSavedQueryTitle("");
    setSavedQueryText("");
  };

  const getSavedQueryError = (error: unknown, action: string) => {
    const code = (error as { code?: string })?.code ?? "";
    if (code.includes("permission-denied"))
      return "Akses Query belum diizinkan. Tambahkan izin workSavedQueries di Firestore Rules, lalu klik Refresh.";
    return `Gagal ${action} query. Periksa koneksi lalu coba lagi.`;
  };

  const fetchSavedQueries = async () => {
    if (!currentUser) return;
    const uid = currentUser.uid;
    const generation = ++savedQueryFetchGeneration.current;
    setIsLoadingSavedQueries(true);
    setSavedQueryError("");
    try {
      const snapshot = await getDocs(
        query(collection(db, "workSavedQueries"), where("userId", "==", uid)),
      );
      if (
        activeUserId.current !== uid ||
        savedQueryFetchGeneration.current !== generation
      )
        return;
      setSavedQueries(
        snapshot.docs
          .map((item): WorkSavedQuery => {
            const data = item.data();
            const createdAtMillis =
              data.createdAt instanceof Timestamp
                ? data.createdAt.toMillis()
                : 0;
            const updatedAtMillis =
              data.updatedAt instanceof Timestamp
                ? data.updatedAt.toMillis()
                : createdAtMillis;
            return {
              id: item.id,
              userId: uid,
              title:
                typeof data.title === "string" ? data.title : "Tanpa judul",
              queryText:
                typeof data.queryText === "string" ? data.queryText : "",
              createdAtMillis,
              updatedAtMillis,
            };
          })
          .sort((a, b) => b.updatedAtMillis - a.updatedAtMillis),
      );
    } catch (error) {
      if (
        activeUserId.current !== uid ||
        savedQueryFetchGeneration.current !== generation
      )
        return;
      console.error(error);
      setSavedQueryError(getSavedQueryError(error, "memuat"));
    } finally {
      if (
        activeUserId.current === uid &&
        savedQueryFetchGeneration.current === generation
      )
        setIsLoadingSavedQueries(false);
    }
  };

  useEffect(() => {
    ++savedQueryFetchGeneration.current;
    setSavedQueries([]);
    resetSavedQueryForm();
    setSavedQuerySearch("");
    setSavedQueryError("");
    setSavedQueryNotice("");
    setViewingSavedQueryId("");
    setBusySavedQueryId("");
    setIsSavingSavedQuery(false);
    setIsLoadingSavedQueries(false);
  }, [currentUser?.uid]);

  useEffect(() => {
    if (currentUser && activeMenu === "query") void fetchSavedQueries();
  }, [currentUser?.uid, activeMenu]);

  const saveSavedQuery = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentUser || isSavingSavedQuery || busySavedQueryId) return;
    const uid = currentUser.uid;
    const cleanTitle = savedQueryTitle.trim();
    if (!cleanTitle || !savedQueryText.trim()) {
      setSavedQueryError("Judul dan isi query wajib diisi.");
      return;
    }
    if (cleanTitle.length > 200 || savedQueryText.length > 100000) {
      setSavedQueryError(
        "Judul maksimal 200 karakter dan isi query maksimal 100.000 karakter.",
      );
      return;
    }
    setIsSavingSavedQuery(true);
    setSavedQueryError("");
    setSavedQueryNotice("");
    try {
      let id = editingSavedQueryId;
      const previous = savedQueries.find((item) => item.id === id);
      const payload = {
        userId: uid,
        title: cleanTitle,
        queryText: savedQueryText,
        updatedAt: serverTimestamp(),
      };
      if (id) {
        if (!previous || previous.userId !== uid)
          throw new Error("Query tidak ditemukan");
        await updateDoc(doc(db, "workSavedQueries", id), payload);
      } else {
        const created = await addDoc(collection(db, "workSavedQueries"), {
          ...payload,
          createdAt: serverTimestamp(),
        });
        id = created.id;
      }
      if (activeUserId.current !== uid) return;
      // Preserve whitespace and line breaks exactly as entered.
      const localRow: WorkSavedQuery = {
        id,
        userId: uid,
        title: cleanTitle,
        queryText: savedQueryText,
        createdAtMillis: previous?.createdAtMillis || Date.now(),
        updatedAtMillis: Date.now(),
      };
      setSavedQueries((rows) =>
        [localRow, ...rows.filter((item) => item.id !== id)].sort(
          (a, b) => b.updatedAtMillis - a.updatedAtMillis,
        ),
      );
      resetSavedQueryForm();
      setSavedQuerySearch("");
      setSavedQueryNotice(
        previous
          ? "Perubahan query berhasil disimpan."
          : "Query berhasil disimpan.",
      );
    } catch (error) {
      if (activeUserId.current === uid) {
        console.error(error);
        setSavedQueryError(getSavedQueryError(error, "menyimpan"));
      }
    } finally {
      if (activeUserId.current === uid) setIsSavingSavedQuery(false);
    }
  };

  const editSavedQuery = (item: WorkSavedQuery) => {
    if (
      isSavingSavedQuery ||
      busySavedQueryId ||
      item.userId !== currentUser?.uid
    )
      return;
    setEditingSavedQueryId(item.id);
    setSavedQueryTitle(item.title);
    setSavedQueryText(item.queryText);
    setSavedQueryError("");
    setSavedQueryNotice("");
    setViewingSavedQueryId("");
    window.setTimeout(
      () =>
        document
          .getElementById("saved-query-editor")
          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
      0,
    );
  };

  const deleteSavedQuery = async (item: WorkSavedQuery) => {
    if (
      !currentUser ||
      item.userId !== currentUser.uid ||
      isSavingSavedQuery ||
      busySavedQueryId
    )
      return;
    if (!window.confirm(`Hapus query “${item.title}”?`)) return;
    const uid = currentUser.uid;
    setBusySavedQueryId(item.id);
    setSavedQueryError("");
    setSavedQueryNotice("");
    try {
      await deleteDoc(doc(db, "workSavedQueries", item.id));
      if (activeUserId.current !== uid) return;
      setSavedQueries((rows) => rows.filter((row) => row.id !== item.id));
      if (editingSavedQueryId === item.id) resetSavedQueryForm();
      if (viewingSavedQueryId === item.id) setViewingSavedQueryId("");
      setSavedQueryNotice("Query berhasil dihapus.");
    } catch (error) {
      if (activeUserId.current === uid) {
        console.error(error);
        setSavedQueryError(getSavedQueryError(error, "menghapus"));
      }
    } finally {
      if (activeUserId.current === uid) setBusySavedQueryId("");
    }
  };

  const copySavedQuery = async (item: WorkSavedQuery) => {
    const uid = currentUser?.uid;
    if (!uid || item.userId !== uid) return;
    try {
      await navigator.clipboard.writeText(item.queryText);
      if (activeUserId.current === uid) {
        setSavedQueryError("");
        setSavedQueryNotice(`Isi query “${item.title}” sudah disalin.`);
      }
    } catch {
      if (activeUserId.current === uid) {
        setSavedQueryNotice("");
        setSavedQueryError(
          "Belum bisa menyalin otomatis. Buka Lihat query, lalu pilih teks dan salin secara manual.",
        );
      }
    }
  };

  const filteredSavedQueries = useMemo(() => {
    const text = savedQuerySearch.trim().toLowerCase();
    return savedQueries.filter(
      (item) =>
        !text ||
        `${item.title}\n${item.queryText}`.toLowerCase().includes(text),
    );
  }, [savedQueries, savedQuerySearch]);
  const viewingSavedQuery =
    savedQueries.find((item) => item.id === viewingSavedQueryId) ?? null;

  useEffect(() => {
    if (!viewingSavedQueryId) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setViewingSavedQueryId("");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [viewingSavedQueryId]);

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
      await signInWithEmailAndPassword(
        auth,
        usernameToEmail(cleanUsername),
        loginPassword,
      );
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
      alert("Judul kasus wajib diisi.");
      return;
    }

    if (isSaving) return;
    if (
      !cleanLabel(client) ||
      !cleanLabel(module) ||
      !requesterPic.trim() ||
      !masukDate
    ) {
      alert(
        "Isi client, modul/topik, PIC peminta, dan tanggal pengajuan dulu ya.",
      );
      return;
    }
    if (masukDate > getTodayInputDate()) {
      alert("Tanggal pengajuan tidak boleh di masa depan.");
      return;
    }
    if (
      status === "Selesai" &&
      (!completedDate ||
        completedDate < masukDate ||
        completedDate > getTodayInputDate())
    ) {
      alert("Pilih tanggal selesai antara tanggal pengajuan dan hari ini.");
      return;
    }
    if (status === "Menunggu" && !waitingReason.trim()) {
      alert("Isi keterangan yang sedang ditunggu ya.");
      return;
    }

    try {
      setIsSaving(true);

      const payload = {
        userId: currentUser.uid,
        title: title.trim(),
        client:
          clientOptions.find(
            (item) =>
              item.toLowerCase() === normalizeClient(client).toLowerCase(),
          ) ?? normalizeClient(client),
        module:
          moduleOptions.find(
            (item) => item.toLowerCase() === cleanLabel(module).toLowerCase(),
          ) ?? cleanLabel(module),
        bladeForm: bladeForm.trim(),
        requesterPic: requesterPic.trim(),
        caseKind,
        waitingReason: status === "Menunggu" ? waitingReason.trim() : "",
        completedDate: status === "Selesai" ? completedDate : "",
        masukDate,
        deadlineDate: deadlineDate || "",
        status,
        priority,
        notes: projectNotes.trim(),
        updatedAt: serverTimestamp(),
      };

      let savedProjectId = editingProjectId;
      if (editingProjectId) {
        const previous = projects.find((item) => item.id === editingProjectId);
        const completionChanged =
          status === "Selesai" &&
          (previous?.status !== "Selesai" ||
            previous?.completedDate !== completedDate);
        const event = makeActivity(
          completionChanged
            ? "Kasus selesai / tanggal selesai diperbarui"
            : previous?.status === "Selesai" && status !== "Selesai"
              ? "Kasus dibuka kembali"
              : "Kasus diperbarui",
          `${previous?.status ?? "—"} → ${status}. PIC peminta: ${requesterPic.trim()}.${status === "Menunggu" ? ` Menunggu: ${waitingReason.trim()}` : ""}`,
          completionChanged ? completedDate : getTodayInputDate(),
        );
        await updateDoc(doc(db, "workProjects", editingProjectId), {
          ...payload,
          activityHistory: arrayUnion(event),
        });
        alert("Kasus berhasil diupdate.");
      } else {
        const created = await addDoc(collection(db, "workProjects"), {
          ...payload,
          createdAt: serverTimestamp(),
          activityHistory:
            status === "Selesai"
              ? [
                  makeActivity(
                    "Kasus selesai",
                    `PIC peminta: ${requesterPic.trim()}`,
                    completedDate,
                  ),
                ]
              : [],
        });
        savedProjectId = created.id;
        alert("Kasus berhasil disimpan.");
      }

      resetForm();
      setActiveMenu("project");
      setSearch("");
      setFilterClient(payload.client);
      setFilterModule(payload.module);
      setFilterStatus("");
      setFilterPriority("");
      await fetchProjects();
      if (activeUserId.current === currentUser.uid)
        setSelectedProjectId(savedProjectId);
    } catch (error) {
      console.error(error);
      alert("Gagal menyimpan kasus.");
    } finally {
      setIsSaving(false);
    }
  };

  const startEditProject = (project: WorkProject) => {
    setEditingProjectId(project.id);
    setTitle(project.title);
    setClient(project.client);
    setModule(project.module);
    setBladeForm(project.bladeForm);
    setRequesterPic(project.requesterPic);
    setCaseKind(project.caseKind);
    setWaitingReason(project.waitingReason);
    setCompletedDate(
      project.completedDate ||
        (project.status === "Selesai" ? getTodayInputDate() : ""),
    );
    setMasukDate(project.masukDate);
    setDeadlineDate(project.deadlineDate);
    setStatus(project.status);
    setPriority(project.priority);
    setProjectNotes(project.notes);
    setActiveMenu("tambah");
  };

  const openCompletion = (project: WorkProject) => {
    setCompletionDateInput(project.completedDate || getTodayInputDate());
    setCompletionProjectId(project.id);
  };

  const completeProject = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentUser || !completionProject || isCompleting) return;
    if (
      !completionDateInput ||
      (completionProject.masukDate &&
        completionDateInput < completionProject.masukDate) ||
      completionDateInput > getTodayInputDate()
    ) {
      alert("Tanggal selesai harus antara tanggal pengajuan dan hari ini.");
      return;
    }
    try {
      setIsCompleting(true);
      await updateDoc(doc(db, "workProjects", completionProject.id), {
        status: "Selesai",
        completedDate: completionDateInput,
        waitingReason: "",
        updatedAt: serverTimestamp(),
        activityHistory: arrayUnion(
          makeActivity(
            completionProject.status === "Selesai"
              ? "Tanggal selesai diperbarui"
              : "Kasus selesai",
            `Tanggal pengajuan: ${formatInputDate(completionProject.masukDate)}. Tanggal selesai: ${formatInputDate(completionDateInput)}. PIC peminta: ${completionProject.requesterPic || "Belum diisi"}.`,
            completionDateInput,
          ),
        ),
      });
      setCompletionProjectId("");
      await fetchProjects();
    } catch (error) {
      console.error(error);
      alert("Gagal menyimpan tanggal selesai.");
    } finally {
      setIsCompleting(false);
    }
  };

  useEffect(() => {
    if (!completionProjectId) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isCompleting) setCompletionProjectId("");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [completionProjectId, isCompleting]);

  const deleteProject = async (project: WorkProject) => {
    const ok = window.confirm(
      `Hapus kasus ${project.title}? Tugas dan catatan terkait juga akan dihapus.`,
    );
    if (!ok) return;

    try {
      const relatedTasks = tasks.filter(
        (item) => item.projectId === project.id,
      );
      await Promise.all(
        relatedTasks.map((item) =>
          deleteDoc(doc(db, "workProjectTasks", item.id)),
        ),
      );
      const relatedNotes = notes.filter(
        (item) => item.projectId === project.id,
      );
      await Promise.all(
        relatedNotes.map((item) =>
          deleteDoc(doc(db, "workProjectNotes", item.id)),
        ),
      );
      await deleteDoc(doc(db, "workProjects", project.id));

      if (selectedProjectId === project.id) setSelectedProjectId("");
      await fetchProjects();
      alert("Kasus berhasil dihapus.");
    } catch (error) {
      console.error(error);
      alert("Gagal menghapus kasus.");
    }
  };

  const saveNote = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!currentUser || !selectedProject) {
      alert("Pilih kasus aktif dulu ya.");
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
      alert("Pilih kasus untuk catatan ini dulu ya.");
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

    if (!taskProjectOptions.some((item) => item.id === taskProjectId)) {
      alert("Pilih kasus aktif dulu ya.");
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

  const buildExcelWorksheet = (
    name: string,
    rows: (string | number | boolean | null | undefined)[][],
  ) => {
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
        ["Filter Client", filterClient || "Semua"],
        ["Filter Modul", filterModule || "Semua"],
        [],
        ["Metrik", "Jumlah"],
        ...reportSummaryRows.map((row) => [row.label, row.value]),
      ]),
      buildExcelWorksheet("Kasus", [
        [
          "Nama Kasus",
          "Client",
          "Modul/Topik",
          "Blade/Form",
          "PIC Peminta",
          "Jenis",
          "Tanggal Pengajuan",
          "Tanggal Selesai",
          "Deadline",
          "Status",
          "Prioritas",
          "Deadline Info",
          "Total Tugas",
          "Pending",
          "Selesai",
          "Total Note",
          "Note Awal",
        ],
        ...reportProjectRows.map((project) => [
          project.title,
          project.client || "-",
          project.module || "-",
          project.bladeForm || "-",
          project.requesterPic || "-",
          project.caseKind,
          project.masukDate,
          project.completedDate || "-",
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
        [
          "Target Tanggal",
          "Kasus",
          "Client",
          "Modul/Topik",
          "PIC Peminta",
          "Pekerjaan",
          "Status Tugas",
          "Status Kasus",
          "Prioritas Kasus",
          "Dibuat",
        ],
        ...reportTaskRows.map((task) => [
          task.taskDate,
          task.projectTitle,
          task.client || "-",
          task.module || "-",
          task.requesterPic || "-",
          task.title,
          task.isDone ? "Selesai" : "Pending",
          task.projectStatus,
          task.projectPriority,
          task.createdAtText,
        ]),
      ]),
      buildExcelWorksheet("Note Progress", [
        [
          "Tanggal Note",
          "Kasus",
          "Client",
          "Modul/Topik",
          "PIC Peminta",
          "Note",
          "Status Kasus",
          "Prioritas Kasus",
          "Dibuat",
        ],
        ...reportNoteRows.map((note) => [
          note.noteDate,
          note.projectTitle,
          note.client || "-",
          note.module || "-",
          note.requesterPic || "-",
          note.note,
          note.projectStatus,
          note.projectPriority,
          note.createdAtText,
        ]),
      ]),
      buildExcelWorksheet("Riwayat", [
        [
          "Tanggal",
          "Jenis Aktivitas",
          "Kasus",
          "Client",
          "Modul/Topik",
          "PIC Peminta",
          "Judul",
          "Catatan",
          "Status",
          "Prioritas",
        ],
        ...filteredActivityRows.map((activity) => [
          activity.date,
          activity.type,
          activity.projectTitle,
          activity.client || "-",
          activity.module || "-",
          activity.requesterPic || "-",
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
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
        `,
      )
      .join("");

    const projectRows = reportProjectRows
      .map(
        (project) => `
          <tr>
            <td>${escapeReportCell(project.title)}</td>
            <td>${escapeReportCell(project.client || "-")}<br>${escapeReportCell(project.module || "-")}<br>PIC: ${escapeReportCell(project.requesterPic || "-")}<br>Blade/Form: ${escapeReportCell(project.bladeForm || "-")}</td>
            <td>${escapeReportCell(project.masukDate)}<br>Selesai: ${escapeReportCell(project.completedDate || "Belum tercatat")}</td>
            <td>${escapeReportCell(formatDeadlineDate(project.deadlineDate))}</td>
            <td>${escapeReportCell(project.status)}</td>
            <td>${escapeReportCell(project.priority)}</td>
            <td>${escapeReportCell(project.deadlineLabel)}</td>
            <td class="number">${escapeReportCell(project.pendingTasks)}/${escapeReportCell(project.totalTasks)}</td>
            <td class="number">${escapeReportCell(project.totalNotes)}</td>
          </tr>
        `,
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
        `,
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
        `,
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
              <h1>Laporan Maintenance</h1>
            </div>
            <div class="meta">
              <div><b>${escapeReportCell(username)}</b></div>
              <div>Dibuat: ${escapeReportCell(generatedAt)}</div>
              <div>Filter: ${escapeReportCell([search ? `Cari ${search}` : "", filterClient ? `Client ${filterClient}` : "", filterModule ? `Modul ${filterModule}` : "", filterStatus ? `Status ${filterStatus}` : "", filterPriority ? `Prioritas ${filterPriority}` : ""].filter(Boolean).join(" · ") || "Semua data")}</div>
            </div>
          </div>

          <div class="summary-grid">${summaryCards}</div>

          <h2>Daftar Kasus</h2>
          <table>
            <thead>
              <tr><th>Kasus</th><th>Client / Modul / PIC</th><th>Pengajuan / Selesai</th><th>Deadline</th><th>Status</th><th>Prioritas</th><th>Info</th><th>Tugas</th><th>Note</th></tr>
            </thead>
            <tbody>${projectRows || `<tr><td colspan="9">Belum ada kasus.</td></tr>`}</tbody>
          </table>

          <h2>Daftar Tugas</h2>
          <table>
            <thead>
              <tr><th>Target</th><th>Kasus</th><th>Pekerjaan</th><th>Status Tugas</th><th>Status Kasus</th><th>Prioritas</th></tr>
            </thead>
            <tbody>${taskRows || `<tr><td colspan="6">Belum ada tugas.</td></tr>`}</tbody>
          </table>

          <h2>Note Progress</h2>
          <table>
            <thead>
              <tr><th>Tanggal</th><th>Kasus</th><th>Note</th><th>Status Kasus</th><th>Prioritas</th></tr>
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

  const openNewCase = (clientName = "", moduleName = "") => {
    resetForm();
    setClient(clientName === UNASSIGNED_CLIENT ? "" : clientName);
    setModule(moduleName === UNASSIGNED_MODULE ? "" : moduleName);
    openMenuPage("tambah");
  };

  const browseCases = (clientName: string, moduleName = "") => {
    setFilterClient(clientName);
    setFilterModule(moduleName);
    setSearch("");
    setFilterStatus("");
    setFilterPriority("");
    const first = projects.find(
      (item) =>
        (item.client || UNASSIGNED_CLIENT).toLowerCase() ===
          clientName.toLowerCase() &&
        (!moduleName ||
          (item.module || UNASSIGNED_MODULE).toLowerCase() ===
            moduleName.toLowerCase()),
    );
    setSelectedProjectId(first?.id ?? "");
    openMenuPage("project");
  };

  const selectCase = (project: WorkProject) => {
    setSelectedProjectId(project.id);
    window.setTimeout(() => {
      if (window.innerWidth < 1024)
        document
          .getElementById("case-detail")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };

  const resetFilters = () => {
    setSearch("");
    setFilterClient("");
    setFilterModule("");
    setFilterStatus("");
    setFilterPriority("");
  };
  const panelClass = `min-w-0 rounded-[18px] border ${borderColor} ${cardBg} p-4`;
  const buttonClass =
    "min-h-[36px] rounded-xl bg-[#A7F3D0] px-3 py-2 text-[13px] font-semibold text-[#111214] disabled:opacity-60";
  const secondaryButton = `min-h-[36px] rounded-xl border ${borderColor} ${softCardBg} px-3 py-2 text-[13px] font-medium disabled:opacity-60`;
  const smallAccent = isDarkMode ? "text-[#A7F3D0]" : "text-emerald-700";
  const stats = [
    [
      "Kasus Aktif",
      filteredProjects.filter((item) => item.status !== "Selesai").length,
    ],
    [
      "Deadline Dekat",
      filteredProjects.filter(
        (item) =>
          item.status !== "Selesai" &&
          getDaysLeft(item.deadlineDate) !== null &&
          getDaysLeft(item.deadlineDate)! >= 0 &&
          getDaysLeft(item.deadlineDate)! <= 3,
      ).length,
    ],
    [
      "Lewat Deadline",
      filteredProjects.filter(
        (item) =>
          item.status !== "Selesai" &&
          getDaysLeft(item.deadlineDate) !== null &&
          getDaysLeft(item.deadlineDate)! < 0,
      ).length,
    ],
    [
      "Menunggu",
      filteredProjects.filter((item) => item.status === "Menunggu").length,
    ],
    [
      "Selesai Hari Ini",
      filteredProjects.filter(
        (item) =>
          item.status === "Selesai" &&
          item.completedDate === getTodayInputDate(),
      ).length,
    ],
    ["Tugas Pending", reportTaskRows.filter((item) => !item.isDone).length],
  ];

  const renderFilters = () => (
    <div className="space-y-3">
      <label className="block">
        <span className={`mb-1 block text-[12px] font-medium ${mutedText}`}>
          Cari maintenance
        </span>
        <input
          aria-label="Cari maintenance"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className={inputClass}
          placeholder="Kasus, PIC, client, modul, atau Blade/Form"
        />
      </label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="min-w-0">
          <span className={`mb-1 block text-[12px] font-medium ${mutedText}`}>
            Client
          </span>
          <select
            aria-label="Filter client"
            className={inputClass}
            value={filterClient}
            onChange={(event) => {
              setFilterClient(event.target.value);
              setFilterModule("");
            }}
          >
            <option value="">Semua client</option>
            {filterClientOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0">
          <span className={`mb-1 block text-[12px] font-medium ${mutedText}`}>
            Modul/Topik
          </span>
          <select
            aria-label="Filter modul"
            className={inputClass}
            value={filterModule}
            onChange={(event) => setFilterModule(event.target.value)}
          >
            <option value="">Semua modul/topik</option>
            {filterModuleOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0">
          <span className={`mb-1 block text-[12px] font-medium ${mutedText}`}>
            Status
          </span>
          <select
            aria-label="Filter status"
            className={inputClass}
            value={filterStatus}
            onChange={(event) =>
              setFilterStatus(event.target.value as ProjectStatus | "")
            }
          >
            <option value="">Semua status</option>
            {statusOptions.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label className="min-w-0">
          <span className={`mb-1 block text-[12px] font-medium ${mutedText}`}>
            Prioritas
          </span>
          <select
            aria-label="Filter prioritas"
            className={inputClass}
            value={filterPriority}
            onChange={(event) =>
              setFilterPriority(event.target.value as ProjectPriority | "")
            }
          >
            <option value="">Semua prioritas</option>
            {priorityOptions.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
      </div>
      {(search ||
        filterClient ||
        filterModule ||
        filterStatus ||
        filterPriority) && (
        <button
          type="button"
          onClick={resetFilters}
          className={`text-[12px] font-bold ${smallAccent}`}
        >
          Reset semua filter
        </button>
      )}
    </div>
  );

  const renderCaseCard = (project: WorkProject, selected = false) => (
    <button
      type="button"
      key={project.id}
      onClick={() => selectCase(project)}
      className={`w-full min-w-0 rounded-2xl border p-3 text-left ${selected ? "border-emerald-400 bg-emerald-400/10" : `${borderColor} ${softCardBg}`}`}
    >
      <p className={`mb-2 break-words text-[12px] font-bold ${smallAccent}`}>
        {getCaseContext(project)}
      </p>
      <h3 className="break-words text-[13px] font-semibold">{project.title}</h3>
      <p className={`mt-2 break-words text-[12px] ${mutedText}`}>
        PIC peminta: {project.requesterPic || "Belum diisi"}
      </p>
      {project.bladeForm && (
        <p className={`mt-1 break-all text-[12px] ${mutedText}`}>
          Blade/Form: {project.bladeForm}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2 text-[12px] font-bold">
        <span className={`rounded-full px-3 py-1 ${getDeadlineClass(project)}`}>
          {getDeadlineLabel(project)}
        </span>
        <span className={`rounded-full border ${borderColor} px-3 py-1`}>
          {project.status}
        </span>
        <span className={`rounded-full border ${borderColor} px-3 py-1`}>
          {project.priority}
        </span>
        <span className={`rounded-full border ${borderColor} px-3 py-1`}>
          {project.caseKind}
        </span>
      </div>
      <p className={`mt-3 text-[12px] ${mutedText}`}>
        Diajukan {formatInputDate(project.masukDate)}
        {project.completedDate
          ? ` · Selesai ${formatInputDate(project.completedDate)}`
          : ""}
      </p>
      {project.status === "Menunggu" && project.waitingReason && (
        <p className={`mt-2 break-words text-[12px] ${mutedText}`}>
          Menunggu: {project.waitingReason}
        </p>
      )}
    </button>
  );

  if (isCheckingAuth)
    return (
      <main className={`min-h-screen ${pageBg} p-6`}>Memeriksa login...</main>
    );

  if (!currentUser)
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#111214] p-6 text-white">
        <section className="w-full max-w-md rounded-[2rem] border border-[#2B2F34] bg-[#1A1C1F] p-6 shadow-2xl">
          <div className="mb-6 text-center">
            <div className="mb-3 text-[24px]">🗂️</div>
            <h1 className="text-[18px] font-semibold">Office Tracker</h1>
            <p className="mt-2 text-[13px] text-[#B8BDC7]">
              Maintenance, PIC, dan progress kerja dalam satu tempat.
            </p>
          </div>
          <form onSubmit={handleLogin} className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-[12px] font-bold text-[#B8BDC7]">
                Username
              </span>
              <input
                autoComplete="username"
                value={loginUsername}
                onChange={(event) => setLoginUsername(event.target.value)}
                className={inputClass}
                required
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-bold text-[#B8BDC7]">
                Password
              </span>
              <input
                autoComplete="current-password"
                type="password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
                className={inputClass}
                required
              />
            </label>
            <button disabled={isLoggingIn} className={`w-full ${buttonClass}`}>
              {isLoggingIn ? "Masuk..." : "Masuk"}
            </button>
          </form>
        </section>
      </main>
    );

  return (
    <main className={`min-h-screen pb-24 text-[13px] leading-[1.5] ${pageBg}`}>
      <section className="mx-auto max-w-6xl px-3 py-3 sm:px-5 sm:py-4">
        <header className={`mb-4 ${panelClass}`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p
                className={`text-[12px] font-bold uppercase tracking-wide ${smallAccent}`}
              >
                Office Tracker · Maintenance
              </p>
              <h1 className="mt-1 break-words text-[18px] font-semibold">
                Hai, {username}
              </h1>
              <p className={`mt-1 text-[13px] ${mutedText}`}>
                Client → Modul/Topik → Kasus Maintenance
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => openNewCase()}
                className={buttonClass}
              >
                ＋ Kasus
              </button>
              <button
                type="button"
                onClick={() => setIsDarkMode((value) => !value)}
                className={secondaryButton}
                aria-label="Ganti tema"
              >
                {isDarkMode ? "☀️" : "🌙"}
              </button>
              <button
                type="button"
                onClick={() => signOut(auth)}
                className="rounded-xl bg-red-100 px-3 py-2 text-[13px] font-semibold text-red-700"
              >
                Logout
              </button>
            </div>
          </div>
        </header>

        {isLoadingProjects && (
          <p role="status" className={`mb-4 text-[13px] ${mutedText}`}>
            Memuat data maintenance...
          </p>
        )}

        {activeMenu === "dashboard" && (
          <div className="space-y-3">
            <section className={panelClass}>
              <div className="mb-4">
                <h2 className="text-[15px] font-semibold">
                  Ringkasan Maintenance
                </h2>
                <p className={`mt-1 text-[13px] ${mutedText}`}>
                  Gunakan filter untuk fokus ke client, modul, atau PIC
                  tertentu.
                </p>
              </div>
              {renderFilters()}
            </section>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {stats.map(([label, value]) => (
                <div key={label} className={panelClass}>
                  <p className={`text-[12px] font-medium ${mutedText}`}>
                    {label}
                  </p>
                  <p className="mt-2 text-[24px] font-semibold">{value}</p>
                </div>
              ))}
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <section className={panelClass}>
                <h2 className="mb-0.5 text-[16px] font-semibold">
                  Perlu Dikerjakan
                </h2>
                <p className={`mb-4 text-[13px] ${mutedText}`}>
                  Kasus aktif diurutkan dari deadline paling awal.
                </p>
                <div className="space-y-3">
                  {filteredProjects
                    .filter((item) => item.status !== "Selesai")
                    .sort(
                      (a, b) =>
                        getDeadlineSortValue(a.deadlineDate) -
                        getDeadlineSortValue(b.deadlineDate),
                    )
                    .slice(0, 5)
                    .map((project) => (
                      <div
                        key={project.id}
                        onClick={() => openMenuPage("project")}
                      >
                        {renderCaseCard(project)}
                      </div>
                    ))}
                </div>
                {!filteredProjects.some(
                  (item) => item.status !== "Selesai",
                ) && (
                  <p className={mutedText}>
                    Belum ada kasus aktif sesuai filter.
                  </p>
                )}
              </section>
              <section className={panelClass}>
                <h2 className="mb-0.5 text-[16px] font-semibold">
                  Menunggu Tindak Lanjut
                </h2>
                <p className={`mb-4 text-[13px] ${mutedText}`}>
                  Lihat hal yang masih ditunggu agar tidak terlupakan.
                </p>
                <div className="space-y-3">
                  {filteredProjects
                    .filter((item) => item.status === "Menunggu")
                    .slice(0, 5)
                    .map((project) => (
                      <div
                        key={project.id}
                        onClick={() => openMenuPage("project")}
                      >
                        {renderCaseCard(project)}
                      </div>
                    ))}
                </div>
                {!filteredProjects.some(
                  (item) => item.status === "Menunggu",
                ) && (
                  <p className={mutedText}>
                    Tidak ada kasus menunggu sesuai filter.
                  </p>
                )}
              </section>
            </div>
          </div>
        )}

        {activeMenu === "client" && (
          <div className="space-y-3">
            <section className={panelClass}>
              <h2 className="text-[16px] font-semibold">Client</h2>
              <p className={`mt-1 mb-4 text-[13px] ${mutedText}`}>
                Pilih client untuk melihat modul/topik dan kasusnya.
              </p>
              <input
                aria-label="Cari client"
                className={inputClass}
                value={clientHubSearch}
                onChange={(event) => setClientHubSearch(event.target.value)}
                placeholder="Cari nama client"
              />
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filterClientOptions
                  .filter((name) =>
                    name
                      .toLowerCase()
                      .includes(clientHubSearch.trim().toLowerCase()),
                  )
                  .map((name) => {
                    const rows = projects.filter(
                      (item) =>
                        (item.client || UNASSIGNED_CLIENT).toLowerCase() ===
                        name.toLowerCase(),
                    );
                    return (
                      <button
                        type="button"
                        key={name}
                        onClick={() => setClientHubSelection(name)}
                        className={`rounded-2xl border p-3 text-left ${clientHubSelection === name ? "border-emerald-400 bg-emerald-400/10" : `${borderColor} ${softCardBg}`}`}
                      >
                        <h3 className="break-words text-[13px] font-semibold">
                          {name}
                        </h3>
                        <p className={`mt-1 text-[12px] ${mutedText}`}>
                          {
                            uniqueLabels(
                              rows.map((item) => item.module).filter(Boolean),
                            ).length
                          }{" "}
                          modul/topik · {rows.length} kasus
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
                          <span>
                            {
                              rows.filter((item) => item.status !== "Selesai")
                                .length
                            }{" "}
                            aktif
                          </span>
                          <span>
                            ·{" "}
                            {
                              rows.filter((item) => item.status === "Menunggu")
                                .length
                            }{" "}
                            menunggu
                          </span>
                          <span>
                            ·{" "}
                            {
                              rows.filter((item) => item.status === "Selesai")
                                .length
                            }{" "}
                            selesai
                          </span>
                        </div>
                      </button>
                    );
                  })}
              </div>
            </section>
            <section className={panelClass}>
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:justify-between">
                <div>
                  <h2 className="text-[16px] font-semibold">
                    {clientHubSelection}
                  </h2>
                  <p className={`mt-1 text-[13px] ${mutedText}`}>
                    Modul dan topik khusus client ini.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={secondaryButton}
                    onClick={() => browseCases(clientHubSelection)}
                  >
                    Semua kasus
                  </button>
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={() => openNewCase(clientHubSelection)}
                  >
                    ＋ Kasus baru
                  </button>
                </div>
              </div>
              {hubModules.length === 0 ? (
                <p className={`text-[13px] ${mutedText}`}>
                  Belum ada modul. Tambahkan kasus pertama, lalu isi nama
                  modul/topik yang kamu tangani.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {hubModules.map((name) => {
                    const rows = hubProjects.filter(
                      (item) =>
                        (item.module || UNASSIGNED_MODULE).toLowerCase() ===
                        name.toLowerCase(),
                    );
                    return (
                      <div
                        key={name}
                        className={`min-w-0 rounded-2xl border ${borderColor} ${softCardBg} p-4`}
                      >
                        <h3 className="break-words text-[13px] font-semibold">
                          {name}
                        </h3>
                        <p className={`mt-2 text-[13px] ${mutedText}`}>
                          {rows.length} kasus ·{" "}
                          {
                            rows.filter((item) => item.status !== "Selesai")
                              .length
                          }{" "}
                          aktif
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={secondaryButton}
                            onClick={() =>
                              browseCases(clientHubSelection, name)
                            }
                          >
                            Lihat kasus
                          </button>
                          <button
                            type="button"
                            className={buttonClass}
                            onClick={() =>
                              openNewCase(clientHubSelection, name)
                            }
                          >
                            ＋ Kasus
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className={`mt-4 text-[12px] ${mutedText}`}>
                Client dan modul baru tersedia kembali setelah kasusnya
                disimpan. Data lama tanpa modul tetap ditampilkan sebagai “Tanpa
                modul”.
              </p>
            </section>
          </div>
        )}

        {activeMenu === "tambah" && (
          <section className={`mx-auto max-w-3xl ${panelClass}`}>
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-[16px] font-semibold">
                  {editingProjectId
                    ? "Edit Kasus Maintenance"
                    : "Tambah Kasus Maintenance"}
                </h2>
                <p className={`mt-1 text-[13px] ${mutedText}`}>
                  Catat satu masalah atau permintaan sebagai satu kasus.
                </p>
              </div>
              {editingProjectId && (
                <button
                  type="button"
                  className={secondaryButton}
                  onClick={() => {
                    resetForm();
                    openMenuPage("project");
                  }}
                >
                  Batal edit
                </button>
              )}
            </div>
            <form onSubmit={saveProject} className="space-y-4">
              <div className="space-y-3">
                <h3
                  className={`text-[11px] font-semibold uppercase tracking-wide ${mutedText}`}
                >
                  Identitas maintenance
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block min-w-0">
                    <span
                      className={`mb-1 block text-[12px] font-medium ${mutedText}`}
                    >
                      Client *
                    </span>
                    <input
                      aria-label="Client kasus"
                      list="office-client-options"
                      className={inputClass}
                      value={client}
                      onChange={(event) => {
                        setClient(event.target.value);
                        setModule("");
                      }}
                      required
                      placeholder="Pilih / ketik client baru"
                      maxLength={100}
                    />
                    <datalist id="office-client-options">
                      {clientOptions.map((name) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                  </label>
                  <label className="block min-w-0">
                    <span
                      className={`mb-1 block text-[12px] font-medium ${mutedText}`}
                    >
                      Modul/Topik *
                    </span>
                    <input
                      aria-label="Modul kasus"
                      list="office-module-options"
                      className={inputClass}
                      value={module}
                      onChange={(event) => setModule(event.target.value)}
                      required
                      disabled={!client.trim()}
                      placeholder="Contoh: Kasbank, SPB, General Ledger"
                      maxLength={100}
                    />
                    <datalist id="office-module-options">
                      {moduleOptions.map((name) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                  </label>
                </div>
                <p className={`text-[12px] ${mutedText}`}>
                  Pilihan modul mengikuti client. Ketik nama baru jika
                  modul/topiknya belum tersedia.
                </p>
                <label className="block">
                  <span
                    className={`mb-1 block text-[12px] font-medium ${mutedText}`}
                  >
                    Judul kasus *
                  </span>
                  <input
                    aria-label="Judul kasus"
                    className={inputClass}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    required
                    placeholder="Contoh: detail bukti pembayaran tidak muncul"
                    maxLength={200}
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span
                      className={`mb-1 block text-[12px] font-medium ${mutedText}`}
                    >
                      PIC peminta maintenance *
                    </span>
                    <input
                      aria-label="PIC peminta"
                      className={inputClass}
                      value={requesterPic}
                      onChange={(event) => setRequesterPic(event.target.value)}
                      required
                      placeholder="Nama orang yang mengajukan"
                      maxLength={150}
                    />
                  </label>
                  <label className="block">
                    <span
                      className={`mb-1 block text-[12px] font-medium ${mutedText}`}
                    >
                      Blade/Form <span className="font-normal">(opsional)</span>
                    </span>
                    <input
                      aria-label="Blade/Form"
                      className={inputClass}
                      value={bladeForm}
                      onChange={(event) => setBladeForm(event.target.value)}
                      placeholder="Contoh: fKasBank.blade.php"
                      maxLength={500}
                    />
                  </label>
                </div>
              </div>
              <div className={`space-y-3 border-t ${borderColor} pt-4`}>
                <h3
                  className={`text-[11px] font-semibold uppercase tracking-wide ${mutedText}`}
                >
                  Jadwal & status
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span
                      className={`mb-1 block text-[12px] font-medium ${mutedText}`}
                    >
                      Tanggal pengajuan *
                    </span>
                    <input
                      aria-label="Tanggal pengajuan"
                      type="date"
                      className={inputClass}
                      value={masukDate}
                      onChange={(event) => setMasukDate(event.target.value)}
                      max={getTodayInputDate()}
                      required
                    />
                  </label>
                  <label className="block">
                    <span
                      className={`mb-1 block text-[12px] font-medium ${mutedText}`}
                    >
                      Deadline <span className="font-normal">(opsional)</span>
                    </span>
                    <input
                      aria-label="Deadline kasus"
                      type="date"
                      className={inputClass}
                      value={deadlineDate}
                      onChange={(event) => setDeadlineDate(event.target.value)}
                    />
                    {deadlineDate && (
                      <button
                        type="button"
                        className={`mt-1 text-[12px] font-bold ${smallAccent}`}
                        onClick={() => setDeadlineDate("")}
                      >
                        Kosongkan deadline
                      </button>
                    )}
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block">
                    <span
                      className={`mb-1 block text-[12px] font-medium ${mutedText}`}
                    >
                      Jenis
                    </span>
                    <select
                      aria-label="Jenis kasus"
                      className={inputClass}
                      value={caseKind}
                      onChange={(event) =>
                        setCaseKind(event.target.value as CaseKind)
                      }
                    >
                      {caseKinds.map((name) => (
                        <option key={name}>{name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span
                      className={`mb-1 block text-[12px] font-medium ${mutedText}`}
                    >
                      Status
                    </span>
                    <select
                      aria-label="Status kasus"
                      className={inputClass}
                      value={status}
                      onChange={(event) => {
                        const next = event.target.value as ProjectStatus;
                        setStatus(next);
                        if (next === "Selesai" && !completedDate)
                          setCompletedDate(getTodayInputDate());
                      }}
                    >
                      {statusOptions.map((name) => (
                        <option key={name}>{name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span
                      className={`mb-1 block text-[12px] font-medium ${mutedText}`}
                    >
                      Prioritas
                    </span>
                    <select
                      aria-label="Prioritas kasus"
                      className={inputClass}
                      value={priority}
                      onChange={(event) =>
                        setPriority(event.target.value as ProjectPriority)
                      }
                    >
                      {priorityOptions.map((name) => (
                        <option key={name}>{name}</option>
                      ))}
                    </select>
                  </label>
                </div>
                {status === "Menunggu" && (
                  <label className="block">
                    <span
                      className={`mb-1 block text-[12px] font-medium ${mutedText}`}
                    >
                      Sedang menunggu apa? *
                    </span>
                    <textarea
                      aria-label="Keterangan menunggu"
                      className={`${inputClass} min-h-24`}
                      value={waitingReason}
                      onChange={(event) => setWaitingReason(event.target.value)}
                      required
                      placeholder="Contoh: menunggu data / konfirmasi dari PIC"
                    />
                  </label>
                )}
                {status === "Selesai" && (
                  <label className="block">
                    <span
                      className={`mb-1 block text-[12px] font-medium ${mutedText}`}
                    >
                      Tanggal selesai *
                    </span>
                    <input
                      aria-label="Tanggal selesai di form"
                      type="date"
                      className={inputClass}
                      value={completedDate}
                      onChange={(event) => setCompletedDate(event.target.value)}
                      min={masukDate || undefined}
                      max={getTodayInputDate()}
                      required
                    />
                    <span className={`mt-1 block text-[12px] ${mutedText}`}>
                      Pilih tanggal pekerjaan benar-benar selesai, walaupun baru
                      dicatat hari ini.
                    </span>
                  </label>
                )}
              </div>
              <div className={`space-y-3 border-t ${borderColor} pt-4`}>
                <label className="block">
                  <span
                    className={`mb-1 block text-[12px] font-medium ${mutedText}`}
                  >
                    Deskripsi / catatan awal
                  </span>
                  <textarea
                    aria-label="Deskripsi kasus"
                    className={`${inputClass} min-h-24`}
                    value={projectNotes}
                    onChange={(event) => setProjectNotes(event.target.value)}
                    placeholder="Masalah, kebutuhan, link, atau catatan penting"
                  />
                </label>
              </div>
              <button disabled={isSaving} className={`w-full ${buttonClass}`}>
                {isSaving
                  ? "Menyimpan..."
                  : editingProjectId
                    ? "Simpan perubahan"
                    : "Simpan kasus"}
              </button>
            </form>
          </section>
        )}

        {activeMenu === "project" && (
          <div className="grid items-start gap-3 lg:grid-cols-[0.95fr_1.05fr]">
            <section className={panelClass}>
              <div className="mb-4 flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-[16px] font-semibold">
                    Kasus Maintenance
                  </h2>
                  <p className={`mt-1 text-[13px] ${mutedText}`}>
                    {filteredProjects.length} kasus sesuai filter
                  </p>
                </div>
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={isLoadingProjects}
                  onClick={fetchProjects}
                >
                  Refresh
                </button>
              </div>
              {renderFilters()}
              <div className="mt-4 space-y-3">
                {filteredProjects.map((project) =>
                  renderCaseCard(project, project.id === selectedProjectId),
                )}
              </div>
              {!isLoadingProjects && filteredProjects.length === 0 && (
                <p className={`mt-4 text-[13px] ${mutedText}`}>
                  Belum ada kasus sesuai filter.
                </p>
              )}
            </section>
            <section id="case-detail" className={`${panelClass} scroll-mt-4`}>
              {!selectedProject ||
              !filteredProjects.some(
                (item) => item.id === selectedProject.id,
              ) ? (
                <p className={mutedText}>
                  Pilih kasus dari daftar untuk melihat detail, tugas, dan
                  progress.
                </p>
              ) : (
                <div className="space-y-3">
                  <div>
                    <p
                      className={`mb-2 break-words text-[12px] font-bold ${smallAccent}`}
                    >
                      {getCaseContext(selectedProject)}
                    </p>
                    <h2 className="break-words text-[16px] font-semibold">
                      {selectedProject.title}
                    </h2>
                    <div className="mt-3 flex flex-wrap gap-2 text-[12px] font-bold">
                      <span
                        className={`rounded-full px-3 py-1 ${getDeadlineClass(selectedProject)}`}
                      >
                        {getDeadlineLabel(selectedProject)}
                      </span>
                      <span
                        className={`rounded-full border ${borderColor} px-3 py-1`}
                      >
                        {selectedProject.status}
                      </span>
                      <span
                        className={`rounded-full border ${borderColor} px-3 py-1`}
                      >
                        {selectedProject.priority}
                      </span>
                      <span
                        className={`rounded-full border ${borderColor} px-3 py-1`}
                      >
                        {selectedProject.caseKind}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {[
                      [
                        "PIC peminta",
                        selectedProject.requesterPic || "Belum diisi",
                      ],
                      [
                        "Blade/Form",
                        selectedProject.bladeForm || "Tidak diisi",
                      ],
                      [
                        "Tanggal pengajuan",
                        formatInputDate(selectedProject.masukDate),
                      ],
                      [
                        "Tanggal selesai",
                        selectedProject.completedDate
                          ? formatInputDate(selectedProject.completedDate)
                          : selectedProject.status === "Selesai"
                            ? "Belum tercatat — pilih tanggal"
                            : "Belum selesai",
                      ],
                      [
                        "Deadline",
                        selectedProject.deadlineDate
                          ? formatInputDate(selectedProject.deadlineDate)
                          : "Tanpa deadline",
                      ],
                      [
                        "Terakhir diperbarui",
                        selectedProject.updatedAtMillis
                          ? new Date(
                              selectedProject.updatedAtMillis,
                            ).toLocaleString("id-ID")
                          : selectedProject.createdAtText,
                      ],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className={`min-w-0 rounded-2xl ${softCardBg} p-3`}
                      >
                        <p className={`text-[12px] font-medium ${mutedText}`}>
                          {label}
                        </p>
                        <p className="mt-1 break-words text-[13px] font-bold">
                          {value}
                        </p>
                      </div>
                    ))}
                  </div>
                  {selectedProject.waitingReason &&
                    selectedProject.status === "Menunggu" && (
                      <div className={`rounded-2xl border ${borderColor} p-4`}>
                        <p
                          className={`mb-1 text-[12px] font-medium ${mutedText}`}
                        >
                          Sedang menunggu
                        </p>
                        <p className="whitespace-pre-wrap break-words text-[13px]">
                          {selectedProject.waitingReason}
                        </p>
                      </div>
                    )}
                  {selectedProject.notes && (
                    <div className={`rounded-2xl ${softCardBg} p-3`}>
                      <p
                        className={`mb-2 text-[12px] font-medium ${mutedText}`}
                      >
                        Deskripsi / catatan awal
                      </p>
                      <p className="whitespace-pre-wrap break-words text-[13px] leading-5">
                        {selectedProject.notes}
                      </p>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openCompletion(selectedProject)}
                      className={buttonClass}
                    >
                      {selectedProject.status === "Selesai"
                        ? "Ubah tanggal selesai"
                        : "✓ Beres"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        startEditProject(selectedProject);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                      className={secondaryButton}
                    >
                      Edit kasus
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedHistoryProjectId(selectedProject.id);
                        openMenuPage("riwayat");
                      }}
                      className={secondaryButton}
                    >
                      Riwayat
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteProject(selectedProject)}
                      className="rounded-xl bg-red-100 px-3 py-2 text-[13px] font-semibold text-red-700"
                    >
                      Hapus
                    </button>
                  </div>
                  <div>
                    <h3 className="mb-3 font-semibold">Tugas kasus ini</h3>
                    <div className="space-y-2">
                      {tasks
                        .filter((item) => item.projectId === selectedProject.id)
                        .map((task) => (
                          <div
                            key={task.id}
                            className={`flex items-start gap-3 rounded-2xl ${softCardBg} p-3`}
                          >
                            <button
                              type="button"
                              onClick={() => toggleTaskDone(task)}
                              aria-label={
                                task.isDone
                                  ? "Batalkan selesai tugas"
                                  : "Selesaikan tugas"
                              }
                              className={`shrink-0 rounded-xl border ${borderColor} px-3 py-2 ${smallAccent}`}
                            >
                              {task.isDone ? "✓" : "○"}
                            </button>
                            <div className="min-w-0">
                              <p
                                className={`whitespace-pre-wrap break-words text-[13px] ${task.isDone ? "line-through" : ""}`}
                              >
                                {task.title}
                              </p>
                              <p className={`mt-1 text-[12px] ${mutedText}`}>
                                Target {formatInputDate(task.taskDate)}
                              </p>
                            </div>
                          </div>
                        ))}
                    </div>
                    {!tasks.some(
                      (item) => item.projectId === selectedProject.id,
                    ) && (
                      <p className={`text-[13px] ${mutedText}`}>
                        Belum ada tugas.
                      </p>
                    )}
                    {selectedProject.status !== "Selesai" && (
                      <button
                        type="button"
                        className={`mt-3 text-[13px] font-bold ${smallAccent}`}
                        onClick={() => {
                          setTaskProjectId(selectedProject.id);
                          openMenuPage("tugas");
                        }}
                      >
                        ＋ Tambah tugas
                      </button>
                    )}
                  </div>
                  <form
                    onSubmit={saveNote}
                    className={`rounded-2xl border ${borderColor} ${softCardBg} p-4`}
                  >
                    <h3 className="mb-3 font-semibold">
                      Tambah catatan progress
                    </h3>
                    <label className="block">
                      <span className={`mb-1 block text-[12px] ${mutedText}`}>
                        Tanggal catatan
                      </span>
                      <input
                        type="date"
                        className={inputClass}
                        value={noteDate}
                        onChange={(event) => setNoteDate(event.target.value)}
                        required
                      />
                    </label>
                    <textarea
                      aria-label="Catatan progress"
                      className={`mt-3 ${inputClass} min-h-24`}
                      value={noteText}
                      onChange={(event) => setNoteText(event.target.value)}
                      required
                      placeholder="Progress, hasil follow up, link, atau revisi..."
                    />
                    <button
                      disabled={isSavingNote}
                      className={`mt-3 w-full ${buttonClass}`}
                    >
                      {isSavingNote ? "Menyimpan..." : "Simpan progress"}
                    </button>
                  </form>
                  <div>
                    <h3 className="mb-3 font-semibold">Catatan Progress</h3>
                    <div className="space-y-3">
                      {selectedProjectNotes.map((note) => (
                        <div
                          key={note.id}
                          className={`rounded-2xl ${softCardBg} p-3`}
                        >
                          <div className="mb-2 flex justify-between gap-2">
                            <p className="text-[12px] font-bold">
                              {formatInputDate(note.noteDate)}
                            </p>
                            <button
                              type="button"
                              onClick={() => deleteNote(note.id)}
                              className="text-[12px] font-bold text-red-500"
                            >
                              Hapus
                            </button>
                          </div>
                          <p className="whitespace-pre-wrap break-words text-[13px] leading-5">
                            {note.note}
                          </p>
                        </div>
                      ))}
                    </div>
                    {selectedProjectNotes.length === 0 && (
                      <p className={`text-[13px] ${mutedText}`}>
                        Belum ada catatan progress.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {activeMenu === "riwayat" && (
          <div className="grid gap-3 lg:grid-cols-2">
            <section className={panelClass}>
              <h2 className="mb-4 text-[16px] font-semibold">
                Riwayat per Kasus
              </h2>
              {renderFilters()}
              <div className="mt-4 space-y-3">
                {historyProjectRows.map((project) => (
                  <button
                    type="button"
                    key={project.id}
                    onClick={() => setSelectedHistoryProjectId(project.id)}
                    className={`w-full rounded-2xl border p-3 text-left ${selectedHistoryProject?.id === project.id ? "border-emerald-400 bg-emerald-400/10" : `${borderColor} ${softCardBg}`}`}
                  >
                    <p
                      className={`mb-1 break-words text-[12px] font-bold ${smallAccent}`}
                    >
                      {getCaseContext(project)}
                    </p>
                    <p className="break-words text-[13px] font-semibold">
                      {project.title}
                    </p>
                    <p className={`mt-2 text-[12px] ${mutedText}`}>
                      PIC: {project.requesterPic || "Belum diisi"} ·{" "}
                      {project.activityCount} aktivitas
                    </p>
                    <p className={`mt-1 text-[12px] ${mutedText}`}>
                      Terakhir: {project.lastActivityText}
                    </p>
                  </button>
                ))}
              </div>
              {historyProjectRows.length === 0 && (
                <p className={`mt-4 text-[13px] ${mutedText}`}>
                  Belum ada riwayat sesuai filter.
                </p>
              )}
            </section>
            <section className={panelClass}>
              {!selectedHistoryProject ? (
                <p className={mutedText}>Pilih kasus untuk melihat riwayat.</p>
              ) : (
                <>
                  <h2 className="break-words text-[16px] font-semibold">
                    {selectedHistoryProject.title}
                  </h2>
                  <p className={`mt-1 break-words text-[13px] ${mutedText}`}>
                    {getCaseContext(selectedHistoryProject)}
                  </p>
                  <button
                    type="button"
                    className={`mt-3 ${secondaryButton}`}
                    onClick={() => {
                      setSelectedProjectId(selectedHistoryProject.id);
                      openMenuPage("project");
                    }}
                  >
                    Buka detail kasus
                  </button>
                  <div className="mt-5 space-y-3">
                    {selectedHistoryActivities.map((activity) => (
                      <div
                        key={activity.id}
                        className={`rounded-2xl ${softCardBg} p-3`}
                      >
                        <p className={`text-[12px] ${mutedText}`}>
                          {activity.date}
                        </p>
                        <h3 className="mt-2 break-words text-[13px] font-semibold">
                          {activity.icon} {activity.title}
                        </h3>
                        {activity.note && (
                          <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-5">
                            {activity.note}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>
          </div>
        )}

        {activeMenu === "tugas" && (
          <div className="grid items-start gap-3 lg:grid-cols-[0.9fr_1.1fr]">
            <section className={panelClass}>
              <h2 className="mb-4 text-[16px] font-semibold">Tambah Tugas</h2>
              <form onSubmit={saveTask} className="space-y-3">
                <label className="block">
                  <span
                    className={`mb-1 block text-[12px] font-medium ${mutedText}`}
                  >
                    Kasus aktif
                  </span>
                  <select
                    aria-label="Kasus tugas"
                    className={inputClass}
                    value={taskProjectId}
                    onChange={(event) => setTaskProjectId(event.target.value)}
                    required
                  >
                    <option value="">Pilih kasus</option>
                    {taskProjectOptions.map((project) => (
                      <option key={project.id} value={project.id}>
                        {getCaseOption(project)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span
                    className={`mb-1 block text-[12px] font-medium ${mutedText}`}
                  >
                    Pekerjaan
                  </span>
                  <textarea
                    className={`${inputClass} min-h-24`}
                    value={taskTitle}
                    onChange={(event) => setTaskTitle(event.target.value)}
                    required
                    placeholder="Pekerjaan kecil untuk menyelesaikan kasus"
                  />
                </label>
                <label className="block">
                  <span
                    className={`mb-1 block text-[12px] font-medium ${mutedText}`}
                  >
                    Target tanggal
                  </span>
                  <input
                    type="date"
                    className={inputClass}
                    value={taskDate}
                    onChange={(event) => setTaskDate(event.target.value)}
                    required
                  />
                </label>
                <button
                  disabled={isSavingTask || taskProjectOptions.length === 0}
                  className={`w-full ${buttonClass}`}
                >
                  {isSavingTask ? "Menyimpan..." : "Simpan tugas"}
                </button>
              </form>
              {taskProjectOptions.length === 0 && (
                <p className={`mt-3 text-[12px] ${mutedText}`}>
                  Tambahkan kasus aktif terlebih dahulu.
                </p>
              )}
            </section>
            <section className={panelClass}>
              <h2 className="text-[16px] font-semibold">Tugas Pending</h2>
              <p className={`mt-1 mb-4 text-[13px] ${mutedText}`}>
                {pendingTasks.length} pekerjaan belum selesai
              </p>
              <div className="space-y-3">
                {pendingTasks.map((task) => {
                  const project = projects.find(
                    (item) => item.id === task.projectId,
                  );
                  return (
                    <div
                      key={task.id}
                      className={`rounded-2xl ${softCardBg} p-3`}
                    >
                      <p className="whitespace-pre-wrap break-words text-[13px] font-semibold">
                        {task.title}
                      </p>
                      <p
                        className={`mt-2 break-words text-[12px] ${mutedText}`}
                      >
                        {project
                          ? getCaseOption(project)
                          : "Kasus tidak ditemukan"}
                      </p>
                      <p className={`mt-1 text-[12px] ${mutedText}`}>
                        Target {formatInputDate(task.taskDate)}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={buttonClass}
                          onClick={() => toggleTaskDone(task)}
                        >
                          ✓ Selesai
                        </button>
                        {project && (
                          <button
                            type="button"
                            className={secondaryButton}
                            onClick={() => {
                              resetFilters();
                              setSelectedProjectId(project.id);
                              openMenuPage("project");
                            }}
                          >
                            Buka kasus
                          </button>
                        )}
                        <button
                          type="button"
                          className="px-3 py-2 text-[12px] font-bold text-red-500"
                          onClick={() => deleteTask(task.id)}
                        >
                          Hapus
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {pendingTasks.length === 0 && (
                <p className={`text-[13px] ${mutedText}`}>
                  Belum ada tugas pending.
                </p>
              )}
              {doneTasks.length > 0 && (
                <div className="mt-6 space-y-3">
                  <h3 className="font-semibold">Tugas Selesai</h3>
                  {doneTasks.slice(0, 10).map((task) => (
                    <div
                      key={task.id}
                      className={`flex items-start justify-between gap-3 rounded-2xl ${softCardBg} p-3`}
                    >
                      <p className="min-w-0 break-words text-[13px] line-through">
                        {task.title}
                      </p>
                      <button
                        type="button"
                        className={`shrink-0 text-[12px] font-bold ${smallAccent}`}
                        onClick={() => toggleTaskDone(task)}
                      >
                        Batal selesai
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {activeMenu === "catatan" && (
          <div className="grid items-start gap-3 lg:grid-cols-[0.9fr_1.1fr]">
            <section className={panelClass}>
              <h2 className="mb-4 text-[16px] font-semibold">Tambah Catatan</h2>
              <form onSubmit={saveCatatan} className="space-y-3">
                <label className="block">
                  <span
                    className={`mb-1 block text-[12px] font-medium ${mutedText}`}
                  >
                    Kasus
                  </span>
                  <select
                    className={inputClass}
                    value={catatanProjectId}
                    onChange={(event) =>
                      setCatatanProjectId(event.target.value)
                    }
                    required
                  >
                    <option value="">Pilih kasus</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {getCaseOption(project)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span
                    className={`mb-1 block text-[12px] font-medium ${mutedText}`}
                  >
                    Tanggal catatan
                  </span>
                  <input
                    type="date"
                    className={inputClass}
                    value={catatanDate}
                    onChange={(event) => setCatatanDate(event.target.value)}
                    required
                  />
                </label>
                <textarea
                  aria-label="Isi catatan"
                  className={`${inputClass} min-h-24`}
                  value={catatanText}
                  onChange={(event) => setCatatanText(event.target.value)}
                  required
                  placeholder="Catatan, link, atau reminder follow up"
                />
                <button
                  disabled={isSavingCatatan || projects.length === 0}
                  className={`w-full ${buttonClass}`}
                >
                  {isSavingCatatan ? "Menyimpan..." : "Simpan catatan"}
                </button>
              </form>
            </section>
            <section className={panelClass}>
              <h2 className="mb-4 text-[16px] font-semibold">Daftar Catatan</h2>
              <div className="space-y-2">
                <input
                  aria-label="Cari catatan"
                  className={inputClass}
                  value={catatanSearch}
                  onChange={(event) => setCatatanSearch(event.target.value)}
                  placeholder="Cari isi catatan / kasus / client"
                />
                <select
                  aria-label="Filter kasus catatan"
                  className={inputClass}
                  value={catatanFilterProjectId}
                  onChange={(event) =>
                    setCatatanFilterProjectId(event.target.value)
                  }
                >
                  <option value="">Semua kasus</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {getCaseOption(project)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-4 space-y-3">
                {catatanRows.map((note) => (
                  <div
                    key={note.id}
                    className={`rounded-2xl ${softCardBg} p-3`}
                  >
                    <p className="break-words text-[13px] font-semibold">
                      {note.projectTitle}
                    </p>
                    <p className={`mt-1 break-words text-[12px] ${mutedText}`}>
                      {note.client || UNASSIGNED_CLIENT} ·{" "}
                      {note.module || UNASSIGNED_MODULE} ·{" "}
                      {formatInputDate(note.noteDate)}
                    </p>
                    <p className="mt-3 whitespace-pre-wrap break-words text-[13px] leading-5">
                      {note.note}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={secondaryButton}
                        onClick={() => {
                          resetFilters();
                          setSelectedProjectId(note.projectId);
                          openMenuPage("project");
                        }}
                      >
                        Buka kasus
                      </button>
                      <button
                        type="button"
                        className="px-3 py-2 text-[12px] font-bold text-red-500"
                        onClick={() => deleteNote(note.id)}
                      >
                        Hapus
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {catatanRows.length === 0 && (
                <p className={`mt-4 text-[13px] ${mutedText}`}>
                  Belum ada catatan sesuai filter.
                </p>
              )}
            </section>
          </div>
        )}

        {activeMenu === "laporan" && (
          <div className="space-y-3">
            <section className={panelClass}>
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:justify-between">
                <div>
                  <h2 className="text-[16px] font-semibold">
                    Laporan Maintenance
                  </h2>
                  <p className={`mt-1 text-[13px] ${mutedText}`}>
                    Client, modul, PIC, Blade/Form, serta tanggal pengajuan dan
                    selesai.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={buttonClass}
                    onClick={exportExcelReport}
                  >
                    Export Excel
                  </button>
                  <button
                    type="button"
                    className={secondaryButton}
                    onClick={printReport}
                  >
                    Cetak / PDF
                  </button>
                </div>
              </div>
              {renderFilters()}
            </section>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {reportSummaryRows.map((row) => (
                <div key={row.label} className={panelClass}>
                  <p className={`text-[12px] font-medium ${mutedText}`}>
                    {row.label}
                  </p>
                  <p className="mt-2 text-[24px] font-semibold">{row.value}</p>
                </div>
              ))}
            </div>
            <section className={panelClass}>
              <h3 className="mb-4 font-semibold">
                Preview Kasus · {reportProjectRows.length}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {reportProjectRows.slice(0, 12).map((project) => (
                  <div key={project.id} onClick={() => openMenuPage("project")}>
                    {renderCaseCard(project)}
                  </div>
                ))}
              </div>
              {reportProjectRows.length === 0 && (
                <p className={mutedText}>Belum ada data sesuai filter.</p>
              )}
            </section>
          </div>
        )}

        {activeMenu === "query" && (
          <div className="space-y-3">
            <section className={panelClass}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-[16px] font-semibold">Query Tersimpan</h2>
                  <p className={`mt-1 text-[13px] ${mutedText}`}>
                    Simpan query dengan judul agar mudah ditemukan kembali.
                  </p>
                </div>
                <button
                  type="button"
                  className={secondaryButton}
                  disabled={
                    isLoadingSavedQueries ||
                    isSavingSavedQuery ||
                    !!busySavedQueryId
                  }
                  onClick={() => void fetchSavedQueries()}
                >
                  {isLoadingSavedQueries ? "Memuat..." : "Refresh query"}
                </button>
              </div>
              {savedQueryError && (
                <p
                  role="alert"
                  className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-[12px] text-red-500"
                >
                  {savedQueryError}
                </p>
              )}
              {savedQueryNotice && (
                <p
                  role="status"
                  className={`mt-3 rounded-xl bg-emerald-500/10 px-3 py-2 text-[12px] ${smallAccent}`}
                >
                  {savedQueryNotice}
                </p>
              )}
            </section>
            <div className="grid items-start gap-3 lg:grid-cols-[1.1fr_0.9fr]">
              <section
                id="saved-query-editor"
                className={`${panelClass} scroll-mt-4`}
              >
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-[14px] font-semibold">
                    {editingSavedQueryId ? "Edit Query" : "Tambah Query"}
                  </h3>
                  {editingSavedQueryId && (
                    <button
                      type="button"
                      className={`text-[12px] font-medium ${smallAccent}`}
                      disabled={isSavingSavedQuery}
                      onClick={() => {
                        resetSavedQueryForm();
                        setSavedQueryNotice("");
                        setSavedQueryError("");
                      }}
                    >
                      Batal edit query
                    </button>
                  )}
                </div>
                <form onSubmit={saveSavedQuery} className="space-y-3">
                  <label className="block">
                    <span
                      className={`mb-1 block text-[12px] font-medium ${mutedText}`}
                    >
                      Judul query *
                    </span>
                    <input
                      aria-label="Judul query"
                      className={inputClass}
                      value={savedQueryTitle}
                      onChange={(event) =>
                        setSavedQueryTitle(event.target.value)
                      }
                      placeholder="Contoh: Cek selisih jurnal Kasbank"
                      required
                      maxLength={200}
                      disabled={isSavingSavedQuery}
                    />
                  </label>
                  <label className="block">
                    <span
                      className={`mb-1 block text-[12px] font-medium ${mutedText}`}
                    >
                      Isi query *
                    </span>
                    <textarea
                      aria-label="Isi query"
                      className={`${inputClass} min-h-[260px] resize-y overflow-x-auto font-mono`}
                      value={savedQueryText}
                      onChange={(event) =>
                        setSavedQueryText(event.target.value)
                      }
                      placeholder={
                        "SELECT *\nFROM trans_j\nWHERE no_bukti = '...';"
                      }
                      rows={12}
                      wrap="off"
                      spellCheck={false}
                      autoCorrect="off"
                      autoCapitalize="off"
                      required
                      maxLength={100000}
                      disabled={isSavingSavedQuery}
                    />
                  </label>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className={`text-[11px] ${mutedText}`}>
                      {savedQueryText.length.toLocaleString("id-ID")} karakter
                    </span>
                    <button
                      disabled={
                        isSavingSavedQuery ||
                        isLoadingSavedQueries ||
                        !!busySavedQueryId
                      }
                      className={buttonClass}
                    >
                      {isSavingSavedQuery
                        ? "Menyimpan..."
                        : editingSavedQueryId
                          ? "Simpan perubahan query"
                          : "Simpan query"}
                    </button>
                  </div>
                </form>
              </section>
              <section className={panelClass}>
                <div className="mb-3">
                  <h3 className="text-[14px] font-semibold">Daftar Query</h3>
                  <p className={`mt-1 text-[12px] ${mutedText}`}>
                    {filteredSavedQueries.length} query tampil dari{" "}
                    {savedQueries.length} tersimpan
                  </p>
                </div>
                <input
                  aria-label="Cari query"
                  className={inputClass}
                  value={savedQuerySearch}
                  onChange={(event) => setSavedQuerySearch(event.target.value)}
                  placeholder="Cari judul atau isi query"
                />
                {isLoadingSavedQueries ? (
                  <p className={`mt-4 text-[12px] ${mutedText}`}>
                    Memuat query...
                  </p>
                ) : filteredSavedQueries.length === 0 ? (
                  <p className={`mt-4 text-[12px] ${mutedText}`}>
                    {savedQuerySearch
                      ? "Tidak ada query yang cocok dengan pencarian."
                      : savedQueryError
                        ? "Klik Refresh setelah akses atau koneksi diperbaiki."
                        : "Belum ada query. Tambahkan judul dan isi query di form."}
                  </p>
                ) : (
                  <div className="mt-3 space-y-3 lg:max-h-[620px] lg:overflow-y-auto lg:pr-1">
                    {filteredSavedQueries.map((item) => (
                      <article
                        key={item.id}
                        className={`min-w-0 rounded-2xl border ${borderColor} ${softCardBg} p-3`}
                      >
                        <h4 className="break-words text-[13px] font-semibold">
                          {item.title}
                        </h4>
                        <p className={`mt-1 text-[11px] ${mutedText}`}>
                          {item.updatedAtMillis
                            ? `Diperbarui ${new Date(item.updatedAtMillis).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}`
                            : "Tanggal belum tersedia"}
                        </p>
                        <pre
                          className={`mt-3 max-h-16 overflow-hidden whitespace-pre-wrap break-all font-mono text-[11px] leading-4 ${mutedText}`}
                        >
                          {item.queryText.split("\n").slice(0, 2).join("\n")}
                        </pre>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={secondaryButton}
                            onClick={() => setViewingSavedQueryId(item.id)}
                          >
                            Lihat query
                          </button>
                          <button
                            type="button"
                            className={secondaryButton}
                            onClick={() => void copySavedQuery(item)}
                          >
                            Salin query
                          </button>
                          <button
                            type="button"
                            className={secondaryButton}
                            disabled={isSavingSavedQuery || !!busySavedQueryId}
                            onClick={() => editSavedQuery(item)}
                          >
                            Edit query
                          </button>
                          <button
                            type="button"
                            className="rounded-xl bg-red-100 px-3 py-2 text-[12px] font-medium text-red-700 disabled:opacity-60"
                            disabled={isSavingSavedQuery || !!busySavedQueryId}
                            onClick={() => void deleteSavedQuery(item)}
                          >
                            {busySavedQueryId === item.id
                              ? "Menghapus..."
                              : "Hapus query"}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        )}

        {activeMenu === "settings" && (
          <section className={panelClass}>
            <h2 className="text-[16px] font-semibold">Settings</h2>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                className={secondaryButton}
                onClick={() => setIsDarkMode((value) => !value)}
              >
                {isDarkMode ? "Aktifkan light mode" : "Aktifkan dark mode"}
              </button>
              <button
                type="button"
                className="rounded-xl bg-red-100 px-3 py-2 font-bold text-red-700"
                onClick={() => signOut(auth)}
              >
                Logout
              </button>
            </div>
          </section>
        )}
      </section>

      {completionProject && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm"
          onClick={() => {
            if (!isCompleting) setCompletionProjectId("");
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="completion-title"
            onClick={(event) => event.stopPropagation()}
            className={`max-h-[85dvh] w-full max-w-md overflow-y-auto ${panelClass} shadow-2xl`}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 id="completion-title" className="text-[16px] font-semibold">
                  {completionProject.status === "Selesai"
                    ? "Ubah tanggal selesai"
                    : "Tandai Beres"}
                </h2>
                <p className={`mt-2 break-words text-[13px] ${mutedText}`}>
                  {completionProject.title}
                </p>
                <p className={`mt-1 break-words text-[12px] ${mutedText}`}>
                  {getCaseContext(completionProject)}
                </p>
              </div>
              <button
                type="button"
                disabled={isCompleting}
                aria-label="Tutup tanggal selesai"
                className={secondaryButton}
                onClick={() => setCompletionProjectId("")}
              >
                ×
              </button>
            </div>
            <p className={`mb-4 text-[13px] ${mutedText}`}>
              Diajukan {formatInputDate(completionProject.masukDate)} · PIC{" "}
              {completionProject.requesterPic || "Belum diisi"}
            </p>
            <form onSubmit={completeProject} className="space-y-3">
              <label className="block">
                <span
                  className={`mb-1 block text-[12px] font-medium ${mutedText}`}
                >
                  Tanggal selesai *
                </span>
                <input
                  aria-label="Tanggal selesai"
                  autoFocus
                  type="date"
                  className={inputClass}
                  value={completionDateInput}
                  onChange={(event) =>
                    setCompletionDateInput(event.target.value)
                  }
                  min={completionProject.masukDate || undefined}
                  max={getTodayInputDate()}
                  required
                  disabled={isCompleting}
                />
              </label>
              <p className={`text-[12px] ${mutedText}`}>
                Default hari ini. Kamu boleh memilih tanggal sebelumnya jika
                pekerjaan sudah selesai lebih awal.
              </p>
              {tasks.some(
                (item) =>
                  item.projectId === completionProject.id && !item.isDone,
              ) && (
                <p className={`text-[12px] ${mutedText}`}>
                  Masih ada tugas pending pada kasus ini. Status tugas dapat
                  kamu selesaikan secara terpisah.
                </p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={isCompleting}
                  className={secondaryButton}
                  onClick={() => setCompletionProjectId("")}
                >
                  Batal
                </button>
                <button disabled={isCompleting} className={buttonClass}>
                  {isCompleting ? "Menyimpan..." : "Simpan selesai"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {viewingSavedQuery && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm"
          onClick={() => setViewingSavedQueryId("")}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="query-view-title"
            onClick={(event) => event.stopPropagation()}
            className={`flex max-h-[85dvh] w-full max-w-4xl flex-col ${panelClass} shadow-2xl`}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className={`mb-1 text-[11px] ${mutedText}`}>
                  Query tersimpan
                </p>
                <h2
                  id="query-view-title"
                  className="break-words text-[16px] font-semibold"
                >
                  {viewingSavedQuery.title}
                </h2>
              </div>
              <button
                type="button"
                autoFocus
                aria-label="Tutup lihat query"
                className={secondaryButton}
                onClick={() => setViewingSavedQueryId("")}
              >
                ×
              </button>
            </div>
            <pre
              tabIndex={0}
              aria-label="Isi query tersimpan"
              className={`min-h-0 flex-1 select-text overflow-auto rounded-xl border ${borderColor} ${isDarkMode ? "bg-[#111214]" : "bg-neutral-50"} p-3 font-mono text-[12px] leading-5`}
            >
              <code>{viewingSavedQuery.queryText}</code>
            </pre>
            {savedQueryNotice && (
              <p role="status" className={`mt-3 text-[12px] ${smallAccent}`}>
                {savedQueryNotice}
              </p>
            )}
            {savedQueryError && (
              <p role="alert" className="mt-3 text-[12px] text-red-500">
                {savedQueryError}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className={buttonClass}
                onClick={() => void copySavedQuery(viewingSavedQuery)}
              >
                Salin query
              </button>
              <button
                type="button"
                className={secondaryButton}
                disabled={isSavingSavedQuery || !!busySavedQueryId}
                onClick={() => editSavedQuery(viewingSavedQuery)}
              >
                Edit query
              </button>
              <button
                type="button"
                className={secondaryButton}
                onClick={() => setViewingSavedQueryId("")}
              >
                Tutup
              </button>
            </div>
          </section>
        </div>
      )}

      {isNavigationMenuOpen && (
        <div
          className="fixed inset-0 z-[70] bg-black/50 p-3 backdrop-blur-sm"
          onClick={() => setIsNavigationMenuOpen(false)}
        >
          <section
            onClick={(event) => event.stopPropagation()}
            className={`absolute bottom-24 left-3 right-3 mx-auto max-h-[70dvh] max-w-3xl overflow-y-auto ${panelClass}`}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[16px] font-semibold">Pilih Halaman</h2>
              <button
                type="button"
                className={secondaryButton}
                aria-label="Tutup menu"
                onClick={() => setIsNavigationMenuOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[
                ["dashboard", "🏠", "Dashboard"],
                ["client", "🏢", "Client"],
                ["tambah", "＋", "Tambah Kasus"],
                ["project", "🗂️", "Kasus"],
                ["tugas", "☑️", "Tugas"],
                ["catatan", "📝", "Catatan"],
                ["query", "SQL", "Query"],
                ["riwayat", "🧾", "Riwayat"],
                ["laporan", "📊", "Laporan"],
                ["settings", "⚙️", "Settings"],
              ].map(([id, icon, label]) => (
                <button
                  type="button"
                  key={id}
                  onClick={() =>
                    id === "tambah"
                      ? openNewCase()
                      : openMenuPage(id as ActiveMenu)
                  }
                  className={`rounded-2xl border ${borderColor} ${activeMenu === id ? "bg-emerald-400/10" : softCardBg} p-4 text-left`}
                >
                  <span aria-hidden="true" className="text-[16px]">
                    {icon}
                  </span>
                  <p className="mt-2 text-[13px] font-bold">{label}</p>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      <nav
        aria-label="Navigasi utama"
        className={`fixed bottom-0 left-0 right-0 z-[60] border-t ${borderColor} ${isDarkMode ? "bg-[#141518]/95" : "bg-white/95"} pb-[env(safe-area-inset-bottom)] backdrop-blur`}
      >
        <div className="mx-auto grid max-w-3xl grid-cols-5 gap-1 px-2 py-2">
          {[
            ["dashboard", "🏠", "Home"],
            ["client", "🏢", "Client"],
            ["project", "🗂️", "Kasus"],
            ["tugas", "☑️", "Tugas"],
          ].map(([id, icon, label]) => (
            <button
              type="button"
              key={id}
              aria-current={activeMenu === id ? "page" : undefined}
              onClick={() => openMenuPage(id as ActiveMenu)}
              className={`min-h-[48px] rounded-xl px-1 py-1.5 text-[11px] font-medium ${activeMenu === id ? "bg-[#A7F3D0] text-[#111214]" : mutedText}`}
            >
              <div aria-hidden="true" className="mb-0.5 text-[16px]">
                {icon}
              </div>
              {label}
            </button>
          ))}
          <button
            type="button"
            aria-expanded={isNavigationMenuOpen}
            onClick={() => setIsNavigationMenuOpen((value) => !value)}
            className={`min-h-[48px] rounded-xl px-1 py-1.5 text-[11px] font-medium ${isNavigationMenuOpen || ["tambah", "catatan", "query", "riwayat", "laporan", "settings"].includes(activeMenu) ? "bg-[#A7F3D0] text-[#111214]" : mutedText}`}
          >
            <div aria-hidden="true" className="mb-0.5 text-[16px]">
              ☰
            </div>
            Menu
          </button>
        </div>
      </nav>
    </main>
  );
}
