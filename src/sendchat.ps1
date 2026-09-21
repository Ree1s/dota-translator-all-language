# The keys behind "send it translated": the player types English into the
# game's OWN chat field and presses the app's key instead of Enter.
#
#   copy   Ctrl+A, Ctrl+C    what they typed goes to the clipboard
#   send   Ctrl+A, Ctrl+V, Enter    the translation replaces it and is said
#
# The app does the clipboard and the translating in between; no text comes
# through here at all.
#
# This is INPUT, the kind a keyboard sends, through Windows. The game's
# process is never opened by this script, for reading or for writing, and
# nothing here could write to it. It acts only on a word from the app,
# and the app sends one only because the player pressed the key.
#
# It is started with the app and then WAITS, blocked on its stdin, costing
# nothing: compiling the C# below takes most of a second, and a key that
# answers a second late is a key that feels broken. When the app goes, the
# pipe closes, the read returns nothing, and this exits.
#
# GUARD: if Dota is not the window in front, NOTHING is typed - asked
# before every group of keys. Keys sent to whatever else has the keyboard
# would select, overwrite and SEND in it, and that could be a chat with a
# real person.

param([string]$ProcessName = 'dota2')

$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class SayKeys {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern int GetWindowThreadProcessId(IntPtr hwnd, out int pid);
  [DllImport("user32.dll")] static extern uint MapVirtualKey(uint code, uint type);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);

  const uint KEYUP = 2;
  public const byte ENTER = 0x0D, SHIFT = 0x10, CTRL = 0x11, ALT = 0x12, A = 0x41, C = 0x43, V = 0x56;

  // The scan code goes with the virtual key: a game reading raw input
  // sees the scan code and would ignore a key that has none.
  static void Down(byte vk) { keybd_event(vk, (byte)MapVirtualKey(vk, 0), 0, UIntPtr.Zero); }
  static void Up(byte vk) { keybd_event(vk, (byte)MapVirtualKey(vk, 0), KEYUP, UIntPtr.Zero); }
  public static void Tap(byte vk) { Down(vk); Thread.Sleep(30); Up(vk); }
  public static void Chord(byte mod, byte vk) { Down(mod); Thread.Sleep(30); Tap(vk); Thread.Sleep(30); Up(mod); }

  /// Does the window in front belong to this process?
  public static bool InFront(int pid) {
    int owner; GetWindowThreadProcessId(GetForegroundWindow(), out owner);
    return owner == pid;
  }

  static bool Held(byte vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }

  /// The player's own Ctrl and Enter are still going up from the key that
  /// started this. Ours on top of theirs would be other keys.
  public static bool WaitReleased(int ms) {
    for (int t = 0; t < ms; t += 25) {
      if (!Held(CTRL) && !Held(SHIFT) && !Held(ALT) && !Held(ENTER)) return true;
      Thread.Sleep(25);
    }
    return false;
  }
}
"@

function GamePid {
  $p = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($p) { return $p.Id }
  return 0
}

Write-Output 'ready'
while ($true) {
  $word = [Console]::In.ReadLine()
  if ($null -eq $word) { break }
  if ($word -ne 'copy' -and $word -ne 'send') { continue }
  try {
    $id = GamePid
    if ($id -eq 0 -or -not [SayKeys]::InFront($id)) { Write-Output 'NOT DONE: the game is not in front'; continue }
    if (-not [SayKeys]::WaitReleased(1500)) { Write-Output 'NOT DONE: keys are still held'; continue }
    if (-not [SayKeys]::InFront($id)) { Write-Output 'NOT DONE: the game is not in front'; continue }
    [SayKeys]::Chord([SayKeys]::CTRL, [SayKeys]::A)
    Start-Sleep -Milliseconds 60
    if ($word -eq 'copy') {
      [SayKeys]::Chord([SayKeys]::CTRL, [SayKeys]::C)
      Start-Sleep -Milliseconds 80
      Write-Output 'copied'
      continue
    }
    [SayKeys]::Chord([SayKeys]::CTRL, [SayKeys]::V)
    Start-Sleep -Milliseconds 120
    # Asked again: Enter in the wrong window SENDS something.
    if (-not [SayKeys]::InFront($id)) { Write-Output 'NOT DONE: the game lost focus'; continue }
    [SayKeys]::Tap([SayKeys]::ENTER)
    Write-Output 'sent'
  } catch {
    Write-Output 'NOT DONE: the helper failed'
  }
}
