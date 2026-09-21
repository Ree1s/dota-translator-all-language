# Says whether Dota is the window in front, and nothing else:
#
#   {"t":"focus","on":1}     one line per CHANGE
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
  public static int OwnerPid() {
    int owner; GetWindowThreadProcessId(GetForegroundWindow(), out owner);
    return owner;
  }
}
"@

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
  Start-Sleep -Milliseconds $IntervalMs
}
