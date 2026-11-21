import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  type User,
} from "firebase/auth";
import {
  doc,
  collection,
  query,
  where,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  runTransaction,
  onSnapshot,
  serverTimestamp,
  type Unsubscribe,
  type Timestamp,
} from "firebase/firestore";
import { auth, db, OperationType, handleFirestoreError, testConnection } from "./firebaseApp";
import songStatsManager from "./firebaseSongStats";

export interface TrackInput {
  id: string;
  title?: string;
  artist?: string;
  duration?: string;
  seconds?: number;
  thumb?: string;
}

export interface SanitizedTrack {
  trackId: string;
  title: string;
  artist: string;
  duration: string;
  seconds: number;
  thumb: string;
}

export interface UserProfileData {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  totalPlays: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface LikedSongData extends SanitizedTrack {
  userId: string;
  likedAtMs: number;
}

export interface UserPlaylistData {
  playlistId: string;
  userId: string;
  name: string;
  trackIds: string[];
  createdAtMs: number;
  updatedAtMs: number;
}

export interface HistoryEntryData extends SanitizedTrack {
  historyId: string;
  userId: string;
  playedAtMs: number;
}

export interface TrackPlayStatData extends SanitizedTrack {
  userId: string;
  playCount: number;
  firstPlayedAtMs: number;
  lastPlayedAtMs: number;
}

export interface AccountSnapshot {
  authReady: boolean;
  loading: boolean;
  libraryReady: boolean;
  user: {
    uid: string;
    displayName: string;
    email: string;
    photoURL: string;
    providers: string[];
  } | null;
  profile: UserProfileData | null;
  likedSongs: LikedSongData[];
  likedIds: string[];
  playlists: UserPlaylistData[];
  history: HistoryEntryData[];
  playStats: Record<string, TrackPlayStatData>;
  mostPlayed: TrackPlayStatData[];
  totalPlays: number;
  syncError: string | null;
}

type StateListener = (snapshot: AccountSnapshot) => void;

const MAX_PLAYLIST_TRACKS = 500;
const MAX_HISTORY_ENTRIES = 150;
const MIN_DUPLICATE_GAP_MS = 20000;

function toMillis(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === "number" && Number.isFinite(ts)) return ts;
  if (typeof (ts as Timestamp).toMillis === "function") {
    return (ts as Timestamp).toMillis();
  }
  return 0;
}

function clampString(val: unknown, maxLen: number, fallback = ""): string {
  const s = typeof val === "string" ? val.trim() : "";
  if (!s) return fallback;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function isValidTrackId(id: unknown): id is string {
  return typeof id === "string" && /^[a-zA-Z0-9_-]{4,128}$/.test(id.trim());
}

function isValidDocId(id: unknown): id is string {
  return typeof id === "string" && /^[a-zA-Z0-9_-]{8,128}$/.test(id.trim());
}

function generateId(prefix: string): string {
  const ts = Date.now().toString(36);
  let rand = "";
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    rand = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  } else {
    rand = Math.random().toString(36).slice(2, 12);
  }
  return `${prefix}_${ts}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}

function sanitizeTrack(track: TrackInput | null | undefined): SanitizedTrack | null {
  if (!track || !isValidTrackId(track.id)) return null;
  const trackId = track.id.trim();
  const title = clampString(track.title, 250, "Untitled Track");
  const artist = clampString(track.artist, 120, "Slowedfy");
  const duration = clampString(track.duration, 20, "0:00");
  const rawSeconds = typeof track.seconds === "number" && Number.isFinite(track.seconds)
    ? Math.round(track.seconds)
    : 0;
  const seconds = Math.max(0, Math.min(86400, rawSeconds));
  const thumb = clampString(track.thumb, 500, "");
  return { trackId, title, artist, duration, seconds, thumb };
}

function deriveDisplayName(user: User, overrideName?: string): string {
  const override = clampString(overrideName, 80, "");
  if (override) return override;
  const dn = clampString(user.displayName, 80, "");
  if (dn) return dn;
  const email = typeof user.email === "string" ? user.email.trim() : "";
  if (email.includes("@")) {
    const prefix = email.split("@")[0].trim();
    if (prefix) return clampString(prefix, 80, "Listener");
  }
  return "Slowedfy Listener";
}

function formatAuthError(error: unknown): string {
  const code = (error as { code?: string })?.code || "";
  switch (code) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Sign-in window was closed before completing.";
    case "auth/popup-blocked":
      return "Pop-up was blocked by your browser. Please allow pop-ups and try again.";
    case "auth/unauthorized-domain": {
      const host =
        typeof window !== "undefined" && window.location?.hostname
          ? window.location.hostname
          : "this domain";
      return `Domain "${host}" is not yet authorized in Firebase Authentication settings.`;
    }
    case "auth/operation-not-allowed":
      return "Email/Password sign-in is not enabled in Firebase Authentication yet. Please sign in with Google or enable Email/Password in Firebase Console.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/user-disabled":
      return "This account has been disabled.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Invalid email or password. Please check your credentials and try again.";
    case "auth/email-already-in-use":
      return "An account with this email already exists. Try signing in instead.";
    case "auth/weak-password":
      return "Password must be at least 6 characters long.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    case "auth/network-request-failed":
      return "Network error. Please check your internet connection.";
    default:
      return error instanceof Error && error.message
        ? error.message.replace(/^Firebase:\s*/i, "")
        : "Authentication failed. Please try again.";
  }
}

class SlowedfyUserLibrary {
  private authReady = false;
  private loading = false;
  private currentUser: User | null = null;
  private profile: UserProfileData | null = null;
  private likedSongs: LikedSongData[] = [];
  private likedIdSet = new Set<string>();
  private playlists: UserPlaylistData[] = [];
  private history: HistoryEntryData[] = [];
  private playStatsMap = new Map<string, TrackPlayStatData>();
  private mostPlayed: TrackPlayStatData[] = [];
  private syncError: string | null = null;

  private profileReadyPromise: Promise<void> | null = null;
  private unsubscribers: Unsubscribe[] = [];
  private listeners = new Set<StateListener>();
  private pendingLikeOps = new Set<string>();
  private pendingPlaylistOps = new Set<string>();
  private deletingHistoryIds = new Set<string>();
  private legacyHistoryDocsByTrack = new Map<string, string[]>();
  private snapshotsLoaded = {
    liked: false,
    playlists: false,
    history: false,
    stats: false,
  };
  private reconciledLikesUid: string | null = null;
  private reconciledPlaysUid: string | null = null;

  // Accurate meaningful play tracking state
  private playSession: {
    trackId: string | null;
    track: SanitizedTrack | null;
    accumulatedMs: number;
    lastTickWallMs: number | null;
    lastAudioTimeSec: number | null;
    counted: boolean;
    recording: boolean;
  } = {
    trackId: null,
    track: null,
    accumulatedMs: 0,
    lastTickWallMs: null,
    lastAudioTimeSec: null,
    counted: false,
    recording: false,
  };

  private lastCountedTrackId: string | null = null;
  private lastCountedAtWallMs = 0;

  constructor() {
    this.init();
  }

  private init(): void {
    onAuthStateChanged(auth, async (user) => {
      this.cleanupSubscriptions();
      this.currentUser = user;
      this.syncError = null;

      if (!user) {
        this.profile = null;
        this.likedSongs = [];
        this.likedIdSet.clear();
        this.playlists = [];
        this.history = [];
        this.playStatsMap.clear();
        this.mostPlayed = [];
        this.profileReadyPromise = null;
        this.pendingLikeOps.clear();
        this.pendingPlaylistOps.clear();
        this.deletingHistoryIds.clear();
        this.legacyHistoryDocsByTrack.clear();
        this.snapshotsLoaded = { liked: false, playlists: false, history: false, stats: false };
        this.reconciledLikesUid = null;
        this.reconciledPlaysUid = null;
        this.loading = false;
        this.authReady = true;
        this.emit();
        return;
      }

      this.snapshotsLoaded = { liked: false, playlists: false, history: false, stats: false };
      this.legacyHistoryDocsByTrack.clear();
      this.deletingHistoryIds.clear();
      this.loading = true;
      this.authReady = true;
      this.emit();

      const bootstrapPromise = this.bootstrapUser(user);
      this.profileReadyPromise = bootstrapPromise;
      try {
        await bootstrapPromise;
        // Ensure user is still the same signed-in user after async bootstrap
        if (this.currentUser?.uid === user.uid) {
          this.attachUserListeners(user.uid);
        }
      } catch (err) {
        if (this.profileReadyPromise === bootstrapPromise) {
          this.profileReadyPromise = null;
        }
        this.syncError =
          err instanceof Error ? err.message : "Could not sync your library right now.";
      } finally {
        this.loading = false;
        this.emit();
      }
    });
  }

  private cleanupSubscriptions(): void {
    for (const unsub of this.unsubscribers) {
      try {
        unsub();
      } catch {
        // ignore unsubscribe errors
      }
    }
    this.unsubscribers = [];
  }

  private async bootstrapUser(user: User, overrideName?: string): Promise<void> {
    await testConnection();
    const uid = user.uid;
    const userRef = doc(db, "users", uid);
    const displayName = deriveDisplayName(user, overrideName);
    const email = clampString(user.email, 160, "");
    const photoURL = clampString(user.photoURL, 500, "");

    try {
      const snap = await getDoc(userRef);
      if (!snap.exists()) {
        await setDoc(userRef, {
          uid,
          displayName,
          email,
          photoURL,
          totalPlays: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        this.profile = {
          uid,
          displayName,
          email,
          photoURL,
          totalPlays: 0,
          createdAtMs: Date.now(),
          updatedAtMs: Date.now(),
        };
      } else {
        const data = snap.data();
        const existingName = clampString(data?.displayName, 80, displayName);
        const existingEmail = clampString(data?.email, 160, "");
        const existingPhoto = clampString(data?.photoURL, 500, "");
        const nextName = overrideName ? displayName : existingName || displayName;
        const nextEmail = email || existingEmail;
        const nextPhoto = photoURL || existingPhoto;

        this.profile = {
          uid,
          displayName: nextName,
          email: nextEmail,
          photoURL: nextPhoto,
          totalPlays: typeof data?.totalPlays === "number" ? data.totalPlays : 0,
          createdAtMs: toMillis(data?.createdAt),
          updatedAtMs: toMillis(data?.updatedAt),
        };

        if (
          nextName !== existingName ||
          nextEmail !== existingEmail ||
          nextPhoto !== existingPhoto
        ) {
          await updateDoc(userRef, {
            displayName: nextName,
            email: nextEmail,
            photoURL: nextPhoto,
            updatedAt: serverTimestamp(),
          });
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${uid}`);
    }
  }

  private attachUserListeners(uid: string): void {
    this.cleanupSubscriptions();

    // 1. Profile + totalPlays
    const userRef = doc(db, "users", uid);
    this.unsubscribers.push(
      onSnapshot(
        userRef,
        (snap) => {
          if (!snap.exists()) return;
          const d = snap.data();
          this.profile = {
            uid,
            displayName: clampString(d?.displayName, 80, "Slowedfy Listener"),
            email: clampString(d?.email, 160, ""),
            photoURL: clampString(d?.photoURL, 500, ""),
            totalPlays: typeof d?.totalPlays === "number" && d.totalPlays >= 0 ? d.totalPlays : 0,
            createdAtMs: toMillis(d?.createdAt),
            updatedAtMs: toMillis(d?.updatedAt),
          };
          this.emit();
        },
        (error) => {
          try {
            handleFirestoreError(error, OperationType.GET, `users/${uid}`);
          } catch {
            this.syncError = "Unable to sync profile.";
            this.emit();
          }
        }
      )
    );

    // 2. Liked Songs
    const likedQ = query(
      collection(db, "users", uid, "likedSongs"),
      where("userId", "==", uid)
    );
    this.unsubscribers.push(
      onSnapshot(
        likedQ,
        (snapshot) => {
          const items: LikedSongData[] = [];
          const nextIds = new Set<string>();
          for (const docSnap of snapshot.docs) {
            const d = docSnap.data();
            const trackId = typeof d?.trackId === "string" ? d.trackId : docSnap.id;
            if (!isValidTrackId(trackId)) continue;
            nextIds.add(trackId);
            items.push({
              trackId,
              userId: uid,
              title: clampString(d?.title, 250, "Untitled Track"),
              artist: clampString(d?.artist, 120, "Slowedfy"),
              duration: clampString(d?.duration, 20, "0:00"),
              seconds: typeof d?.seconds === "number" ? d.seconds : 0,
              thumb: clampString(d?.thumb, 500, ""),
              likedAtMs: toMillis(d?.likedAt) || Date.now(),
            });
          }
          items.sort((a, b) => b.likedAtMs - a.likedAtMs);
          this.likedSongs = items;
          this.likedIdSet = nextIds;
          this.snapshotsLoaded.liked = true;
          this.emit();

          if (this.reconciledLikesUid !== uid && items.length > 0) {
            this.reconciledLikesUid = uid;
            void this.reconcilePreexistingLikes(uid, items.map((i) => i.trackId));
          }
        },
        (error) => {
          this.snapshotsLoaded.liked = true;
          try {
            handleFirestoreError(error, OperationType.LIST, `users/${uid}/likedSongs`);
          } catch {
            // handled via structured log
          }
          this.emit();
        }
      )
    );

    // 3. Personal Playlists
    const playlistsQ = query(
      collection(db, "users", uid, "playlists"),
      where("userId", "==", uid)
    );
    this.unsubscribers.push(
      onSnapshot(
        playlistsQ,
        (snapshot) => {
          const items: UserPlaylistData[] = [];
          for (const docSnap of snapshot.docs) {
            const d = docSnap.data();
            const playlistId = typeof d?.playlistId === "string" ? d.playlistId : docSnap.id;
            if (!isValidDocId(playlistId)) continue;
            const rawTrackIds = Array.isArray(d?.trackIds)
              ? d.trackIds.filter((id: unknown): id is string => isValidTrackId(id))
              : [];
            items.push({
              playlistId,
              userId: uid,
              name: clampString(d?.name, 80, "Untitled Playlist"),
              trackIds: rawTrackIds.slice(0, MAX_PLAYLIST_TRACKS),
              createdAtMs: toMillis(d?.createdAt) || Date.now(),
              updatedAtMs: toMillis(d?.updatedAt) || Date.now(),
            });
          }
          items.sort((a, b) => b.createdAtMs - a.createdAtMs);
          this.playlists = items;
          this.snapshotsLoaded.playlists = true;
          this.emit();
        },
        (error) => {
          this.snapshotsLoaded.playlists = true;
          try {
            handleFirestoreError(error, OperationType.LIST, `users/${uid}/playlists`);
          } catch {
            // handled via structured log
          }
          this.emit();
        }
      )
    );

    // 4. Listening History (deduplicated strictly to one entry per song, newest first)
    const historyQ = query(
      collection(db, "users", uid, "history"),
      where("userId", "==", uid)
    );
    this.unsubscribers.push(
      onSnapshot(
        historyQ,
        (snapshot) => {
          const bestByTrack = new Map<string, { entry: HistoryEntryData; isCanonical: boolean }>();
          const allDocIdsByTrack = new Map<string, string[]>();

          for (const docSnap of snapshot.docs) {
            const d = docSnap.data();
            const docId = docSnap.id;
            const historyId = typeof d?.historyId === "string" ? d.historyId : docId;
            const trackId = typeof d?.trackId === "string" ? d.trackId : "";
            if (!isValidTrackId(docId) || !isValidTrackId(historyId) || !isValidTrackId(trackId)) continue;

            const isCanonical = docId === trackId;
            const entry: HistoryEntryData = {
              historyId: docId,
              userId: uid,
              trackId,
              title: clampString(d?.title, 250, "Untitled Track"),
              artist: clampString(d?.artist, 120, "Slowedfy"),
              duration: clampString(d?.duration, 20, "0:00"),
              seconds: typeof d?.seconds === "number" ? d.seconds : 0,
              thumb: clampString(d?.thumb, 500, ""),
              playedAtMs: toMillis(d?.playedAt) || Date.now(),
            };

            const trackDocIds = allDocIdsByTrack.get(trackId) || [];
            trackDocIds.push(docId);
            allDocIdsByTrack.set(trackId, trackDocIds);

            const prev = bestByTrack.get(trackId);
            if (!prev) {
              bestByTrack.set(trackId, { entry, isCanonical });
            } else {
              // Prefer canonical doc when canonical exists with equal/newer timestamp; otherwise keep newest playedAtMs
              const replaceWithCurrent =
                (isCanonical && !prev.isCanonical && entry.playedAtMs >= prev.entry.playedAtMs) ||
                (!prev.isCanonical && entry.playedAtMs > prev.entry.playedAtMs) ||
                (prev.isCanonical && !isCanonical && entry.playedAtMs > prev.entry.playedAtMs + 1000);
              if (replaceWithCurrent) {
                bestByTrack.set(trackId, { entry, isCanonical });
              }
            }
          }

          const deduped: HistoryEntryData[] = [];
          const nextLegacyMap = new Map<string, string[]>();
          const duplicateDocIdsToDelete: string[] = [];

          for (const [trackId, winner] of bestByTrack.entries()) {
            deduped.push(winner.entry);
            const docIds = allDocIdsByTrack.get(trackId) || [];
            const legacyIds: string[] = [];
            for (const docId of docIds) {
              if (docId !== trackId) {
                legacyIds.push(docId);
              }
              // Quietly remove redundant duplicate docs from Firestore
              if (docId !== winner.entry.historyId) {
                duplicateDocIdsToDelete.push(docId);
              }
            }
            if (legacyIds.length > 0) {
              nextLegacyMap.set(trackId, legacyIds);
            }
          }

          deduped.sort((a, b) => b.playedAtMs - a.playedAtMs);
          this.legacyHistoryDocsByTrack = nextLegacyMap;
          this.history = deduped;
          this.snapshotsLoaded.history = true;
          this.emit();

          if (duplicateDocIdsToDelete.length > 0 && this.currentUser?.uid === uid) {
            void this.cleanupDuplicateHistoryDocs(uid, duplicateDocIdsToDelete);
          }
        },
        (error) => {
          this.snapshotsLoaded.history = true;
          try {
            handleFirestoreError(error, OperationType.LIST, `users/${uid}/history`);
          } catch {
            // handled via structured log
          }
          this.emit();
        }
      )
    );

    // 5. Play Stats & Most Played
    const statsQ = query(
      collection(db, "users", uid, "playStats"),
      where("userId", "==", uid)
    );
    this.unsubscribers.push(
      onSnapshot(
        statsQ,
        (snapshot) => {
          const map = new Map<string, TrackPlayStatData>();
          const ranked: TrackPlayStatData[] = [];
          for (const docSnap of snapshot.docs) {
            const d = docSnap.data();
            const trackId = typeof d?.trackId === "string" ? d.trackId : docSnap.id;
            const playCount = typeof d?.playCount === "number" ? d.playCount : 0;
            if (!isValidTrackId(trackId) || playCount < 1) continue;
            const item: TrackPlayStatData = {
              trackId,
              userId: uid,
              title: clampString(d?.title, 250, "Untitled Track"),
              artist: clampString(d?.artist, 120, "Slowedfy"),
              duration: clampString(d?.duration, 20, "0:00"),
              seconds: typeof d?.seconds === "number" ? d.seconds : 0,
              thumb: clampString(d?.thumb, 500, ""),
              playCount,
              firstPlayedAtMs: toMillis(d?.firstPlayedAt) || Date.now(),
              lastPlayedAtMs: toMillis(d?.lastPlayedAt) || Date.now(),
            };
            map.set(trackId, item);
            ranked.push(item);
          }
          ranked.sort((a, b) => {
            if (b.playCount !== a.playCount) return b.playCount - a.playCount;
            return b.lastPlayedAtMs - a.lastPlayedAtMs;
          });
          this.playStatsMap = map;
          this.mostPlayed = ranked;
          this.snapshotsLoaded.stats = true;
          this.emit();

          if (this.reconciledPlaysUid !== uid && ranked.length > 0) {
            this.reconciledPlaysUid = uid;
            void this.reconcilePreexistingPlays(uid, ranked.map((r) => r.trackId));
          }
        },
        (error) => {
          this.snapshotsLoaded.stats = true;
          try {
            handleFirestoreError(error, OperationType.LIST, `users/${uid}/playStats`);
          } catch {
            // handled via structured log
          }
          this.emit();
        }
      )
    );
  }

  private async cleanupDuplicateHistoryDocs(uid: string, docIds: string[]): Promise<void> {
    for (const docId of docIds.slice(0, 25)) {
      if (this.currentUser?.uid !== uid) return;
      if (!isValidTrackId(docId) || this.deletingHistoryIds.has(docId)) continue;
      this.deletingHistoryIds.add(docId);
      try {
        await deleteDoc(doc(db, "users", uid, "history", docId));
      } catch {
        // non-fatal cleanup error
      } finally {
        this.deletingHistoryIds.delete(docId);
      }
    }
  }

  public getSnapshot(): AccountSnapshot {
    const user = this.currentUser;
    const statsRecord: Record<string, TrackPlayStatData> = {};
    for (const [k, v] of this.playStatsMap.entries()) {
      statsRecord[k] = v;
    }

    const computedSum = this.mostPlayed.reduce((acc, s) => acc + s.playCount, 0);
    const totalPlays = Math.max(this.profile?.totalPlays ?? 0, computedSum);

    const libraryReady = !user || (
      !this.loading &&
      this.snapshotsLoaded.liked &&
      this.snapshotsLoaded.playlists &&
      this.snapshotsLoaded.history &&
      this.snapshotsLoaded.stats
    );

    return {
      authReady: this.authReady,
      loading: this.loading,
      libraryReady,
      user: user
        ? {
            uid: user.uid,
            displayName: this.profile?.displayName || deriveDisplayName(user),
            email: this.profile?.email || user.email || "",
            photoURL: this.profile?.photoURL || user.photoURL || "",
            providers: user.providerData.map((p) => p.providerId),
          }
        : null,
      profile: this.profile,
      likedSongs: this.likedSongs,
      likedIds: Array.from(this.likedIdSet),
      playlists: this.playlists,
      history: this.history,
      playStats: statsRecord,
      mostPlayed: this.mostPlayed,
      totalPlays,
      syncError: this.syncError,
    };
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    try {
      listener(this.getSnapshot());
    } catch {
      // ignore subscriber error
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snap = this.getSnapshot();
    for (const cb of this.listeners) {
      try {
        cb(snap);
      } catch {
        // ignore subscriber errors
      }
    }
  }

  private async requireSignedInUid(): Promise<string> {
    const user = this.currentUser || auth.currentUser;
    if (!user) {
      throw new Error("AUTH_REQUIRED");
    }
    const ensureBootstrapped = async () => {
      const p = this.bootstrapUser(user);
      this.profileReadyPromise = p;
      try {
        await p;
        if (this.currentUser?.uid === user.uid && this.unsubscribers.length === 0) {
          this.attachUserListeners(user.uid);
        }
      } catch (err) {
        if (this.profileReadyPromise === p) {
          this.profileReadyPromise = null;
        }
        throw err;
      }
    };

    if (this.profileReadyPromise) {
      try {
        await this.profileReadyPromise;
      } catch {
        // Recover automatically after transient offline/network failures
        await ensureBootstrapped();
      }
    } else {
      await ensureBootstrapped();
    }
    return user.uid;
  }

  // ---- Authentication Methods ----

  public async signInWithGoogle(): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: formatAuthError(error) };
    }
  }

  public async signInWithEmail(
    email: string,
    password: string
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      return { ok: false, error: "Please enter both your email and password." };
    }
    try {
      await signInWithEmailAndPassword(auth, cleanEmail, password);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: formatAuthError(error) };
    }
  }

  public async signUpWithEmail(
    displayName: string,
    email: string,
    password: string
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const cleanEmail = email.trim();
    const cleanName = clampString(displayName, 80, "");
    if (!cleanEmail || !password) {
      return { ok: false, error: "Please enter your email and choose a password." };
    }
    if (password.length < 6) {
      return { ok: false, error: "Password must be at least 6 characters long." };
    }
    try {
      const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
      const finalName = deriveDisplayName(cred.user, cleanName);
      try {
        await updateProfile(cred.user, { displayName: finalName });
      } catch {
        // non-fatal
      }
      this.profileReadyPromise = this.bootstrapUser(cred.user, finalName);
      await this.profileReadyPromise;
      return { ok: true };
    } catch (error) {
      return { ok: false, error: formatAuthError(error) };
    }
  }

  public async resetPassword(
    email: string
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      return { ok: false, error: "Enter your email address first to receive a reset link." };
    }
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: formatAuthError(error) };
    }
  }

  public async logout(): Promise<void> {
    this.cleanupSubscriptions();
    this.resetPlaySession();
    await signOut(auth);
  }

  // ---- Likes ----

  public isLiked(trackId: string): boolean {
    return this.likedIdSet.has(trackId);
  }

  private async reconcilePreexistingLikes(uid: string, trackIds: string[]): Promise<void> {
    for (const trackId of trackIds) {
      if (this.currentUser?.uid !== uid) return;
      await songStatsManager.reconcileExistingUserLike(trackId, uid);
    }
  }

  private async reconcilePreexistingPlays(uid: string, trackIds: string[]): Promise<void> {
    for (const trackId of trackIds) {
      if (this.currentUser?.uid !== uid) return;
      await songStatsManager.recordUniquePlay(trackId, uid);
    }
  }

  public async ensureLiked(
    track: TrackInput
  ): Promise<{ ok: boolean; liked?: boolean; alreadyLiked?: boolean; requiresAuth?: boolean; error?: string }> {
    if (!this.currentUser) {
      return { ok: false, requiresAuth: true };
    }
    const clean = sanitizeTrack(track);
    if (!clean) {
      return { ok: false, error: "Invalid song." };
    }
    if (this.likedIdSet.has(clean.trackId)) {
      return { ok: true, liked: true, alreadyLiked: true };
    }
    return this.toggleLike(track);
  }

  public async toggleLike(
    track: TrackInput
  ): Promise<{ ok: boolean; liked?: boolean; requiresAuth?: boolean; error?: string }> {
    if (!this.currentUser) {
      return { ok: false, requiresAuth: true };
    }
    const clean = sanitizeTrack(track);
    if (!clean) {
      return { ok: false, error: "Invalid song." };
    }
    if (this.pendingLikeOps.has(clean.trackId)) {
      return { ok: true, liked: this.likedIdSet.has(clean.trackId) };
    }

    this.pendingLikeOps.add(clean.trackId);
    let uid: string;
    try {
      uid = await this.requireSignedInUid();
    } catch (error) {
      this.pendingLikeOps.delete(clean.trackId);
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Could not connect to your account.",
      };
    }

    const likeRef = doc(db, "users", uid, "likedSongs", clean.trackId);
    const likerRef = doc(db, "song_stats", clean.trackId, "likers", uid);
    const songStatRef = doc(db, "song_stats", clean.trackId);
    const currentlyLiked = this.likedIdSet.has(clean.trackId);
    const prevLikedSongs = [...this.likedSongs];

    // Instant optimistic update for heart state, Liked Songs list, and global like count
    const optimisticStat = songStatsManager.setOptimisticLikeDelta(
      clean.trackId,
      currentlyLiked ? -1 : 1
    );
    if (currentlyLiked) {
      this.likedIdSet.delete(clean.trackId);
      this.likedSongs = this.likedSongs.filter((item) => item.trackId !== clean.trackId);
    } else {
      this.likedIdSet.add(clean.trackId);
      this.likedSongs = [
        { ...clean, userId: uid, likedAtMs: Date.now() },
        ...this.likedSongs.filter((item) => item.trackId !== clean.trackId),
      ];
    }
    this.emit();

    try {
      let finalLiked = !currentlyLiked;
      let finalLikeCount: number | undefined;

      await runTransaction(db, async (tx) => {
        const [uLikeSnap, likerSnap, statSnap] = await Promise.all([
          tx.get(likeRef),
          tx.get(likerRef),
          tx.get(songStatRef),
        ]);

        const curCount =
          statSnap.exists() &&
          typeof statSnap.data()?.likeCount === "number" &&
          statSnap.data().likeCount >= 0
            ? Math.floor(statSnap.data().likeCount)
            : 0;

        if (uLikeSnap.exists()) {
          tx.delete(likeRef);
          if (likerSnap.exists()) {
            tx.delete(likerRef);
            if (statSnap.exists() && curCount >= 1) {
              const next = curCount - 1;
              tx.update(songStatRef, {
                likeCount: next,
                updatedAt: serverTimestamp(),
              });
              finalLikeCount = next;
            }
          }
          finalLiked = false;
        } else {
          tx.set(likeRef, {
            trackId: clean.trackId,
            userId: uid,
            title: clean.title,
            artist: clean.artist,
            duration: clean.duration,
            seconds: clean.seconds,
            thumb: clean.thumb,
            likedAt: serverTimestamp(),
          });

          if (!likerSnap.exists()) {
            tx.set(likerRef, {
              trackId: clean.trackId,
              userId: uid,
              likedAt: serverTimestamp(),
            });

            if (!statSnap.exists()) {
              tx.set(songStatRef, {
                trackId: clean.trackId,
                uniquePlayCount: 0,
                likeCount: 1,
                lastGuestPlayKey: "",
                updatedAt: serverTimestamp(),
              });
              finalLikeCount = 1;
            } else {
              const next = curCount + 1;
              tx.update(songStatRef, {
                likeCount: next,
                updatedAt: serverTimestamp(),
              });
              finalLikeCount = next;
            }
          }
          finalLiked = true;
        }
      });

      if (finalLiked) {
        this.likedIdSet.add(clean.trackId);
        if (!this.likedSongs.some((item) => item.trackId === clean.trackId)) {
          this.likedSongs = [{ ...clean, userId: uid, likedAtMs: Date.now() }, ...this.likedSongs];
        }
      } else {
        this.likedIdSet.delete(clean.trackId);
        this.likedSongs = this.likedSongs.filter((item) => item.trackId !== clean.trackId);
      }
      optimisticStat.commit(finalLikeCount);
      this.emit();
      return { ok: true, liked: finalLiked };
    } catch (error) {
      // Roll back optimistic state on failure
      if (currentlyLiked) {
        this.likedIdSet.add(clean.trackId);
      } else {
        this.likedIdSet.delete(clean.trackId);
      }
      this.likedSongs = prevLikedSongs;
      optimisticStat.rollback();
      this.emit();
      try {
        handleFirestoreError(
          error,
          currentlyLiked ? OperationType.DELETE : OperationType.CREATE,
          `users/${uid}/likedSongs/${clean.trackId}`
        );
      } catch (wrapped) {
        return { ok: false, error: wrapped instanceof Error ? wrapped.message : "Failed to update like." };
      }
    } finally {
      this.pendingLikeOps.delete(clean.trackId);
    }
  }

  // ---- Personal Playlists ----

  public async createPlaylist(
    name: string,
    initialTrackId?: string
  ): Promise<{ ok: boolean; playlistId?: string; requiresAuth?: boolean; error?: string }> {
    if (!this.currentUser) {
      return { ok: false, requiresAuth: true };
    }
    const cleanName = clampString(name, 80, "");
    if (!cleanName) {
      return { ok: false, error: "Please enter a playlist name." };
    }

    const uid = await this.requireSignedInUid();
    const playlistId = generateId("pl");
    const trackIds = initialTrackId && isValidTrackId(initialTrackId) ? [initialTrackId.trim()] : [];
    const plRef = doc(db, "users", uid, "playlists", playlistId);

    try {
      await setDoc(plRef, {
        playlistId,
        userId: uid,
        name: cleanName,
        trackIds,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return { ok: true, playlistId };
    } catch (error) {
      try {
        handleFirestoreError(error, OperationType.CREATE, `users/${uid}/playlists/${playlistId}`);
      } catch (wrapped) {
        return { ok: false, error: wrapped instanceof Error ? wrapped.message : "Could not create playlist." };
      }
    }
  }

  public async renamePlaylist(
    playlistId: string,
    newName: string
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.currentUser) return { ok: false, error: "Please sign in first." };
    const cleanName = clampString(newName, 80, "");
    if (!cleanName) return { ok: false, error: "Playlist name cannot be empty." };
    if (!isValidDocId(playlistId)) return { ok: false, error: "Invalid playlist." };

    const uid = await this.requireSignedInUid();
    const plRef = doc(db, "users", uid, "playlists", playlistId);
    try {
      await updateDoc(plRef, {
        name: cleanName,
        updatedAt: serverTimestamp(),
      });
      return { ok: true };
    } catch (error) {
      try {
        handleFirestoreError(error, OperationType.UPDATE, `users/${uid}/playlists/${playlistId}`);
      } catch (wrapped) {
        return { ok: false, error: wrapped instanceof Error ? wrapped.message : "Could not rename playlist." };
      }
    }
  }

  public async deletePlaylist(playlistId: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.currentUser) return { ok: false, error: "Please sign in first." };
    if (!isValidDocId(playlistId)) return { ok: false, error: "Invalid playlist." };

    const uid = await this.requireSignedInUid();
    const plRef = doc(db, "users", uid, "playlists", playlistId);
    try {
      await deleteDoc(plRef);
      return { ok: true };
    } catch (error) {
      try {
        handleFirestoreError(error, OperationType.DELETE, `users/${uid}/playlists/${playlistId}`);
      } catch (wrapped) {
        return { ok: false, error: wrapped instanceof Error ? wrapped.message : "Could not delete playlist." };
      }
    }
  }

  public async toggleTrackInPlaylist(
    playlistId: string,
    trackId: string,
    mode: "toggle" | "add" | "remove" = "toggle"
  ): Promise<{ ok: boolean; added?: boolean; error?: string }> {
    if (!this.currentUser) return { ok: false, error: "Please sign in first." };
    if (!isValidDocId(playlistId) || !isValidTrackId(trackId)) {
      return { ok: false, error: "Invalid playlist or song." };
    }

    const opKey = `${playlistId}:${trackId}`;
    if (this.pendingPlaylistOps.has(opKey)) {
      return { ok: false };
    }
    this.pendingPlaylistOps.add(opKey);

    try {
      const uid = await this.requireSignedInUid();
      const plRef = doc(db, "users", uid, "playlists", playlistId);
      let finalAdded = false;

      await runTransaction(db, async (tx) => {
        const snap = await tx.get(plRef);
        if (!snap.exists()) {
          throw new Error("PLAYLIST_NOT_FOUND");
        }
        const data = snap.data();
        const serverIds: string[] = Array.isArray(data?.trackIds)
          ? Array.from(
              new Set(data.trackIds.filter((id: unknown): id is string => isValidTrackId(id)))
            )
          : [];

        const exists = serverIds.includes(trackId);
        let nextTrackIds = serverIds;

        if (mode === "remove" || (mode === "toggle" && exists)) {
          nextTrackIds = serverIds.filter((id) => id !== trackId);
          finalAdded = false;
        } else if (mode === "add" || (mode === "toggle" && !exists)) {
          if (exists) {
            finalAdded = true;
            return;
          }
          if (serverIds.length >= MAX_PLAYLIST_TRACKS) {
            throw new Error("PLAYLIST_LIMIT");
          }
          nextTrackIds = [...serverIds, trackId];
          finalAdded = true;
        }

        tx.update(plRef, {
          trackIds: nextTrackIds,
          updatedAt: serverTimestamp(),
        });
      });

      return { ok: true, added: finalAdded };
    } catch (error) {
      if (error instanceof Error && error.message === "PLAYLIST_NOT_FOUND") {
        return { ok: false, error: "Playlist not found." };
      }
      if (error instanceof Error && error.message === "PLAYLIST_LIMIT") {
        return { ok: false, error: `Playlists can hold up to ${MAX_PLAYLIST_TRACKS} songs.` };
      }
      try {
        handleFirestoreError(
          error,
          OperationType.UPDATE,
          `users/${this.currentUser?.uid}/playlists/${playlistId}`
        );
      } catch (wrapped) {
        return { ok: false, error: wrapped instanceof Error ? wrapped.message : "Could not update playlist." };
      }
    } finally {
      this.pendingPlaylistOps.delete(opKey);
    }
  }

  public async removeTrackFromPlaylist(
    playlistId: string,
    trackId: string
  ): Promise<{ ok: boolean; error?: string }> {
    return this.toggleTrackInPlaylist(playlistId, trackId, "remove");
  }

  public async removeHistoryEntry(historyId: string): Promise<{ ok: boolean }> {
    if (!this.currentUser || !isValidTrackId(historyId)) return { ok: false };
    try {
      const uid = await this.requireSignedInUid();
      await deleteDoc(doc(db, "users", uid, "history", historyId));
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  // ---- Stats Helpers ----

  public getTrackPlayCount(trackId: string): number {
    return this.playStatsMap.get(trackId)?.playCount ?? 0;
  }

  public getTotalPlays(): number {
    const computedSum = this.mostPlayed.reduce((acc, s) => acc + s.playCount, 0);
    return Math.max(this.profile?.totalPlays ?? 0, computedSum);
  }

  // ---- Meaningful Play Tracking ----

  private resetPlaySession(): void {
    this.playSession = {
      trackId: null,
      track: null,
      accumulatedMs: 0,
      lastTickWallMs: null,
      lastAudioTimeSec: null,
      counted: false,
      recording: false,
    };
  }

  public onTrackStarted(track: TrackInput | null | undefined): void {
    const clean = sanitizeTrack(track);
    if (!clean) {
      this.resetPlaySession();
      return;
    }
    this.playSession = {
      trackId: clean.trackId,
      track: clean,
      accumulatedMs: 0,
      lastTickWallMs: null,
      lastAudioTimeSec: null,
      counted: false,
      recording: false,
    };
  }

  public onPlaybackTick(
    track: TrackInput | null | undefined,
    isPlaying: boolean,
    currentTimeSec: number,
    durationSec: number
  ): void {
    const clean = sanitizeTrack(track);
    if (!clean) return;

    if (this.playSession.trackId !== clean.trackId) {
      this.onTrackStarted(track);
    } else {
      // Keep freshest metadata (e.g., once duration resolves)
      this.playSession.track = clean;
    }

    if (!isPlaying) {
      this.playSession.lastTickWallMs = null;
      this.playSession.lastAudioTimeSec = Number.isFinite(currentTimeSec) ? currentTimeSec : null;
      return;
    }

    const now = Date.now();
    const curSec = Number.isFinite(currentTimeSec) && currentTimeSec >= 0 ? currentTimeSec : 0;

    if (this.playSession.lastTickWallMs !== null && this.playSession.lastAudioTimeSec !== null) {
      const wallDeltaMs = now - this.playSession.lastTickWallMs;
      const audioDeltaSec = curSec - this.playSession.lastAudioTimeSec;

      // Credit elapsed real playback time only when audio genuinely moved forward (prevents seek cheats & stalled-buffer inflation)
      if (wallDeltaMs > 0 && audioDeltaSec > 0.05) {
        const creditedMs = Math.min(wallDeltaMs, audioDeltaSec * 1000 + 350, 15000);
        if (creditedMs > 0) {
          this.playSession.accumulatedMs += creditedMs;
        }
      }
    }

    this.playSession.lastTickWallMs = now;
    this.playSession.lastAudioTimeSec = curSec;

    if (this.playSession.counted || this.playSession.recording) {
      return;
    }

    const effectiveDur =
      Number.isFinite(durationSec) && durationSec > 0
        ? durationSec
        : clean.seconds > 0
        ? clean.seconds
        : 0;

    // Meaningful play threshold: 30s for normal tracks, scaled proportionally down to 15s for short tracks
    const thresholdMs =
      effectiveDur > 0
        ? Math.min(30000, Math.max(15000, Math.round(effectiveDur * 0.35 * 1000)))
        : 25000;

    if (this.playSession.accumulatedMs >= thresholdMs) {
      void this.commitMeaningfulPlay(clean);
    }
  }

  public onTrackEnded(track: TrackInput | null | undefined): void {
    const clean = sanitizeTrack(track);
    if (
      clean &&
      this.playSession.trackId === clean.trackId &&
      !this.playSession.counted &&
      !this.playSession.recording &&
      this.playSession.accumulatedMs >= 10000
    ) {
      void this.commitMeaningfulPlay(clean);
    }
    // Reset so a subsequent repeat listen can count legitimately
    this.resetPlaySession();
  }

  private async commitMeaningfulPlay(track: SanitizedTrack): Promise<void> {
    const now = Date.now();
    if (
      this.lastCountedTrackId === track.trackId &&
      now - this.lastCountedAtWallMs < MIN_DUPLICATE_GAP_MS
    ) {
      this.playSession.counted = true;
      return;
    }

    this.playSession.recording = true;
    try {
      const signedInUser = this.currentUser || auth.currentUser;

      // Always record deduplicated unique listener play in song_stats (isolated so transient errors never block user history/playStats)
      try {
        await songStatsManager.recordUniquePlay(track.trackId, signedInUser ? signedInUser.uid : null);
      } catch {
        // non-fatal for private library sync
      }

      // Guest users do not write to private /users/{uid} collections
      if (!signedInUser) {
        this.playSession.counted = true;
        this.lastCountedTrackId = track.trackId;
        this.lastCountedAtWallMs = Date.now();
        return;
      }

      const uid = await this.requireSignedInUid();
      const userRef = doc(db, "users", uid);
      const statRef = doc(db, "users", uid, "playStats", track.trackId);
      // Canonical per-song history document keyed strictly by trackId (prevents duplicate history rows)
      const historyRef = doc(db, "users", uid, "history", track.trackId);

      await runTransaction(db, async (tx) => {
        const [uSnap, sSnap, hSnap] = await Promise.all([
          tx.get(userRef),
          tx.get(statRef),
          tx.get(historyRef),
        ]);
        if (!uSnap.exists()) {
          throw new Error("User profile missing during play record.");
        }
        const prevTotal =
          typeof uSnap.data()?.totalPlays === "number" && uSnap.data().totalPlays >= 0
            ? uSnap.data().totalPlays
            : 0;

        tx.update(userRef, {
          totalPlays: prevTotal + 1,
          updatedAt: serverTimestamp(),
        });

        if (!sSnap.exists()) {
          tx.set(statRef, {
            trackId: track.trackId,
            userId: uid,
            title: track.title,
            artist: track.artist,
            duration: track.duration,
            seconds: track.seconds,
            thumb: track.thumb,
            playCount: 1,
            firstPlayedAt: serverTimestamp(),
            lastPlayedAt: serverTimestamp(),
          });
        } else {
          const prevCount =
            typeof sSnap.data()?.playCount === "number" && sSnap.data().playCount >= 1
              ? sSnap.data().playCount
              : 1;
          tx.update(statRef, {
            title: track.title,
            artist: track.artist,
            duration: track.duration,
            seconds: track.seconds,
            thumb: track.thumb,
            playCount: prevCount + 1,
            lastPlayedAt: serverTimestamp(),
          });
        }

        if (!hSnap.exists()) {
          tx.set(historyRef, {
            historyId: track.trackId,
            userId: uid,
            trackId: track.trackId,
            title: track.title,
            artist: track.artist,
            duration: track.duration,
            seconds: track.seconds,
            thumb: track.thumb,
            playedAt: serverTimestamp(),
          });
        } else {
          tx.update(historyRef, {
            title: track.title,
            artist: track.artist,
            duration: track.duration,
            seconds: track.seconds,
            thumb: track.thumb,
            playedAt: serverTimestamp(),
          });
        }
      });

      this.playSession.counted = true;
      this.lastCountedTrackId = track.trackId;
      this.lastCountedAtWallMs = Date.now();

      // Remove any legacy non-canonical hist_* entries for this song now that canonical {trackId} exists
      const legacyIds = this.legacyHistoryDocsByTrack.get(track.trackId);
      if (legacyIds && legacyIds.length > 0) {
        void this.cleanupDuplicateHistoryDocs(uid, legacyIds);
      }

      // Trim excess old history records quietly in background
      if (this.history.length > MAX_HISTORY_ENTRIES) {
        const overflow = this.history.slice(MAX_HISTORY_ENTRIES);
        for (const oldEntry of overflow.slice(0, 5)) {
          deleteDoc(doc(db, "users", uid, "history", oldEntry.historyId)).catch(() => {});
        }
      }
    } catch (error) {
      try {
        handleFirestoreError(error, OperationType.WRITE, `users/${this.currentUser?.uid}/playStats/${track.trackId}`);
      } catch {
        // non-fatal for playback
      }
    } finally {
      this.playSession.recording = false;
    }
  }
}

const accountManager = new SlowedfyUserLibrary();

declare global {
  interface Window {
    SlowedfyAccount?: SlowedfyUserLibrary;
  }
}

if (typeof window !== "undefined") {
  window.SlowedfyAccount = accountManager;
}

export default accountManager;
