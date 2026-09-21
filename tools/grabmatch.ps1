# Which hero is in a tile of a screen grab? For tools/grabmatch.mjs.
#
#   -Image  a PNG
#   -Refs   a folder of reference portraits, <hero>.png / <hero>.bmp
#   -Tiles  "name:x:y:w:h;name:x:y:w:h"   in the image's own pixels
#   -Slack  how far (px) a tile may be off; every 2px offset is tried
#   -Top    the share of the reference's HEIGHT compared, from its top (the
#           caller shortens its tiles to match): the game draws icons over
#           the bottom of a top-bar portrait
#   -Inset  the share of the REFERENCE cut off each side before comparing
#
# Prints one line per tile: name best score second score2 dx dy
# The measure is zero-mean normalised correlation of 16x9 thumbnails, so a
# darker or brighter drawing of the same picture still scores high.

param([string]$Image, [string]$Refs, [string]$Tiles, [int]$Slack = 6, [double]$Inset = 0.0, [double]$Top = 1.0)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing @"
using System;
using System.Drawing;
using System.Drawing.Drawing2D;

public static class TileMatch {
  const int W = 16, H = 9;
  public static double[] Thumb(Bitmap src, double x, double y, double w, double h) {
    using (var t = new Bitmap(W, H)) {
      using (var g = Graphics.FromImage(t)) {
        g.InterpolationMode = InterpolationMode.HighQualityBilinear;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        g.DrawImage(src, new RectangleF(0, 0, W, H), new RectangleF((float)x, (float)y, (float)w, (float)h), GraphicsUnit.Pixel);
      }
      var v = new double[W * H * 3];
      double mean = 0;
      for (int j = 0; j < H; j++) for (int i = 0; i < W; i++) {
        Color c = t.GetPixel(i, j);
        int o = (j * W + i) * 3;
        v[o] = c.R; v[o + 1] = c.G; v[o + 2] = c.B;
        mean += c.R + c.G + c.B;
      }
      mean /= v.Length;
      double norm = 0;
      for (int k = 0; k < v.Length; k++) { v[k] -= mean; norm += v[k] * v[k]; }
      norm = Math.Sqrt(norm);
      if (norm > 0) for (int k = 0; k < v.Length; k++) v[k] /= norm;
      return v;
    }
  }
  public static double Dot(double[] a, double[] b) {
    double s = 0;
    for (int k = 0; k < a.Length; k++) s += a[k] * b[k];
    return s;
  }
}
"@

$img = New-Object System.Drawing.Bitmap $Image
$known = @{}
foreach ($f in Get-ChildItem -Path $Refs -File) {
  $r = New-Object System.Drawing.Bitmap $f.FullName
  $ix = $r.Width * $Inset; $iy = $r.Height * $Inset
  $known[$f.BaseName] = [TileMatch]::Thumb($r, $ix, $iy, $r.Width - 2 * $ix, ($r.Height - 2 * $iy) * $Top)
  $r.Dispose()
}

foreach ($tile in $Tiles.Split(';')) {
  $p = $tile.Split(':')
  if ($p.Length -lt 5) { continue }
  $x = [double]$p[1]; $y = [double]$p[2]; $w = [double]$p[3]; $h = [double]$p[4]
  $best = ''; $bestS = -2.0; $bdx = 0; $bdy = 0
  $scores = @{}
  for ($dx = -$Slack; $dx -le $Slack; $dx += 2) {
    for ($dy = -$Slack; $dy -le $Slack; $dy += 2) {
      if ($x + $dx -lt 0 -or $y + $dy -lt 0 -or $x + $dx + $w -gt $img.Width -or $y + $dy + $h -gt $img.Height) { continue }
      $t = [TileMatch]::Thumb($img, $x + $dx, $y + $dy, $w, $h)
      foreach ($k in $known.Keys) {
        $s = [TileMatch]::Dot($t, $known[$k])
        if (-not $scores.ContainsKey($k) -or $s -gt $scores[$k]) { $scores[$k] = $s }
        if ($s -gt $bestS) { $bestS = $s; $best = $k; $bdx = $dx; $bdy = $dy }
      }
    }
  }
  $second = ''; $secondS = -2.0
  foreach ($k in $scores.Keys) { if ($k -ne $best -and $scores[$k] -gt $secondS) { $secondS = $scores[$k]; $second = $k } }
  [Console]::Out.WriteLine(('{0} {1} {2:F3} {3} {4:F3} {5} {6}' -f $p[0], $best, $bestS, $second, $secondS, $bdx, $bdy))
}
$img.Dispose()
