# Reads Dota 2's chat out of the running game's memory and prints each
# line it finds as one JSON object on stdout.
#
# Long-lived on purpose: it is spawned ONCE and kept, so nothing pays for
# PowerShell's startup or the C# compile per poll.
#
# Nothing is written to the game. This opens the process with
# PROCESS_VM_READ | PROCESS_QUERY_INFORMATION - read and ask, no more -
# and never calls WriteProcessMemory. That is the whole of its access.
#
# Why PowerShell at all: it keeps the tool at ZERO runtime dependencies
# and ships no compiled binary, so "is this a virus" is answerable by
# reading this file. The scanning loop itself is C# via Add-Type because a
# PowerShell byte loop over 4 GB never finishes.
#
# Protocol, one JSON object per line:
#   {"t":"status","state":"waiting|scanning|reading","pid":N,"detail":"..."}
#   {"t":"line","b64":"<the line, UTF-8, base64>","a":<address>,"w":0|1,
#    "r":<region base>,"rs":<region size>,"ab":<allocation base>,"p":0|1}
#   {"t":"stat","full":bool,"mode":"full|wide|win","ms":N,"mb":N,
#    "regions":N,"hits":N,"hot":N,"winMb":N}
#   {"t":"find","panels":N,"ms":N,"mb":N}      a search for the chat panel
#   {"t":"stat","mode":"panel","ms":N,"kb":N,"hits":N,"panels":"0xADDR:count ..."}
#   {"t":"error","detail":"..."}
#
# THE CHAT PANEL COMES FIRST (see "THE CHAT PANEL" below): when the game's
# own chat container can be found, a poll is a few KB of it and none of
# the scans below run at all. They are what happens until it is found,
# and the fallback for the day its layout changes.
#
# Three kinds of scan, from dearest to cheapest:
#   full  every byte of the process. Finds which ALLOCATIONS hold chat.
#   wide  every region of those allocations (~710 MB in a live match).
#   win   only a window around the addresses where a line has been seen.
# "a" is where the line was found and "w" whether that was inside the
# windows as they stood BEFORE the scan - together they are what says
# whether windows are any good, which is NOT yet known (see CLAUDE.md).

param(
  [string]$ProcessName = 'dota2',
  [int]$IntervalMs = 1000,
  [int]$FullRescanMs = 60000,
  # The process that started this one. When it is gone, so are we: a
  # force-killed Electron used to leave this loop reading the game's
  # memory for ever, and the game paid for it.
  [int]$ParentPid = 0,
  # Half-width of the window read around each remembered hit. 0 turns
  # windows off and makes every poll a wide one, which is what every
  # poll was before windows existed.
  [int]$WindowMb = 4,
  # Every Nth poll is wide whatever the windows say, so a line written
  # somewhere new is late by at most N polls rather than lost until the
  # next full sweep.
  [int]$WideEvery = 5,
  # The biggest region a WIDE poll will read, in MB; 0 reads them all.
  [int]$WideCapMb = 64,
  # Read the chat panel itself when it can be found (see THE CHAT PANEL
  # below). 0 is the scanner alone, as it was before the panel was known.
  [int]$Panel = 1,
  # A panel poll is a few KB, so it can be far more often than a scan.
  [int]$PanelIntervalMs = 250,
  # How often to look for the panel again while the only ones known are
  # the menu's. Two sweeps each time - but in the menu, not in a match.
  [int]$PanelRefindMs = 20000,
  [int]$PollThreads = 1,
  [int]$SweepThreads = 2,
  [string]$Priority = 'BelowNormal'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# The reader must never take a core the game wants. Below normal, its
# threads run only when nothing of ordinary priority is ready to.
try { [System.Diagnostics.Process]::GetCurrentProcess().PriorityClass = $Priority } catch { }

$parent = $null
if ($ParentPid -gt 0) {
  # Held as an object, not re-looked-up by number: a pid is reused, and a
  # handle to the process that was ours cannot be mistaken for the next
  # process to be given its number.
  try { $parent = Get-Process -Id $ParentPid -ErrorAction Stop } catch { exit 0 }
}
function ParentGone { return ($null -ne $parent) -and $parent.HasExited }

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

public static class DotaMem {
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(int a, bool i, int pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, IntPtr size, out IntPtr read);
  [DllImport("kernel32.dll")] static extern int VirtualQueryEx(IntPtr h, IntPtr addr, out MBI mbi, int len);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

  [StructLayout(LayoutKind.Sequential)]
  struct MBI {
    public IntPtr BaseAddress, AllocationBase;
    public int AllocationProtect, __a;
    public IntPtr RegionSize;
    public int State, Protect, Type, __b;
  }

  const int VM_READ = 0x0010, QUERY = 0x0400, COMMIT = 0x1000, PRIVATE = 0x20000;
  const int MAX_STR = 512;   // a chat line is far shorter; this bounds a runaway read
  const int LOOKBACK = 48;   // how far before the anchor the channel tag can sit
  // Regions BIGGER than the buffer used to be skipped whole. MEASURED on
  // the running game: 20 of them, 2,972 MB in all, the biggest 320 MB -
  // two fifths of the process never looked at, and nothing said so. They
  // are read in chunks now; the chunks overlap by more than the longest
  // string, so one lying on a seam is still seen entire.
  const int CHUNK = 16 * 1024 * 1024;
  const int OVERLAP = 8192;
  // What a POLL will read of a hot allocation. The allocations holding
  // chat also hold the game's bulk pools: 336 MB of small regions and
  // about 2 GB in a handful of enormous ones, which took a poll to 4.1
  // seconds. Every chat line yet measured was in a small region - 3.7 MB,
  // 32 MB, 3.9 MB - and a pool of a quarter of a gigabyte is not where a
  // short string is written. This is a heuristic, not a law, and it is
  // the FULL sweep's job to be the thing that has no heuristics in it:
  // that one reads every byte, giant regions included.
  //
  // AND IT WAS WRONG, for all chat. MEASURED with back-to-back full sweeps
  // and lines typed at known times: a team line is in memory four or five
  // times over and one copy usually lands somewhere small, but an all-chat
  // line exists only as one or two markup copies, and two of three of
  // those sat in regions of 64.8 MB and 160 MB. No poll ever saw them. The
  // chat heap grows through the match and its regions merge past any cap.
  // So the cap now binds only the WIDE poll, where it is what keeps 2 GB
  // of pools out of a routine read. A WINDOWED poll reads a few MB of a
  // region however big the region is, and has no use for a cap at all.
  public static long POLL_MAX_REGION = 64L * 1024 * 1024;   // 0 = no cap

  // Panorama's markup wraps EVERY chat line whatever its channel, so it
  // is the one anchor that finds both. MEASURED: the plain pre-formatted
  // string tags team chat "[Allies] " and leaves all-chat untagged, so
  // scanning for tags alone found team chat and missed all-chat entirely.
  // The plain tagged form is kept as a second anchor - it is cheap, and
  // it still catches a line whose markup copy has been freed.
  static readonly string[] TAGS = {
    "class=\"ChatPersona\"",
    "[Allies] ", "[All] ", "[Everyone] ", "[Team] ", "[Spectators] ", "[Coaches] "
  };
  static readonly List<byte[]> PATS = new List<byte[]>();
  // Which bytes can START a pattern. The scan was a loop over the whole
  // buffer PER PATTERN - seven passes over every byte of the process -
  // and is one pass now: nearly every byte fails this lookup and costs
  // nothing more. MEASURED on a 1 GB process, three sweeps each:
  // 10.6/8.5/6.0s before, 1.46/1.47/1.48s after.
  static readonly bool[] FIRST = new bool[256];
  static DotaMem() {
    foreach (var t in TAGS) { var b = Encoding.UTF8.GetBytes(t); PATS.Add(b); FIRST[b[0]] = true; }
  }

  public static long LastMs, LastBytes; public static int LastRegions, LastHits;

  /// A line and where it was. A = the anchor's address in the game,
  /// W = inside the windows as they stood when the scan began, P = in
  /// private memory (the only kind a line is ever WRITTEN to).
  /// R/RS = the region it was in and that region's size, AB = the
  /// allocation. Where a line lands is the open question, and an address
  /// alone cannot say whether two lines shared a region or a heap.
  public class Hit { public string S; public long A, R, RS, AB; public bool W, P; }

  // The windows: sorted, merged [start, end) ranges around every address
  // a line has been seen at. Replaced whole, never edited, so a scan on
  // several threads can read it without a lock.
  static long[][] Win = new long[0][];

  public static long SetWindows(IEnumerable<long> addrs, long radius) {
    var a = new List<long>(addrs); a.Sort();
    var w = new List<long[]>();
    foreach (long x in a) {
      // Page-aligned, because the region walk thinks in pages.
      long s = Math.Max(0, x - radius) & ~0xFFFL, e = (x + radius + 0xFFF) & ~0xFFFL;
      if (w.Count > 0 && s <= w[w.Count - 1][1]) { if (e > w[w.Count - 1][1]) w[w.Count - 1][1] = e; }
      else w.Add(new long[] { s, e });
    }
    Win = w.ToArray();
    long total = 0; foreach (var r in Win) total += r[1] - r[0];
    return total;
  }

  static bool InWin(long[][] win, long addr) {
    foreach (var r in win) { if (addr < r[0]) return false; if (addr < r[1]) return true; }
    return false;
  }

  static bool Readable(int protect) {
    int p = protect & 0xFF;
    return p == 0x02 || p == 0x04 || p == 0x20 || p == 0x40;
  }

  static string Extract(byte[] buf, long n, long at, int back, out bool cut) {
    // Forward to the end of the string; backwards only as far as `back`
    // asks and only over printable bytes. The first version walked back
    // to the previous null and, where there was none, dragged in whatever
    // preceded the line ("�@  [Allies] ..."). The markup form needs
    // a LITTLE look-back, because its channel tag sits before the anchor.
    long s = at;
    while (s > 0 && at - s < back && buf[s - 1] != 0 && buf[s - 1] >= 0x20) s--;
    long e = at;
    while (e < n && buf[e] != 0 && e - s < MAX_STR) e++;
    cut = (e >= n);
    if (e <= s) return null;
    try { return Encoding.UTF8.GetString(buf, (int)s, (int)(e - s)); } catch { return null; }
  }

  /// One chunk, into the CALLER's list - nothing shared, so this is safe
  /// to run on several threads at once.
  ///
  /// `whole` says the buffer begins where a region really begins. Where
  /// it does not - a later chunk, or a window cut out of the middle of a
  /// region - a hit in its first bytes has lost its look-back, and the
  /// channel tag lives in the look-back: "[Allies] " cut away leaves a
  /// line that parses perfectly well as ALL chat. Such a hit is left
  /// alone. A later chunk's first bytes are the overlap, which the chunk
  /// before saw whole; a window's are a radius away from anything that
  /// made it a window.
  static bool ScanBuffer(byte[] buf, long n, bool last, bool whole, long baseAddr,
                         long[][] win, bool priv, List<Hit> found) {
    bool any = false;
    for (long i = whole ? 0 : LOOKBACK; i < n; i++) {
      if (!FIRST[buf[i]]) continue;
      for (int k = 0; k < PATS.Count; k++) {
        byte[] p = PATS[k];
        int pl = p.Length;
        if (buf[i] != p[0] || i + pl > n) continue;
        bool okp = true;
        for (int j = 1; j < pl; j++) if (buf[i + j] != p[j]) { okp = false; break; }
        if (!okp) continue;
        bool cut;
        string s = Extract(buf, n, i, LOOKBACK, out cut);
        // A string running to the end of a chunk is not whole. The next
        // chunk overlaps far enough to hold it entire, so it is left to
        // that one rather than emitted truncated - a truncated line can
        // still PARSE, which would put half a sentence on the overlay.
        if (s != null && (last || !cut)) {
          long a = baseAddr + i;
          found.Add(new Hit { S = s, A = a, W = InWin(win, a), P = priv });
          any = true;
        }
        break;      // one anchor per position is enough
      }
    }
    return any;
  }

  /// Scan. `only` null reads everything; otherwise only the regions
  /// belonging to those ALLOCATIONS are read, and an empty set therefore
  /// reads nothing at all. (The filter used to be `only.Count > 0`, so an
  /// empty set fell through to reading all 4 GB - a "quick" scan costing
  /// exactly as much as a full one.)
  ///
  /// ALLOCATIONS, not regions, and that is the whole point. MEASURED in a
  /// live match: a new chat line does NOT land in the region the last
  /// sweep found one in - over 95 polls of the hot regions, not one new
  /// line appeared, and both times chat turned up it was a full sweep
  /// that found it. The heap RESERVATION is stable where the region is
  /// not, and the two holding chat came to 336 MB of a 4,527 MB process:
  /// 7.4%, about half a second to read.
  ///
  /// Returns the lines found; fills the Last* counters.
  /// `hot` receives the allocation bases that produced a hit.
  /// `windowed` reads only the parts of those regions inside the windows.
  public static List<Hit> Scan(int pid, HashSet<long> only, HashSet<long> hot, bool windowed, int threadsWanted) {
    var found = new List<Hit>();
    long[][] win = Win;       // one snapshot for the whole scan
    LastMs = 0; LastBytes = 0; LastRegions = 0; LastHits = 0;
    var sw = System.Diagnostics.Stopwatch.StartNew();

    IntPtr h = OpenProcess(VM_READ | QUERY, false, pid);
    if (h == IntPtr.Zero) throw new Exception("OpenProcess failed: " + Marshal.GetLastWin32Error());

    // Two phases. The WALK is cheap and strictly sequential (each
    // VirtualQueryEx asks about the address after the last region); the
    // READING is where all the time goes, and is done on several threads.
    // It is memory bandwidth as much as processor: 410 MB took 1.0s on
    // one thread, and a poll that eats a core is a poll that costs frames
    // in the game it is reading.
    // {base, size, allocationBase, isPrivate, startsRegion, endsRegion, regionBase, regionSize}
    var work = new List<long[]>();
    long addr = 0, stopAt = long.MaxValue;
    if (windowed) {
      // Nothing outside the windows will be read, so nothing outside
      // them need be asked about either.
      if (win.Length == 0) { LastMs = 0; CloseHandle(h); return found; }
      addr = win[0][0]; stopAt = win[win.Length - 1][1];
    }
    try {
      while (addr < stopAt) {
        MBI m;
        if (VirtualQueryEx(h, (IntPtr)addr, out m, Marshal.SizeOf(typeof(MBI))) == 0) break;
        long size = (long)m.RegionSize, bas = (long)m.BaseAddress, ab = (long)m.AllocationBase;
        if (size <= 0) break;

        bool want = m.State == COMMIT && Readable(m.Protect);
        if (want && only != null && (!only.Contains(ab) || (!windowed && POLL_MAX_REGION > 0 && size > POLL_MAX_REGION))) want = false;
        long priv = m.Type == PRIVATE ? 1 : 0;
        if (want && !windowed) work.Add(new long[] { bas, size, ab, priv, 1, 1, bas, size });
        if (want && windowed) {
          // Asking about an address in the MIDDLE of a region answers
          // from that page on, so `bas` is only known to start a region
          // when it is not where a window made us begin.
          long end = bas + size;
          foreach (var r in win) {
            if (r[1] <= bas) continue;
            if (r[0] >= end) break;
            long s = Math.Max(bas, r[0]), e = Math.Min(end, r[1]);
            work.Add(new long[] { s, e - s, ab, priv, (s == bas && bas != win[0][0]) ? 1 : 0, e == end ? 1 : 0, bas, size });
          }
        }

        long next = bas + size;
        if (next <= addr) break;
        addr = next;
      }

      LastRegions = work.Count;
      long bytes = 0, hits = 0;
      var gate = new object();
      int threads = Math.Max(1, Math.Min(Math.Min(4, threadsWanted), Environment.ProcessorCount - 1));

      Parallel.For<byte[]>(0, work.Count,
        new ParallelOptions { MaxDegreeOfParallelism = threads },
        () => new byte[CHUNK],                       // one buffer per worker
        (i, state, buf) => {
          long bas = work[i][0], size = work[i][1], ab = work[i][2];
          bool priv = work[i][3] == 1, starts = work[i][4] == 1, ends = work[i][5] == 1;
          var mine = new List<Hit>();
          bool any = false;
          long read = 0;
          for (long off = 0; off < size; off += CHUNK - OVERLAP) {
            long ask = Math.Min((long)CHUNK, size - off);
            IntPtr got;
            if (!ReadProcessMemory(h, (IntPtr)(bas + off), buf, (IntPtr)ask, out got)) break;
            long n = (long)got;
            if (n <= 0) break;
            read += n;
            // A string running off the end is only whole if that end is
            // the region's; a window's end is just where we stopped.
            bool last = ends && off + ask >= size;
            int had = mine.Count;
            if (ScanBuffer(buf, n, last, starts && off == 0, bas + off, win, priv, mine)) any = true;
            for (int q = had; q < mine.Count; q++) { mine[q].R = work[i][6]; mine[q].RS = work[i][7]; mine[q].AB = ab; }
            if (n < ask) break;          // short read: the rest is not there
          }
          lock (gate) {
            bytes += read;
            if (mine.Count > 0) { found.AddRange(mine); hits += mine.Count; }
            // A line is WRITTEN, so it can only be in private memory. An
            // image's is static - the one thing the anchor matches there
            // is Panorama's own template,
            // `<span class="ChatPersona">%s</span>`, and making its 29 MB
            // resource region hot would have every poll read a quarter of
            // a gigabyte of module for nothing.
            if (any && hot != null && work[i][3] == 1) hot.Add(ab);
          }
          return buf;
        },
        buf => { });

      LastBytes = bytes; LastHits = (int)hits;
    } finally { CloseHandle(h); }

    sw.Stop(); LastMs = sw.ElapsedMilliseconds;
    return found;
  }

  // ---------------------------------------------------------------------
  // THE CHAT PANEL: read the chat's own container, not the process.
  //
  // MEASURED on the live game with tools/ptrscan.ps1 (see CLAUDE.md): the
  // HUD's chat is a Panorama UI panel whose id is "ChatLinesPanel". Its
  // children are the lines, in the order they were said - team and all
  // chat alike - and each line's text is three pointers away:
  //
  //   panel  +0x10 -> id string   +0x18 -> parent   +0x28 count   +0x30 -> children
  //   child  +0x08 -> client panel  +0x90 -> text object  +0x10 -> the line
  //
  // A poll is the panel's header, 8 bytes per line and three small reads
  // per line: a few KB, against the 340-490 MB a windowed poll had grown
  // to. These offsets are the fragile part, so nothing here is trusted:
  // a panel must have the right id, a parent and children that begin
  // with the same 8 bytes (the vtable) it does, and a line must parse.
  // When that stops being true the panel is dropped and the scanner
  // above, which knows no offsets at all, takes over again.
  public static int UI_CLIENT = 0x08, UI_ID = 0x10, UI_PARENT = 0x18, UI_COUNT = 0x28, UI_KIDS = 0x30;
  public static int CLIENT_TEXT = 0x90, TEXT_STR = 0x10;
  const int MAX_KIDS = 4096, LINE_MAX = 2048, GIVE_UP = 8;
  static readonly byte[] PANEL_ID = Encoding.UTF8.GetBytes("ChatLinesPanel\0");
  static readonly byte[] PERSONA = Encoding.UTF8.GetBytes("class=\"ChatPersona\"");

  public static List<long> Panels = new List<long>();
  /// Each panel and how many children it had at the last read, as
  /// "0xADDR:16 0xADDR:7" - for the log, where two panels and a count that
  /// jumps are otherwise one number that makes no sense.
  public static string PanelCounts = "";
  // child panel -> the string it showed when last read. A panel that is
  // given another line, or an address that is handed to a new panel,
  // shows up as a different string pointer.
  static Dictionary<long, long> LastStr = new Dictionary<long, long>();
  static Dictionary<long, int> Tries = new Dictionary<long, int>();

  /// True once there is a panel that belongs to a MATCH: one under the
  /// root called DotaHud, or one with anything in it. MEASURED: there are
  /// four ChatLinesPanels - the HUD's, the hero pick's (both under
  /// DotaHud), the loading screen's and the dashboard's - and the last two
  /// exist in the menu, where finding them would otherwise satisfy the
  /// reader for good and the match's own panel, made later, would never be
  /// looked for. Until this is true the caller keeps looking.
  public static bool Settled = false;
  static HashSet<long> InMatch = new HashSet<long>();
  static readonly byte[] HUD_ROOT = Encoding.UTF8.GetBytes("DotaHud\0");

  public static void ForgetPanels() { Panels.Clear(); LastStr.Clear(); Tries.Clear(); InMatch.Clear(); Settled = false; }

  static bool UnderHud(IntPtr h, long p) {
    var q = new byte[8]; var id = new byte[HUD_ROOT.Length];
    for (int depth = 0; depth < 64; depth++) {
      long parent = RQ(h, p + UI_PARENT, q);
      if (parent == 0) break;
      p = parent;
    }
    if (!Rd(h, RQ(h, p + UI_ID, q), id, id.Length)) return false;
    for (int i = 0; i < id.Length; i++) if (id[i] != HUD_ROOT[i]) return false;
    return true;
  }

  static bool Rd(IntPtr h, long addr, byte[] buf, int len) {
    IntPtr got;
    return addr > 0x10000 && ReadProcessMemory(h, (IntPtr)addr, buf, (IntPtr)len, out got) && (long)got == len;
  }
  static long RQ(IntPtr h, long addr, byte[] q) { return Rd(h, addr, q, 8) ? BitConverter.ToInt64(q, 0) : 0; }

  static bool Valid(IntPtr h, long p, out int count, out long kids) {
    count = 0; kids = 0;
    var b = new byte[0x40]; var q = new byte[8];
    if (!Rd(h, p, b, b.Length)) return false;
    long vt = BitConverter.ToInt64(b, 0), parent = BitConverter.ToInt64(b, UI_PARENT);
    count = BitConverter.ToInt32(b, UI_COUNT); kids = BitConverter.ToInt64(b, UI_KIDS);
    if (vt == 0 || parent == 0 || count < 0 || count > MAX_KIDS) return false;
    var id = new byte[PANEL_ID.Length];
    if (!Rd(h, BitConverter.ToInt64(b, UI_ID), id, id.Length)) return false;
    for (int i = 0; i < id.Length; i++) if (id[i] != PANEL_ID[i]) return false;
    if (RQ(h, parent, q) != vt) return false;
    if (count > 0 && RQ(h, RQ(h, kids, q), q) != vt) return false;
    return true;
  }

  delegate void Visit(byte[] buf, long n, long baseAddr);

  static long SweepPrivate(IntPtr h, int threadsWanted, Visit visit) {
    var work = new List<long[]>();
    long addr = 0;
    while (true) {
      MBI m;
      if (VirtualQueryEx(h, (IntPtr)addr, out m, Marshal.SizeOf(typeof(MBI))) == 0) break;
      long size = (long)m.RegionSize, bas = (long)m.BaseAddress;
      if (size <= 0) break;
      if (m.State == COMMIT && Readable(m.Protect) && m.Type == PRIVATE) work.Add(new long[] { bas, size });
      long next = bas + size;
      if (next <= addr) break;
      addr = next;
    }
    long bytes = 0; var gate = new object();
    int threads = Math.Max(1, Math.Min(Math.Min(4, threadsWanted), Environment.ProcessorCount - 1));
    Parallel.For<byte[]>(0, work.Count, new ParallelOptions { MaxDegreeOfParallelism = threads },
      () => new byte[CHUNK],
      (i, state, buf) => {
        long read = 0;
        // CHUNK - OVERLAP is a multiple of 8, so an aligned word stays
        // aligned in every chunk.
        for (long off = 0; off < work[i][1]; off += CHUNK - OVERLAP) {
          long ask = Math.Min((long)CHUNK, work[i][1] - off);
          IntPtr got;
          if (!ReadProcessMemory(h, (IntPtr)(work[i][0] + off), buf, (IntPtr)ask, out got)) break;
          long n = (long)got; if (n <= 0) break;
          read += n;
          visit(buf, n, work[i][0] + off);
          if (n < ask) break;
        }
        lock (gate) bytes += read;
        return buf;
      },
      buf => { });
    return bytes;
  }

  /// Find the chat panel: the id string, then what points at it. Two
  /// sweeps of private memory, ONCE - not per poll. Needs no chat to
  /// have been said, and no address or module offset from a past run.
  public static int FindPanels(int pid, int threadsWanted) {
    var sw = System.Diagnostics.Stopwatch.StartNew();
    ForgetPanels(); LastBytes = 0; LastRegions = 0; LastHits = 0;
    IntPtr h = OpenProcess(VM_READ | QUERY, false, pid);
    if (h == IntPtr.Zero) throw new Exception("OpenProcess failed: " + Marshal.GetLastWin32Error());
    try {
      var ids = new HashSet<long>(); var gate = new object();
      long bytes = SweepPrivate(h, threadsWanted, (buf, n, bas) => {
        int pl = PANEL_ID.Length;
        for (long i = 0; i + pl <= n; i++) {
          if (buf[i] != PANEL_ID[0]) continue;
          bool ok = true;
          for (int j = 1; j < pl; j++) if (buf[i + j] != PANEL_ID[j]) { ok = false; break; }
          if (ok) lock (gate) ids.Add(bas + i);
        }
      });
      if (ids.Count > 0) {
        var t = new long[ids.Count]; ids.CopyTo(t); Array.Sort(t);
        long lo = t[0], hi = t[t.Length - 1];
        var cands = new HashSet<long>();
        bytes += SweepPrivate(h, threadsWanted, (buf, n, bas) => {
          for (long i = 0; i + 8 <= n; i += 8) {
            if (buf[i + 7] != 0 || buf[i + 6] != 0) continue;     // not a user-mode address
            long v = BitConverter.ToInt64(buf, (int)i);
            if (v < lo || v > hi || Array.BinarySearch(t, v) < 0) continue;
            lock (gate) cands.Add(bas + i - UI_ID);
          }
        });
        foreach (long c in cands) {
          int count; long kids;
          if (!Valid(h, c, out count, out kids)) continue;
          Panels.Add(c);
          if (UnderHud(h, c)) InMatch.Add(c);
        }
      }
      LastBytes = bytes;
    } finally { CloseHandle(h); }
    sw.Stop(); LastMs = sw.ElapsedMilliseconds;
    return Panels.Count;
  }

  /// One poll of the panels. A panel that no longer validates is dropped;
  /// the caller sees Panels.Count fall to zero and goes back to scanning.
  public static List<Hit> ReadPanels(int pid) {
    var found = new List<Hit>();
    var sw = System.Diagnostics.Stopwatch.StartNew();
    LastBytes = 0; LastRegions = 0; LastHits = 0;
    IntPtr h = OpenProcess(VM_READ | QUERY, false, pid);
    if (h == IntPtr.Zero) throw new Exception("OpenProcess failed: " + Marshal.GetLastWin32Error());
    try {
      var q = new byte[8]; var line = new byte[LINE_MAX];
      var live = new HashSet<long>();
      long bytes = 0; string counts = ""; bool settled = false;
      for (int pi = Panels.Count - 1; pi >= 0; pi--) {
        int count; long kids;
        if (!Valid(h, Panels[pi], out count, out kids)) { InMatch.Remove(Panels[pi]); Panels.RemoveAt(pi); continue; }
        if (count > 0 || InMatch.Contains(Panels[pi])) settled = true;
        bytes += 0x40 + 32;
        LastRegions += count;
        counts = "0x" + Panels[pi].ToString("x") + ":" + count + (counts.Length > 0 ? " " : "") + counts;
        if (count == 0) continue;
        var arr = new byte[count * 8];
        if (!Rd(h, kids, arr, arr.Length)) continue;        // the array moved under us: next poll
        bytes += arr.Length;
        for (int k = 0; k < count; k++) {
          long c = BitConverter.ToInt64(arr, k * 8);
          live.Add(c);
          long str = RQ(h, RQ(h, RQ(h, c + UI_CLIENT, q) + CLIENT_TEXT, q) + TEXT_STR, q);
          bytes += 24;
          long was;
          if (str == 0 || (LastStr.TryGetValue(c, out was) && was == str)) continue;

          // To the end of the page if 2 KB runs off readable memory.
          int n = LINE_MAX;
          if (!Rd(h, str, line, n)) { n = (int)(4096 - (str & 0xFFF)); if (n > LINE_MAX || !Rd(h, str, line, n)) n = 0; }
          bytes += n;
          int len = 0; while (len < n && line[len] != 0) len++;
          int at = -1;
          for (int i = 0; len < n && i + PERSONA.Length <= len && at < 0; i++) {
            if (line[i] != PERSONA[0]) continue;
            bool ok = true;
            for (int j = 1; j < PERSONA.Length; j++) if (line[i + j] != PERSONA[j]) { ok = false; break; }
            if (ok) at = i;
          }
          bool cut; string s = at < 0 ? null : Extract(line, len, at, LOOKBACK, out cut);
          if (s == null) {
            // Not a chat line, or a line whose text is not there YET. Asked
            // again a few times, then left alone until its string changes.
            int tries; Tries.TryGetValue(c, out tries); Tries[c] = ++tries;
            if (tries >= GIVE_UP) { LastStr[c] = str; Tries.Remove(c); }
            continue;
          }
          found.Add(new Hit { S = s, A = str, W = true, P = true });
          LastStr[c] = str; Tries.Remove(c);
        }
      }
      // An address is reused: a panel that has gone must be forgotten, or
      // the line that gets its address next is taken for the old one.
      if (Panels.Count > 0) {
        var gone = new List<long>();
        foreach (long c in LastStr.Keys) if (!live.Contains(c)) gone.Add(c);
        foreach (long c in gone) { LastStr.Remove(c); Tries.Remove(c); }
      }
      LastBytes = bytes; LastHits = found.Count; PanelCounts = counts; Settled = settled;
    } finally { CloseHandle(h); }
    sw.Stop(); LastMs = sw.ElapsedMilliseconds;
    return found;
  }
}
"@

[DotaMem]::POLL_MAX_REGION = [long]$WideCapMb * 1MB

function Emit($obj) {
  # -Compress keeps it to one line, which is what the reader splits on.
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 4))
  [Console]::Out.Flush()
}

$hot = New-Object 'System.Collections.Generic.HashSet[long]'
# Every address a line has been seen at since the last full sweep. The
# windows are rebuilt from this, so they follow the chat as it moves.
$addrs = New-Object 'System.Collections.Generic.HashSet[long]'
$winBytes = 0
$polls = 0
$lastFull = [DateTime]::MinValue
$lastPid = 0

# How long to wait before sweeping the whole process AGAIN when the last
# sweep found no chat at all. There is plenty of time with nothing to
# find: the menu, the loading screen, a match where nobody has spoken
# yet. The rule was "sweep until something is found", which ran those
# sweeps back to back for as long as that lasted - a core busy for as
# long as the player sits in the menu. Doubling from one second to ten
# still picks the first line up within seconds of it being said.
$idleWaitMs = 0
$IDLE_WAIT_MAX = 10000
# Whether the reader has already been told we are looking. Said ONCE per
# spell, not per sweep: the overlay draws a status over the game, and a
# match where nobody has spoken yet would otherwise repeat it every few
# seconds until somebody does.
$announcedSearch = $false
# The same, for the chat panel: when to look for it again, and whether
# the reader has been told we are looking.
$panelRetryAt = [DateTime]::MinValue
$panelWaitMs = 0
$panelFirst = $false
$panelStatAt = [DateTime]::MinValue
$announcedPanel = $false

Emit @{ t = 'status'; state = 'waiting'; detail = 'looking for Dota' }

while ($true) {
  if (ParentGone) { exit 0 }
  $proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $proc) {
    if ($lastPid -ne 0) {
      # Dota closed: the addresses we learned mean nothing for the next one.
      [DotaMem]::ForgetPanels(); $panelRetryAt = [DateTime]::MinValue; $panelWaitMs = 0; $announcedPanel = $false; $hot.Clear(); $addrs.Clear(); $winBytes = [DotaMem]::SetWindows($addrs, 0); $lastPid = 0; $lastFull = [DateTime]::MinValue; $idleWaitMs = 0; $announcedSearch = $false
      Emit @{ t = 'status'; state = 'waiting'; detail = 'Dota closed' }
    }
    Start-Sleep -Milliseconds 2000
    continue
  }

  if ($proc.Id -ne $lastPid) {
    [DotaMem]::ForgetPanels(); $panelRetryAt = [DateTime]::MinValue; $panelWaitMs = 0; $announcedPanel = $false; $hot.Clear(); $addrs.Clear(); $winBytes = [DotaMem]::SetWindows($addrs, 0); $lastFull = [DateTime]::MinValue; $idleWaitMs = 0; $announcedSearch = $false
    $lastPid = $proc.Id
    Emit @{ t = 'status'; state = 'reading'; pid = $proc.Id; detail = 'attached' }
  }

  # The panel first. While there is one, NOTHING else runs: no sweeps, no
  # windows, only the panel's own few KB. Looking for it costs two sweeps
  # of private memory, so a miss (the menu, a loading screen) is asked
  # again on a backoff, 15s to 2 minutes, and the scanner below carries
  # on meanwhile exactly as it did before there was a panel reader.
  if ($Panel -gt 0) {
    try {
      # No panel, or none that belongs to a match yet: look (again).
      if (([DotaMem]::Panels.Count -eq 0 -or -not [DotaMem]::Settled) -and [DateTime]::UtcNow -ge $panelRetryAt) {
        if (-not $announcedPanel) { $announcedPanel = $true; Emit @{ t = 'status'; state = 'scanning'; pid = $proc.Id; detail = 'looking for the chat panel' } }
        $n = [DotaMem]::FindPanels($proc.Id, $SweepThreads)
        Emit @{ t = 'find'; panels = $n; ms = [DotaMem]::LastMs; mb = [int]([DotaMem]::LastBytes / 1MB) }
        if ($n -gt 0) {
          # Found, but perhaps only the menu's: asked again in a while
          # unless the first read says one of them is a match's.
          $panelRetryAt = [DateTime]::UtcNow.AddMilliseconds($PanelRefindMs)
          $panelWaitMs = 0; $panelFirst = $true; $announcedPanel = $false
          Emit @{ t = 'status'; state = 'reading'; pid = $proc.Id; detail = 'found the chat panel' }
        } else {
          $panelWaitMs = [Math]::Min([Math]::Max(15000, $panelWaitMs * 2), 120000)
          $panelRetryAt = [DateTime]::UtcNow.AddMilliseconds($panelWaitMs)
        }
      }
      if ([DotaMem]::Panels.Count -gt 0) {
        $lines = [DotaMem]::ReadPanels($proc.Id)
        foreach ($h in $lines) {
          $b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($h.S))
          Emit @{ t = 'line'; b64 = $b64; a = $h.A; w = 1; r = 0; rs = 0; ab = 0; p = 1 }
        }
        # A stat per poll would be four a second saying nothing. One after
        # the first read (it is what tells the reader the backlog is over),
        # one whenever a line turned up, and one every ten seconds.
        if ($panelFirst -or $lines.Count -gt 0 -or ([DateTime]::UtcNow - $panelStatAt).TotalMilliseconds -gt 10000) {
          $panelFirst = $false; $panelStatAt = [DateTime]::UtcNow
          Emit @{
            t = 'stat'; full = $false; mode = 'panel'; winMb = 0; ms = [DotaMem]::LastMs; mb = 0
            kb = [Math]::Round([DotaMem]::LastBytes / 1KB, 1); regions = [DotaMem]::LastRegions
            hits = [DotaMem]::LastHits; hot = 0; panels = [DotaMem]::PanelCounts
          }
        }
        if ([DotaMem]::Panels.Count -gt 0) { Start-Sleep -Milliseconds $PanelIntervalMs; continue }
        # The panel has gone (the match ended, or the layout is not what it
        # was). Look again at once, and scan in the meantime.
        $panelRetryAt = [DateTime]::UtcNow; $lastFull = [DateTime]::MinValue
        Emit @{ t = 'status'; state = 'scanning'; pid = $proc.Id; detail = 'the chat panel went away' }
      }
    } catch {
      Emit @{ t = 'error'; detail = $_.Exception.Message }
      Start-Sleep -Milliseconds 1000
      continue
    }
  }

  # A full sweep finds where chat lives; after that only those regions are
  # read, which is the difference between seconds and a poll you can run
  # every second. Redone periodically because the game allocates as it
  # runs, and - while we still have nowhere to look - on the backoff
  # above. MEASURED: a sweep costs about 1.5s per gigabyte.
  $waitMs = if ($hot.Count -eq 0) { $idleWaitMs } else { $FullRescanMs }
  $full = ([DateTime]::UtcNow - $lastFull).TotalMilliseconds -gt $waitMs

  # Only a sweep that is looking for the chat is ANNOUNCED. The periodic
  # one is upkeep, and the overlay draws a status line over the game for
  # eight seconds: "Finding the chat in memory..." once a minute in the
  # middle of a match reads as the tool having lost it.
  $searching = $full -and ($hot.Count -eq 0)
  if ($searching -and -not $announcedSearch) {
    $announcedSearch = $true
    Emit @{ t = 'status'; state = 'scanning'; pid = $proc.Id; detail = 'full sweep' }
  }

  # With nowhere to look and no sweep due, there is nothing to do: reading
  # no regions would find no lines. Skipped rather than run, so the reader
  # is not handed a stat every second saying nothing happened.
  if (-not $full -and $hot.Count -eq 0) {
    Start-Sleep -Milliseconds $IntervalMs
    continue
  }

  try {
    # Which kind of scan. A poll is windowed unless windows are off, there
    # are none yet, or it is this one's turn to be wide.
    if ($full) { $mode = 'full'; $polls = 0 }
    else {
      $polls++
      $mode = if ($WindowMb -le 0 -or $winBytes -le 0 -or ($polls % $WideEvery) -eq 0) { 'wide' } else { 'win' }
    }
    $only = if ($full) { $null } else { $hot }
    $threads = if ($full) { $SweepThreads } else { $PollThreads }
    $fresh = New-Object 'System.Collections.Generic.HashSet[long]'
    $lines = [DotaMem]::Scan($proc.Id, $only, $fresh, ($mode -eq 'win'), $threads)

    if ($full) {
      $hot.Clear()
      $addrs.Clear()
      $lastFull = [DateTime]::UtcNow
    }
    foreach ($b in $fresh) { [void]$hot.Add($b) }
    # A freed or half-overwritten line counts here although chatmem will
    # throw it away: it still marks a place chat is written to.
    $grew = $full
    foreach ($h in $lines) { if ($h.P -and $addrs.Add($h.A)) { $grew = $true } }
    if ($grew) { $winBytes = [DotaMem]::SetWindows($addrs, [long]$WindowMb * 1MB) }
    # A hot region that stops producing is dropped at the next full sweep,
    # so this cannot grow into the whole address space.

    if ($full) {
      if ($hot.Count -eq 0) {
        if ($idleWaitMs -eq 0) { $idleWaitMs = 1000 }
        else { $idleWaitMs = [Math]::Min($idleWaitMs * 2, $IDLE_WAIT_MAX) }
      } else {
        $idleWaitMs = 0
        # The last thing said was that we were looking for the chat, and
        # that has stopped being true.
        if ($announcedSearch) { Emit @{ t = 'status'; state = 'reading'; pid = $proc.Id; detail = 'found chat' } }
        $announcedSearch = $false
      }
    }

    # Base64, not the text itself. A Cyrillic line written straight to
    # stdout comes back as mojibake ("ðøÐâð©ðÀð░" for "Луиза") whenever
    # the console codepage is not UTF-8, which depends on the machine and
    # on how the process was spawned. Base64 is ASCII and cannot be
    # re-encoded on the way out; the reader decodes it as UTF-8.
    foreach ($h in $lines) {
      $b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($h.S))
      Emit @{ t = 'line'; b64 = $b64; a = $h.A; w = [int]$h.W; r = $h.R; rs = $h.RS; ab = $h.AB; p = [int]$h.P }
    }

    Emit @{
      t = 'stat'; full = $full; mode = $mode; winMb = [int]($winBytes / 1MB); ms = [DotaMem]::LastMs;
      mb = [int]([DotaMem]::LastBytes / 1MB); regions = [DotaMem]::LastRegions;
      hits = [DotaMem]::LastHits; hot = $hot.Count
    }
  } catch {
    # A process that exited mid-scan is ordinary, not an error worth
    # shouting about; the next turn of the loop notices it is gone.
    Emit @{ t = 'error'; detail = $_.Exception.Message }
    Start-Sleep -Milliseconds 1000
  }

  Start-Sleep -Milliseconds $IntervalMs
}
