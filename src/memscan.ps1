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
#   {"t":"line","b64":"<the line, UTF-8, base64>"}
#   {"t":"stat","full":bool,"ms":N,"mb":N,"regions":N,"hits":N,"hot":N}
#   {"t":"error","detail":"..."}

param(
  [string]$ProcessName = 'dota2',
  [int]$IntervalMs = 1000,
  [int]$FullRescanMs = 60000
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

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

  const int VM_READ = 0x0010, QUERY = 0x0400, COMMIT = 0x1000;
  const int MAX_STR = 512;   // a chat line is far shorter; this bounds a runaway read

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
  static DotaMem() { foreach (var t in TAGS) PATS.Add(Encoding.UTF8.GetBytes(t)); }

  public static long LastMs, LastBytes; public static int LastRegions, LastHits;

  static bool Readable(int protect) {
    int p = protect & 0xFF;
    return p == 0x02 || p == 0x04 || p == 0x20 || p == 0x40;
  }

  static string Extract(byte[] buf, long n, long at, int back) {
    // Forward to the end of the string; backwards only as far as `back`
    // asks and only over printable bytes. The first version walked back
    // to the previous null and, where there was none, dragged in whatever
    // preceded the line ("�@  [Allies] ..."). The markup form needs
    // a LITTLE look-back, because its channel tag sits before the anchor.
    long s = at;
    while (s > 0 && at - s < back && buf[s - 1] != 0 && buf[s - 1] >= 0x20) s--;
    long e = at;
    while (e < n && buf[e] != 0 && e - s < MAX_STR) e++;
    if (e <= s) return null;
    try { return Encoding.UTF8.GetString(buf, (int)s, (int)(e - s)); } catch { return null; }
  }

  /// Scan. When `only` is non-empty, just those region bases are read -
  /// that is what makes polling cheap once the first full scan has shown
  /// where chat lives. Returns the lines found; fills the Last* counters.
  /// `hot` receives the bases that produced a hit.
  public static List<string> Scan(int pid, HashSet<long> only, HashSet<long> hot) {
    var found = new List<string>();
    LastMs = 0; LastBytes = 0; LastRegions = 0; LastHits = 0;
    var sw = System.Diagnostics.Stopwatch.StartNew();

    IntPtr h = OpenProcess(VM_READ | QUERY, false, pid);
    if (h == IntPtr.Zero) throw new Exception("OpenProcess failed: " + Marshal.GetLastWin32Error());

    byte[] buf = new byte[64 * 1024 * 1024];
    long addr = 0;
    try {
      while (true) {
        MBI m;
        if (VirtualQueryEx(h, (IntPtr)addr, out m, Marshal.SizeOf(typeof(MBI))) == 0) break;
        long size = (long)m.RegionSize, bas = (long)m.BaseAddress;
        if (size <= 0) break;

        bool want = m.State == COMMIT && Readable(m.Protect) && size <= buf.Length;
        if (want && only != null && only.Count > 0 && !only.Contains(bas)) want = false;

        if (want) {
          LastRegions++;
          IntPtr got;
          if (ReadProcessMemory(h, m.BaseAddress, buf, (IntPtr)size, out got)) {
            long n = (long)got; LastBytes += n;
            bool any = false;
            foreach (var p in PATS) {
              int pl = p.Length; byte f = p[0];
              for (long i = 0; i <= n - pl; i++) {
                if (buf[i] != f) continue;
                bool okp = true;
                for (int j = 1; j < pl; j++) if (buf[i + j] != p[j]) { okp = false; break; }
                if (!okp) continue;
                string s = Extract(buf, n, i, 48);
                if (s != null) { found.Add(s); LastHits++; any = true; }
              }
            }
            if (any && hot != null) hot.Add(bas);
          }
        }
        long next = bas + size;
        if (next <= addr) break;
        addr = next;
      }
    } finally { CloseHandle(h); }

    sw.Stop(); LastMs = sw.ElapsedMilliseconds;
    return found;
  }
}
"@

function Emit($obj) {
  # -Compress keeps it to one line, which is what the reader splits on.
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 4))
  [Console]::Out.Flush()
}

$hot = New-Object 'System.Collections.Generic.HashSet[long]'
$lastFull = [DateTime]::MinValue
$lastPid = 0

Emit @{ t = 'status'; state = 'waiting'; detail = 'looking for Dota' }

while ($true) {
  $proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $proc) {
    if ($lastPid -ne 0) {
      # Dota closed: the addresses we learned mean nothing for the next one.
      $hot.Clear(); $lastPid = 0; $lastFull = [DateTime]::MinValue
      Emit @{ t = 'status'; state = 'waiting'; detail = 'Dota closed' }
    }
    Start-Sleep -Milliseconds 2000
    continue
  }

  if ($proc.Id -ne $lastPid) {
    $hot.Clear(); $lastFull = [DateTime]::MinValue
    $lastPid = $proc.Id
    Emit @{ t = 'status'; state = 'reading'; pid = $proc.Id; detail = 'attached' }
  }

  # A full sweep finds where chat lives; after that only those regions are
  # read, which is the difference between ~11s and a poll you can run every
  # second. Redone periodically because the game allocates as it runs.
  $full = ($hot.Count -eq 0) -or (([DateTime]::UtcNow - $lastFull).TotalMilliseconds -gt $FullRescanMs)
  if ($full) { Emit @{ t = 'status'; state = 'scanning'; pid = $proc.Id; detail = 'full sweep' } }

  try {
    $only = if ($full) { $null } else { $hot }
    $fresh = New-Object 'System.Collections.Generic.HashSet[long]'
    $lines = [DotaMem]::Scan($proc.Id, $only, $fresh)

    if ($full) {
      $hot.Clear()
      $lastFull = [DateTime]::UtcNow
    }
    foreach ($b in $fresh) { [void]$hot.Add($b) }
    # A hot region that stops producing is dropped at the next full sweep,
    # so this cannot grow into the whole address space.

    # Base64, not the text itself. A Cyrillic line written straight to
    # stdout comes back as mojibake ("ðøÐâð©ðÀð░" for "Луиза") whenever
    # the console codepage is not UTF-8, which depends on the machine and
    # on how the process was spawned. Base64 is ASCII and cannot be
    # re-encoded on the way out; the reader decodes it as UTF-8.
    foreach ($s in $lines) {
      $b64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($s))
      Emit @{ t = 'line'; b64 = $b64 }
    }

    Emit @{
      t = 'stat'; full = $full; ms = [DotaMem]::LastMs;
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
