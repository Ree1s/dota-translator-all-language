# Screen grabs for tools/grabtest.mjs: saves a region of the screen as PNG.
# Kept running and told what to grab on stdin, a line at a time:
#
#   <x> <y> <w> <h> <path>
#
# It answers "ok <path>" or "failed <why>". The first line it prints is
# "screen <width> <height>" - the primary screen, in real pixels.
# Screen capture only: nothing of the game is opened or read.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @"
using System.Runtime.InteropServices;
public static class GrabDpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }
"@
[void][GrabDpi]::SetProcessDPIAware()

$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
[Console]::Out.WriteLine("screen $($b.Width) $($b.Height)")
[Console]::Out.Flush()

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { exit 0 }
  $p = $line.Trim().Split(' ', 5)
  if ($p.Length -lt 5) { continue }
  try {
    $x = [int]$p[0]; $y = [int]$p[1]; $w = [int]$p[2]; $h = [int]$p[3]
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($x, $y, 0, 0, $bmp.Size)
    $bmp.Save($p[4], [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
    [Console]::Out.WriteLine("ok $($p[4])")
  } catch {
    [Console]::Out.WriteLine("failed $($_.Exception.Message)")
  }
  [Console]::Out.Flush()
}
