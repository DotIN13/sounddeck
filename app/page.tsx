// --------------------------------------------------------------------
// file: app/page.tsx  (Client UI using shadcn/ui + Batch to Folder via File System Access API + FLAC tagging via metaflac.wasm; flac.wasm fallback)
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

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [metaReady, setMetaReady] = useState(false);
  const [flacReady, setFlacReady] = useState(false);

  const [batchBusy, setBatchBusy] = useState(false);
  const [batchNote, setBatchNote] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{
    done: number;
    total: number;
  }>({ done: 0, total: 0 });

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

  // Prepare a tagged file but DO NOT auto-download; return filename + bytes + mime
  async function prepareTaggedFile(track: TrackItem) {
    const urlInfo = await fetchSongUrl(track);
    const songUrl = urlInfo?.url as string;
    if (!songUrl) throw new Error("No audio url");
    const hint = parseContentTypeFromUrl(songUrl);
    const mediaResp = await fetch(songUrl);
    if (!mediaResp.ok) throw new Error(`download: ${mediaResp.status}`);
    const mediaBuf = await mediaResp.arrayBuffer();

    const artists = arrayify(track.artist);
    const artistStr = artists.join(" / ");
    const title = track.name || "Unknown Title";
    const album = track.album || "";
    const year = new Date().getFullYear().toString();
    const [coverUrl, lyricData] = await Promise.all([
      fetchAlbumArt(track, "500"),
      fetchLyrics(track),
    ]);
    let coverArrayBuf: ArrayBuffer | undefined;
    let coverMime: string | undefined;
    if (coverUrl) {
      try {
        const c = await fetch(coverUrl);
        coverMime = c.headers.get("content-type") || undefined;
        coverArrayBuf = await c.arrayBuffer();
      } catch {}
    }
    const unsyncedLyrics = stripLrcTags(lyricData?.tlyric || lyricData?.lyric);

    let bytes: Uint8Array;
    let mime = "audio/mpeg";
    let ext = ".mp3";
    let fnameBase = sanitizeFileName(`${artistStr} - ${title}`);

    if (hint === "audio/mpeg" || /br=(128|192|320)/i.test(songUrl)) {
      const writer = new ID3Writer(new Uint8Array(mediaBuf));
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
      if (coverArrayBuf)
        writer.setFrame("APIC", {
          type: 3,
          data: new Uint8Array(coverArrayBuf),
          description: "Cover",
        });
      writer.addTag();
      const ab = (writer as any).arrayBuffer as ArrayBuffer;
      bytes = new Uint8Array(ab);
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
      let out: Uint8Array | undefined;
      if (metaReady) {
        out = await tagFlacWithMetaflac(
          new Uint8Array(mediaBuf),
          tags,
          coverArrayBuf
            ? {
                bytes: new Uint8Array(coverArrayBuf),
                mime: coverMime || "image/jpeg",
              }
            : undefined
        );
      } else if (flacReady) {
        out = await tagFlacWithFlacWasm(
          new Uint8Array(mediaBuf),
          tags,
          coverArrayBuf
            ? {
                bytes: new Uint8Array(coverArrayBuf),
                mime: coverMime || "image/jpeg",
              }
            : undefined
        );
      }
      if (!out) throw new Error("No FLAC tool available");
      bytes = out;
      mime = "audio/flac";
      ext = ".flac";
    }

    return { fileName: `${fnameBase}${ext}`, bytes, mime };
  }

  // Single-file download via object URL (kept for convenience)
  async function downloadOne(track: TrackItem) {
    const { fileName, bytes, mime } = await prepareTaggedFile(track);
    const blob = new Blob([bytes], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  // Batch save straight to a chosen folder (Chromium browsers)
  async function downloadSelectedToFolder() {
    try {
      // @ts-ignore experimental
      if (!window.showDirectoryPicker) {
        setBatchNote(
          "Your browser doesn't support folder saving. Use Chrome/Edge/Opera."
        );
        return;
      }
      // @ts-ignore experimental
      const dirHandle: FileSystemDirectoryHandle =
        await window.showDirectoryPicker();
      const ids = Array.from(selectedIds);
      setBatchBusy(true);
      setBatchNote(null);
      setBatchProgress({ done: 0, total: ids.length });
      for (let i = 0; i < ids.length; i++) {
        const [src, id] = ids[i].split(":");
        const t = results.find((r) => r.source === src && String(r.id) === id);
        if (!t) {
          setBatchNote(`Skipped missing result ${ids[i]}`);
          continue;
        }
        try {
          const { fileName, bytes, mime } = await prepareTaggedFile(t);
          // Create file and stream write
          const fileHandle = await dirHandle.getFileHandle(fileName, {
            create: true,
          });
          const writable = await (fileHandle as any).createWritable();
          await writable.write(new Blob([bytes], { type: mime }));
          await writable.close();
        } catch (e: any) {
          setBatchNote(`Error on ${t.name}: ${e?.message ?? e}`);
        }
        setBatchProgress({ done: i + 1, total: ids.length });
      }
      setBatchNote(`Saved ${ids.length} file(s) to selected folder.`);
    } finally {
      setBatchBusy(false);
    }
  }

  function toggleSelect(track: TrackItem) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const key = `${track.source}:${track.id}`;
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
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
                const selected = selectedIds.has(key);
                const artists = arrayify(t.artist).join(" / ");
                return (
                  <TableRow key={key} className="hover:bg-muted/50">
                    <TableCell>
                      <Checkbox
                        checked={selected}
                        onCheckedChange={() => toggleSelect(t)}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell>{artists || "-"}</TableCell>
                    <TableCell>{t.album || "-"}</TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => getPreview(t)}
                        >
                          <Play className="w-4 h-4 mr-1" />
                          Preview
                        </Button>
                        <Button size="sm" onClick={() => downloadOne(t)}>
                          <Download className="w-4 h-4 mr-1" />
                          Download
                        </Button>
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
        <Button
          variant="secondary"
          onClick={downloadSelectedToFolder}
          disabled={selectedIds.size === 0 || batchBusy}
        >
          Save Selected to Folder
        </Button>
        <div className="text-xs text-muted-foreground ml-2">
          (Uses File System Access API on Chromium-based browsers)
        </div>
        <div className="ml-auto text-xs text-muted-foreground">
          FLAC tools: metaflac {metaReady ? "✓" : "×"} / flac{" "}
          {flacReady ? "✓" : "×"}
        </div>
      </div>

      {(batchBusy || batchNote) && (
        <div className="mt-2 text-xs text-muted-foreground">
          {batchBusy && (
            <span>
              Saving… {batchProgress.done}/{batchProgress.total}
            </span>
          )}
          {batchNote && <div>{batchNote}</div>}
        </div>
      )}

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
          try another source or bitrate (320kbps is ideal for MP3 tagging).
        </p>
        <p>
          MP3 uses ID3v2.3 (title/artist/album/year/cover/lyrics). FLAC tagging
          uses <code>metaflac.wasm</code> without re-encode; if unavailable, we
          fall back to <code>flac.wasm</code>.
        </p>
        <p>
          Folder saving writes directly to disk with the File System Access API.
          Your browser will prompt for permission.
        </p>
      </div>
    </div>
  );
}
