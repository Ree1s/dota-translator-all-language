# Types chat lines into the running game, for testing the reader against
# lines whose exact send time is known.
#
#   powershell -File tools/saychat.ps1 -Plan plan.json [-Out said.log]
#
# plan.json (UTF-8): [{ "channel": "team"|"all", "text": "...", "waitMs": 8000 }, ...]
# waitMs is how long to wait BEFORE saying that line.
#
# This is INPUT, the kind a macro tool sends: focus the window, Enter (or
# Shift+Enter for all chat), paste, Enter. Nothing is written to the
# game's memory. The line goes through the clipboard because Dota's chat
# box is known to accept a paste, and the clipboard is put back after.
#
# The text is never in this file: Windows PowerShell reads a script with
# no BOM as ANSI, and Cyrillic in here would arrive as mojibake.
#
# GUARD: if Dota cannot be brought to the front, NOTHING is typed. Keys
# sent to whatever else has focus would paste a line into it and press
# Enter, and that could be a chat with a real person.

param(
  [string]$Plan = '',
  # Bring the game to the front and type nothing. A game in the
  # background idles, so anything measured against it there is measured
  # against the wrong game.
  [switch]$FocusOnly,
  [string]$Out = 'said.log',
  [string]$ProcessName = 'dota2'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class DotaKeys {
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint type);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

  const uint KEYUP = 2;
  public const byte ENTER = 0x0D, SHIFT = 0x10, CTRL = 0x11, ALT = 0x12, V = 0x56;

  // The scan code goes with the virtual key: a game reading raw input
  // sees the scan code and would ignore a key that has none.
  static void Down(byte vk) { keybd_event(vk, (byte)MapVirtualKey(vk, 0), 0, UIntPtr.Zero); }
  static void Up(byte vk) { keybd_event(vk, (byte)MapVirtualKey(vk, 0), KEYUP, UIntPtr.Zero); }
  public static void Tap(byte vk) { Down(vk); Thread.Sleep(40); Up(vk); }
  public static void Chord(byte mod, byte vk) { Down(mod); Thread.Sleep(40); Tap(vk); Thread.Sleep(40); Up(mod); }

  public static bool IsFront(IntPtr h) { return GetForegroundWindow() == h; }

  public static bool Focus(IntPtr h) {
    if (IsFront(h)) return true;
    if (IsIconic(h)) ShowWindow(h, 9);
    // Windows only lets a process take the foreground if it has just
    // had input; a tap of Alt is the accepted way of having had some.
    Tap(ALT);
    SetForegroundWindow(h);
    Thread.Sleep(300);
    return IsFront(h);
  }
}
"@

$proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Write-Output "NOT SENT: no $ProcessName window"; exit 2 }
$hwnd = $proc.MainWindowHandle

if ($FocusOnly) {
  if ([DotaKeys]::Focus($hwnd)) { Write-Output 'focused'; exit 0 } else { Write-Output 'NOT FOCUSED'; exit 3 }
}
$lines = Get-Content -Raw -Encoding UTF8 $Plan | ConvertFrom-Json
$before = $null
try { if ([System.Windows.Forms.Clipboard]::ContainsText()) { $before = [System.Windows.Forms.Clipboard]::GetText() } } catch { }

$sent = 0
try {
  foreach ($l in $lines) {
    Start-Sleep -Milliseconds ([int]$l.waitMs)
    if (-not [DotaKeys]::Focus($hwnd)) { Write-Output "NOT SENT: could not bring the game to the front"; break }
    [System.Windows.Forms.Clipboard]::SetText([string]$l.text)
    if ($l.channel -eq 'all') { [DotaKeys]::Chord([DotaKeys]::SHIFT, [DotaKeys]::ENTER) } else { [DotaKeys]::Tap([DotaKeys]::ENTER) }
    Start-Sleep -Milliseconds 250
    # Asked again: the player may have clicked away while the box opened.
    if (-not [DotaKeys]::IsFront($hwnd)) { Write-Output "NOT SENT: the game lost focus"; break }
    [DotaKeys]::Chord([DotaKeys]::CTRL, [DotaKeys]::V)
    Start-Sleep -Milliseconds 200
    if (-not [DotaKeys]::IsFront($hwnd)) { Write-Output "NOT SENT: the game lost focus"; break }
    [DotaKeys]::Tap([DotaKeys]::ENTER)
    $stamp = (Get-Date).ToString('HH:mm:ss.fff')
    $row = "$stamp $($l.channel) $($l.text)"
    [System.IO.File]::AppendAllText($Out, $row + "`n", (New-Object System.Text.UTF8Encoding($false)))
    Write-Output "sent $stamp $($l.channel)"
    $sent++
  }
} finally {
  try { if ($null -ne $before) { [System.Windows.Forms.Clipboard]::SetText($before) } else { [System.Windows.Forms.Clipboard]::Clear() } } catch { }
}
Write-Output "done: $sent of $($lines.Count) sent"
