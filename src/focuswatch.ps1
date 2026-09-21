# Says whether Dota is the window in front, and nothing else:
#
#   {"t":"focus","on":1}                          one line per CHANGE
#   {"t":"window","x":0,"y":0,"w":1920,"h":1080}  while the game is in front:
#       where the inside of its window is ON THE SCREEN, in real pixels, on
#       a change and every few seconds besides (a reloaded overlay page has
#       forgotten it). GSI mode places the text above the game's chat from
#       this alone - the memory reader had the game's own layout for that.
#
# For the GSI source, which hears the game but cannot see the desktop. The
# memory helper reports this itself; this one does not touch the game at
# all - it asks WINDOWS which window is in front and what program owns it.
# The overlay hides on it, and the say-back key exists only while it is 1.
#
# Cheap on purpose: the foreground window's owner is one call, and the
# owner's NAME is looked up only when the owner changes (walking every
# process by name each poll was 3% of a core in memscan.ps1, measured).

param(
  [int]$ParentPid = 0,
  [int]$IntervalMs = 250,
  [string]$ProcessName = 'dota2'
)

$ErrorActionPreference = 'Stop'

# Held as an object: a pid is reused, a handle is not.
$parent = $null
if ($ParentPid -gt 0) {
  try { $parent = Get-Process -Id $ParentPid -ErrorAction Stop } catch { exit 0 }
}

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class FrontWindow {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  // "x,y,w,h" of the front window's client area, or "" (minimised, gone).
  public static string Client() {
    IntPtr h = GetForegroundWindow();
    RECT r; POINT p = new POINT();
    if (h == IntPtr.Zero || !GetClientRect(h, out r) || !ClientToScreen(h, ref p)) return "";
    if (r.R - r.L < 320 || r.B - r.T < 240) return "";
    return p.X + "," + p.Y + "," + (r.R - r.L) + "," + (r.B - r.T);
  }
  public static int OwnerPid() {
    int owner; GetWindowThreadProcessId(GetForegroundWindow(), out owner);
    return owner;
  }
}
"@

# Real pixels, as the game's are, whatever Windows display scaling says.
[void][FrontWindow]::SetProcessDPIAware()

$lastClient = ''
$clientAt = [DateTime]::MinValue
$lastOwner = -1
$on = -1
while ($true) {
  if (($null -ne $parent) -and $parent.HasExited) { exit 0 }
  $owner = [FrontWindow]::OwnerPid()
  if ($owner -ne $lastOwner) {
    $lastOwner = $owner
    $now = 0
    if ($owner -gt 0) {
      try { if ((Get-Process -Id $owner -ErrorAction Stop).ProcessName -ieq $ProcessName) { $now = 1 } } catch { $now = 0 }
    }
    if ($now -ne $on) {
      $on = $now
      [Console]::Out.WriteLine('{"t":"focus","on":' + $on + '}')
      [Console]::Out.Flush()
    }
  }
  if ($on -eq 1) {
    $c = [FrontWindow]::Client()
    $due = ([DateTime]::UtcNow - $clientAt).TotalSeconds -ge 5
    if ($c -and (($c -ne $lastClient) -or $due)) {
      $lastClient = $c
      $clientAt = [DateTime]::UtcNow
      $n = $c.Split(',')
      [Console]::Out.WriteLine('{"t":"window","x":' + $n[0] + ',"y":' + $n[1] + ',"w":' + $n[2] + ',"h":' + $n[3] + '}')
      [Console]::Out.Flush()
    }
  } else { $lastClient = '' }
  Start-Sleep -Milliseconds $IntervalMs
}
