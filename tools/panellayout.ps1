# Where does a UI panel keep its POSITION? Read-only.
#
#   powershell -ExecutionPolicy Bypass -File tools/panellayout.ps1 -Panel 0xADDR [-Len 0x300]
#
# Prints, for the panel's children side by side, every 4-byte field that
# reads as a plausible float in any of them (|v| between 0.5 and 10000,
# or exactly 0 where a sibling has one). Consecutive chat lines sit one
# line-height apart, so the field holding y is the column that climbs by
# the same step each row; x and width are the columns that do not move.
# With -Up, prints the same fields for the panel and each of its
# ancestors instead, which is how a child-relative position becomes a
# screen position.
#
# It reads the game's memory: with the player's say-so.

param(
  [string]$Panel,
  [int]$Len = 0x300,
  [switch]$Up,
  [int]$Last = 8,
  [string]$ProcessName = 'dota2'
)

$ErrorActionPreference = 'Stop'
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class PL {
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(int a, bool i, int pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, IntPtr size, out IntPtr read);
  static IntPtr H;
  public static void Open(int pid) { H = OpenProcess(0x0410, false, pid); if (H == IntPtr.Zero) throw new Exception("OpenProcess failed"); }
  public static byte[] R(long a, int n) { var b = new byte[n]; IntPtr g; if (a < 0x10000 || !ReadProcessMemory(H, (IntPtr)a, b, (IntPtr)n, out g) || (long)g != n) return new byte[0]; return b; }
  public static long Q(long a) { var b = R(a, 8); return b.Length == 8 ? BitConverter.ToInt64(b, 0) : 0; }
}
'@

$proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) { "no $ProcessName running"; exit 2 }
[PL]::Open($proc.Id)
$p = [Convert]::ToInt64($Panel.Substring(2), 16)

function IdOf([long]$ui) {
  $b = [PL]::R([PL]::Q($ui + 0x10), 48)
  if ($b.Length -eq 0) { return '' }
  $n = [Array]::IndexOf($b, [byte]0); if ($n -le 0) { return '' }
  return [System.Text.Encoding]::ASCII.GetString($b, 0, $n)
}

$cols = @()
if ($Up) {
  for ($at = $p; $at -ne 0 -and $cols.Count -lt 16; $at = [PL]::Q($at + 0x18)) { $cols += $at }
} else {
  $count = [BitConverter]::ToInt32([PL]::R($p + 0x28, 4), 0)
  $kids = [PL]::Q($p + 0x30)
  for ($k = [Math]::Max(0, $count - $Last); $k -lt $count; $k++) { $cols += [PL]::Q($kids + 8 * $k) }
}
$bufs = $cols | ForEach-Object { , ([PL]::R($_, $Len)) }
'        ' + (($cols | ForEach-Object { '{0,12}' -f (IdOf $_) }) -join '')
'        ' + (($cols | ForEach-Object { '{0,12:x}' -f $_ }) -join '')
for ($o = 0x40; $o + 4 -le $Len; $o += 4) {
  $vals = $bufs | ForEach-Object { if ($_.Length -ge $o + 4) { [BitConverter]::ToSingle($_, $o) } else { [single]::NaN } }
  $good = @($vals | Where-Object { -not [single]::IsNaN($_) -and [Math]::Abs($_) -ge 0.5 -and [Math]::Abs($_) -le 10000 })
  # +0x1b0..+0x1bc are always shown: MEASURED to be the position (x, y,
  # and the same again), which is legitimately 0 for most panels.
  $always = ($o -ge 0x1b0 -and $o -le 0x1bc)
  if (-not $always -and $good.Count -lt [Math]::Max(1, [int]($cols.Count / 2))) { continue }
  ('+0x{0:x3}  ' -f $o) + (($vals | ForEach-Object { '{0,12:0.##}' -f $_ }) -join '')
}
