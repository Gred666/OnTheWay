import { create } from "zustand";
import { backend } from "./backend";
import type { DayDoc, DocumentSaveTarget, Goal, Note, SearchResult, Task } from "./types";

interface DataState {
  notes: Note[];
  archived: Note[];
  tasks: Record<string, Task>;
  goals: Goal[];
  dayDocs: DayDoc[];
  todayDoc: Note | null;
  markedDates: Set<string>;
  initialized: boolean;
  loading: boolean;
  error: string | null;
  savingNoteIds: Set<string>;

  initialize: () => Promise<void>;
  loadDay: (date: string) => Promise<void>;
  searchNotes: (query: string) => Promise<SearchResult>;
  saveDocument: (target: DocumentSaveTarget, contentMd: string) => Promise<void>;
  saveNoteTitle: (id: string, title: string) => Promise<void>;
  toggleTask: (id: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  archiveNote: (id: string) => Promise<void>;
  restoreNote: (id: string) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
}

const messageOf = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : JSON.stringify(error);

const noteOrder = (a: Note, b: Note) =>
  a.isPinned === b.isPinned ? b.updatedAt - a.updatedAt : a.isPinned ? -1 : 1;

function taskMapFrom(
  notes: Note[],
  todayDoc: Note | null,
  goals: Goal[],
  days: DayDoc[],
): Record<string, Task> {
  const all = [
    ...notes.flatMap((note) => note.actionGroup?.tasks ?? []),
    ...(todayDoc?.actionGroup?.tasks ?? []),
    ...goals.flatMap((goal) => goal.actionGroup?.tasks ?? []),
    ...days.flatMap((day) => day.tasks),
  ];
  return Object.fromEntries(all.map((task) => [task.id, task]));
}

function patchTask(state: DataState, id: string, task: Task): Partial<DataState> {
  const inGroup = (group: Note["actionGroup"]): Note["actionGroup"] =>
    group ? { ...group, tasks: group.tasks.map((item) => (item.id === id ? task : item)) } : null;
  return {
    tasks: { ...state.tasks, [id]: task },
    notes: state.notes.map((note) => ({ ...note, actionGroup: inGroup(note.actionGroup) })),
    todayDoc: state.todayDoc
      ? { ...state.todayDoc, actionGroup: inGroup(state.todayDoc.actionGroup) }
      : null,
    goals: state.goals.map((goal) => ({
      ...goal,
      actionGroup: goal.actionGroup
        ? {
            ...goal.actionGroup,
            tasks: goal.actionGroup.tasks.map((item) => (item.id === id ? task : item)),
          }
        : null,
    })),
    dayDocs: state.dayDocs.map((day) => ({
      ...day,
      tasks: day.tasks.map((item) => (item.id === id ? task : item)),
    })),
  };
}

let initializePromise: Promise<void> | null = null;

export const useData = create<DataState>((set, get) => ({
  notes: [],
  archived: [],
  tasks: {},
  goals: [],
  dayDocs: [],
  todayDoc: null,
  markedDates: new Set(),
  initialized: false,
  loading: false,
  error: null,
  savingNoteIds: new Set(),

  initialize: async () => {
    if (get().initialized) return;
    if (initializePromise) return initializePromise;

    set({ loading: true, error: null });
    initializePromise = (async () => {
      try {
        const api = await backend();
        const [activeSummaries, archivedSummaries, goals, marked] = await Promise.all([
          api.noteList(false),
          api.noteList(true),
          Promise.all([api.goalLatest("week"), api.goalLatest("month"), api.goalLatest("year")]),
          api.calendarMarked("2000-01-01", "2100-12-31"),
        ]);

        const todaySummary = activeSummaries.find((note) => note.id === "n-today");
        const noteSummaries = activeSummaries.filter((note) => note.id !== "n-today");
        const [notes, archived, todayDoc] = await Promise.all([
          Promise.all(noteSummaries.map((note) => api.noteGet(note.id))),
          Promise.all(archivedSummaries.map((note) => api.noteGet(note.id))),
          todaySummary ? api.noteGet(todaySummary.id) : Promise.resolve(null),
        ]);

        set({
          notes: notes.sort(noteOrder),
          archived,
          todayDoc,
          goals,
          tasks: taskMapFrom(notes, todayDoc, goals, []),
          markedDates: new Set(marked),
          initialized: true,
          loading: false,
        });
      } catch (error) {
        set({ error: messageOf(error), loading: false });
      } finally {
        initializePromise = null;
      }
    })();
    return initializePromise;
  },

  loadDay: async (date) => {
    if (get().dayDocs.some((day) => day.date === date)) return;
    try {
      const day = await (await backend()).calendarDay(date);
      set((state) => {
        const dayDocs = [...state.dayDocs.filter((item) => item.date !== date), day];
        return {
          dayDocs,
          tasks: {
            ...state.tasks,
            ...Object.fromEntries(day.tasks.map((task) => [task.id, task])),
          },
        };
      });
    } catch (error) {
      set({ error: messageOf(error) });
    }
  },

  searchNotes: async (query) => (await backend()).searchNotes(query, 200),

  saveDocument: async (target, contentMd) => {
    const id = target.id;
    if (target.kind === "goal") {
      const source = get().goals.find((goal) => goal.id === id);
      if (!source || source.contentMd === contentMd) return;
      try {
        const updated = await (await backend()).goalSave(id, contentMd);
        set((state) => ({
          goals: state.goals.map((goal) => (goal.id === id ? updated : goal)),
          error: null,
        }));
      } catch (error) {
        set({ error: messageOf(error) });
        throw error;
      }
      return;
    }
    if (target.kind === "day") {
      const source = get().dayDocs.find((day) => day.date === id);
      if (source?.noteMd === contentMd) return;
      try {
        const updated = await (await backend()).calendarDaySave(id, contentMd);
        set((state) => ({
          dayDocs: [...state.dayDocs.filter((day) => day.date !== id), updated],
          markedDates:
            contentMd.trim() || updated.tasks.length > 0
              ? new Set(state.markedDates).add(id)
              : new Set([...state.markedDates].filter((date) => date !== id)),
          error: null,
        }));
      } catch (error) {
        set({ error: messageOf(error) });
        throw error;
      }
      return;
    }
    const source =
      get().notes.find((note) => note.id === id) ??
      get().archived.find((note) => note.id === id) ??
      (get().todayDoc?.id === id ? get().todayDoc : null);
    if (!source || source.contentMd === contentMd) return;

    set((state) => ({ savingNoteIds: new Set(state.savingNoteIds).add(id) }));
    try {
      const api = await backend();
      await api.noteUpsert({ id, title: source.title, contentMd, icon: source.icon });
      const updated = await api.noteGet(id);
      set((state) => ({
        notes: state.notes.map((note) => (note.id === id ? updated : note)).sort(noteOrder),
        archived: state.archived.map((note) => (note.id === id ? updated : note)),
        todayDoc: state.todayDoc?.id === id ? updated : state.todayDoc,
        tasks: {
          ...state.tasks,
          ...Object.fromEntries((updated.actionGroup?.tasks ?? []).map((task) => [task.id, task])),
        },
        error: null,
      }));
    } catch (error) {
      set({ error: messageOf(error) });
      throw error;
    } finally {
      set((state) => {
        const savingNoteIds = new Set(state.savingNoteIds);
        savingNoteIds.delete(id);
        return { savingNoteIds };
      });
    }
  },

  saveNoteTitle: async (id, title) => {
    const cleanTitle = title.trim();
    const source =
      get().notes.find((note) => note.id === id) ??
      get().archived.find((note) => note.id === id) ??
      (get().todayDoc?.id === id ? get().todayDoc : null);
    if (!source || !cleanTitle || source.title === cleanTitle) return;

    try {
      const api = await backend();
      await api.noteUpsert({
        id,
        title: cleanTitle,
        contentMd: source.contentMd,
        icon: source.icon,
      });
      const updated = await api.noteGet(id);
      set((state) => ({
        notes: state.notes.map((note) => (note.id === id ? updated : note)).sort(noteOrder),
        archived: state.archived.map((note) => (note.id === id ? updated : note)),
        todayDoc: state.todayDoc?.id === id ? updated : state.todayDoc,
        error: null,
      }));
    } catch (error) {
      set({ error: messageOf(error) });
      throw error;
    }
  },

  toggleTask: async (id) => {
    const current = get().tasks[id];
    if (!current) return;
    const done = current.status === "done";
    const optimistic: Task = {
      ...current,
      status: done ? "todo" : "done",
      completedAt: done ? null : Date.now(),
      updatedAt: Date.now(),
    };
    set((state) => patchTask(state, id, optimistic));
    try {
      const saved = await (await backend()).taskToggle(id);
      set((state) => patchTask(state, id, saved));
    } catch (error) {
      set((state) => ({ ...patchTask(state, id, current), error: messageOf(error) }));
    }
  },

  togglePin: async (id) => {
    const previous = get().notes.find((note) => note.id === id);
    if (!previous) return;
    const pinned = !previous.isPinned;
    set((state) => ({
      notes: state.notes
        .map((note) => (note.id === id ? { ...note, isPinned: pinned } : note))
        .sort(noteOrder),
    }));
    try {
      await (await backend()).noteSetPinned(id, pinned);
    } catch (error) {
      set((state) => ({
        notes: state.notes.map((note) => (note.id === id ? previous : note)).sort(noteOrder),
        error: messageOf(error),
      }));
    }
  },

  archiveNote: async (id) => {
    const previous = get().notes.find((note) => note.id === id);
    if (!previous) return;
    const optimistic: Note = {
      ...previous,
      isArchived: true,
      isPinned: false,
      archiveCategory: previous.archiveCategory ?? "笔记",
      archivedAt: Date.now(),
    };
    set((state) => ({
      notes: state.notes.filter((note) => note.id !== id),
      archived: [optimistic, ...state.archived],
    }));
    try {
      const api = await backend();
      await api.noteArchive(id);
      const saved = await api.noteGet(id);
      set((state) => ({
        archived: state.archived.map((note) => (note.id === id ? saved : note)),
      }));
    } catch (error) {
      set((state) => ({
        notes: [previous, ...state.notes].sort(noteOrder),
        archived: state.archived.filter((note) => note.id !== id),
        error: messageOf(error),
      }));
    }
  },

  restoreNote: async (id) => {
    const previous = get().archived.find((note) => note.id === id);
    if (!previous) return;
    const optimistic = { ...previous, isArchived: false, archivedAt: null };
    set((state) => ({
      archived: state.archived.filter((note) => note.id !== id),
      notes: [optimistic, ...state.notes].sort(noteOrder),
    }));
    try {
      const api = await backend();
      await api.noteRestore(id);
      const saved = await api.noteGet(id);
      set((state) => ({
        notes: state.notes.map((note) => (note.id === id ? saved : note)).sort(noteOrder),
      }));
    } catch (error) {
      set((state) => ({
        archived: [previous, ...state.archived],
        notes: state.notes.filter((note) => note.id !== id),
        error: messageOf(error),
      }));
    }
  },

  deleteNote: async (id) => {
    const previous = get().notes.find((note) => note.id === id);
    if (!previous) return;
    set((state) => ({ notes: state.notes.filter((note) => note.id !== id) }));
    try {
      await (await backend()).noteDelete(id);
    } catch (error) {
      set((state) => ({
        notes: [previous, ...state.notes].sort(noteOrder),
        error: messageOf(error),
      }));
    }
  },
}));

export function useTodoCount(): number {
  return useData((state) => state.todayDoc?.actionGroup?.tasks.length ?? 0);
}
