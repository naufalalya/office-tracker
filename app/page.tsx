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
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import {
  getStorage,
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import { auth, db } from "../lib/firebase";

type ProjectStatus =
  | "Belum Mulai"
  | "Proses"
  | "Menunggu"
  | "Testing"
  | "Hold"
  | "Selesai";
type CaseKind =
  | "Bug"
  | "Revisi"
  | "Penambahan"
  | "Fitur"
  | "Support"
  | "Maintenance";
type CaseActivity = {
  id: string;
  title: string;
  note: string;
  date: string;
  recordedAt: number;
};
type ProjectPriority = "Rendah" | "Normal" | "Penting" | "Urgent";
type ActiveMenu =
  | "masterModules"
  | "clientAdd"
  | "projects"
  | "client"
  | "dashboard"
  | "tambah"
  | "project"
  | "riwayat"
  | "tugas"
  | "catatan"
  | "laporan"
  | "settings"
  | "query"
  | "upgradeNotes";

type WorkSavedQuery = {
  id: string;
  userId: string;
  client: string;
  title: string;
  queryText: string;
  createdAtMillis: number;
  updatedAtMillis: number;
};

const upgradeTopics = [
  "Perubahan kode",
  "Error & Solusi",
  "Konfigurasi",
  "Database",
  "Referensi",
  "Lainnya",
] as const;
type UpgradeTopic = (typeof upgradeTopics)[number];
type UpgradeSource = "PHP 7.2" | "PHP 8.2" | "Umum";
const upgradeSources: UpgradeSource[] = ["PHP 7.2", "PHP 8.2", "Umum"];
type UpgradeNote = {
  id: string;
  userId: string;
  title: string;
  body: string;
  projectName: string;
  topic: UpgradeTopic;
  sourceVersion: UpgradeSource;
  noteDate: string;
  createdAtMillis: number;
  updatedAtMillis: number;
};
// Upgrade notes reuse the existing user-owned snippet collection. The discriminator
// prevents notes from appearing in Query; legacy documents remain ordinary queries.
const isUpgradeRecord = (data: { recordType?: unknown }) =>
  data.recordType === "upgrade-note";

type FormGroup = "Master" | "Transaksi" | "Report" | "Settings";
const formGroups: FormGroup[] = ["Master", "Transaksi", "Report", "Settings"];
type IssueDraft = {
  id: string;
  title: string;
  masukDate: string;
  status: ProjectStatus;
};
const newIssueDraft = (): IssueDraft => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  title: "",
  masukDate: getTodayInputDate(),
  status: "Belum Mulai",
});
const workModules: CaseKind[] = ["Maintenance", "Penambahan", "Bug", "Revisi"];
const workKind = (kind: CaseKind): CaseKind =>
  kind === "Fitur" ? "Penambahan" : kind;
const completionOnSave = (
  status: ProjectStatus,
  previous?: Pick<WorkProject, "status" | "completedDate">,
) =>
  status === "Selesai"
    ? previous?.status === "Selesai" && previous.completedDate
      ? previous.completedDate
      : getTodayInputDate()
    : "";

type WorkProject = {
  formGroup?: FormGroup;
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
  attachments: NoteAttachment[];
  id: string;
  projectId: string;
  noteDate: string;
  note: string;
  createdAtText: string;
  createdAtMillis: number;
};

type WorkTask = {
  attachments: NoteAttachment[];
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
const caseKinds: CaseKind[] = [...workModules, "Fitur", "Support"];
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

type NoteAttachment = {
  name: string;
  url: string;
  path: string;
  contentType: string;
  size: number;
};
type PendingNoteImage = { id: string; file: File; url: string; name: string };
type ImagePreview = { name: string; url: string };
const MAX_NOTE_IMAGES = 5;
const MAX_NOTE_IMAGE_SIZE = 5 * 1024 * 1024;
const NOTE_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

const readNoteAttachments = (value: unknown): NoteAttachment[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item) =>
        item &&
        typeof item.url === "string" &&
        item.url.startsWith("https://") &&
        typeof item.path === "string" &&
        typeof item.name === "string",
    )
    .map((item) => ({
      name: item.name,
      url: item.url,
      path: item.path,
      contentType:
        typeof item.contentType === "string" ? item.contentType : "image/png",
      size: typeof item.size === "number" ? item.size : 0,
    }));
};

function useNoteImageDraft() {
  const [images, setImages] = useState<PendingNoteImage[]>([]);
  const [error, setError] = useState("");
  const currentImages = useRef<PendingNoteImage[]>([]);
  const replaceImages = (next: PendingNoteImage[]) => {
    currentImages.current
      .filter((item) => !next.some((other) => other.id === item.id))
      .forEach((item) => URL.revokeObjectURL(item.url));
    currentImages.current = next;
    setImages(next);
  };
  const addFiles = (files: File[]) => {
    if (!files.length) return;
    if (currentImages.current.length + files.length > MAX_NOTE_IMAGES) {
      setError(
        "Maksimal 5 gambar per catatan. Hapus salah satu gambar jika ingin menggantinya.",
      );
      return;
    }
    const invalid = files.find(
      (file) =>
        !NOTE_IMAGE_TYPES.includes(file.type) ||
        file.size === 0 ||
        file.size > MAX_NOTE_IMAGE_SIZE,
    );
    if (invalid) {
      setError(
        `“${invalid.name}” tidak dapat ditambahkan. Gunakan PNG, JPG, WEBP, atau GIF, maksimal 5 MB per gambar.`,
      );
      return;
    }
    const next = files.map((file) => ({
      id:
        globalThis.crypto?.randomUUID?.() ??
        `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      name: file.name,
      url: URL.createObjectURL(file),
    }));
    replaceImages([...currentImages.current, ...next]);
    setError("");
  };
  const remove = (id: string) => {
    replaceImages(currentImages.current.filter((item) => item.id !== id));
    setError("");
  };
  const clear = () => {
    replaceImages([]);
    setError("");
  };
  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (files.length) {
      event.preventDefault();
      addFiles(files);
    }
  };
  useEffect(
    () => () => {
      currentImages.current.forEach((item) => URL.revokeObjectURL(item.url));
    },
    [],
  );
  return { images, error, setError, addFiles, remove, clear, onPaste };
}

function NoteImagePicker({
  draft,
  label,
  disabled,
  progress,
  onCancel,
  onOpen,
  dark,
}: {
  draft: ReturnType<typeof useNoteImageDraft>;
  label: string;
  disabled: boolean;
  progress: number | null;
  onCancel: () => void;
  onOpen: (images: ImagePreview[], index: number) => void;
  dark: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      className={`mt-3 rounded-xl border ${dark ? "border-[#3A3F45]" : "border-neutral-200"} p-3`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={`text-[12px] font-medium ${dark ? "text-[#B8BDC7]" : "text-neutral-500"}`}
        >
          Gambar revisi <span className="font-normal">(opsional)</span>
        </span>
        <button
          type="button"
          disabled={disabled || draft.images.length >= MAX_NOTE_IMAGES}
          onClick={() => input.current?.click()}
          className={`rounded-lg border ${dark ? "border-[#3A3F45] text-[#A7F3D0]" : "border-neutral-200 text-emerald-700"} px-3 py-2 text-[12px] font-medium disabled:opacity-50`}
        >
          + Tambah gambar
        </button>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        accept={NOTE_IMAGE_TYPES.join(",")}
        aria-label={label}
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          draft.addFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <p
        className={`mt-2 text-[11px] ${dark ? "text-[#B8BDC7]" : "text-neutral-500"}`}
      >
        Maksimal 5 gambar, 5 MB per gambar. Screenshot juga bisa ditempel ke
        kolom pekerjaan dengan Ctrl/Cmd + V.
      </p>
      {draft.images.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {draft.images.map((item, index) => (
            <div key={item.id} className="min-w-0">
              <button
                type="button"
                aria-label={`Perbesar pilihan gambar ${index + 1}`}
                onClick={() => onOpen(draft.images, index)}
                className={`block w-full overflow-hidden rounded-lg border ${dark ? "border-[#3A3F45] bg-[#111214]" : "border-neutral-200 bg-white"}`}
              >
                <img
                  src={item.url}
                  alt={item.name}
                  className="h-24 w-full object-contain"
                />
              </button>
              <div className="mt-1 flex items-center gap-1">
                <span
                  className="min-w-0 flex-1 truncate text-[10px]"
                  title={item.name}
                >
                  {item.name}
                </span>
                <button
                  type="button"
                  aria-label={`Hapus pilihan gambar ${index + 1}`}
                  disabled={disabled}
                  onClick={() => draft.remove(item.id)}
                  className="shrink-0 px-1 py-1 text-[11px] text-red-500 disabled:opacity-50"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {progress !== null && (
        <div className="mt-3">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <p role="status" className="text-[11px]">
              {progress < 100
                ? `Mengunggah gambar… ${progress}%`
                : "Menyimpan tugas…"}
            </p>
            {progress < 100 && (
              <button
                type="button"
                className="text-[11px] text-red-500"
                onClick={onCancel}
              >
                Batalkan upload
              </button>
            )}
          </div>
          <div
            className={`h-1.5 overflow-hidden rounded-full ${dark ? "bg-[#111214]" : "bg-neutral-200"}`}
          >
            <div
              className="h-full rounded-full bg-emerald-400 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
      {draft.error && (
        <p role="alert" className="mt-2 break-words text-[12px] text-red-500">
          {draft.error}
        </p>
      )}
    </div>
  );
}

function NoteImageGallery({
  images,
  onOpen,
}: {
  images: NoteAttachment[];
  onOpen: (images: ImagePreview[], index: number) => void;
}) {
  if (!images.length) return null;
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
      {images.map((item, index) => (
        <button
          type="button"
          key={item.path || `${item.url}-${index}`}
          aria-label={`Lihat gambar revisi ${index + 1}: ${item.name}`}
          onClick={() => onOpen(images, index)}
          className="min-w-0 overflow-hidden rounded-xl border border-neutral-500/20 bg-neutral-500/5 text-left"
        >
          <img
            src={item.url}
            alt={item.name}
            loading="lazy"
            className="h-28 w-full object-contain"
          />
          <span
            className="block truncate px-2 py-1.5 text-[10px]"
            title={item.name}
          >
            {item.name}
          </span>
        </button>
      ))}
    </div>
  );
}

async function removeNoteImageObjects(paths: string[]) {
  if (!paths.length) return;
  const storage = getStorage(auth.app);
  const results = await Promise.allSettled(
    paths.map(async (path) => {
      try {
        await deleteObject(storageRef(storage, path));
      } catch (error) {
        if ((error as { code?: string }).code !== "storage/object-not-found")
          throw error;
      }
    }),
  );
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
}

async function uploadNoteAttachments({
  uid,
  projectId,
  noteId,
  images,
  signal,
  onProgress,
}: {
  uid: string;
  projectId: string;
  noteId: string;
  images: PendingNoteImage[];
  signal: AbortSignal;
  onProgress: (value: number) => void;
}): Promise<NoteAttachment[]> {
  if (!images.length) return [];
  if (!auth.app.options.storageBucket)
    throw new Error(
      "Isi NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET di .env.local agar upload gambar dapat digunakan.",
    );
  const storage = getStorage(auth.app);
  const result: NoteAttachment[] = [];
  const attemptedPaths: string[] = [];
  try {
    for (let index = 0; index < images.length; index++) {
      if (signal.aborted)
        throw Object.assign(new Error("Upload dibatalkan."), {
          code: "storage/canceled",
        });
      const item = images[index];
      const extension = (
        {
          "image/png": "png",
          "image/jpeg": "jpg",
          "image/webp": "webp",
          "image/gif": "gif",
        } as Record<string, string>
      )[item.file.type];
      const path = `workNoteImages/${uid}/${projectId}/${noteId}/${item.id}.${extension}`;
      attemptedPaths.push(path);
      const task = uploadBytesResumable(storageRef(storage, path), item.file, {
        contentType: item.file.type,
      });
      const cancel = () => task.cancel();
      signal.addEventListener("abort", cancel, { once: true });
      const unsubscribe = task.on("state_changed", (snapshot) =>
        onProgress(
          Math.min(
            99,
            Math.floor(
              ((index +
                snapshot.bytesTransferred / Math.max(1, snapshot.totalBytes)) /
                images.length) *
                100,
            ),
          ),
        ),
      );
      try {
        await task;
      } finally {
        unsubscribe();
        signal.removeEventListener("abort", cancel);
      }
      if (signal.aborted)
        throw Object.assign(new Error("Upload dibatalkan."), {
          code: "storage/canceled",
        });
      const url = await getDownloadURL(task.snapshot.ref);
      result.push({
        name: item.name,
        url,
        path,
        contentType: item.file.type,
        size: item.file.size,
      });
    }
    onProgress(100);
    return result;
  } catch (error) {
    try {
      await removeNoteImageObjects(attemptedPaths);
    } catch (cleanupError) {
      console.error("Upload cleanup failed", cleanupError);
    }
    throw error;
  }
}

const getNoteSaveError = (error: unknown) => {
  const code = (error as { code?: string })?.code ?? "";
  if (code === "storage/canceled")
    return "Upload dibatalkan. Catatan dan pilihan gambar masih tersedia untuk dicoba lagi.";
  if (
    [
      "storage/unauthorized",
      "storage/bucket-not-found",
      "storage/project-not-found",
      "storage/unknown",
      "storage/quota-exceeded",
    ].includes(code)
  )
    return "Gambar belum dapat diunggah. Periksa Firebase Storage, paket Blaze, nama bucket, dan Storage Rules. Catatan serta pilihan gambar tetap tersedia.";
  if (
    error instanceof Error &&
    error.message.includes("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET")
  )
    return error.message;
  return "Catatan belum berhasil disimpan. Periksa koneksi dan izin Firebase, lalu coba lagi. Teks serta pilihan gambar tetap tersedia.";
};

export default function Home() {
  const noteImageDraft = useNoteImageDraft();
  const catatanImageDraft = useNoteImageDraft();
  const taskImageDraft = useNoteImageDraft();
  const taskUploadController = useRef<AbortController | null>(null);
  const [taskUploadProgress, setTaskUploadProgress] = useState<number | null>(
    null,
  );
  const noteUploadControllers = useRef(new Set<AbortController>());
  const noteUploadController = useRef<AbortController | null>(null);
  const catatanUploadController = useRef<AbortController | null>(null);
  const [, setNoteUploadProgress] = useState<number | null>(null);
  const [, setCatatanUploadProgress] = useState<number | null>(null);
  const [imageViewer, setImageViewer] = useState<{
    images: ImagePreview[];
    index: number;
  } | null>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const imageViewerClose = useRef<HTMLButtonElement>(null);
  const openNoteImages = (images: ImagePreview[], index: number) => {
    setImageZoom(1);
    setImageViewer({ images, index });
  };
  const activeUserId = useRef<string | null>(null);
  const fetchGeneration = useRef(0);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [loginUsername, setLoginUsername] = useState("alya-kerja");
  const [loginPassword, setLoginPassword] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [masterClients, setMasterClients] = useState<string[]>([]);
  const [newClientName, setNewClientName] = useState("");
  const [clientError, setClientError] = useState("");
  const [savingClient, setSavingClient] = useState(false);
  const [transactionClient, setTransactionClient] = useState("");
  const [masterModules, setMasterModules] = useState<
    Record<string, CaseKind[]>
  >({});
  const [masterProjectName, setMasterProjectName] = useState("");
  const [moduleDraft, setModuleDraft] = useState<CaseKind[]>([...workModules]);
  const [transactionModule, setTransactionModule] = useState<CaseKind | "">("");
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [clientPickerSearch, setClientPickerSearch] = useState("");
  const [issueRows, setIssueRows] = useState<IssueDraft[]>([newIssueDraft()]);
  const [gridError, setGridError] = useState("");
  const [gridNotice, setGridNotice] = useState("");
  const [savingGrid, setSavingGrid] = useState(false);
  const [activeMenu, setActiveMenu] = useState<ActiveMenu>("dashboard");
  const [projectView, setProjectView] = useState<"list" | "detail">("list");
  const [detailTab, setDetailTab] = useState<"notes" | "tasks" | "history">(
    "notes",
  );
  const navigationHistory = useRef<
    { menu: ActiveMenu; view: "list" | "detail"; scroll: number }[]
  >([]);
  const [savingStatus, setSavingStatus] = useState(false);
  const [detailNotice, setDetailNotice] = useState("");
  const [detailError, setDetailError] = useState("");
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
  const [completionProjectId, setCompletionProjectId] = useState("");
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
  const [savedQueryClient, setSavedQueryClient] = useState("");
  const [savedQueryFilterClient, setSavedQueryFilterClient] = useState("");
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

  const upgradeFetchGeneration = useRef(0);
  const [upgradeNotes, setUpgradeNotes] = useState<UpgradeNote[]>([]);
  const [upgradeView, setUpgradeView] = useState<"list" | "read" | "edit">(
    "list",
  );
  const [upgradeSelectedId, setUpgradeSelectedId] = useState("");
  const [upgradeEditingId, setUpgradeEditingId] = useState("");
  const [upgradeTitle, setUpgradeTitle] = useState("");
  const [upgradeBody, setUpgradeBody] = useState("");
  const [upgradeProject, setUpgradeProject] = useState("");
  const [upgradeTopic, setUpgradeTopic] =
    useState<UpgradeTopic>("Perubahan kode");
  const [upgradeSource, setUpgradeSource] = useState<UpgradeSource>("Umum");
  const [upgradeDate, setUpgradeDate] = useState(getTodayInputDate());
  const [upgradeSearch, setUpgradeSearch] = useState("");
  const [upgradeFilter, setUpgradeFilter] = useState("");
  const [upgradeSourceFilter, setUpgradeSourceFilter] = useState("");
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [upgradeSaving, setUpgradeSaving] = useState(false);
  const [upgradeDeleting, setUpgradeDeleting] = useState("");
  const [upgradeError, setUpgradeError] = useState("");
  const [upgradeNotice, setUpgradeNotice] = useState("");
  const selectedUpgradeNote = upgradeNotes.find(
    (item) => item.id === upgradeSelectedId,
  );
  const filteredUpgradeNotes = upgradeNotes.filter(
    (item) =>
      (!upgradeFilter || item.topic === upgradeFilter) &&
      (!upgradeSourceFilter || item.sourceVersion === upgradeSourceFilter) &&
      [item.title, item.body, item.projectName, item.topic, item.sourceVersion]
        .join(" ")
        .toLowerCase()
        .includes(upgradeSearch.trim().toLowerCase()),
  );

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
    ...masterClients,
    ...projects.map((item) => item.client),
  ]);
  const modulesFor = (name: string): CaseKind[] =>
    uniqueLabels([
      ...(masterModules[normalizeClient(name).toLowerCase()] ?? workModules),
      ...projects
        .filter(
          (item) =>
            item.client.toLowerCase() === normalizeClient(name).toLowerCase(),
        )
        .map((item) => workKind(item.caseKind)),
    ]) as CaseKind[];
  const moduleOptions = modulesFor(client);
  const transactionRecords = projects.filter(
    (item) =>
      item.client.toLowerCase() === transactionClient.toLowerCase() &&
      workKind(item.caseKind) === transactionModule,
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
        attachments: [] as NoteAttachment[],
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
        attachments: note.attachments,
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
        attachments: task.attachments,
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
    setMasukDate(getTodayInputDate());
    setDeadlineDate("");
    setStatus("Belum Mulai");
    setPriority("Normal");
    setProjectNotes("");
  };

  useEffect(() => {
    setMasterClients([]);
    setMasterModules({});
    setTransactionModule("");
    setTransactionClient("");
    setClientPickerOpen(false);
    setIssueRows([newIssueDraft()]);
    setGridError("");
    setGridNotice("");
    setClientError("");
    if (!currentUser) return;
    let cancelled = false;
    getDocs(
      query(
        collection(db, "workClients"),
        where("userId", "==", currentUser.uid),
      ),
    )
      .then((snapshot) => {
        if (cancelled) return;
        setMasterClients(
          snapshot.docs
            .map((item) => String(item.data().name || ""))
            .filter(Boolean),
        );
        setMasterModules(
          Object.fromEntries(
            snapshot.docs.map((item) => {
              const data = item.data();
              return [
                normalizeClient(String(data.name || "")).toLowerCase(),
                Array.isArray(data.modules)
                  ? data.modules
                      .filter((kind: CaseKind) => caseKinds.includes(kind))
                      .map(workKind)
                  : [...workModules],
              ];
            }),
          ),
        );
      })
      .catch(() => {
        if (!cancelled)
          setClientError(
            "Master client belum dapat dimuat. Pastikan Firestore Rules mengizinkan workClients untuk pemilik userId.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  const saveMasterClient = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentUser || savingClient) return;
    const name = normalizeClient(newClientName);
    if (!name) {
      setClientError("Nama project wajib diisi.");
      return;
    }
    if (
      clientOptions.some((item) => item.toLowerCase() === name.toLowerCase())
    ) {
      setClientError("Project sudah ada di daftar.");
      return;
    }
    setSavingClient(true);
    setClientError("");
    const owner = currentUser.uid;
    try {
      await setDoc(
        doc(
          db,
          "workClients",
          `${owner}_${encodeURIComponent(name.toLowerCase())}`,
        ),
        { userId: owner, name, createdAt: serverTimestamp() },
      );
      if (activeUserId.current !== owner) return;
      setMasterClients((previous) => uniqueLabels([...previous, name]));
      setNewClientName("");
      openMenuPage("client");
    } catch {
      if (activeUserId.current === owner)
        setClientError(
          "Gagal menyimpan project. Cek koneksi dan izin workClients di Firestore.",
        );
    } finally {
      setSavingClient(false);
    }
  };

  const saveModuleMaster = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentUser || savingClient) return;
    const name = normalizeClient(masterProjectName);
    if (!name || !moduleDraft.length) {
      setClientError("Pilih project dan minimal satu modul.");
      return;
    }
    const owner = currentUser.uid;
    setSavingClient(true);
    setClientError("");
    try {
      await setDoc(
        doc(
          db,
          "workClients",
          `${owner}_${encodeURIComponent(name.toLowerCase())}`,
        ),
        {
          userId: owner,
          name,
          modules: moduleDraft,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      if (activeUserId.current !== owner) return;
      setMasterModules((previous) => ({
        ...previous,
        [name.toLowerCase()]: [...moduleDraft],
      }));
      setMasterClients((previous) => uniqueLabels([...previous, name]));
      setTransactionModule("");
      openMenuPage("client");
    } catch {
      if (activeUserId.current === owner)
        setClientError("Gagal menyimpan modul project. Silakan coba lagi.");
    } finally {
      setSavingClient(false);
    }
  };

  const updateIssueRow = (id: string, patch: Partial<IssueDraft>) => {
    setIssueRows((rows) =>
      rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
    setGridNotice("");
  };
  const saveIssueGrid = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentUser || savingGrid) return;
    setGridError("");
    setGridNotice("");
    if (
      !clientOptions.includes(transactionClient) ||
      !transactionModule ||
      !modulesFor(transactionClient).includes(transactionModule)
    ) {
      setGridError("Pilih project dan modul dari master terlebih dahulu.");
      return;
    }
    if (
      !issueRows.length ||
      issueRows.length > 100 ||
      issueRows.some(
        (row) =>
          !row.title.trim() ||
          !row.masukDate ||
          row.masukDate > getTodayInputDate() ||
          !statusOptions.includes(row.status),
      )
    ) {
      setGridError(
        "Isi deskripsi, tanggal masuk (maksimal hari ini), dan status pada setiap baris. Maksimal 100 baris.",
      );
      return;
    }
    setSavingGrid(true);
    const owner = currentUser.uid;
    try {
      const batch = writeBatch(db);
      issueRows.forEach((row) => {
        batch.set(doc(collection(db, "workProjects")), {
          userId: owner,
          client: transactionClient,
          formGroup: "Transaksi",
          title: row.title.trim(),
          module: transactionModule,
          caseKind: transactionModule,
          requesterPic: "",
          bladeForm: "",
          masukDate: row.masukDate,
          deadlineDate: "",
          priority: "Normal",
          status: row.status,
          notes: "",
          waitingReason: "",
          completedDate: completionOnSave(row.status),
          activityHistory: [
            makeActivity("Pekerjaan dicatat", row.title.trim()),
          ],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
      if (activeUserId.current !== owner) return;
      setIssueRows([newIssueDraft()]);
      setGridNotice(
        "Pekerjaan berhasil disimpan. Project dan modul tetap dipilih.",
      );
      await fetchProjects();
    } catch {
      if (activeUserId.current === owner)
        setGridError(
          "Gagal menyimpan daftar masalah. Baris tetap tersedia untuk dicoba lagi.",
        );
    } finally {
      setSavingGrid(false);
    }
  };

  const openMenuPage = (menuId: ActiveMenu) => {
    if (menuId !== activeMenu) {
      navigationHistory.current.push({
        menu: activeMenu,
        view: projectView,
        scroll: window.scrollY,
      });
    }
    if (menuId === "project") setProjectView("detail");
    setActiveMenu(menuId);
    setIsNavigationMenuOpen(false);
    window.setTimeout(
      () => window.scrollTo({ top: 0, behavior: "instant" }),
      0,
    );
  };

  const goBack = () => {
    const previous = navigationHistory.current.pop();
    setActiveMenu(previous?.menu ?? "projects");
    setProjectView(previous?.view ?? "list");
    setIsNavigationMenuOpen(false);
    window.setTimeout(
      () =>
        window.scrollTo({ top: previous?.scroll ?? 0, behavior: "instant" }),
      0,
    );
  };

  const changeWorkStatus = async (
    project: WorkProject,
    next: ProjectStatus,
  ) => {
    if (!currentUser || savingStatus || next === project.status) return;
    const owner = currentUser.uid;
    setSavingStatus(true);
    setDetailNotice("");
    setDetailError("");
    try {
      await updateDoc(doc(db, "workProjects", project.id), {
        status: next,
        completedDate: completionOnSave(next, project),
        waitingReason: next === "Menunggu" ? project.waitingReason : "",
        updatedAt: serverTimestamp(),
        activityHistory: arrayUnion(
          makeActivity("Status diperbarui", `${project.status} → ${next}`),
        ),
      });
      if (activeUserId.current !== owner) return;
      setProjects((items) =>
        items.map((item) =>
          item.id === project.id
            ? {
                ...item,
                status: next,
                completedDate: completionOnSave(next, project),
              }
            : item,
        ),
      );
      if (next !== "Selesai") setTaskProjectId(project.id);
      setDetailNotice(
        next === "Selesai"
          ? "Pekerjaan selesai. Tanggal selesai sudah tercatat otomatis."
          : "Status berhasil diperbarui.",
      );
      await fetchProjects();
    } catch {
      if (activeUserId.current === owner)
        setDetailError("Status belum tersimpan. Coba lagi.");
    } finally {
      setSavingStatus(false);
    }
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
            formGroup: formGroups.includes(data.formGroup)
              ? data.formGroup
              : undefined,
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
            attachments: readNoteAttachments(data.attachments),
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
            attachments: readNoteAttachments(data.attachments),
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
      if (activeUserId.current !== (user?.uid ?? null))
        noteUploadControllers.current.forEach((controller) =>
          controller.abort(),
        );
      if (activeUserId.current !== (user?.uid ?? null)) {
        navigationHistory.current = [];
        setDetailNotice("");
        setDetailError("");
        setDetailTab("notes");
      }
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
    noteImageDraft.clear();
    catatanImageDraft.clear();
    taskImageDraft.clear();
    setTaskTitle("");
    setTaskDate(getTodayInputDate());
    setIsSavingTask(false);
    setTaskUploadProgress(null);
    setImageViewer(null);
    setNoteText("");
    setCatatanText("");
    setIsSavingNote(false);
    setIsSavingCatatan(false);
    setNoteUploadProgress(null);
    setCatatanUploadProgress(null);
    resetForm();
    if (!currentUser) return;
    fetchProjects();
  }, [currentUser?.uid]);

  const resetUpgradeDraft = () => {
    setUpgradeEditingId("");
    setUpgradeTitle("");
    setUpgradeBody("");
    setUpgradeProject("");
    setUpgradeTopic("Perubahan kode");
    setUpgradeSource("Umum");
    setUpgradeDate(getTodayInputDate());
  };

  const fetchUpgradeNotes = async () => {
    if (!currentUser) return;
    const owner = currentUser.uid;
    const generation = ++upgradeFetchGeneration.current;
    setUpgradeLoading(true);
    setUpgradeError("");
    try {
      const snapshot = await getDocs(
        query(collection(db, "workSavedQueries"), where("userId", "==", owner)),
      );
      if (
        activeUserId.current !== owner ||
        upgradeFetchGeneration.current !== generation
      )
        return;
      setUpgradeNotes(
        snapshot.docs
          .filter((item) => isUpgradeRecord(item.data()))
          .map((item): UpgradeNote => {
            const data = item.data();
            return {
              id: item.id,
              userId: owner,
              title:
                typeof data.title === "string" ? data.title : "Tanpa judul",
              body: typeof data.queryText === "string" ? data.queryText : "",
              projectName: typeof data.client === "string" ? data.client : "",
              topic: upgradeTopics.includes(data.topic)
                ? data.topic
                : "Lainnya",
              sourceVersion: upgradeSources.includes(data.sourceVersion)
                ? data.sourceVersion
                : "Umum",
              noteDate: typeof data.noteDate === "string" ? data.noteDate : "",
              createdAtMillis:
                data.createdAt instanceof Timestamp
                  ? data.createdAt.toMillis()
                  : 0,
              updatedAtMillis:
                data.updatedAt instanceof Timestamp
                  ? data.updatedAt.toMillis()
                  : 0,
            };
          })
          .sort((a, b) => b.updatedAtMillis - a.updatedAtMillis),
      );
    } catch (error) {
      if (
        activeUserId.current !== owner ||
        upgradeFetchGeneration.current !== generation
      )
        return;
      setUpgradeError(
        (error as { code?: string }).code?.includes("permission-denied")
          ? "Catatan belum dapat diakses. Pastikan akses workSavedQueries untuk akunmu sudah diizinkan di Firestore Rules."
          : "Catatan belum dapat dimuat. Periksa koneksi lalu klik Refresh.",
      );
    } finally {
      if (
        activeUserId.current === owner &&
        upgradeFetchGeneration.current === generation
      )
        setUpgradeLoading(false);
    }
  };

  useEffect(() => {
    ++upgradeFetchGeneration.current;
    setUpgradeNotes([]);
    setUpgradeView("list");
    setUpgradeSelectedId("");
    resetUpgradeDraft();
    setUpgradeSearch("");
    setUpgradeFilter("");
    setUpgradeSourceFilter("");
    setUpgradeError("");
    setUpgradeNotice("");
    setUpgradeSaving(false);
    setUpgradeLoading(false);
    setUpgradeDeleting("");
  }, [currentUser?.uid]);
  useEffect(() => {
    if (currentUser && activeMenu === "upgradeNotes") void fetchUpgradeNotes();
  }, [currentUser?.uid, activeMenu]);

  const openUpgradeEditor = (note?: UpgradeNote) => {
    if (upgradeSaving || upgradeDeleting) return;
    if (note) {
      setUpgradeEditingId(note.id);
      setUpgradeTitle(note.title);
      setUpgradeBody(note.body);
      setUpgradeProject(note.projectName);
      setUpgradeTopic(note.topic);
      setUpgradeSource(note.sourceVersion);
      setUpgradeDate(note.noteDate || getTodayInputDate());
    } else {
      resetUpgradeDraft();
    }
    setUpgradeError("");
    setUpgradeNotice("");
    setUpgradeView("edit");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const saveUpgradeNote = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentUser || upgradeSaving || upgradeDeleting) return;
    if (!upgradeTitle.trim() || !upgradeBody.trim() || !upgradeDate) {
      setUpgradeError("Isi judul, tanggal, dan catatan terlebih dahulu.");
      return;
    }
    if (upgradeTitle.trim().length > 200 || upgradeBody.length > 100000) {
      setUpgradeError(
        "Judul maksimal 200 karakter dan isi maksimal 100.000 karakter.",
      );
      return;
    }
    const owner = currentUser.uid;
    const previous = upgradeNotes.find((item) => item.id === upgradeEditingId);
    if (upgradeEditingId && (!previous || previous.userId !== owner)) {
      setUpgradeError(
        "Catatan tidak ditemukan. Muat ulang daftar terlebih dahulu.",
      );
      return;
    }
    const draft = {
      title: upgradeTitle.trim(),
      body: upgradeBody,
      projectName: upgradeProject.trim(),
      topic: upgradeTopic,
      sourceVersion: upgradeSource,
      noteDate: upgradeDate,
    };
    setUpgradeSaving(true);
    setUpgradeError("");
    setUpgradeNotice("");
    try {
      const payload = {
        userId: owner,
        recordType: "upgrade-note",
        title: draft.title,
        queryText: draft.body,
        client: draft.projectName,
        topic: draft.topic,
        sourceVersion: draft.sourceVersion,
        noteDate: draft.noteDate,
        updatedAt: serverTimestamp(),
      };
      let id = upgradeEditingId;
      if (id) await updateDoc(doc(db, "workSavedQueries", id), payload);
      else
        id = (
          await addDoc(collection(db, "workSavedQueries"), {
            ...payload,
            createdAt: serverTimestamp(),
          })
        ).id;
      if (activeUserId.current !== owner) return;
      // Discard any older in-flight refresh before adding the confirmed saved row.
      ++upgradeFetchGeneration.current;
      setUpgradeLoading(false);
      const row: UpgradeNote = {
        ...draft,
        id,
        userId: owner,
        createdAtMillis: previous?.createdAtMillis || Date.now(),
        updatedAtMillis: Date.now(),
      };
      setUpgradeNotes((items) => [
        row,
        ...items.filter((item) => item.id !== id),
      ]);
      setUpgradeSelectedId(id);
      setUpgradeView("read");
      resetUpgradeDraft();
      setUpgradeNotice(
        previous
          ? "Perubahan catatan berhasil disimpan."
          : "Catatan berhasil disimpan.",
      );
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      if (activeUserId.current === owner)
        setUpgradeError(
          "Catatan belum tersimpan. Cek koneksi dan akses workSavedQueries di Firestore Rules. Isi catatan masih tersedia untuk dicoba lagi.",
        );
    } finally {
      if (activeUserId.current === owner) setUpgradeSaving(false);
    }
  };

  const deleteUpgradeNote = async (note: UpgradeNote) => {
    if (
      !currentUser ||
      note.userId !== currentUser.uid ||
      upgradeSaving ||
      upgradeDeleting
    )
      return;
    if (!window.confirm(`Hapus catatan “${note.title}”?`)) return;
    const owner = currentUser.uid;
    setUpgradeDeleting(note.id);
    setUpgradeError("");
    setUpgradeNotice("");
    try {
      await deleteDoc(doc(db, "workSavedQueries", note.id));
      if (activeUserId.current !== owner) return;
      ++upgradeFetchGeneration.current;
      setUpgradeLoading(false);
      setUpgradeNotes((items) => items.filter((item) => item.id !== note.id));
      setUpgradeView("list");
      setUpgradeSelectedId("");
      setUpgradeNotice("Catatan berhasil dihapus.");
    } catch {
      if (activeUserId.current === owner)
        setUpgradeError("Catatan belum dapat dihapus. Silakan coba lagi.");
    } finally {
      if (activeUserId.current === owner) setUpgradeDeleting("");
    }
  };

  const savedQueryClientOptions = uniqueLabels([
    ...clientOptions,
    ...savedQueries.map((item) => item.client),
  ]);

  const resetSavedQueryForm = () => {
    setSavedQueryClient("");
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
          .filter((item) => !isUpgradeRecord(item.data()))
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
              client:
                typeof data.client === "string"
                  ? normalizeClient(data.client)
                  : "",
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
    setSavedQueryFilterClient("");
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
      const selectedClient = normalizeClient(savedQueryClient);
      const clientName =
        savedQueryClientOptions.find(
          (item) => item.toLowerCase() === selectedClient.toLowerCase(),
        ) ?? selectedClient;
      const payload = {
        userId: uid,
        client: clientName,
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
        client: clientName,
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
      setSavedQueryFilterClient("");
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
    setSavedQueryClient(item.client);
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
    return savedQueries.filter((item) => {
      const matchesClient =
        !savedQueryFilterClient ||
        (savedQueryFilterClient === "__without_client__"
          ? !item.client
          : item.client.toLowerCase() === savedQueryFilterClient.toLowerCase());
      const matchesSearch =
        !text ||
        `${item.title}\n${item.client}\n${item.queryText}`
          .toLowerCase()
          .includes(text);
      return matchesClient && matchesSearch;
    });
  }, [savedQueries, savedQuerySearch, savedQueryFilterClient]);
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

  useEffect(
    () => () => {
      noteUploadControllers.current.forEach((controller) => controller.abort());
    },
    [],
  );

  useEffect(() => {
    if (!imageViewer) return;
    const previousOverflow = document.body.style.overflow;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() =>
      imageViewerClose.current?.focus(),
    );
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setImageViewer(null);
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const delta = event.key === "ArrowLeft" ? -1 : 1;
        setImageViewer((value) =>
          value
            ? {
                ...value,
                index: Math.max(
                  0,
                  Math.min(value.images.length - 1, value.index + delta),
                ),
              }
            : null,
        );
        setImageZoom(1);
      }
      if (event.key === "Tab") {
        const dialog = imageViewerClose.current?.closest('[role="dialog"]');
        const controls = Array.from(
          dialog?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), a[href]",
          ) ?? [],
        );
        const first = controls[0],
          last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", keyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", keyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [!!imageViewer]);

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
    if (!cleanLabel(client) || !cleanLabel(module) || !masukDate) {
      alert("Pilih project, modul, dan tanggal masuk dulu ya.");
      return;
    }
    if (masukDate > getTodayInputDate()) {
      alert("Tanggal pengajuan tidak boleh di masa depan.");
      return;
    }
    if (
      !clientOptions.includes(client) ||
      !modulesFor(client).includes(caseKind)
    ) {
      alert("Pilih project dan modul dari master.");
      return;
    }
    const previousRecord = projects.find(
      (item) => item.id === editingProjectId,
    );
    const savedCompletedDate = completionOnSave(status, previousRecord);
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
          previousRecord &&
          workKind(previousRecord.caseKind) === caseKind &&
          previousRecord.client === client
            ? previousRecord.module
            : (moduleOptions.find(
                (item) =>
                  item.toLowerCase() === cleanLabel(module).toLowerCase(),
              ) ?? cleanLabel(module)),
        bladeForm: bladeForm.trim(),
        requesterPic: requesterPic.trim(),
        caseKind,
        waitingReason: status === "Menunggu" ? waitingReason.trim() : "",
        completedDate: savedCompletedDate,
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
            previous?.completedDate !== savedCompletedDate);
        const event = makeActivity(
          completionChanged
            ? "Kasus selesai / tanggal selesai diperbarui"
            : previous?.status === "Selesai" && status !== "Selesai"
              ? "Kasus dibuka kembali"
              : "Kasus diperbarui",
          `${previous?.status ?? "—"} → ${status}. PIC peminta: ${requesterPic.trim()}.${status === "Menunggu" ? ` Menunggu: ${waitingReason.trim()}` : ""}`,
          completionChanged ? savedCompletedDate : getTodayInputDate(),
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
                    savedCompletedDate,
                  ),
                ]
              : [],
        });
        savedProjectId = created.id;
        alert("Kasus berhasil disimpan.");
      }

      resetForm();
      setProjectView("detail");
      if (activeMenu === "tambah") goBack();
      else openMenuPage("project");
      setSearch("");
      if (!editingProjectId) {
        setFilterClient(payload.client);
        setFilterModule(payload.module);
        setFilterStatus("");
        setFilterPriority("");
      }
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
    setModule(project.module || workKind(project.caseKind));
    setBladeForm(project.bladeForm);
    setRequesterPic(project.requesterPic);
    setCaseKind(workKind(project.caseKind));
    setWaitingReason(project.waitingReason);
    setMasukDate(project.masukDate);
    setDeadlineDate(project.deadlineDate);
    setStatus(project.status);
    setPriority(project.priority);
    setProjectNotes(project.notes);
    openMenuPage("tambah");
  };

  const openCompletion = (project: WorkProject) => {
    setCompletionProjectId(project.id);
  };

  const completeProject = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentUser || !completionProject || isCompleting) return;
    const completionDateInput = completionOnSave("Selesai", completionProject);
    if (completionProject.masukDate > completionDateInput) {
      alert("Tanggal masuk tidak boleh di masa depan.");
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
      await Promise.all(relatedTasks.map((item) => deleteTaskWithImages(item)));
      const relatedNotes = notes.filter(
        (item) => item.projectId === project.id,
      );
      await Promise.all(relatedNotes.map((item) => deleteNoteWithImages(item)));
      await deleteDoc(doc(db, "workProjects", project.id));

      if (selectedProjectId === project.id) {
        setSelectedProjectId("");
        goBack();
      }
      await fetchProjects();
      alert("Kasus berhasil dihapus.");
    } catch (error) {
      console.error(error);
      alert("Gagal menghapus kasus.");
    }
  };

  const persistNoteWithImages = async (
    project: WorkProject,
    text: string,
    date: string,
    draft: ReturnType<typeof useNoteImageDraft>,
    onProgress: (value: number | null) => void,
    controllerRef: { current: AbortController | null },
  ) => {
    if (!currentUser) throw new Error("Login diperlukan");
    const uid = currentUser.uid;
    const controller = new AbortController();
    controllerRef.current = controller;
    noteUploadControllers.current.add(controller);
    const noteRef = doc(collection(db, "workProjectNotes"));
    let attachments: NoteAttachment[] = [];
    let committed = false;
    try {
      if (draft.images.length) onProgress(0);
      attachments = await uploadNoteAttachments({
        uid,
        projectId: project.id,
        noteId: noteRef.id,
        images: [...draft.images],
        signal: controller.signal,
        onProgress: (value) => {
          if (activeUserId.current === uid) onProgress(value);
        },
      });
      if (controller.signal.aborted || activeUserId.current !== uid)
        throw Object.assign(new Error("Upload dibatalkan."), {
          code: "storage/canceled",
        });
      await setDoc(noteRef, {
        userId: uid,
        projectId: project.id,
        projectTitle: project.title,
        noteDate: date,
        note: text.trim(),
        ...(attachments.length ? { attachments } : {}),
        createdAt: serverTimestamp(),
      });
      committed = true;
    } catch (error) {
      if (!committed && attachments.length) {
        try {
          await removeNoteImageObjects(attachments.map((item) => item.path));
        } catch (cleanupError) {
          console.error("Note image cleanup failed", cleanupError);
        }
      }
      throw error;
    } finally {
      noteUploadControllers.current.delete(controller);
      if (controllerRef.current === controller) controllerRef.current = null;
      if (activeUserId.current === uid) onProgress(null);
    }
  };

  const deleteNoteWithImages = async (note: ProjectNote) => {
    if (!currentUser) throw new Error("Login diperlukan");
    const prefix = `workNoteImages/${currentUser.uid}/${note.projectId}/${note.id}/`;
    await removeNoteImageObjects(
      note.attachments
        .filter((item) => item.path.startsWith(prefix))
        .map((item) => item.path),
    );
    await deleteDoc(doc(db, "workProjectNotes", note.id));
  };

  const saveNote = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentUser || !selectedProject || isSavingNote) return;
    if (!noteText.trim() && !noteImageDraft.images.length) {
      noteImageDraft.setError(
        "Isi catatan atau tambahkan gambar terlebih dahulu.",
      );
      return;
    }
    const uid = currentUser.uid;
    try {
      setIsSavingNote(true);
      noteImageDraft.setError("");
      await persistNoteWithImages(
        selectedProject,
        noteText,
        noteDate,
        noteImageDraft,
        setNoteUploadProgress,
        noteUploadController,
      );
      if (activeUserId.current !== uid) return;
      setNoteText("");
      setNoteDate(getTodayInputDate());
      noteImageDraft.clear();
      await fetchProjects();
    } catch (error) {
      if (activeUserId.current === uid) {
        console.error(error);
        noteImageDraft.setError(getNoteSaveError(error));
      }
    } finally {
      if (activeUserId.current === uid) setIsSavingNote(false);
    }
  };

  const deleteNote = async (noteId: string) => {
    const note = notes.find((item) => item.id === noteId);
    if (!note || !window.confirm("Hapus catatan ini beserta gambar terlampir?"))
      return;
    try {
      await deleteNoteWithImages(note);
      await fetchProjects();
    } catch (error) {
      console.error(error);
      alert(
        "Catatan belum selesai dihapus. Periksa koneksi dan izin Firebase, lalu coba lagi.",
      );
      await fetchProjects();
    }
  };

  const saveCatatan = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentUser || isSavingCatatan) return;
    const target = projects.find((item) => item.id === catatanProjectId);
    if (!target) {
      catatanImageDraft.setError("Pilih kasus terlebih dahulu.");
      return;
    }
    if (!catatanText.trim() && !catatanImageDraft.images.length) {
      catatanImageDraft.setError(
        "Isi catatan atau tambahkan gambar terlebih dahulu.",
      );
      return;
    }
    const uid = currentUser.uid;
    try {
      setIsSavingCatatan(true);
      catatanImageDraft.setError("");
      await persistNoteWithImages(
        target,
        catatanText,
        catatanDate,
        catatanImageDraft,
        setCatatanUploadProgress,
        catatanUploadController,
      );
      if (activeUserId.current !== uid) return;
      setCatatanText("");
      setCatatanDate(getTodayInputDate());
      catatanImageDraft.clear();
      await fetchProjects();
      alert("Catatan berhasil disimpan.");
    } catch (error) {
      if (activeUserId.current === uid) {
        console.error(error);
        catatanImageDraft.setError(getNoteSaveError(error));
      }
    } finally {
      if (activeUserId.current === uid) setIsSavingCatatan(false);
    }
  };

  const saveTask = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSavingTask) return;

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

    const uid = currentUser.uid;
    const controller = new AbortController();
    taskUploadController.current = controller;
    noteUploadControllers.current.add(controller);
    const taskRef = doc(collection(db, "workProjectTasks"));
    let attachments: NoteAttachment[] = [];
    let committed = false;
    try {
      setIsSavingTask(true);
      taskImageDraft.setError("");
      if (taskImageDraft.images.length) setTaskUploadProgress(0);
      attachments = await uploadNoteAttachments({
        uid,
        projectId: taskProjectId,
        noteId: `task-${taskRef.id}`,
        images: [...taskImageDraft.images],
        signal: controller.signal,
        onProgress: (value) => {
          if (activeUserId.current === uid) setTaskUploadProgress(value);
        },
      });
      if (controller.signal.aborted || activeUserId.current !== uid)
        throw Object.assign(new Error("Upload dibatalkan."), {
          code: "storage/canceled",
        });
      await setDoc(taskRef, {
        userId: uid,
        projectId: taskProjectId,
        title: taskTitle.trim(),
        taskDate,
        isDone: false,
        ...(attachments.length ? { attachments } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      committed = true;
      if (activeUserId.current !== uid) return;
      setTaskTitle("");
      setTaskDate(getTodayInputDate());
      taskImageDraft.clear();
      await fetchProjects();
    } catch (error) {
      if (!committed && attachments.length) {
        try {
          await removeNoteImageObjects(attachments.map((item) => item.path));
        } catch (cleanupError) {
          console.error("Task image cleanup failed", cleanupError);
        }
      }
      if (activeUserId.current === uid) {
        console.error(error);
        taskImageDraft.setError(
          getNoteSaveError(error)
            .replace(/Catatan/g, "Tugas")
            .replace(/catatan/g, "tugas"),
        );
      }
    } finally {
      noteUploadControllers.current.delete(controller);
      if (taskUploadController.current === controller)
        taskUploadController.current = null;
      if (activeUserId.current === uid) {
        setIsSavingTask(false);
        setTaskUploadProgress(null);
      }
    }
  };

  const deleteTaskWithImages = async (task: WorkTask) => {
    if (!currentUser) throw new Error("Login diperlukan");
    const prefix = `workNoteImages/${currentUser.uid}/${task.projectId}/task-${task.id}/`;
    await removeNoteImageObjects(
      task.attachments
        .filter((item) => item.path.startsWith(prefix))
        .map((item) => item.path),
    );
    await deleteDoc(doc(db, "workProjectTasks", task.id));
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
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    const ok = window.confirm("Hapus pekerjaan ini?");
    if (!ok) return;

    try {
      await deleteTaskWithImages(task);
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
          "Lampiran Gambar",
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
          task.attachments.map((item) => item.url).join("\n"),
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
          "Lampiran Gambar",
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
          note.attachments.map((image) => image.url).join("\n"),
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
            <td>${escapeReportCell(task.title)}${task.attachments.map((image) => `<br/><a href="${escapeReportCell(image.url)}">${escapeReportCell(image.name)}</a>`).join("")}</td>
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
            <td>${escapeReportCell(note.note)}${note.attachments.map((image, index) => `<div><a href="${escapeReportCell(image.url)}">Gambar ${index + 1}: ${escapeReportCell(image.name)}</a></div>`).join("")}</td>
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
    if (clientName && clientName !== UNASSIGNED_CLIENT)
      setTransactionClient(clientName);
    setTransactionModule(
      workModules.includes(moduleName as CaseKind)
        ? (moduleName as CaseKind)
        : "",
    );
    setIssueRows([newIssueDraft()]);
    setGridError("");
    setGridNotice("");
    openMenuPage("projects");
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
    setProjectView("list");
  };

  const selectCase = (project: WorkProject) => {
    if (activeMenu === "project" && projectView === "list") {
      navigationHistory.current.push({
        menu: "project",
        view: "list",
        scroll: window.scrollY,
      });
    }
    openMenuPage("project");
    setProjectView("detail");
    setSelectedProjectId(project.id);
    setTaskProjectId(project.id);
    setDetailTab("notes");
    setDetailNotice("");
    setDetailError("");
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
      className={`w-full rounded-xl border p-4 text-left transition-colors hover:border-emerald-400/60 ${selected ? "border-emerald-400 bg-emerald-400/10" : borderColor}`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className={`text-xs font-medium ${smallAccent}`}>
          {project.client} · {workKind(project.caseKind)}
        </p>
        <span className={`shrink-0 text-xs ${mutedText}`}>
          {project.status}
        </span>
      </div>
      <h3 className="mt-2 break-words font-semibold leading-relaxed">
        {project.title}
      </h3>
      <div
        className={`mt-3 flex items-center justify-between gap-3 text-xs ${mutedText}`}
      >
        <span>Masuk {formatInputDate(project.masukDate)}</span>
        <span className={smallAccent}>Lihat detail →</span>
      </div>
    </button>
  );

  const renderDashboardCase = (project: WorkProject) => (
    <button
      type="button"
      onClick={() => {
        selectCase(project);
      }}
      className={`group w-full rounded-2xl border ${borderColor} p-4 text-left transition-colors hover:border-emerald-400/60 hover:bg-emerald-400/5 focus-visible:outline-emerald-400`}
    >
      <div className="flex items-center justify-between gap-3">
        <p className={`truncate text-[11px] font-semibold ${smallAccent}`}>
          {getCaseContext(project)}
        </p>
        <span className={`shrink-0 text-[11px] ${mutedText}`}>
          {project.status}
        </span>
      </div>
      <h3 className="mt-2 break-words text-[14px] font-semibold">
        {project.title}
      </h3>
      <div
        className={`mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] ${mutedText}`}
      >
        <span>{project.requesterPic || "Belum ada PIC"}</span>
        <span>
          {project.deadlineDate
            ? `Deadline ${formatInputDate(project.deadlineDate)}`
            : "Tanpa deadline"}{" "}
          <span aria-hidden="true">↗</span>
        </span>
      </div>
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
    <main
      className={`min-h-screen text-[13px] leading-[1.5] lg:pl-60 ${pageBg}`}
    >
      <section className="mx-auto max-w-[1440px] px-4 py-5 sm:px-8 sm:py-8">
        <header className={activeMenu === "project" ? "mb-5" : "mb-7"}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <button
                type="button"
                aria-label="Buka navigasi"
                aria-expanded={isNavigationMenuOpen}
                onClick={() => setIsNavigationMenuOpen(true)}
                className={`mb-3 lg:hidden ${secondaryButton}`}
              >
                ☰ Menu
              </button>
              <p
                className={`text-[12px] font-bold uppercase tracking-wide ${smallAccent}`}
              >
                Kerja Nowmy · Ruang Kerja
              </p>
              {activeMenu !== "project" && (
                <>
                  <h1 className="mt-2 break-words text-[26px] font-semibold tracking-tight">
                    Hai, {username} 👋
                  </h1>
                  <p className={`mt-1 text-[13px] ${mutedText}`}>
                    Yuk, selesaikan satu per satu. Semua pekerjaanmu ada di
                    sini.
                  </p>
                </>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => openNewCase()}
                className={buttonClass}
              >
                ＋ Pekerjaan
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
          <div className="space-y-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p
                  className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${smallAccent}`}
                >
                  Overview
                </p>
                <h2 className="mt-1 text-[20px] font-semibold tracking-tight">
                  Fokus pekerjaanmu
                </h2>
              </div>
              <span className={`text-[12px] ${mutedText}`}>
                {formatInputDate(getTodayInputDate())}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
              {stats.map(([label, value], index) => (
                <div
                  key={label}
                  className={`relative overflow-hidden rounded-2xl border ${borderColor} ${index === 0 ? "bg-emerald-400/10" : cardBg} p-4 sm:p-5`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className={`text-[12px] font-medium ${mutedText}`}>
                      {label}
                    </p>
                    <span
                      aria-hidden="true"
                      className={`flex h-8 w-8 items-center justify-center rounded-xl ${index === 2 ? "bg-rose-400/10 text-rose-400" : "bg-emerald-400/10 text-emerald-500"}`}
                    >
                      {["◈", "◷", "!", "⋯", "✓", "☑"][index]}
                    </span>
                  </div>
                  <p className="mt-3 text-[30px] font-semibold leading-none tracking-tight">
                    {value}
                  </p>
                </div>
              ))}
            </div>
            <details className={`${panelClass} group`}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium">
                <span>
                  ⌕ Cari &amp; filter pekerjaan{" "}
                  <span className={`ml-2 text-[11px] ${mutedText}`}>
                    {[
                      search,
                      filterClient,
                      filterModule,
                      filterStatus,
                      filterPriority,
                    ].filter(Boolean).length > 0
                      ? "· Filter aktif"
                      : "· Semua pekerjaan"}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="transition-transform group-open:rotate-180"
                >
                  ⌄
                </span>
              </summary>
              <div className="mt-4">{renderFilters()}</div>
            </details>
            <div className="grid gap-3 lg:grid-cols-2">
              <section className={panelClass}>
                <h2 className="mb-0.5 text-[16px] font-semibold">
                  Prioritas berikutnya
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
                      <div key={project.id}>{renderDashboardCase(project)}</div>
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
                  Menunggu kabar
                </h2>
                <p className={`mb-4 text-[13px] ${mutedText}`}>
                  Lihat hal yang masih ditunggu agar tidak terlupakan.
                </p>
                <div className="space-y-3">
                  {filteredProjects
                    .filter((item) => item.status === "Menunggu")
                    .slice(0, 5)
                    .map((project) => (
                      <div key={project.id}>{renderDashboardCase(project)}</div>
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
          <section className={panelClass}>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className={`text-[11px] ${smallAccent}`}>MASTER</p>
                <h2 className="text-[20px] font-semibold">Master Project</h2>
                <p className={`mt-1 ${mutedText}`}>
                  Siapkan project dan modul sebelum mencatat pekerjaan.
                </p>
              </div>
              <button
                type="button"
                className={buttonClass}
                onClick={() => {
                  setClientError("");
                  openMenuPage("clientAdd");
                }}
              >
                ＋ Tambah project
              </button>
            </div>
            <input
              aria-label="Cari project"
              placeholder="Cari nama project..."
              value={clientHubSearch}
              onChange={(e) => setClientHubSearch(e.target.value)}
              className={inputClass}
            />
            {clientError && (
              <p role="alert" className="mt-3 text-rose-500">
                {clientError}
              </p>
            )}
            <div className="mt-4 divide-y divide-neutral-500/15">
              {clientOptions
                .filter((name) =>
                  name.toLowerCase().includes(clientHubSearch.toLowerCase()),
                )
                .map((name) => (
                  <div
                    key={name}
                    className="flex flex-wrap items-center justify-between gap-3 py-4"
                  >
                    <div>
                      <p className="font-semibold">{name}</p>
                      <p className={`mt-1 text-[12px] ${mutedText}`}>
                        {modulesFor(name).join(" · ")}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={secondaryButton}
                        onClick={() => {
                          setMasterProjectName(name);
                          setModuleDraft(modulesFor(name));
                          setClientError("");
                          openMenuPage("masterModules");
                        }}
                      >
                        Kelola modul
                      </button>
                      <button
                        type="button"
                        className={buttonClass}
                        onClick={() => {
                          setTransactionClient(name);
                          setTransactionModule("");
                          setIssueRows([newIssueDraft()]);
                          setGridError("");
                          setGridNotice("");
                          openMenuPage("projects");
                        }}
                      >
                        Catat kerja →
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </section>
        )}
        {activeMenu === "clientAdd" && (
          <section className={`mx-auto max-w-xl ${panelClass}`}>
            <h2 className="text-[20px] font-semibold">Tambah Project</h2>
            <form onSubmit={saveMasterClient} className="mt-5 space-y-4">
              <label className="block">
                Nama project
                <input
                  autoFocus
                  required
                  maxLength={150}
                  className={`mt-2 ${inputClass}`}
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                />
              </label>
              <p className={mutedText}>
                Modul awal: Maintenance, Penambahan, Bug, dan Revisi. Sesuaikan
                melalui Kelola modul.
              </p>
              {clientError && (
                <p role="alert" className="text-rose-500">
                  {clientError}
                </p>
              )}
              <div className="flex gap-2">
                <button disabled={savingClient} className={buttonClass}>
                  {savingClient ? "Menyimpan..." : "Simpan project"}
                </button>
                <button
                  type="button"
                  disabled={savingClient}
                  className={secondaryButton}
                  onClick={() => openMenuPage("client")}
                >
                  Kembali
                </button>
              </div>
            </form>
          </section>
        )}
        {activeMenu === "masterModules" && (
          <section className={`mx-auto max-w-xl ${panelClass}`}>
            <p className={`text-[11px] ${smallAccent}`}>MASTER MODUL PROJECT</p>
            <h2 className="mt-2 text-[20px] font-semibold">
              {masterProjectName}
            </h2>
            <form onSubmit={saveModuleMaster} className="mt-5 space-y-4">
              <fieldset disabled={savingClient} className="space-y-3">
                <legend className={`mb-3 ${mutedText}`}>
                  Pilih modul yang digunakan project ini.
                </legend>
                {uniqueLabels([
                  ...workModules,
                  ...modulesFor(masterProjectName),
                ]).map((name) => (
                  <label
                    key={name}
                    className={`flex items-center gap-3 rounded-xl border ${borderColor} p-4`}
                  >
                    <input
                      type="checkbox"
                      checked={moduleDraft.includes(name as CaseKind)}
                      onChange={(e) =>
                        setModuleDraft((values) =>
                          e.target.checked
                            ? [...values, name as CaseKind]
                            : values.filter((value) => value !== name),
                        )
                      }
                    />
                    {name}
                  </label>
                ))}
              </fieldset>
              <p className={`text-[12px] ${mutedText}`}>
                Modul yang sudah memiliki catatan tetap tersedia untuk menjaga
                riwayat.
              </p>
              {clientError && (
                <p role="alert" className="text-rose-500">
                  {clientError}
                </p>
              )}
              <div className="flex gap-2">
                <button disabled={savingClient} className={buttonClass}>
                  {savingClient ? "Menyimpan..." : "Simpan modul"}
                </button>
                <button
                  type="button"
                  disabled={savingClient}
                  className={secondaryButton}
                  onClick={() => openMenuPage("client")}
                >
                  Kembali
                </button>
              </div>
            </form>
          </section>
        )}
        {activeMenu === "projects" && (
          <div className="space-y-5">
            <section className={panelClass}>
              <p className={`text-[11px] ${smallAccent}`}>PENCATATAN KERJA</p>
              <h2 className="mt-1 text-[20px] font-semibold">
                Project → Modul → Detail pekerjaan
              </h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label>
                  1. Pilih project
                  <select
                    disabled={savingGrid}
                    className={`mt-2 ${inputClass}`}
                    value={transactionClient}
                    onChange={(e) => {
                      setTransactionClient(e.target.value);
                      setTransactionModule("");
                      setIssueRows([newIssueDraft()]);
                      setGridError("");
                      setGridNotice("");
                    }}
                  >
                    <option value="">Pilih project</option>
                    {clientOptions.map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  2. Pilih modul project
                  <select
                    disabled={!transactionClient || savingGrid}
                    className={`mt-2 ${inputClass}`}
                    value={transactionModule}
                    onChange={(e) => {
                      setTransactionModule(e.target.value as CaseKind);
                      setIssueRows([newIssueDraft()]);
                      setGridError("");
                      setGridNotice("");
                    }}
                  >
                    <option value="">Pilih modul</option>
                    {modulesFor(transactionClient).map((name) => (
                      <option key={name}>{name}</option>
                    ))}
                  </select>
                </label>
              </div>
              <button
                type="button"
                className={`mt-3 text-[12px] ${smallAccent}`}
                onClick={() => openMenuPage("client")}
              >
                Kelola master project dan modul ↗
              </button>
            </section>
            {!transactionClient || !transactionModule ? (
              <section className={`${panelClass} py-12 text-center`}>
                <h3 className="font-semibold">
                  Pilih project dan modul terlebih dahulu
                </h3>
                <p className={`mt-2 ${mutedText}`}>
                  Detail pekerjaan akan muncul setelah kedua pilihan terisi.
                </p>
              </section>
            ) : (
              <>
                <section className={panelClass}>
                  <h3 className="text-[16px] font-semibold">
                    3. Detail pekerjaan · {transactionClient} /{" "}
                    {transactionModule}
                  </h3>
                  <p className={`mt-2 text-[12px] ${mutedText}`}>
                    Satu baris untuk satu pekerjaan. Tanggal selesai otomatis
                    terisi saat disimpan dengan status Selesai.
                  </p>
                  <form onSubmit={saveIssueGrid} className="mt-4 space-y-4">
                    <fieldset disabled={savingGrid} className="min-w-0">
                      <div className="overflow-x-auto rounded-xl border border-neutral-500/20">
                        <table className="w-full min-w-[760px] text-left text-[12px]">
                          <thead className={softCardBg}>
                            <tr>
                              {[
                                "No",
                                "Deskripsi *",
                                "Tanggal masuk *",
                                "Status *",
                                "Tanggal selesai",
                                "Aksi",
                              ].map((label) => (
                                <th key={label} className="p-3 font-medium">
                                  {label}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {issueRows.map((row, index) => (
                              <tr
                                key={row.id}
                                className="border-t border-neutral-500/15"
                              >
                                <td className="p-2">{index + 1}</td>
                                <td className="min-w-[260px] p-2">
                                  <textarea
                                    aria-label={`Deskripsi baris ${index + 1}`}
                                    required
                                    className={`${inputClass} min-h-20`}
                                    value={row.title}
                                    onChange={(e) =>
                                      updateIssueRow(row.id, {
                                        title: e.target.value,
                                      })
                                    }
                                    placeholder="Tuliskan pekerjaan yang perlu dikerjakan"
                                  />
                                </td>
                                <td className="p-2">
                                  <input
                                    aria-label={`Tanggal masuk baris ${index + 1}`}
                                    type="date"
                                    required
                                    max={getTodayInputDate()}
                                    className={inputClass}
                                    value={row.masukDate}
                                    onChange={(e) =>
                                      updateIssueRow(row.id, {
                                        masukDate: e.target.value,
                                      })
                                    }
                                  />
                                </td>
                                <td className="p-2">
                                  <select
                                    aria-label={`Status baris ${index + 1}`}
                                    className={inputClass}
                                    value={row.status}
                                    onChange={(e) =>
                                      updateIssueRow(row.id, {
                                        status: e.target.value as ProjectStatus,
                                      })
                                    }
                                  >
                                    {statusOptions.map((name) => (
                                      <option key={name}>{name}</option>
                                    ))}
                                  </select>
                                </td>
                                <td className={`p-2 ${mutedText}`}>
                                  {row.status === "Selesai"
                                    ? "Otomatis saat simpan"
                                    : "Belum selesai"}
                                </td>
                                <td className="p-2">
                                  <button
                                    type="button"
                                    disabled={issueRows.length === 1}
                                    aria-label={`Hapus baris ${index + 1}`}
                                    className={secondaryButton}
                                    onClick={() =>
                                      setIssueRows((rows) =>
                                        rows.filter(
                                          (item) => item.id !== row.id,
                                        ),
                                      )
                                    }
                                  >
                                    ×
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </fieldset>
                    {gridError && (
                      <p role="alert" className="text-rose-500">
                        {gridError}
                      </p>
                    )}
                    {gridNotice && (
                      <p role="status" className={smallAccent}>
                        {gridNotice}
                      </p>
                    )}
                    <div className="flex flex-wrap justify-between gap-3">
                      <button
                        type="button"
                        disabled={savingGrid || issueRows.length >= 100}
                        className={secondaryButton}
                        onClick={() =>
                          setIssueRows((rows) => [...rows, newIssueDraft()])
                        }
                      >
                        ＋ Tambah baris
                      </button>
                      <button disabled={savingGrid} className={buttonClass}>
                        {savingGrid
                          ? "Menyimpan..."
                          : `Simpan ${issueRows.length} pekerjaan`}
                      </button>
                    </div>
                  </form>
                </section>
                <section className={panelClass}>
                  <h3 className="mb-4 font-semibold">Pekerjaan tersimpan</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[650px] text-left">
                      <thead>
                        <tr>
                          {[
                            "Deskripsi",
                            "Tanggal masuk",
                            "Status",
                            "Tanggal selesai",
                            "",
                          ].map((label, index) => (
                            <th
                              key={index}
                              className="p-3 text-[12px] font-medium"
                            >
                              {label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {transactionRecords.map((item) => (
                          <tr
                            key={item.id}
                            className="border-t border-neutral-500/15"
                          >
                            <td className="whitespace-pre-wrap p-3">
                              {item.title}
                            </td>
                            <td className="p-3">
                              {formatInputDate(item.masukDate)}
                            </td>
                            <td className="p-3">{item.status}</td>
                            <td className="p-3">
                              {formatInputDate(item.completedDate)}
                            </td>
                            <td className="p-3">
                              <button
                                type="button"
                                className={secondaryButton}
                                onClick={() => startEditProject(item)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                className={`ml-2 ${secondaryButton}`}
                                onClick={() => {
                                  selectCase(item);
                                }}
                              >
                                Detail ↗
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {!transactionRecords.length && (
                    <p className={mutedText}>
                      Belum ada pekerjaan pada modul ini.
                    </p>
                  )}
                </section>
              </>
            )}
          </div>
        )}
        {activeMenu === "tambah" && (
          <section className={`mx-auto max-w-3xl ${panelClass}`}>
            <button
              type="button"
              disabled={isSaving}
              onClick={() => {
                resetForm();
                goBack();
              }}
              className={`mb-4 ${secondaryButton}`}
            >
              ← Kembali
            </button>
            <h2 className="text-[20px] font-semibold">
              {editingProjectId ? "Edit pekerjaan" : "Tambah pekerjaan"}
            </h2>
            <form onSubmit={saveProject} className="mt-5 space-y-4">
              <fieldset disabled={isSaving} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label>
                    1. Project
                    <select
                      required
                      className={`mt-2 ${inputClass}`}
                      value={client}
                      onChange={(e) => {
                        setClient(e.target.value);
                        setModule("");
                        setCaseKind("Bug");
                      }}
                    >
                      <option value="">Pilih project</option>
                      {clientOptions.map((name) => (
                        <option key={name}>{name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    2. Modul project
                    <select
                      required
                      disabled={!client}
                      className={`mt-2 ${inputClass}`}
                      value={module ? caseKind : ""}
                      onChange={(e) => {
                        setModule(e.target.value);
                        setCaseKind(e.target.value as CaseKind);
                      }}
                    >
                      <option value="">Pilih modul</option>
                      {moduleOptions.map((name) => (
                        <option key={name}>{name}</option>
                      ))}
                    </select>
                  </label>
                </div>
                {client && module && (
                  <>
                    <label className="block">
                      3. Deskripsi *
                      <textarea
                        required
                        className={`mt-2 min-h-32 ${inputClass}`}
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                      />
                    </label>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label>
                        Tanggal masuk *
                        <input
                          required
                          type="date"
                          max={getTodayInputDate()}
                          className={`mt-2 ${inputClass}`}
                          value={masukDate}
                          onChange={(e) => setMasukDate(e.target.value)}
                        />
                      </label>
                      <label>
                        Status
                        <select
                          className={`mt-2 ${inputClass}`}
                          value={status}
                          onChange={(e) =>
                            setStatus(e.target.value as ProjectStatus)
                          }
                        >
                          {statusOptions.map((name) => (
                            <option key={name}>{name}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <p className={`text-[12px] ${mutedText}`}>
                      {status === "Selesai"
                        ? `Tanggal selesai: ${formatInputDate(
                            completionOnSave(
                              status,
                              projects.find(
                                (item) => item.id === editingProjectId,
                              ),
                            ),
                          )}. Dicatat otomatis saat simpan.`
                        : "Tanggal selesai akan terisi otomatis saat pekerjaan disimpan dengan status Selesai."}
                    </p>
                    {projectNotes && (
                      <p
                        className={`whitespace-pre-wrap text-[12px] ${mutedText}`}
                      >
                        Catatan sebelumnya: {projectNotes}
                      </p>
                    )}
                  </>
                )}
              </fieldset>
              <div className="flex gap-2">
                <button
                  disabled={isSaving || !client || !module}
                  className={buttonClass}
                >
                  {isSaving ? "Menyimpan..." : "Simpan pekerjaan"}
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  className={secondaryButton}
                  onClick={() => {
                    resetForm();
                    goBack();
                  }}
                >
                  Batal
                </button>
              </div>
            </form>
          </section>
        )}

        {activeMenu === "project" && (
          <div className="mx-auto max-w-4xl space-y-5">
            <button
              type="button"
              onClick={goBack}
              disabled={savingStatus || isSavingNote || isSavingTask}
              className={secondaryButton}
            >
              ← Kembali
            </button>
            {projectView === "list" ? (
              <section className={panelClass}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold">Daftar pekerjaan</h2>
                    <p className={`mt-1 ${mutedText}`}>
                      {filteredProjects.length} pekerjaan
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={isLoadingProjects}
                    onClick={fetchProjects}
                    className={secondaryButton}
                  >
                    Refresh
                  </button>
                </div>
                <details
                  className={`mt-4 rounded-xl border ${borderColor} p-3`}
                >
                  <summary className="cursor-pointer font-medium">
                    Cari dan filter
                  </summary>
                  <div className="mt-4">{renderFilters()}</div>
                </details>
                <div className="mt-4 space-y-3">
                  {filteredProjects.map((project) => renderCaseCard(project))}
                </div>
                {!filteredProjects.length && (
                  <p className={`py-8 text-center ${mutedText}`}>
                    Belum ada pekerjaan sesuai filter.
                  </p>
                )}
              </section>
            ) : !selectedProject ? (
              <section className={`${panelClass} py-10 text-center`}>
                <h2 className="text-lg font-semibold">
                  Pekerjaan tidak tersedia
                </h2>
                <p className={`mt-2 ${mutedText}`}>
                  Kembali ke daftar untuk memilih pekerjaan.
                </p>
              </section>
            ) : (
              <>
                <section
                  id="case-detail"
                  key={selectedProject.id}
                  className={`${panelClass} space-y-5 sm:p-6`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className={`font-medium ${smallAccent}`}>
                      {selectedProject.client || "Tanpa project"}
                      <span className={`mx-2 ${mutedText}`}>/</span>
                      {workKind(selectedProject.caseKind)}
                    </p>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${selectedProject.status === "Selesai" ? "bg-emerald-400/15 text-emerald-500" : `${softCardBg} ${mutedText}`}`}
                    >
                      {selectedProject.status}
                    </span>
                  </div>
                  <h2 className="whitespace-pre-wrap break-words text-xl font-semibold leading-relaxed sm:text-2xl">
                    {selectedProject.title}
                  </h2>
                  <div
                    className={`flex flex-wrap gap-x-8 gap-y-3 border-y ${borderColor} py-4`}
                  >
                    <div>
                      <p className={`text-xs ${mutedText}`}>Tanggal masuk</p>
                      <p className="mt-1 font-medium">
                        {formatInputDate(selectedProject.masukDate)}
                      </p>
                    </div>
                    <div>
                      <p className={`text-xs ${mutedText}`}>Tanggal selesai</p>
                      <p className="mt-1 font-medium">
                        {selectedProject.completedDate
                          ? formatInputDate(selectedProject.completedDate)
                          : "Belum selesai"}
                      </p>
                    </div>
                    {selectedProject.deadlineDate && (
                      <div>
                        <p className={`text-xs ${mutedText}`}>Deadline</p>
                        <p className="mt-1 font-medium">
                          {formatInputDate(selectedProject.deadlineDate)}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="w-full sm:w-48">
                      <span className={`mb-1 block text-xs ${mutedText}`}>
                        Ubah status
                      </span>
                      <select
                        aria-label="Ubah status pekerjaan"
                        value={selectedProject.status}
                        disabled={savingStatus}
                        className={inputClass}
                        onChange={(event) =>
                          void changeWorkStatus(
                            selectedProject,
                            event.target.value as ProjectStatus,
                          )
                        }
                      >
                        {statusOptions.map((name) => (
                          <option key={name}>{name}</option>
                        ))}
                      </select>
                    </label>
                    {selectedProject.status !== "Selesai" && (
                      <button
                        type="button"
                        disabled={savingStatus}
                        onClick={() =>
                          void changeWorkStatus(selectedProject, "Selesai")
                        }
                        className={buttonClass}
                      >
                        {savingStatus ? "Menyimpan..." : "✓ Selesaikan"}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={savingStatus}
                      onClick={() => startEditProject(selectedProject)}
                      className={secondaryButton}
                    >
                      Edit pekerjaan
                    </button>
                  </div>
                  {savingStatus && (
                    <p role="status" className={mutedText}>
                      Menyimpan status...
                    </p>
                  )}
                  {detailNotice && (
                    <p role="status" className={smallAccent}>
                      {detailNotice}
                    </p>
                  )}
                  {detailError && (
                    <p role="alert" className="text-rose-500">
                      {detailError}
                    </p>
                  )}
                  {selectedProject.waitingReason &&
                    selectedProject.status === "Menunggu" && (
                      <p className={`whitespace-pre-wrap ${mutedText}`}>
                        Menunggu: {selectedProject.waitingReason}
                      </p>
                    )}
                  {selectedProject.notes && (
                    <div>
                      <h3 className={`mb-2 text-xs ${mutedText}`}>
                        Catatan awal
                      </h3>
                      <p className="whitespace-pre-wrap break-words leading-relaxed">
                        {selectedProject.notes}
                      </p>
                    </div>
                  )}
                  <details className={`border-t ${borderColor} pt-4`}>
                    <summary className={`cursor-pointer text-xs ${mutedText}`}>
                      Informasi tambahan dan opsi lainnya
                    </summary>
                    <dl className="mt-4 space-y-3 text-xs">
                      {[
                        [
                          "Modul/topik sebelumnya",
                          selectedProject.module !==
                          workKind(selectedProject.caseKind)
                            ? selectedProject.module
                            : "",
                        ],
                        ["PIC", selectedProject.requesterPic],
                        ["Blade/Form", selectedProject.bladeForm],
                        [
                          "Prioritas",
                          selectedProject.priority !== "Normal"
                            ? selectedProject.priority
                            : "",
                        ],
                        [
                          "Terakhir diperbarui",
                          selectedProject.updatedAtMillis
                            ? new Date(
                                selectedProject.updatedAtMillis,
                              ).toLocaleString("id-ID")
                            : selectedProject.createdAtText,
                        ],
                      ]
                        .filter(([, value]) => Boolean(value))
                        .map(([label, value]) => (
                          <div key={label}>
                            <dt className={mutedText}>{label}</dt>
                            <dd className="mt-1 break-words">{value}</dd>
                          </div>
                        ))}
                    </dl>
                    <button
                      type="button"
                      disabled={savingStatus || isSavingNote || isSavingTask}
                      onClick={() => deleteProject(selectedProject)}
                      className="mt-5 rounded-lg border border-rose-500/30 px-3 py-2 text-xs text-rose-500"
                    >
                      Hapus pekerjaan
                    </button>
                  </details>
                </section>
                <section className={panelClass}>
                  <div
                    role="tablist"
                    aria-label="Aktivitas pekerjaan"
                    className={`flex gap-1 overflow-x-auto border-b ${borderColor}`}
                  >
                    {(
                      [
                        ["notes", "Catatan", selectedProjectNotes.length],
                        [
                          "tasks",
                          "Tugas",
                          tasks.filter(
                            (item) => item.projectId === selectedProject.id,
                          ).length,
                        ],
                        [
                          "history",
                          "Riwayat",
                          activityRows.filter(
                            (item) => item.projectId === selectedProject.id,
                          ).length,
                        ],
                      ] as const
                    ).map(([id, label, count]) => (
                      <button
                        key={id}
                        id={`detail-tab-${id}`}
                        type="button"
                        role="tab"
                        aria-selected={detailTab === id}
                        aria-controls={`detail-panel-${id}`}
                        onClick={() => {
                          setDetailTab(id);
                          if (id === "tasks")
                            setTaskProjectId(selectedProject.id);
                        }}
                        className={`shrink-0 border-b-2 px-4 py-3 font-medium ${detailTab === id ? `border-emerald-400 ${smallAccent}` : `border-transparent ${mutedText}`}`}
                      >
                        {label}
                        <span className={`ml-2 text-xs ${mutedText}`}>
                          {count}
                        </span>
                      </button>
                    ))}
                  </div>
                  {detailTab === "notes" && (
                    <div
                      id="detail-panel-notes"
                      role="tabpanel"
                      aria-labelledby="detail-tab-notes"
                      className="pt-5"
                    >
                      <details
                        key={`note-${selectedProject.id}`}
                        className={`mb-5 rounded-xl border ${borderColor} p-4`}
                      >
                        <summary
                          className={`cursor-pointer font-medium ${smallAccent}`}
                        >
                          ＋ Tambah catatan
                        </summary>
                        <form onSubmit={saveNote} className="mt-4 space-y-3">
                          <label className="block">
                            <span className={`mb-1 block text-xs ${mutedText}`}>
                              Tanggal catatan
                            </span>
                            <input
                              required
                              type="date"
                              disabled={isSavingNote}
                              value={noteDate}
                              onChange={(e) => setNoteDate(e.target.value)}
                              className={`sm:max-w-52 ${inputClass}`}
                            />
                          </label>
                          <textarea
                            aria-label="Catatan progress"
                            required={!noteImageDraft.images.length}
                            disabled={isSavingNote}
                            value={noteText}
                            onChange={(e) => setNoteText(e.target.value)}
                            className={`${inputClass} min-h-24`}
                            placeholder="Tulis perkembangan atau hasil pekerjaan..."
                          />
                          {noteImageDraft.error && (
                            <p role="alert" className="text-rose-500">
                              {noteImageDraft.error}
                            </p>
                          )}
                          <button
                            disabled={isSavingNote}
                            className={buttonClass}
                          >
                            {isSavingNote ? "Menyimpan..." : "Simpan catatan"}
                          </button>
                        </form>
                      </details>
                      <div className="space-y-4">
                        {selectedProjectNotes.map((note) => (
                          <article
                            key={note.id}
                            className={`border-b ${borderColor} pb-4 last:border-0`}
                          >
                            <div className="mb-2 flex items-center justify-between gap-3">
                              <p className={`text-xs ${mutedText}`}>
                                {formatInputDate(note.noteDate)}
                              </p>
                              <button
                                type="button"
                                onClick={() => deleteNote(note.id)}
                                className="text-xs text-rose-500"
                              >
                                Hapus
                              </button>
                            </div>
                            <p className="whitespace-pre-wrap break-words leading-relaxed">
                              {note.note}
                            </p>
                            <NoteImageGallery
                              images={note.attachments}
                              onOpen={openNoteImages}
                            />
                          </article>
                        ))}
                      </div>
                      {!selectedProjectNotes.length && (
                        <p className={`py-5 text-center ${mutedText}`}>
                          Belum ada catatan untuk pekerjaan ini.
                        </p>
                      )}
                    </div>
                  )}
                  {detailTab === "tasks" && (
                    <div
                      id="detail-panel-tasks"
                      role="tabpanel"
                      aria-labelledby="detail-tab-tasks"
                      className="space-y-4 pt-5"
                    >
                      {selectedProject.status !== "Selesai" && (
                        <form
                          onSubmit={saveTask}
                          className={`space-y-3 rounded-xl border ${borderColor} p-4`}
                        >
                          <label className="block">
                            <span className={`mb-1 block text-xs ${mutedText}`}>
                              Tambah tugas
                            </span>
                            <input
                              required
                              aria-label="Tugas baru"
                              disabled={isSavingTask}
                              value={taskTitle}
                              onChange={(e) => setTaskTitle(e.target.value)}
                              className={inputClass}
                              placeholder="Apa yang perlu dikerjakan?"
                            />
                          </label>
                          <div className="flex flex-wrap items-end gap-3">
                            <label>
                              <span
                                className={`mb-1 block text-xs ${mutedText}`}
                              >
                                Tanggal target
                              </span>
                              <input
                                type="date"
                                required
                                disabled={isSavingTask}
                                value={taskDate}
                                onChange={(e) => setTaskDate(e.target.value)}
                                className={inputClass}
                              />
                            </label>
                            <button
                              disabled={isSavingTask}
                              className={buttonClass}
                            >
                              {isSavingTask ? "Menyimpan..." : "Tambah tugas"}
                            </button>
                          </div>
                          {taskImageDraft.error && (
                            <p role="alert" className="text-rose-500">
                              {taskImageDraft.error}
                            </p>
                          )}
                        </form>
                      )}
                      {tasks
                        .filter((item) => item.projectId === selectedProject.id)
                        .map((task) => (
                          <div
                            key={task.id}
                            className={`flex items-start gap-3 border-b ${borderColor} pb-4 last:border-0`}
                          >
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={task.isDone}
                              aria-label={`${task.isDone ? "Buka kembali" : "Selesaikan"} tugas: ${task.title}`}
                              onClick={() => toggleTaskDone(task)}
                              className={`h-7 w-7 shrink-0 rounded-lg border ${borderColor} ${task.isDone ? "bg-emerald-400/15 text-emerald-500" : ""}`}
                            >
                              {task.isDone ? "✓" : ""}
                            </button>
                            <div className="min-w-0">
                              <p
                                className={`whitespace-pre-wrap break-words ${task.isDone ? `line-through ${mutedText}` : ""}`}
                              >
                                {task.title}
                              </p>
                              <p className={`mt-1 text-xs ${mutedText}`}>
                                Target {formatInputDate(task.taskDate)}
                              </p>
                              <NoteImageGallery
                                images={task.attachments}
                                onOpen={openNoteImages}
                              />
                            </div>
                          </div>
                        ))}
                      {!tasks.some(
                        (item) => item.projectId === selectedProject.id,
                      ) && (
                        <p className={`py-5 text-center ${mutedText}`}>
                          Belum ada tugas untuk pekerjaan ini.
                        </p>
                      )}
                    </div>
                  )}
                  {detailTab === "history" && (
                    <div
                      id="detail-panel-history"
                      role="tabpanel"
                      aria-labelledby="detail-tab-history"
                      className="pt-5"
                    >
                      <div className="space-y-4">
                        {activityRows
                          .filter(
                            (item) => item.projectId === selectedProject.id,
                          )
                          .map((activity) => (
                            <article
                              key={activity.id}
                              className={`border-l-2 ${borderColor} pl-4`}
                            >
                              <p className={`text-xs ${mutedText}`}>
                                {activity.date}
                              </p>
                              <h3 className="mt-1 font-medium">
                                {activity.title}
                              </h3>
                              <p
                                className={`mt-1 whitespace-pre-wrap break-words ${mutedText}`}
                              >
                                {activity.note}
                              </p>
                            </article>
                          ))}
                      </div>
                      {!activityRows.some(
                        (item) => item.projectId === selectedProject.id,
                      ) && (
                        <p className={`py-5 text-center ${mutedText}`}>
                          Belum ada riwayat untuk pekerjaan ini.
                        </p>
                      )}
                    </div>
                  )}
                </section>
              </>
            )}
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
                      selectCase(selectedHistoryProject);
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
                        <NoteImageGallery
                          images={activity.attachments}
                          onOpen={openNoteImages}
                        />
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
                    disabled={isSavingTask}
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
                    aria-label="Pekerjaan tugas"
                    value={taskTitle}
                    disabled={isSavingTask}
                    onPaste={taskImageDraft.onPaste}
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
                    aria-label="Target tanggal tugas"
                    value={taskDate}
                    disabled={isSavingTask}
                    onChange={(event) => setTaskDate(event.target.value)}
                    required
                  />
                </label>
                <NoteImagePicker
                  draft={taskImageDraft}
                  label="Gambar tugas"
                  disabled={isSavingTask || taskProjectOptions.length === 0}
                  progress={taskUploadProgress}
                  onCancel={() => taskUploadController.current?.abort()}
                  onOpen={openNoteImages}
                  dark={isDarkMode}
                />
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
                      <NoteImageGallery
                        images={task.attachments}
                        onOpen={openNoteImages}
                      />
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
                              selectCase(project);
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
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-[13px] line-through">
                          {task.title}
                        </p>
                        <NoteImageGallery
                          images={task.attachments}
                          onOpen={openNoteImages}
                        />
                      </div>
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
                    disabled={isSavingCatatan}
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
                    disabled={isSavingCatatan}
                    onChange={(event) => setCatatanDate(event.target.value)}
                    required
                  />
                </label>
                <textarea
                  aria-label="Isi catatan"
                  className={`${inputClass} min-h-24`}
                  value={catatanText}
                  onChange={(event) => setCatatanText(event.target.value)}
                  disabled={isSavingCatatan}
                  required={catatanImageDraft.images.length === 0}
                  placeholder="Catatan, link, atau reminder follow up"
                />
                {catatanImageDraft.error && (
                  <p role="alert" className="mt-2 text-[12px] text-red-500">
                    {catatanImageDraft.error}
                  </p>
                )}
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
                    <NoteImageGallery
                      images={note.attachments}
                      onOpen={openNoteImages}
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={secondaryButton}
                        onClick={() => {
                          resetFilters();
                          const project = projects.find(
                            (item) => item.id === note.projectId,
                          );
                          if (project) selectCase(project);
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

        {activeMenu === "upgradeNotes" && (
          <div className="mx-auto max-w-4xl space-y-5">
            <section className={panelClass}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className={`text-xs font-medium ${smallAccent}`}>
                    LARAVEL 13 · PHP 8.5
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold">
                    Catatan Upgrade
                  </h2>
                  <p className={`mt-2 ${mutedText}`}>
                    Simpan perubahan dari PHP 7.2 / 8.2, temuan error, dan
                    solusi yang sudah dicoba.
                  </p>
                </div>
                {upgradeView === "list" && (
                  <button
                    type="button"
                    disabled={upgradeSaving || Boolean(upgradeDeleting)}
                    onClick={() => openUpgradeEditor()}
                    className={buttonClass}
                  >
                    ＋ Tulis catatan
                  </button>
                )}
              </div>
            </section>
            {upgradeError && (
              <p
                role="alert"
                className="rounded-xl border border-rose-500/30 p-3 text-rose-500"
              >
                {upgradeError}
              </p>
            )}
            {upgradeNotice && (
              <p role="status" className={smallAccent}>
                {upgradeNotice}
              </p>
            )}
            {upgradeView === "list" && (
              <>
                <section className={panelClass}>
                  <label className="block">
                    <span className={`mb-2 block text-xs ${mutedText}`}>
                      Cari catatan
                    </span>
                    <input
                      type="search"
                      value={upgradeSearch}
                      onChange={(e) => setUpgradeSearch(e.target.value)}
                      className={inputClass}
                      placeholder="Cari judul, isi, error, atau nama project..."
                    />
                  </label>
                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <label className="min-w-40 flex-1">
                      <span className={`mb-1 block text-xs ${mutedText}`}>
                        Topik
                      </span>
                      <select
                        value={upgradeFilter}
                        onChange={(e) => setUpgradeFilter(e.target.value)}
                        className={inputClass}
                      >
                        <option value="">Semua topik</option>
                        {upgradeTopics.map((name) => (
                          <option key={name}>{name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="min-w-40 flex-1">
                      <span className={`mb-1 block text-xs ${mutedText}`}>
                        Versi asal
                      </span>
                      <select
                        value={upgradeSourceFilter}
                        onChange={(e) => setUpgradeSourceFilter(e.target.value)}
                        className={inputClass}
                      >
                        <option value="">Semua versi</option>
                        {upgradeSources.map((name) => (
                          <option key={name}>{name}</option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={
                        upgradeLoading ||
                        upgradeSaving ||
                        Boolean(upgradeDeleting)
                      }
                      onClick={() => void fetchUpgradeNotes()}
                      className={secondaryButton}
                    >
                      {upgradeLoading ? "Memuat..." : "Refresh"}
                    </button>
                    {(upgradeSearch ||
                      upgradeFilter ||
                      upgradeSourceFilter) && (
                      <button
                        type="button"
                        className={secondaryButton}
                        onClick={() => {
                          setUpgradeSearch("");
                          setUpgradeFilter("");
                          setUpgradeSourceFilter("");
                        }}
                      >
                        Reset filter
                      </button>
                    )}
                  </div>
                </section>
                {upgradeLoading && (
                  <p role="status" className={mutedText}>
                    Memuat catatan...
                  </p>
                )}
                <div className="space-y-3">
                  {filteredUpgradeNotes.map((note) => (
                    <button
                      type="button"
                      key={note.id}
                      onClick={() => {
                        setUpgradeSelectedId(note.id);
                        setUpgradeView("read");
                        setUpgradeNotice("");
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                      className={`w-full text-left ${panelClass} transition-colors hover:border-emerald-400/60`}
                    >
                      <div
                        className={`flex flex-wrap justify-between gap-2 text-xs ${mutedText}`}
                      >
                        <span>
                          {note.topic} · {note.sourceVersion}
                          {note.projectName ? ` · ${note.projectName}` : ""}
                        </span>
                        <span>{formatInputDate(note.noteDate)}</span>
                      </div>
                      <h3 className="mt-3 break-words text-base font-semibold">
                        {note.title}
                      </h3>
                      <p
                        className={`mt-2 line-clamp-2 break-words ${mutedText}`}
                      >
                        {note.body}
                      </p>
                      <span
                        className={`mt-3 inline-block text-xs font-medium ${smallAccent}`}
                      >
                        Baca catatan →
                      </span>
                    </button>
                  ))}
                </div>
                {!upgradeLoading &&
                  !upgradeError &&
                  !filteredUpgradeNotes.length && (
                    <section className={`${panelClass} py-12 text-center`}>
                      <h3 className="text-lg font-semibold">
                        {upgradeNotes.length
                          ? "Tidak ada catatan yang cocok"
                          : "Mulai kumpulkan catatan upgrademu"}
                      </h3>
                      <p className={`mx-auto mt-2 max-w-md ${mutedText}`}>
                        {upgradeNotes.length
                          ? "Coba kata kunci lain atau reset filter."
                          : "Catat perubahan kode, konfigurasi, atau solusi error supaya mudah ditemukan lagi."}
                      </p>
                      {!upgradeNotes.length && (
                        <button
                          type="button"
                          onClick={() => openUpgradeEditor()}
                          className={`mt-5 ${buttonClass}`}
                        >
                          ＋ Tulis catatan pertama
                        </button>
                      )}
                    </section>
                  )}
              </>
            )}
            {upgradeView === "read" && (
              <>
                <button
                  type="button"
                  disabled={Boolean(upgradeDeleting)}
                  className={secondaryButton}
                  onClick={() => setUpgradeView("list")}
                >
                  ← Kembali ke catatan
                </button>
                {selectedUpgradeNote ? (
                  <article className={`${panelClass} space-y-5 sm:p-6`}>
                    <div
                      className={`flex flex-wrap gap-2 text-xs ${mutedText}`}
                    >
                      <span>{selectedUpgradeNote.topic}</span>
                      <span>
                        · {selectedUpgradeNote.sourceVersion} → PHP 8.5
                      </span>
                      {selectedUpgradeNote.projectName && (
                        <span>· {selectedUpgradeNote.projectName}</span>
                      )}
                    </div>
                    <h2 className="break-words text-2xl font-semibold">
                      {selectedUpgradeNote.title}
                    </h2>
                    <p className={`text-xs ${mutedText}`}>
                      {formatInputDate(selectedUpgradeNote.noteDate)}
                    </p>
                    <pre
                      className={`whitespace-pre-wrap break-words rounded-xl border ${borderColor} ${softCardBg} p-4 font-mono text-[13px] leading-7`}
                    >
                      {selectedUpgradeNote.body}
                    </pre>
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        disabled={Boolean(upgradeDeleting)}
                        className={buttonClass}
                        onClick={() => openUpgradeEditor(selectedUpgradeNote)}
                      >
                        Edit catatan
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(upgradeDeleting)}
                        className="rounded-xl border border-rose-500/30 px-3 py-2 text-rose-500 disabled:opacity-50"
                        onClick={() =>
                          void deleteUpgradeNote(selectedUpgradeNote)
                        }
                      >
                        {upgradeDeleting ? "Menghapus..." : "Hapus catatan"}
                      </button>
                    </div>
                  </article>
                ) : (
                  <p className={mutedText}>
                    Catatan tidak ditemukan. Kembali ke daftar untuk memuat
                    ulang.
                  </p>
                )}
              </>
            )}
            {upgradeView === "edit" && (
              <section className={`${panelClass} sm:p-6`}>
                <button
                  type="button"
                  disabled={upgradeSaving}
                  className={`mb-5 ${secondaryButton}`}
                  onClick={() => {
                    setUpgradeView(upgradeEditingId ? "read" : "list");
                    resetUpgradeDraft();
                    setUpgradeError("");
                  }}
                >
                  ← Batal dan kembali
                </button>
                <h2 className="mb-5 text-xl font-semibold">
                  {upgradeEditingId ? "Edit catatan" : "Tulis catatan baru"}
                </h2>
                <form onSubmit={saveUpgradeNote} className="space-y-4">
                  <fieldset disabled={upgradeSaving} className="space-y-4">
                    <label className="block">
                      Judul *
                      <input
                        autoFocus
                        required
                        maxLength={200}
                        value={upgradeTitle}
                        onChange={(e) => setUpgradeTitle(e.target.value)}
                        className={`mt-2 ${inputClass}`}
                        placeholder="Contoh: perubahan query saat upgrade"
                      />
                    </label>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <label>
                        Topik
                        <select
                          value={upgradeTopic}
                          onChange={(e) =>
                            setUpgradeTopic(e.target.value as UpgradeTopic)
                          }
                          className={`mt-2 ${inputClass}`}
                        >
                          {upgradeTopics.map((name) => (
                            <option key={name}>{name}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Versi asal
                        <select
                          value={upgradeSource}
                          onChange={(e) =>
                            setUpgradeSource(e.target.value as UpgradeSource)
                          }
                          className={`mt-2 ${inputClass}`}
                        >
                          {upgradeSources.map((name) => (
                            <option key={name}>{name}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Project (opsional)
                        <input
                          list="upgrade-project-options"
                          value={upgradeProject}
                          onChange={(e) => setUpgradeProject(e.target.value)}
                          className={`mt-2 ${inputClass}`}
                          placeholder="Umum / pilih project"
                        />
                        <datalist id="upgrade-project-options">
                          {clientOptions.map((name) => (
                            <option key={name} value={name} />
                          ))}
                        </datalist>
                      </label>
                      <label>
                        Tanggal *
                        <input
                          required
                          type="date"
                          value={upgradeDate}
                          onChange={(e) => setUpgradeDate(e.target.value)}
                          className={`mt-2 ${inputClass}`}
                        />
                      </label>
                    </div>
                    <label className="block">
                      Isi catatan *
                      <textarea
                        required
                        maxLength={100000}
                        value={upgradeBody}
                        onChange={(e) => setUpgradeBody(e.target.value)}
                        className={`mt-2 min-h-[320px] font-mono ${inputClass}`}
                        placeholder={
                          "Yang berubah:\n\nKode / konfigurasi lama:\n\nKode / konfigurasi baru:\n\nError dan solusi:\n\nHasil pengujian / referensi:"
                        }
                      />
                    </label>
                    <p className={`text-xs ${mutedText}`}>
                      Bisa diisi catatan bebas atau potongan kode. Baris dan
                      spasi akan disimpan sesuai yang kamu tulis.
                    </p>
                  </fieldset>
                  <button disabled={upgradeSaving} className={buttonClass}>
                    {upgradeSaving ? "Menyimpan..." : "Simpan catatan"}
                  </button>
                </form>
              </section>
            )}
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
                      Client <span className="font-normal">(opsional)</span>
                    </span>
                    <input
                      aria-label="Client query"
                      list="saved-query-client-options"
                      className={inputClass}
                      value={savedQueryClient}
                      onChange={(event) =>
                        setSavedQueryClient(event.target.value)
                      }
                      placeholder="Pilih / ketik nama client"
                      maxLength={100}
                      disabled={isSavingSavedQuery}
                    />
                    <datalist id="saved-query-client-options">
                      {savedQueryClientOptions.map((item) => (
                        <option key={item} value={item} />
                      ))}
                    </datalist>
                  </label>
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
                <label className="mb-2 block">
                  <span
                    className={`mb-1 block text-[12px] font-medium ${mutedText}`}
                  >
                    Filter client
                  </span>
                  <select
                    aria-label="Filter client query"
                    className={inputClass}
                    value={savedQueryFilterClient}
                    onChange={(event) =>
                      setSavedQueryFilterClient(event.target.value)
                    }
                  >
                    <option value="">Semua client</option>
                    <option value="__without_client__">
                      Umum / tanpa client
                    </option>
                    {savedQueryClientOptions.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                <input
                  aria-label="Cari query"
                  className={inputClass}
                  value={savedQuerySearch}
                  onChange={(event) => setSavedQuerySearch(event.target.value)}
                  placeholder="Cari judul, client, atau isi query"
                />
                {isLoadingSavedQueries ? (
                  <p className={`mt-4 text-[12px] ${mutedText}`}>
                    Memuat query...
                  </p>
                ) : filteredSavedQueries.length === 0 ? (
                  <p className={`mt-4 text-[12px] ${mutedText}`}>
                    {savedQuerySearch || savedQueryFilterClient
                      ? "Tidak ada query yang cocok dengan pencarian atau filter."
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
                        <p
                          className={`mt-1 break-words text-[11px] font-semibold ${smallAccent}`}
                        >
                          {item.client || "Umum / tanpa client"}
                        </p>
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

      {imageViewer && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/85 p-2 sm:p-4"
          onClick={() => setImageViewer(null)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="note-image-title"
            onClick={(event) => event.stopPropagation()}
            className={`flex h-[90dvh] max-h-[960px] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border ${borderColor} ${cardBg} shadow-2xl`}
          >
            <div className="flex items-center justify-between gap-3 border-b border-neutral-500/20 p-3">
              <div className="min-w-0">
                <h2
                  id="note-image-title"
                  className="truncate text-[13px] font-semibold"
                >
                  {imageViewer.images[imageViewer.index].name}
                </h2>
                <p className={`mt-1 text-[11px] ${mutedText}`}>
                  Gambar {imageViewer.index + 1} dari{" "}
                  {imageViewer.images.length} · {Math.round(imageZoom * 100)}%
                </p>
              </div>
              <button
                ref={imageViewerClose}
                type="button"
                aria-label="Tutup gambar revisi"
                className={secondaryButton}
                onClick={() => setImageViewer(null)}
              >
                ×
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-black/60 p-2">
              <div
                className="flex h-full min-h-0 min-w-0 items-center justify-center"
                style={
                  imageZoom > 1
                    ? {
                        width: `${imageZoom * 100}%`,
                        height: `${imageZoom * 100}%`,
                      }
                    : undefined
                }
              >
                <img
                  src={imageViewer.images[imageViewer.index].url}
                  alt={imageViewer.images[imageViewer.index].name}
                  className="h-full w-full object-contain"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 border-t border-neutral-500/20 p-3">
              <button
                type="button"
                className={secondaryButton}
                disabled={imageViewer.index === 0}
                onClick={() => {
                  setImageViewer((value) =>
                    value ? { ...value, index: value.index - 1 } : null,
                  );
                  setImageZoom(1);
                }}
              >
                ← Sebelumnya
              </button>
              <button
                type="button"
                aria-label="Perkecil gambar"
                className={secondaryButton}
                disabled={imageZoom <= 1}
                onClick={() =>
                  setImageZoom((value) => Math.max(1, value - 0.5))
                }
              >
                −
              </button>
              <button
                type="button"
                className={secondaryButton}
                onClick={() => setImageZoom(1)}
              >
                Reset zoom
              </button>
              <button
                type="button"
                aria-label="Perbesar gambar"
                className={secondaryButton}
                disabled={imageZoom >= 3}
                onClick={() =>
                  setImageZoom((value) => Math.min(3, value + 0.5))
                }
              >
                +
              </button>
              <button
                type="button"
                className={secondaryButton}
                disabled={imageViewer.index === imageViewer.images.length - 1}
                onClick={() => {
                  setImageViewer((value) =>
                    value ? { ...value, index: value.index + 1 } : null,
                  );
                  setImageZoom(1);
                }}
              >
                Berikutnya →
              </button>
              <a
                className={secondaryButton}
                href={imageViewer.images[imageViewer.index].url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Buka ukuran asli ↗
              </a>
            </div>
          </section>
        </div>
      )}

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
                    ? "Pekerjaan selesai"
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
              <p className={mutedText}>
                Tanggal selesai otomatis:{" "}
                {formatInputDate(
                  completionOnSave("Selesai", completionProject),
                )}
                . Tanggal dicatat saat menekan Simpan.
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
                <p className={`mt-1 break-words text-[12px] ${smallAccent}`}>
                  {viewingSavedQuery.client || "Umum / tanpa client"}
                </p>
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

      {clientPickerOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={() => setClientPickerOpen(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="client-picker-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setClientPickerOpen(false);
            }}
            className={`flex max-h-[80dvh] w-full max-w-lg flex-col ${panelClass} shadow-2xl`}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2
                id="client-picker-title"
                className="text-[18px] font-semibold"
              >
                Pilih Client
              </h2>
              <button
                type="button"
                aria-label="Tutup pilihan client"
                className={secondaryButton}
                onClick={() => setClientPickerOpen(false)}
              >
                ×
              </button>
            </div>
            <input
              autoFocus
              aria-label="Cari client untuk project"
              className={inputClass}
              placeholder="Cari nama client..."
              value={clientPickerSearch}
              onChange={(e) => setClientPickerSearch(e.target.value)}
            />
            <div className="mt-3 min-h-0 space-y-2 overflow-y-auto">
              {clientOptions
                .filter((name) =>
                  name.toLowerCase().includes(clientPickerSearch.toLowerCase()),
                )
                .map((name) => (
                  <button
                    type="button"
                    key={name}
                    className={`flex w-full items-center justify-between rounded-xl border ${borderColor} p-4 text-left hover:bg-emerald-400/10`}
                    onClick={() => {
                      setTransactionClient(name);
                      setClientPickerOpen(false);
                      setGridNotice("");
                    }}
                  >
                    <span>{name}</span>
                    <span aria-hidden="true">
                      {transactionClient === name ? "✓" : "→"}
                    </span>
                  </button>
                ))}
              {!clientOptions.some((name) =>
                name.toLowerCase().includes(clientPickerSearch.toLowerCase()),
              ) && (
                <p className={`p-4 ${mutedText}`}>
                  Client tidak ditemukan. Tambahkan melalui Master → Client.
                </p>
              )}
            </div>
          </section>
        </div>
      )}
      {isNavigationMenuOpen && (
        <button
          type="button"
          aria-label="Tutup navigasi"
          onClick={() => setIsNavigationMenuOpen(false)}
          className="fixed inset-0 z-[55] bg-black/50 backdrop-blur-sm lg:hidden"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-[60] flex w-60 flex-col border-r ${borderColor} ${cardBg} transition-transform duration-200 ${isNavigationMenuOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}
      >
        <div className="flex items-center justify-between px-5 pb-6 pt-8">
          <div>
            <p
              className={`text-[18px] font-bold tracking-tight ${smallAccent}`}
            >
              ◈ Kerja Nowmy
            </p>
            <p className={`mt-1 text-[11px] ${mutedText}`}>
              Sedikit lebih teratur, setiap hari.
            </p>
          </div>
          <button
            type="button"
            aria-label="Tutup navigasi"
            onClick={() => setIsNavigationMenuOpen(false)}
            className="p-2 lg:hidden"
          >
            ×
          </button>
        </div>
        <nav
          aria-label="Navigasi utama"
          className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-4"
        >
          {[
            ["dashboard", "◈", "Dashboard"],
            ["client", "▦", "Project & Modul"],
            ["projects", "▤", "Catat Kerja"],
            ["tugas", "☑", "Tugas"],
            ["catatan", "✎", "Catatan Kerja"],
            ["upgradeNotes", "↗", "Catatan Upgrade"],
            ["query", "⌘", "Query"],
            ["riwayat", "◷", "Riwayat"],
            ["laporan", "▥", "Laporan"],
            ["settings", "⚙", "Settings"],
          ].map(([id, icon, label]) => (
            <div key={id}>
              {id === "client" && (
                <p
                  className={`px-4 pb-2 pt-5 text-[10px] font-bold uppercase tracking-widest ${mutedText}`}
                >
                  Master
                </p>
              )}
              {id === "projects" && (
                <p
                  className={`px-4 pb-2 pt-5 text-[10px] font-bold uppercase tracking-widest ${mutedText}`}
                >
                  Transaksi
                </p>
              )}
              {id === "tugas" && (
                <p
                  className={`px-4 pb-2 pt-5 text-[10px] font-bold uppercase tracking-widest ${mutedText}`}
                >
                  Ruang kerja
                </p>
              )}
              <button
                type="button"
                aria-current={activeMenu === id ? "page" : undefined}
                onClick={() => {
                  openMenuPage(id as ActiveMenu);
                  setIsNavigationMenuOpen(false);
                }}
                className={`flex min-h-[46px] w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-[13px] transition-colors ${activeMenu === id ? "bg-[#A7F3D0] font-semibold text-[#111214]" : `${mutedText} hover:bg-emerald-400/10`}`}
              >
                <span
                  aria-hidden="true"
                  className="w-5 text-center text-[18px]"
                >
                  {icon}
                </span>
                {label}
              </button>
            </div>
          ))}
        </nav>
        <div className={`border-t ${borderColor} p-4`}>
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 font-semibold text-emerald-500">
              {username.slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[12px] font-semibold">{username}</p>
              <p className={`text-[11px] ${mutedText}`}>Ruang kerja pribadi</p>
            </div>
          </div>
        </div>
      </aside>
    </main>
  );
}
