// --------------------------------------------------------------------
// file: app/page.tsx  (Client UI using shadcn/ui + Single-file download with visual progress + FLAC tagging via metaflac.wasm; flac.wasm fallback)
// --------------------------------------------------------------------
"use client";
import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Search, Download, Play, Disc3, CheckCircle2 } from "lucide-react";
import { ID3Writer } from "browser-id3-writer";

// Primary: tag FLAC without re-encoding using metaflac (WASM)
import { metaflac, preloadWASM as preloadMetaWASM } from "metaflac.wasm";
// Fallback: re-encode path using flac.wasm if metaflac isn't available
import { flac, preloadWASM as preloadFlacWASM } from "flac.wasm";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

// —— UI: iOS-style circular progress (determinate + indeterminate)
function ProgressCircle({
  pct,
  indeterminate,
}: {
  pct?: number;
  indeterminate?: boolean;
}) {
  const size = 28; // px
  const stroke = 3;
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const clamped = typeof pct === "number" ? Math.max(0, Math.min(100, pct)) : 0;
  const dash = indeterminate ? C * 0.25 : (C * clamped) / 100;
  return (
    <div
      className={`relative inline-flex items-center justify-center`}
      style={{ width: size, height: size }}
      aria-label={indeterminate ? "Working…" : `Progress ${clamped}%`}
    >
      <svg
        width={size}
        height={size}
        className={indeterminate ? "animate-spin" : ""}
        style={{ animationDuration: indeterminate ? "1s" : undefined }}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          className="text-muted"
          stroke="currentColor"
          fill="none"
          opacity={0.25}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${C}`}
          className="text-primary"
          stroke="currentColor"
          fill="none"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
    </div>
  );
}

// ——— Types
interface TrackItem {
  id: string;
  name: string;
  artist: string[] | string;
  album: string;
  pic_id?: string;
  url_id?: string;
  lyric_id?: string;
  source: string;
}
interface LyricResponse {
  lyric?: string;
  tlyric?: string;
}

const API_PROXY = "/api/music";
const MEDIA_PROXY = "/api/media";
const MUSIC_SOURCES = [
  "netease",
  "tencent",
  "spotify",
  "ytmusic",
  "deezer",
  "migu",
  "kugou",
  "kuwo",
  "qobuz",
  "tidal",
  "joox",
  "ximalaya",
  "apple",
] as const;
const QUALITY_OPTIONS = [
  { label: "128 kbps (MP3)", value: "128" },
  { label: "192 kbps (MP3)", value: "192" },
  { label: "320 kbps (MP3)", value: "320" },
  { label: "Lossless 740", value: "740" },
  { label: "Lossless 999", value: "999" },
];

type MusicSource = (typeof MUSIC_SOURCES)[number];

type Progress = {
  phase: "fetch" | "tag" | "save" | "done" | "error";
  pct?: number;
  note?: string;
};

function arrayify(x: string | string[] | undefined | null): string[] {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}
function sanitizeFileName(name: string) {
  return name.replace(/[\/:*?"<>|]+/g, "_");
}
function stripLrcTags(lrc?: string) {
  return (lrc || "").replace(/\[[^\]]*\]/g, "").trim();
}
function parseContentTypeFromUrl(
  url: string
): "audio/mpeg" | "audio/flac" | undefined {
  const lower = url.toLowerCase();
  if (lower.includes(".mp3")) return "audio/mpeg";
  if (lower.includes(".flac") || lower.includes(".alac")) return "audio/flac";
  return undefined;
}

export default function Page() {
  const [source, setSource] = useState<MusicSource>("netease");
  const [keyword, setKeyword] = useState("");
  const [count, setCount] = useState("20");
  const [page, setPage] = useState("1");
  const [quality, setQuality] = useState("320");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<TrackItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [metaReady, setMetaReady] = useState(false);
  const [flacReady, setFlacReady] = useState(false);

  // Per-track progress map: key = `${source}:${id}`
  const [progressMap, setProgressMap] = useState<Record<string, Progress>>({});

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // Preload WASM toolchains
  useEffect(() => {
    (async () => {
      try {
        await preloadMetaWASM();
        setMetaReady(true);
      } catch {
        setMetaReady(false);
      }
      try {
        await preloadFlacWASM();
        setFlacReady(true);
      } catch {
        setFlacReady(false);
      }
    })();
  }, []);

  async function onSearch() {
    setError(null);
    setResults([]);
    if (!keyword.trim()) {
      setError("Please enter keyword");
      return;
    }
    setLoading(true);
    try {
      const url = new URL(window.location.origin + API_PROXY);
      url.searchParams.set("types", "search");
      url.searchParams.set("source", source);
      url.searchParams.set("name", keyword.trim());
      url.searchParams.set("count", count);
      url.searchParams.set("pages", page);
      const resp = await fetch(url.toString());
      const data = await resp.json();
      const arr = Array.isArray(data) ? data : [];
      setResults(
        arr.map((d: any) => ({
          id: String(d.id ?? d.track_id ?? ""),
          name: d.name ?? "",
          artist: d.artist ?? d.artists ?? [],
          album: d.album ?? "",
          pic_id: d.pic_id ?? undefined,
          url_id: d.url_id ?? undefined,
          lyric_id: d.lyric_id ?? d.id ?? undefined,
          source: d.source ?? source,
        }))
      );
    } catch (e: any) {
      setError(e?.message || "Search failed");
    } finally {
      setLoading(false);
    }
  }

  async function getPreview(t: TrackItem) {
    try {
      const url = new URL(window.location.origin + API_PROXY);
      url.searchParams.set("types", "url");
      url.searchParams.set("source", t.source);
      url.searchParams.set("id", t.id);
      url.searchParams.set("br", "128");
      const r = await fetch(url.toString());
      const d = await r.json();
      if (d?.url) setPreviewUrl(d.url);
    } catch {}
  }
  function togglePlay() {
    const a = audioRef.current;
    if (!a || !previewUrl) return;
    if (a.paused) a.play();
    else a.pause();
  }

  async function fetchSongUrl(track: TrackItem) {
    const u = new URL(window.location.origin + API_PROXY);
    u.searchParams.set("types", "url");
    u.searchParams.set("source", track.source);
    u.searchParams.set("id", track.id);
    u.searchParams.set("br", quality);
    const r = await fetch(u.toString());
    if (!r.ok) throw new Error(`url: ${r.status}`);
    return r.json();
  }
  async function fetchAlbumArt(
    track: TrackItem,
    size: "300" | "500" = "500"
  ): Promise<string | undefined> {
    if (!track.pic_id) return undefined;
    const u = new URL(window.location.origin + API_PROXY);
    u.searchParams.set("types", "pic");
    u.searchParams.set("source", track.source);
    u.searchParams.set("id", track.pic_id);
    u.searchParams.set("size", size);
    const r = await fetch(u.toString());
    if (!r.ok) return undefined;
    const d = await r.json();
    return d?.url;
  }
  async function fetchLyrics(
    track: TrackItem
  ): Promise<LyricResponse | undefined> {
    const lid = track.lyric_id || track.id;
    if (!lid) return undefined;
    const u = new URL(window.location.origin + API_PROXY);
    u.searchParams.set("types", "lyric");
    u.searchParams.set("source", track.source);
    u.searchParams.set("id", String(lid));
    const r = await fetch(u.toString());
    if (!r.ok) return undefined;
    return r.json();
  }

  // Streaming fetch with progress → returns Uint8Array
  async function fetchWithProgress(url: string, key: string) {
    setProgressMap((p) => ({ ...p, [key]: { phase: "fetch", pct: 0 } }));
    const resp = await fetch(`${MEDIA_PROXY}?url=${encodeURIComponent(url)}`);
    if (!resp.ok) throw new Error(`download: ${resp.status}`);
    const lenStr = resp.headers.get("content-length");
    const total = lenStr ? parseInt(lenStr, 10) : 0;
    if (!resp.body) {
      const buf = new Uint8Array(await resp.arrayBuffer());
      setProgressMap((p) => ({ ...p, [key]: { phase: "fetch", pct: 100 } }));
      return buf;
    }
    const reader = resp.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.length;
        if (total) {
          const pct = Math.min(99, Math.round((received / total) * 100));
          setProgressMap((p) => ({ ...p, [key]: { phase: "fetch", pct } }));
        }
      }
    }
    const out = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    setProgressMap((p) => ({ ...p, [key]: { phase: "fetch", pct: 100 } }));
    return out;
  }

  // ---- FLAC helpers
  async function tagFlacWithMetaflac(
    inputFlac: Uint8Array,
    tags: Record<string, string>,
    cover?: { bytes: Uint8Array; mime: string }
  ) {
    const args: string[] = ["--remove-all-tags"];
    for (const [k, v] of Object.entries(tags)) args.push(`--set-tag=${k}=${v}`);
    const inputName = "in.flac";
    const outputName = "in.flac";
    const inputFiles = new Map<string, Uint8Array>([[inputName, inputFlac]]);
    if (cover) {
      const picName = cover.mime.includes("png") ? "cover.png" : "cover.jpg";
      inputFiles.set(picName, cover.bytes);
      args.push(`--import-picture-from=${picName}`);
    }
    args.push(inputName);
    const { files } = await metaflac(args, {
      inputFiles,
      outputFileNames: [outputName],
    });
    const out = files.get(outputName);
    if (!out) throw new Error("metaflac failed");
    return out;
  }
  async function tagFlacWithFlacWasm(
    inputFlac: Uint8Array,
    tags: Record<string, string>,
    cover?: { bytes: Uint8Array; mime: string }
  ) {
    const dec = await flac(["-d", "-f", "-o", "in.wav", "in.flac"], {
      inputFiles: new Map([["in.flac", inputFlac]]),
      outputFileNames: ["in.wav"],
    });
    const wav = dec.files.get("in.wav");
    if (!wav) throw new Error("FLAC decode failed");
    const tagArgs: string[] = [];
    for (const [k, v] of Object.entries(tags)) tagArgs.push(`--tag=${k}=${v}`);
    const inputs = new Map<string, Uint8Array>([["in.wav", wav]]);
    const encodeArgs = ["-f", "-o", "out.flac", ...tagArgs];
    if (cover) {
      const coverName = cover.mime.includes("png") ? "cover.png" : "cover.jpg";
      inputs.set(coverName, cover.bytes);
      encodeArgs.push(`--picture=${coverName}`);
    }
    encodeArgs.push("in.wav");
    const enc = await flac(encodeArgs, {
      inputFiles: inputs,
      outputFileNames: ["out.flac"],
    });
    const out = enc.files.get("out.flac");
    if (!out) throw new Error("FLAC encode failed");
    return out;
  }

  // Single-file download (with progress) → fetch → tag → save
  async function downloadOne(track: TrackItem) {
    const key = `${track.source}:${track.id}`;
    try {
      // 1) Resolve URL
      const urlInfo = await fetchSongUrl(track);
      const songUrl = urlInfo?.url as string;
      if (!songUrl) throw new Error("No audio url");
      const hint = parseContentTypeFromUrl(songUrl);

      // 2) Fetch media with progress
      const mediaBytes = await fetchWithProgress(songUrl, key);

      // 3) Gather tags
      const artists = arrayify(track.artist);
      const artistStr = artists.join(" / ");
      const title = track.name || "Unknown Title";
      const album = track.album || "";
      const year = new Date().getFullYear().toString();
      const [coverUrl, lyricData] = await Promise.all([
        fetchAlbumArt(track, "500"),
        fetchLyrics(track),
      ]);
      let coverBytes: Uint8Array | undefined;
      let coverMime: string | undefined;
      if (coverUrl) {
        try {
          const c = await fetch(
            `${MEDIA_PROXY}?url=${encodeURIComponent(coverUrl)}`
          );
          coverMime = c.headers.get("content-type") || undefined;
          const ab = await c.arrayBuffer();
          coverBytes = new Uint8Array(ab);
        } catch {}
      }
      const unsyncedLyrics = stripLrcTags(
        lyricData?.tlyric || lyricData?.lyric
      );

      // 4) Tagging
      setProgressMap((p) => ({
        ...p,
        [key]: { phase: "tag", pct: 100, note: "Tagging…" },
      }));
      let outBytes: Uint8Array;
      let mime = "audio/mpeg";
      let ext = ".mp3";
      let fnameBase = sanitizeFileName(`${artistStr} - ${title}`);
      if (hint === "audio/mpeg") {
        const writer = new ID3Writer(mediaBytes.buffer);
        writer
          .setFrame("TIT2", title)
          .setFrame("TPE1", artists)
          .setFrame("TALB", album)
          .setFrame("TYER", parseInt(year, 10))
          .setFrame("TCON", ["Other"])
          .setFrame("TCOP", `© ${year} ${artistStr}`);
        if (unsyncedLyrics)
          writer.setFrame("USLT", {
            description: "Lyrics",
            lyrics: unsyncedLyrics,
            language: "eng",
          });
        if (coverBytes)
          writer.setFrame("APIC", {
            type: 3,
            data: coverBytes.buffer,
            description: "Cover",
          });
        writer.addTag();
        outBytes = new Uint8Array(writer.arrayBuffer as ArrayBuffer);
        mime = "audio/mpeg";
        ext = ".mp3";
      } else {
        const tags: Record<string, string> = {
          TITLE: title,
          ARTIST: artistStr,
          ALBUM: album,
          DATE: year,
        };
        if (unsyncedLyrics) tags["LYRICS"] = unsyncedLyrics;
        let flacOut: Uint8Array | undefined;
        if (metaReady) {
          flacOut = await tagFlacWithMetaflac(
            mediaBytes,
            tags,
            coverBytes
              ? { bytes: coverBytes, mime: coverMime || "image/jpeg" }
              : undefined
          );
        } else if (flacReady) {
          flacOut = await tagFlacWithFlacWasm(
            mediaBytes,
            tags,
            coverBytes
              ? { bytes: coverBytes, mime: coverMime || "image/jpeg" }
              : undefined
          );
        }
        if (!flacOut) throw new Error("No FLAC tool available");
        outBytes = flacOut;
        mime = "audio/flac";
        ext = ".flac";
      }

      // 5) Save
      setProgressMap((p) => ({
        ...p,
        [key]: { phase: "save", pct: 100, note: "Saving…" },
      }));
      const blob = new Blob([outBytes], { type: mime });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${fnameBase}${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      setProgressMap((p) => ({
        ...p,
        [key]: { phase: "done", pct: 100, note: "Done" },
      }));
    } catch (e: any) {
      setProgressMap((p) => ({
        ...p,
        [key]: { phase: "error", pct: 0, note: e?.message || "Failed" },
      }));
    }
  }

  return (
    <div className="container py-8 mx-auto max-w-6xl p-6">
      <motion.h1
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-2xl md:text-3xl font-semibold mb-6 flex items-center gap-2"
      >
        <Disc3 className="w-7 h-7" /> SoundDeck: Music Search & Downloader
      </motion.h1>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Search</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <Label className="mb-1 block">Keyword</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="song / artist / album"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onSearch();
                  }}
                />
                <Button onClick={onSearch} disabled={loading}>
                  <Search className="w-4 h-4 mr-1" />
                  Search
                </Button>
              </div>
            </div>
            <div>
              <Label className="mb-1 block">Source</Label>
              <Select
                value={source}
                onValueChange={(v) => setSource(v as MusicSource)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select source" />
                </SelectTrigger>
                <SelectContent>
                  {MUSIC_SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 block">Quality</Label>
              <Select value={quality} onValueChange={setQuality}>
                <SelectTrigger>
                  <SelectValue placeholder="Select quality" />
                </SelectTrigger>
                <SelectContent>
                  {QUALITY_OPTIONS.map((q) => (
                    <SelectItem key={q.value} value={q.value}>
                      {q.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1 block">Per Page</Label>
              <Input
                type="number"
                min={1}
                value={count}
                onChange={(e) => setCount(e.target.value)}
              />
            </div>
            <div>
              <Label className="mb-1 block">Page</Label>
              <Input
                type="number"
                min={1}
                value={page}
                onChange={(e) => setPage(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {error && <div className="text-red-600 text-sm mb-2">{error}</div>}

      <Card>
        <CardHeader>
          <CardTitle>Results</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Artist</TableHead>
                <TableHead>Album</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    No results. Try another keyword/source.
                  </TableCell>
                </TableRow>
              )}
              {results.map((t) => {
                const key = `${t.source}:${t.id}`;
                const artists = arrayify(t.artist).join(" / ");
                const pr = progressMap[key];
                return (
                  <TableRow key={key} className="hover:bg-muted/50">
                    <TableCell>
                      <Checkbox
                        checked={
                          !!pr && pr.phase != "done" && pr.phase != "error"
                        }
                        onCheckedChange={() => {
                          /* kept as a stub for future multi-select actions */
                        }}
                        disabled
                      />
                    </TableCell>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell>{artists || "-"}</TableCell>
                    <TableCell>{t.album || "-"}</TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => getPreview(t)}
                        >
                          <Play className="w-4 h-4 mr-1" />
                          Preview
                        </Button>
                        {pr && pr.phase !== "done" && pr.phase !== "error" ? (
                          <div className="px-2" title={`${pr.phase}…`}>
                            <ProgressCircle
                              pct={pr.pct}
                              indeterminate={
                                pr.phase !== "fetch" &&
                                pr.phase !== "done" &&
                                pr.phase !== "error"
                              }
                            />
                          </div>
                        ) : (
                          <Button size="sm" onClick={() => downloadOne(t)}>
                            <Download className="w-4 h-4 mr-1" />
                            Download
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 mt-3">
        <div className="ml-auto text-xs text-muted-foreground">
          FLAC tools: metaflac {metaReady ? "✓" : "×"} / flac{" "}
          {flacReady ? "✓" : "×"}
        </div>
      </div>

      <audio
        ref={audioRef}
        src={previewUrl ?? undefined}
        className="hidden"
        controls
      />
      {previewUrl && (
        <div className="mt-3 flex items-center gap-2">
          <div className="text-xs text-muted-foreground">Preview URL ready</div>
          <Button variant="outline" onClick={togglePlay}>
            Play / Pause
          </Button>
        </div>
      )}

      <div className="text-xs text-muted-foreground mt-4 space-y-1">
        <p>
          Some sources may fail due to region/account limits. If download fails,
          try another source or bitrate.
        </p>
        <p>
          MP3 uses ID3v2.3 (title/artist/album/year/cover/lyrics). FLAC tagging
          uses <code>metaflac.wasm</code> without re-encode; if unavailable, we
          fall back to <code>flac.wasm</code>.
        </p>
      </div>
    </div>
  );
}
