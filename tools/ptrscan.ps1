# The chat CONTAINER hunt: what POINTS at a chat line, and what points at
# that, level by level, until something stable turns up.
#
#   powershell -ExecutionPolicy Bypass -File tools/ptrscan.ps1 [-ProcessName dota2] [-Levels 3]
#   ... -Targets 0x1234,0x5678 -Slack 0x400     start from addresses, not strings
#   ... -Dump 0x1234 -DumpLen 0x200             annotated qwords at one address
#
# Level 1 finds every chat line (the Panorama markup anchor) and then
# every aligned 8-byte value in the process that points INSIDE one. A
# holder is a field of some object, and what points at an object points
# at its start, so level 2 is every exact pointer to where the object
# holding a level-1 pointer might start - see Candidates - and so on up.
# Rows go to ptrscan.log as JSON, one per line, each with the bytes
# around it taken in the SAME read, so they agree with it.
# tools/ptrview.mjs reads that file.
#
# What to look for: one class @ offset again and again at a level (a
# field of one kind of object), an ARRAY START and the class that holds
# it, and anything held in a module's own data (a root).
#
# Nothing is written to the game: PROCESS_VM_READ | QUERY, as memscan.
# THIS IS HEAVY: every level reads the whole process once. Bot match
# only, with the player's say-so.

param(
  [string]$ProcessName = 'dota2',
  [int]$ProcId = 0,
  [string]$Out = 'ptrscan.log',
  [int]$Levels = 3,
  # How far before the ANCHOR a pointer may point and still count. The
  # anchor is mid-string: the portrait and the channel tag come first.
  [long]$Slack1 = 0x200,
  # Only for -Targets: how far below each address a pointer may point.
  [long]$Slack = 0,
  [string]$Targets = '',
  [string]$Dump = '',
  [int]$DumpLen = 0x200,
  # UI panels to print the ancestors of (comma-separated addresses).
  [string]$Parents = '',
  # Only strings matching this become level-1 targets ('' = all of them).
  [string]$Match = '',
  [int]$MaxTargets = 4000,
  [int]$MaxRows = 20000,
  [int]$Threads = 2,
  [string]$Priority = 'BelowNormal'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try { [System.Diagnostics.Process]::GetCurrentProcess().PriorityClass = $Priority } catch { }

Add-Type @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;

public static class PtrScan {
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

  const int VM_READ = 0x0010, QUERY = 0x0400, COMMIT = 0x1000, PRIVATE = 0x20000, IMAGE = 0x1000000;
  const int CHUNK = 16 * 1024 * 1024;
  const int OVERLAP = 16384;
  const int STEP = CHUNK - OVERLAP;       // a multiple of 8, so alignment survives a seam
  const int BACK = 4096, FWD = 4096;      // how far a string may run either side of its anchor
  // Before, mostly: an object's start and an array's start are both
  // BEHIND the word that was found.
  const int CTX_BEFORE = 0x400, CTX_AFTER = 0x100;
  static readonly byte[] ANCHOR = Encoding.UTF8.GetBytes("class=\"ChatPersona\"");

  public class Region { public long Base, Size, AB; public int Type; }
  public class Str { public long Start, Anchor, R, RS, AB; public bool Open; public string Text; public byte[] Raw; }
  public class Ptr { public long Holder, Value, Target, R, RS, AB, CtxBase; public int Type; public byte[] Ctx; }

  static IntPtr H = IntPtr.Zero;
  public static long LastMs, LastBytes;
  static string[] ModName = new string[0]; static long[] ModBase = new long[0], ModSize = new long[0];

  public static void Open(int pid) {
    H = OpenProcess(VM_READ | QUERY, false, pid);
    if (H == IntPtr.Zero) throw new Exception("OpenProcess failed: " + Marshal.GetLastWin32Error());
  }
  public static void Close() { if (H != IntPtr.Zero) CloseHandle(H); H = IntPtr.Zero; }

  public static void SetModules(string[] names, long[] bases, long[] sizes) { ModName = names; ModBase = bases; ModSize = sizes; }

  /// "client.dll+0x1234" for an address inside a loaded module, else null.
  /// A module offset is the one thing here that is the same on the next
  /// run: it names a vtable, and so a class, across restarts.
  public static string Module(long a) {
    for (int i = 0; i < ModBase.Length; i++)
      if (a >= ModBase[i] && a < ModBase[i] + ModSize[i]) return ModName[i] + "+0x" + (a - ModBase[i]).ToString("x");
    return null;
  }

  static bool Readable(int protect) {
    if ((protect & 0x100) != 0) return false;      // a guard page: reading it trips it
    int p = protect & 0xFF;
    return p == 0x02 || p == 0x04 || p == 0x08 || p == 0x20 || p == 0x40 || p == 0x80;
  }

  public static List<Region> Walk() {
    var list = new List<Region>();
    long addr = 0;
    while (true) {
      MBI m;
      if (VirtualQueryEx(H, (IntPtr)addr, out m, Marshal.SizeOf(typeof(MBI))) == 0) break;
      long size = (long)m.RegionSize, bas = (long)m.BaseAddress;
      if (size <= 0) break;
      if (m.State == COMMIT && Readable(m.Protect)) list.Add(new Region { Base = bas, Size = size, AB = (long)m.AllocationBase, Type = m.Type });
      long next = bas + size;
      if (next <= addr) break;
      addr = next;
    }
    return list;
  }

  delegate void Visit(byte[] buf, long n, long baseAddr, bool first, bool last, Region r);

  static void Sweep(List<Region> regions, int threads, Visit visit) {
    var sw = System.Diagnostics.Stopwatch.StartNew();
    long bytes = 0; var gate = new object();
    Parallel.For<byte[]>(0, regions.Count,
      new ParallelOptions { MaxDegreeOfParallelism = Math.Max(1, Math.Min(4, threads)) },
      () => new byte[CHUNK],
      (i, state, buf) => {
        Region r = regions[i]; long read = 0;
        for (long off = 0; off < r.Size; off += STEP) {
          long ask = Math.Min((long)CHUNK, r.Size - off);
          IntPtr got;
          if (!ReadProcessMemory(H, (IntPtr)(r.Base + off), buf, (IntPtr)ask, out got)) break;
          long n = (long)got; if (n <= 0) break;
          read += n;
          bool last = off + ask >= r.Size;
          visit(buf, n, r.Base + off, off == 0, last, r);
          if (n < ask || last) break;
        }
        lock (gate) bytes += read;
        return buf;
      },
      buf => { });
    sw.Stop(); LastMs = sw.ElapsedMilliseconds; LastBytes = bytes;
  }

  /// Every chat line in private memory, by the markup anchor, with the
  /// address its STRING starts at. Open = no null was found going back,
  /// so the start is a guess.
  public static List<Str> FindStrings(int threads) {
    var found = new Dictionary<long, Str>(); var gate = new object();
    var regions = Walk().FindAll(r => r.Type == PRIVATE);
    Sweep(regions, threads, (buf, n, baseAddr, first, last, r) => {
      byte a0 = ANCHOR[0]; int al = ANCHOR.Length;
      // A hit in a later chunk's first bytes has lost its beginning; the
      // chunk before saw it whole, in the overlap.
      for (long i = first ? 0 : BACK; i + al <= n; i++) {
        if (buf[i] != a0) continue;
        bool ok = true;
        for (int j = 1; j < al; j++) if (buf[i + j] != ANCHOR[j]) { ok = false; break; }
        if (!ok) continue;
        long s = i; while (s > 0 && buf[s - 1] != 0 && i - s < BACK) s--;
        bool open = (s > 0 && buf[s - 1] != 0) || (s == 0 && !first);
        long e = i; while (e < n && buf[e] != 0 && e - i < FWD) e++;
        if (e >= n && !last) continue;               // runs off the chunk: the next one has it
        string text;
        try { text = Encoding.UTF8.GetString(buf, (int)s, (int)(e - s)); } catch { continue; }
        var raw = new byte[e - s]; Array.Copy(buf, s, raw, 0, e - s);
        var str = new Str { Start = baseAddr + s, Anchor = baseAddr + i, R = r.Base, RS = r.Size, AB = r.AB, Open = open, Text = text, Raw = raw };
        lock (gate) found[str.Anchor] = str;
      }
    });
    var list = new List<Str>(found.Values);
    list.Sort((x, y) => x.Start.CompareTo(y.Start));
    return list;
  }

  /// Every aligned 8-byte value v with target - slack <= v <= target for
  /// some target. `targets` must be sorted.
  public static List<Ptr> FindPointers(long[] targets, long slack, int threads, int maxRows) {
    var found = new List<Ptr>(); var gate = new object();
    if (targets.Length == 0) return found;
    long lo = targets[0] - slack, hi = targets[targets.Length - 1];
    Sweep(Walk(), threads, (buf, n, baseAddr, first, last, r) => {
      // Each position belongs to exactly one chunk, and away from a
      // chunk's first bytes so that the context before it is there.
      long from = first ? 0 : CTX_BEFORE, to = Math.Min(n - 7, last ? n : STEP + CTX_BEFORE);
      for (long i = from; i < to; i += 8) {
        if (buf[i + 7] != 0 || buf[i + 6] != 0) continue;      // not a user-mode address
        long v = (long)buf[i] | ((long)buf[i + 1] << 8) | ((long)buf[i + 2] << 16) | ((long)buf[i + 3] << 24) |
                 ((long)buf[i + 4] << 32) | ((long)buf[i + 5] << 40);
        if (v < lo || v > hi) continue;
        int k = Array.BinarySearch(targets, v); if (k < 0) k = ~k;
        if (k >= targets.Length || targets[k] - v > slack) continue;
        long cs = Math.Max(0, i - CTX_BEFORE), ce = Math.Min(n, i + CTX_AFTER);
        var ctx = new byte[ce - cs]; Array.Copy(buf, cs, ctx, 0, ce - cs);
        var p = new Ptr { Holder = baseAddr + i, Value = v, Target = targets[k], R = r.Base, RS = r.Size, AB = r.AB, Type = r.Type, CtxBase = baseAddr + cs, Ctx = ctx };
        lock (gate) { if (found.Count < maxRows) found.Add(p); }
      }
    });
    found.Sort((x, y) => x.Holder.CompareTo(y.Holder));
    return found;
  }

  public static byte[] Read(long addr, int len) {
    var buf = new byte[len]; IntPtr got;
    if (!ReadProcessMemory(H, (IntPtr)addr, buf, (IntPtr)len, out got)) return new byte[0];
    if ((long)got < len) Array.Resize(ref buf, (int)(long)got);
    return buf;
  }

  // ---- the log. Written here, not by ConvertTo-Json: 20,000 rows of
  // that is most of a minute.
  static string Esc(string s) {
    var sb = new StringBuilder();
    foreach (char c in s) {
      if (c == '"') sb.Append("\\\""); else if (c == '\\') sb.Append("\\\\");
      else if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4")); else sb.Append(c);
    }
    return sb.ToString();
  }
  static string Hx(long v) { return "\"0x" + v.ToString("x") + "\""; }
  static string Kind(int type) { return type == PRIVATE ? "private" : type == IMAGE ? "image" : "mapped"; }

  public static void Log(string path, string row) { File.AppendAllText(path, row + "\n", new UTF8Encoding(false)); }

  public static void LogModules(string path) {
    var sb = new StringBuilder();
    for (int i = 0; i < ModBase.Length; i++)
      sb.Append("{\"t\":\"module\",\"name\":\"").Append(Esc(ModName[i])).Append("\",\"base\":").Append(Hx(ModBase[i])).Append(",\"size\":").Append(ModSize[i]).Append("}\n");
    File.AppendAllText(path, sb.ToString(), new UTF8Encoding(false));
  }

  public static void LogRegions(string path) {
    var sb = new StringBuilder("{\"t\":\"regions\",\"list\":[");
    bool firstRow = true;
    foreach (var r in Walk()) {
      if (!firstRow) sb.Append(','); firstRow = false;
      sb.Append('[').Append(Hx(r.Base)).Append(',').Append(r.Size).Append(",\"").Append(Kind(r.Type)[0]).Append("\"]");
    }
    sb.Append("]}\n");
    File.AppendAllText(path, sb.ToString(), new UTF8Encoding(false));
  }

  public static void LogStrings(string path, List<Str> list) {
    var sb = new StringBuilder();
    foreach (var s in list)
      sb.Append("{\"t\":\"str\",\"start\":").Append(Hx(s.Start)).Append(",\"anchor\":").Append(Hx(s.Anchor))
        .Append(",\"open\":").Append(s.Open ? 1 : 0).Append(",\"region\":").Append(Hx(s.R)).Append(",\"rs\":").Append(s.RS)
        .Append(",\"ab\":").Append(Hx(s.AB)).Append(",\"text\":\"").Append(Esc(s.Text)).Append("\"}\n");
    File.AppendAllText(path, sb.ToString(), new UTF8Encoding(false));
  }

  static string PointsAt(Ptr p, Str s, int max) {
    long o = p.Value - s.Start;
    if (o < 0 || o >= s.Raw.Length) return "";
    return Encoding.UTF8.GetString(s.Raw, (int)o, (int)Math.Min(max, s.Raw.Length - o));
  }

  /// Level 1, the pointers worth following: those that land INSIDE a line
  /// (a range search in a heap also catches every neighbour), and of
  /// those, the ones pointing at the commonest beginning - which is what
  /// the start of a line looks like, whatever that turns out to be.
  public static List<Ptr> Inside(List<Ptr> list, List<Str> strs) {
    var byAnchor = new Dictionary<long, Str>();
    foreach (var s in strs) byAnchor[s.Anchor] = s;
    var keep = new List<Ptr>();
    foreach (var p in list) { Str s; if (byAnchor.TryGetValue(p.Target, out s) && p.Value >= s.Start) keep.Add(p); }
    return keep;
  }
  public static List<Ptr> Dominant(List<Ptr> inside, List<Str> strs) {
    var byAnchor = new Dictionary<long, Str>();
    foreach (var s in strs) byAnchor[s.Anchor] = s;
    var count = new Dictionary<string, int>(); string best = null;
    foreach (var p in inside) {
      string k = PointsAt(p, byAnchor[p.Target], 6); int c;
      count.TryGetValue(k, out c); count[k] = c + 1;
      if (best == null || count[k] > count[best]) best = k;
    }
    return inside.FindAll(p => PointsAt(p, byAnchor[p.Target], 6) == best);
  }

  /// How each target of the NEXT level was arrived at, for the log.
  public static Dictionary<long, string> Via = new Dictionary<long, string>();

  static long Q(byte[] b, int o) { return BitConverter.ToInt64(b, o); }

  /// What might point at the thing a holder is part of. A range ("any
  /// pointer within 0x400 below it") was tried first and drowned: in a
  /// heap everything is within 0x400 of something. So, exact addresses:
  ///   obj+0xNN  every word before the holder that is a MODULE address -
  ///             a vtable, so where an object begins. Nearest is not
  ///             always right (objects embed objects), so all are tried
  ///             and the one that is right is the one that repeats.
  ///   array[k]  the first of a run of words that are all targets of
  ///             THIS level: the start of an array of them.
  ///   field     the holder itself.
  public static long[] Candidates(List<Ptr> list, long[] sortedTargets, int maxBack) {
    Via = new Dictionary<long, string>();
    foreach (var p in list) {
      if (p.Type == IMAGE) continue;                 // a root: nothing above it
      int hi = (int)(p.Holder - p.CtxBase);
      if (!Via.ContainsKey(p.Holder)) Via[p.Holder] = "field";
      int a = hi;
      while (a - 8 >= 0 && Array.BinarySearch(sortedTargets, Q(p.Ctx, a - 8)) >= 0) a -= 8;
      bool more = hi + 16 <= p.Ctx.Length && Array.BinarySearch(sortedTargets, Q(p.Ctx, hi + 8)) >= 0;
      if (a != hi || more) Via[p.CtxBase + a] = "array[" + ((hi - a) / 8) + "]";
      for (int o = hi - 8; o >= 0 && hi - o <= maxBack; o -= 8)
        if (Module(Q(p.Ctx, o)) != null && !Via.ContainsKey(p.CtxBase + o)) Via[p.CtxBase + o] = "obj+0x" + (hi - o).ToString("x");
    }
    var keys = new long[Via.Count]; Via.Keys.CopyTo(keys, 0); Array.Sort(keys);
    return keys;
  }

  /// `strs` (level 1 only): the lines the targets are anchors of, so each
  /// row can say what text the pointer actually points AT. Walking back
  /// to a null does NOT find where a string starts - MEASURED on the
  /// stand-in: a heap header is not zeros, and the walk ran through it
  /// into the block before. What begins at the pointed-at byte, the same
  /// for every line, is what says where a line starts.
  public static void LogPointers(string path, int level, List<Ptr> list, List<Str> strs) {
    var byAnchor = new Dictionary<long, Str>();
    if (strs != null) foreach (var s in strs) byAnchor[s.Anchor] = s;
    var sb = new StringBuilder();
    foreach (var p in list) {
      string mod = Module(p.Holder);
      Str at; string via;
      sb.Append('{');
      if (byAnchor.TryGetValue(p.Target, out at)) sb.Append("\"pointsAt\":\"").Append(Esc(PointsAt(p, at, 64))).Append("\",");
      if (Via.TryGetValue(p.Target, out via)) sb.Append("\"via\":\"").Append(Esc(via)).Append("\",");
      sb.Append("\"t\":\"ptr\",");
      sb.Append("\"level\":").Append(level).Append(",\"holder\":").Append(Hx(p.Holder)).Append(",\"value\":").Append(Hx(p.Value))
        .Append(",\"target\":").Append(Hx(p.Target)).Append(",\"delta\":").Append(p.Target - p.Value)
        .Append(",\"kind\":\"").Append(Kind(p.Type)).Append("\",\"region\":").Append(Hx(p.R)).Append(",\"rs\":").Append(p.RS)
        .Append(",\"ab\":").Append(Hx(p.AB)).Append(",\"mod\":").Append(mod == null ? "null" : "\"" + Esc(mod) + "\"")
        .Append(",\"ctxBase\":").Append(Hx(p.CtxBase)).Append(",\"ctx\":\"").Append(BitConverter.ToString(p.Ctx).Replace("-", "")).Append("\"}\n");
    }
    File.AppendAllText(path, sb.ToString(), new UTF8Encoding(false));
  }
}
'@

function ParseAddr([string]$s) {
  $s = $s.Trim()
  if ($s -match '^0x') { return [Convert]::ToInt64($s.Substring(2), 16) }
  return [long]$s
}

$proc = if ($ProcId -gt 0) { Get-Process -Id $ProcId } else { Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1 }
if (-not $proc) { Write-Output "no $ProcessName running; nothing was read"; exit 2 }

$names = @(); $bases = @(); $sizes = @()
try {
  foreach ($m in $proc.Modules) { $names += $m.ModuleName; $bases += [long]$m.BaseAddress; $sizes += [long]$m.ModuleMemorySize }
} catch { Write-Output "could not list modules: $($_.Exception.Message)" }
[PtrScan]::SetModules([string[]]$names, [long[]]$bases, [long[]]$sizes)
[PtrScan]::Open($proc.Id)

try {
  if ($Dump) {
    $at = ParseAddr $Dump
    $bytes = [PtrScan]::Read($at, $DumpLen)
    if ($bytes.Length -eq 0) { Write-Output "cannot read $Dump"; exit 3 }
    for ($i = 0; $i + 8 -le $bytes.Length; $i += 8) {
      $v = [BitConverter]::ToInt64($bytes, $i)
      $note = [PtrScan]::Module($v)
      $ascii = -join ($bytes[$i..($i + 7)] | ForEach-Object { if ($_ -ge 0x20 -and $_ -lt 0x7f) { [char]$_ } else { '.' } })
      Write-Output ('+0x{0:x3}  {1:x16}  {2}  {3}' -f $i, $v, $ascii, $note)
    }
    exit 0
  }

  if ($Parents) {
    # Up the UI tree from a panel, by the MEASURED layout: id at +0x10,
    # parent at +0x18, child count at +0x28. A few hundred bytes in all.
    foreach ($start in ($Parents -split ',')) {
      $at = ParseAddr $start
      for ($depth = 0; $depth -lt 64 -and $at -ne 0; $depth++) {
        $b = [PtrScan]::Read($at, 0x40)
        if ($b.Length -lt 0x40) { Write-Output ('  ' * $depth + ('0x{0:x} unreadable' -f $at)); break }
        $idBytes = [PtrScan]::Read([BitConverter]::ToInt64($b, 0x10), 64)
        $n = [Array]::IndexOf($idBytes, [byte]0); if ($n -lt 0) { $n = $idBytes.Length }
        $id = if ($n -gt 0) { [System.Text.Encoding]::UTF8.GetString($idBytes, 0, $n) } else { '' }
        Write-Output ('{0}0x{1:x}  id="{2}"  children={3}  {4}' -f ('  ' * $depth), $at, $id, [BitConverter]::ToInt32($b, 0x28), [PtrScan]::Module([BitConverter]::ToInt64($b, 0)))
        $at = [BitConverter]::ToInt64($b, 0x18)
      }
    }
    exit 0
  }

  [PtrScan]::Log($Out, ('{"t":"run","at":"' + (Get-Date).ToString('o') + '","process":"' + $proc.ProcessName + '","pid":' + $proc.Id + '}'))
  [PtrScan]::LogModules($Out)
  [PtrScan]::LogRegions($Out)

  if ($Targets) {
    $want = @($Targets -split ',' | ForEach-Object { ParseAddr $_ })
    $slackNow = $Slack
  } else {
    $strs = [PtrScan]::FindStrings($Threads)
    Write-Output ("strings: {0} chat lines, {1}ms, {2}MB" -f $strs.Count, [PtrScan]::LastMs, [int]([PtrScan]::LastBytes / 1MB))
    [PtrScan]::LogStrings($Out, $strs)
    # The ANCHOR, with slack enough to reach back over the portrait and
    # the channel tag to wherever the string really starts.
    $want = @($strs | Where-Object { -not $Match -or $_.Text -match $Match } | ForEach-Object { $_.Anchor })
    $slackNow = $Slack1
  }

  for ($level = 1; $level -le $Levels; $level++) {
    $sorted = [long[]]@($want | Sort-Object -Unique | Select-Object -First $MaxTargets)
    if ($sorted.Length -eq 0) { Write-Output "level ${level}: nothing to look for"; break }
    $ptrs = [PtrScan]::FindPointers($sorted, $slackNow, $Threads, $MaxRows)
    $cost = "{0}ms, {1}MB" -f [PtrScan]::LastMs, [int]([PtrScan]::LastBytes / 1MB)
    $follow = $ptrs
    if ($level -eq 1 -and $strs) {
      # Every pointer inside a line is LOGGED; only the ones at the
      # commonest beginning are FOLLOWED.
      $ptrs = [PtrScan]::Inside($ptrs, $strs)
      $follow = [PtrScan]::Dominant($ptrs, $strs)
    }
    [PtrScan]::LogPointers($Out, $level, $ptrs, $(if ($level -eq 1) { $strs } else { $null }))
    Write-Output ("level {0}: {1} targets (slack 0x{2:x}) -> {3} pointers, {4} followed, {5}" -f $level, $sorted.Length, $slackNow, $ptrs.Count, $follow.Count, $cost)
    $want = [PtrScan]::Candidates($follow, $sorted, 0x200)
    $slackNow = 0
  }
  Write-Output "rows are in $Out"
} finally {
  [PtrScan]::Close()
}
