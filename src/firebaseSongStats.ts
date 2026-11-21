import {
  doc,
  collection,
  query,
  where,
  getDoc,
  runTransaction,
  onSnapshot,
  serverTimestamp,
  type Unsubscribe,
} from "firebase/firestore";
import { db, OperationType, handleFirestoreError, testConnection } from "./firebaseApp";

export interface SongStatCounts {
  uniquePlayCount: number;
  likeCount: number;
  loaded: boolean;
}

export interface SongStatsSnapshot {
  loaded: boolean;
  stats: Record<string, { uniquePlayCount: number; likeCount: number }>;
}

type StatsListener = (snapshot: SongStatsSnapshot) => void;

function isValidTrackId(id: unknown): id is string {
  return typeof id === "string" && /^[a-zA-Z0-9_-]{4,128}$/.test(id.trim());
}

function isValidVisitorId(id: unknown): id is string {
  return typeof id === "string" && /^[a-zA-Z0-9_-]{8,118}$/.test(id.trim());
}

function isValidUid(id: unknown): id is string {
  return typeof id === "string" && /^[a-zA-Z0-9_-]{8,118}$/.test(id.trim());
}

function readVisitorIdFallback(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const winAny = window as unknown as {
      Analytics?: { visitorId?: string; getOrCreateVisitorId?: () => string };
    };
    const fromAnalytics = winAny.Analytics?.visitorId;
    if (isValidVisitorId(fromAnalytics)) return fromAnalytics.trim();
    if (typeof winAny.Analytics?.getOrCreateVisitorId === "function") {
      const created = winAny.Analytics.getOrCreateVisitorId();
      if (isValidVisitorId(created)) return created.trim();
    }
  } catch {
    // ignore
  }
  try {
    const ls = window.localStorage.getItem("slowedfy_vid");
    if (isValidVisitorId(ls)) return ls.trim();
  } catch {
    // ignore
  }
  try {
    const parts = document.cookie ? document.cookie.split(";") : [];
    for (const raw of parts) {
      const c = raw.trim();
      if (c.startsWith("slowedfy_vid=")) {
        const val = decodeURIComponent(c.slice("slowedfy_vid=".length));
        if (isValidVisitorId(val)) return val.trim();
      }
    }
  } catch {
    // ignore
  }
  return null;
}

class SlowedfySongStatsManager {
  private loaded = false;
  private serverStats = new Map<string, { uniquePlayCount: number; likeCount: number }>();
  private optimisticLikes = new Map<string, { targetCount: number; expiresAt: number }>();
  private optimisticPlays = new Map<string, { targetCount: number; expiresAt: number }>();
  private confirmedPlays = new Set<string>();
  private inFlightPlays = new Set<string>();
  private reconciledLikes = new Set<string>();
  private unsub: Unsubscribe | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<StatsListener>();

  constructor() {
    if (typeof window !== "undefined") {
      void this.start();
    }
  }

  public async start(): Promise<void> {
    if (this.unsub) return;
    try {
      await testConnection();
    } catch {
      this.scheduleRetry();
      return;
    }

    const statsQuery = query(
      collection(db, "song_stats"),
      where("uniquePlayCount", ">=", 0)
    );

    this.unsub = onSnapshot(
      statsQuery,
      (snapshot) => {
        const now = Date.now();
        const nextMap = new Map<string, { uniquePlayCount: number; likeCount: number }>();

        for (const docSnap of snapshot.docs) {
          const d = docSnap.data();
          const trackId = typeof d?.trackId === "string" ? d.trackId : docSnap.id;
          if (!isValidTrackId(trackId)) continue;
          const uniquePlayCount =
            typeof d?.uniquePlayCount === "number" && Number.isFinite(d.uniquePlayCount) && d.uniquePlayCount >= 0
              ? Math.floor(d.uniquePlayCount)
              : 0;
          const likeCount =
            typeof d?.likeCount === "number" && Number.isFinite(d.likeCount) && d.likeCount >= 0
              ? Math.floor(d.likeCount)
              : 0;
          nextMap.set(trackId, { uniquePlayCount, likeCount });

          const optLike = this.optimisticLikes.get(trackId);
          if (optLike && (optLike.targetCount === likeCount || now >= optLike.expiresAt)) {
            this.optimisticLikes.delete(trackId);
          }

          const optPlay = this.optimisticPlays.get(trackId);
          if (optPlay && (uniquePlayCount >= optPlay.targetCount || now >= optPlay.expiresAt)) {
            this.optimisticPlays.delete(trackId);
          }
        }

        // Clean up any expired optimistic overrides
        for (const [tid, entry] of this.optimisticLikes.entries()) {
          if (now >= entry.expiresAt) this.optimisticLikes.delete(tid);
        }
        for (const [tid, entry] of this.optimisticPlays.entries()) {
          if (now >= entry.expiresAt) this.optimisticPlays.delete(tid);
        }

        this.serverStats = nextMap;
        this.loaded = true;
        this.emit();
      },
      (error) => {
        this.unsub?.();
        this.unsub = null;
        try {
          handleFirestoreError(error, OperationType.LIST, "song_stats");
        } catch {
          this.scheduleRetry();
        }
      }
    );
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.start();
    }, 4000);
  }

  public getSongStats(trackId: string): SongStatCounts {
    if (!isValidTrackId(trackId)) {
      return { uniquePlayCount: 0, likeCount: 0, loaded: this.loaded };
    }
    const cleanId = trackId.trim();
    const base = this.serverStats.get(cleanId) || { uniquePlayCount: 0, likeCount: 0 };
    const now = Date.now();

    const optPlay = this.optimisticPlays.get(cleanId);
    const uniquePlayCount =
      optPlay && now < optPlay.expiresAt
        ? Math.max(base.uniquePlayCount, optPlay.targetCount)
        : base.uniquePlayCount;

    const optLike = this.optimisticLikes.get(cleanId);
    const likeCount =
      optLike && now < optLike.expiresAt
        ? Math.max(0, optLike.targetCount)
        : base.likeCount;

    return {
      uniquePlayCount,
      likeCount,
      loaded: this.loaded,
    };
  }

  public getSnapshot(): SongStatsSnapshot {
    const stats: Record<string, { uniquePlayCount: number; likeCount: number }> = {};
    const allIds = new Set<string>([
      ...this.serverStats.keys(),
      ...this.optimisticLikes.keys(),
      ...this.optimisticPlays.keys(),
    ]);
    for (const id of allIds) {
      const s = this.getSongStats(id);
      stats[id] = {
        uniquePlayCount: s.uniquePlayCount,
        likeCount: s.likeCount,
      };
    }
    return {
      loaded: this.loaded,
      stats,
    };
  }

  public subscribe(listener: StatsListener): () => void {
    this.listeners.add(listener);
    try {
      listener(this.getSnapshot());
    } catch {
      // ignore subscriber errors
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

  public setOptimisticLikeDelta(trackId: string, delta: 1 | -1): {
    commit: (finalCount?: number) => void;
    rollback: () => void;
  } {
    const cleanId = trackId.trim();
    const current = this.getSongStats(cleanId).likeCount;
    const targetCount = Math.max(0, current + delta);
    this.optimisticLikes.set(cleanId, {
      targetCount,
      expiresAt: Date.now() + 8000,
    });
    this.emit();

    return {
      commit: (finalCount?: number) => {
        if (typeof finalCount === "number" && Number.isFinite(finalCount) && finalCount >= 0) {
          const prev = this.serverStats.get(cleanId) || { uniquePlayCount: 0, likeCount: 0 };
          this.serverStats.set(cleanId, {
            uniquePlayCount: prev.uniquePlayCount,
            likeCount: Math.floor(finalCount),
          });
        }
        this.optimisticLikes.delete(cleanId);
        this.emit();
      },
      rollback: () => {
        this.optimisticLikes.delete(cleanId);
        this.emit();
      },
    };
  }

  public async recordUniquePlay(
    trackId: string,
    uid: string | null,
    explicitVisitorId?: string | null
  ): Promise<void> {
    if (!isValidTrackId(trackId)) return;
    const cleanTrackId = trackId.trim();
    const cleanUid = isValidUid(uid) ? uid.trim() : null;
    const rawVisitorId = explicitVisitorId || readVisitorIdFallback();
    const cleanVisitorId = isValidVisitorId(rawVisitorId) ? rawVisitorId.trim() : null;

    if (!cleanUid && !cleanVisitorId) return;

    const actorKey = cleanUid ? `u_${cleanUid}` : `g_${cleanVisitorId}`;
    const cacheKey = `${actorKey}:${cleanTrackId}`;

    if (this.confirmedPlays.has(cacheKey) || this.inFlightPlays.has(cacheKey)) {
      return;
    }

    this.inFlightPlays.add(cacheKey);
    try {
      await testConnection();
      const songStatRef = doc(db, "song_stats", cleanTrackId);
      const guestListenerId = cleanVisitorId ? `g_${cleanVisitorId}` : null;

      let incrementedTo: number | null = null;

      if (cleanUid) {
        const userListenerId = `u_${cleanUid}`;
        const userListenerRef = doc(db, "song_stats", cleanTrackId, "uniqueListeners", userListenerId);
        const guestListenerRef = guestListenerId
          ? doc(db, "song_stats", cleanTrackId, "uniqueListeners", guestListenerId)
          : null;

        await runTransaction(db, async (tx) => {
          const [statSnap, uSnap, gSnap] = await Promise.all([
            tx.get(songStatRef),
            tx.get(userListenerRef),
            guestListenerRef ? tx.get(guestListenerRef) : Promise.resolve(null),
          ]);

          if (uSnap.exists()) {
            return;
          }

          // Same browser already counted this person as a guest: link user receipt without inflating uniquePlayCount
          if (gSnap && gSnap.exists() && statSnap.exists()) {
            tx.set(userListenerRef, {
              trackId: cleanTrackId,
              listenerId: userListenerId,
              listenerType: "user",
              firstPlayedAt: serverTimestamp(),
            });
            return;
          }

          tx.set(userListenerRef, {
            trackId: cleanTrackId,
            listenerId: userListenerId,
            listenerType: "user",
            firstPlayedAt: serverTimestamp(),
          });

          if (!statSnap.exists()) {
            tx.set(songStatRef, {
              trackId: cleanTrackId,
              uniquePlayCount: 1,
              likeCount: 0,
              lastGuestPlayKey: "",
              updatedAt: serverTimestamp(),
            });
            incrementedTo = 1;
          } else {
            const cur =
              typeof statSnap.data()?.uniquePlayCount === "number" && statSnap.data().uniquePlayCount >= 0
                ? Math.floor(statSnap.data().uniquePlayCount)
                : 0;
            const next = cur + 1;
            tx.update(songStatRef, {
              uniquePlayCount: next,
              updatedAt: serverTimestamp(),
            });
            incrementedTo = next;
          }
        });
      } else if (guestListenerId) {
        const guestListenerRef = doc(db, "song_stats", cleanTrackId, "uniqueListeners", guestListenerId);

        await runTransaction(db, async (tx) => {
          const [statSnap, gSnap] = await Promise.all([
            tx.get(songStatRef),
            tx.get(guestListenerRef),
          ]);

          if (gSnap.exists()) {
            return;
          }

          tx.set(guestListenerRef, {
            trackId: cleanTrackId,
            listenerId: guestListenerId,
            listenerType: "guest",
            firstPlayedAt: serverTimestamp(),
          });

          if (!statSnap.exists()) {
            tx.set(songStatRef, {
              trackId: cleanTrackId,
              uniquePlayCount: 1,
              likeCount: 0,
              lastGuestPlayKey: guestListenerId,
              updatedAt: serverTimestamp(),
            });
            incrementedTo = 1;
          } else {
            const cur =
              typeof statSnap.data()?.uniquePlayCount === "number" && statSnap.data().uniquePlayCount >= 0
                ? Math.floor(statSnap.data().uniquePlayCount)
                : 0;
            const next = cur + 1;
            tx.update(songStatRef, {
              uniquePlayCount: next,
              lastGuestPlayKey: guestListenerId,
              updatedAt: serverTimestamp(),
            });
            incrementedTo = next;
          }
        });
      }

      this.confirmedPlays.add(cacheKey);
      if (incrementedTo !== null) {
        const prev = this.serverStats.get(cleanTrackId) || { uniquePlayCount: 0, likeCount: 0 };
        this.serverStats.set(cleanTrackId, {
          uniquePlayCount: Math.max(prev.uniquePlayCount, incrementedTo),
          likeCount: prev.likeCount,
        });
        this.optimisticPlays.set(cleanTrackId, {
          targetCount: incrementedTo,
          expiresAt: Date.now() + 6000,
        });
        this.emit();
      }
    } catch (error) {
      try {
        handleFirestoreError(error, OperationType.WRITE, `song_stats/${cleanTrackId}`);
      } catch {
        // non-fatal for playback
      }
    } finally {
      this.inFlightPlays.delete(cacheKey);
    }
  }

  /**
   * Ensures any pre-existing liked song saved under users/{uid}/likedSongs before
   * song_stats launched is accurately reflected in song_stats.likeCount without duplication.
   */
  public async reconcileExistingUserLike(trackId: string, uid: string): Promise<void> {
    if (!isValidTrackId(trackId) || !isValidUid(uid)) return;
    const cleanTrackId = trackId.trim();
    const cleanUid = uid.trim();
    const key = `${cleanUid}:${cleanTrackId}`;
    if (this.reconciledLikes.has(key)) return;
    this.reconciledLikes.add(key);

    try {
      const likerRef = doc(db, "song_stats", cleanTrackId, "likers", cleanUid);
      const existingLiker = await getDoc(likerRef);
      if (existingLiker.exists()) return;

      const userLikeRef = doc(db, "users", cleanUid, "likedSongs", cleanTrackId);
      const songStatRef = doc(db, "song_stats", cleanTrackId);

      await runTransaction(db, async (tx) => {
        const [uLikeSnap, lSnap, sSnap] = await Promise.all([
          tx.get(userLikeRef),
          tx.get(likerRef),
          tx.get(songStatRef),
        ]);
        if (!uLikeSnap.exists() || lSnap.exists()) return;

        tx.set(likerRef, {
          trackId: cleanTrackId,
          userId: cleanUid,
          likedAt: serverTimestamp(),
        });

        if (!sSnap.exists()) {
          tx.set(songStatRef, {
            trackId: cleanTrackId,
            uniquePlayCount: 0,
            likeCount: 1,
            lastGuestPlayKey: "",
            updatedAt: serverTimestamp(),
          });
        } else {
          const curLikes =
            typeof sSnap.data()?.likeCount === "number" && sSnap.data().likeCount >= 0
              ? Math.floor(sSnap.data().likeCount)
              : 0;
          tx.update(songStatRef, {
            likeCount: curLikes + 1,
            updatedAt: serverTimestamp(),
          });
        }
      });
    } catch {
      this.reconciledLikes.delete(key);
    }
  }
}

const songStatsManager = new SlowedfySongStatsManager();

declare global {
  interface Window {
    SlowedfySongStats?: SlowedfySongStatsManager;
  }
}

if (typeof window !== "undefined") {
  window.SlowedfySongStats = songStatsManager;
}

export default songStatsManager;
