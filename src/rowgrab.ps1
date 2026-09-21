# Whose portrait stands beside the newest row of the game's chat?
#
# For the GSI source, whose feed gives a speaker's seat and not their hero.
# Kept running; asked on stdin, a line at a time:
#
#   row <id>          the portrait beside the newest chat row
#   seat <id> <0-9>   the fallback: that seat's tile of the top bar
#
# and answers one JSON line:
#
#   {"t":"row","id":7,"ok":1,"hero":"marci","score":0.912,"second":"luna","score2":0.570}
#   {"t":"row","id":7,"ok":0,"why":"the game is not in front"}
#
# The first line it prints is {"t":"ready","refs":143}.
#
# SCREEN CAPTURE of one small rectangle (about 56 x 40 px at 1080p), and only
# while Dota is the window in front. Nothing of the game is opened or read:
# it asks Windows where the front window is and copies pixels off the screen.
#
# The measure is tools/grabmatch.ps1's: zero-mean normalised correlation of
# 16x9 thumbnails against the game's own portraits (-Refs, written from the
# player's pak01 by src/rowgrab.js). MEASURED there: a right hero 0.89-0.93,
# the best wrong one 0.51-0.66. The caller draws the line.

param(
  [int]$ParentPid = 0,
  [string]$Refs = '',
  [string]$ProcessName = 'dota2',
  [int]$Slack = 8
)

$ErrorActionPreference = 'Stop'

# Held as an object: a pid is reused, a handle is not.
$parent = $null
if ($ParentPid -gt 0) {
  try { $parent = Get-Process -Id $ParentPid -ErrorAction Stop } catch { exit 0 }
}

Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

public static class RowGrab {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);

  const int W = 16, H = 9;
  static readonly List<string> names = new List<string>();
  static readonly List<double[]> known = new List<double[]>();
  // The TOP 60% of each portrait: the game draws icons, bars and a death
  // timer over the bottom of a top-bar tile (SEEN: 5 of 10 sure whole, 9 of
  // 10 by the top alone).
  const double TOP = 0.6;
  static readonly List<double[]> knownTop = new List<double[]>();

  static double[] Thumb(Bitmap src, double x, double y, double w, double h) {
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

  public static int AddRef(string name, string file) {
    using (var r = new Bitmap(file)) { names.Add(name); known.Add(Thumb(r, 0, 0, r.Width, r.Height)); knownTop.Add(Thumb(r, 0, 0, r.Width, r.Height * TOP)); }
    return names.Count;
  }

  // The front window's owner, and where its picture is on the screen.
  public static int Front(out int x, out int y, out int w, out int h) {
    x = y = w = h = 0;
    IntPtr win = GetForegroundWindow();
    if (win == IntPtr.Zero) return 0;
    int owner; GetWindowThreadProcessId(win, out owner);
    RECT r; if (!GetClientRect(win, out r)) return owner;
    POINT p = new POINT(); ClientToScreen(win, ref p);
    x = p.X; y = p.Y; w = r.R - r.L; h = r.B - r.T;
    return owner;
  }

  // MEASURED (5120x1440 and the same shrunk to 1080p), in 1080-high units
  // from the centre line of the game's picture: the newest chat row's
  // portrait is 39.75 x 24, 362.25 left of centre, 735.75 down.
  public static string Match(int gx, int gy, int gw, int gh, int slack) {
    double s = gh / 1080.0;
    double tx = gx + gw / 2.0 - 362.25 * s, ty = gy + 735.75 * s, tw = 39.75 * s, th = 24 * s;
    int bx = (int)Math.Floor(tx) - slack, by = (int)Math.Floor(ty) - slack;
    int bw = (int)Math.Ceiling(tw) + 2 * slack + 2, bh = (int)Math.Ceiling(th) + 2 * slack + 2;
    using (var bmp = new Bitmap(bw, bh)) {
      using (var g = Graphics.FromImage(bmp)) g.CopyFromScreen(bx, by, 0, 0, bmp.Size);
      return Best(bmp, tx - bx, ty - by, tw, th, slack, known);
    }
  }

  // The fallback: the top bar shows all ten heroes in SEAT order. MEASURED,
  // same units: a tile is 60 x 34.5, 62.25 apart, radiant's first 416.25
  // left of centre, dire's first 107.25 right of it, 4.5 down. One tile is
  // grabbed - the seat asked about - and only its top 60% compared.
  public static string MatchSeat(int gx, int gy, int gw, int gh, int seat, int slack) {
    double s = gh / 1080.0;
    double off = seat < 5 ? -416.25 + 62.25 * seat : 107.25 + 62.25 * (seat - 5);
    double tx = gx + gw / 2.0 + off * s, ty = gy + 4.5 * s, tw = 60 * s, th = 34.5 * TOP * s;
    int bx = (int)Math.Floor(tx) - slack, by = Math.Max(gy, (int)Math.Floor(ty) - slack);
    int bw = (int)Math.Ceiling(tw) + 2 * slack + 2, bh = (int)Math.Ceiling(th) + 2 * slack + 2;
    using (var bmp = new Bitmap(bw, bh)) {
      using (var g = Graphics.FromImage(bmp)) g.CopyFromScreen(bx, by, 0, 0, bmp.Size);
      return Best(bmp, tx - bx, ty - by, tw, th, slack, knownTop);
    }
  }

  // The same question of a saved picture (tools/rowcheck.mjs): the tile at
  // ox,oy in the file's own pixels.
  public static string MatchFile(string file, double ox, double oy, double tw, double th, int slack, bool top) {
    using (var bmp = new Bitmap(file)) return Best(bmp, ox, oy, tw, th, slack, top ? knownTop : known);
  }

  static string Best(Bitmap bmp, double ox, double oy, double tw, double th, int slack, List<double[]> known) {
    {
      var best = new double[names.Count];
      for (int k = 0; k < best.Length; k++) best[k] = -2;
      for (int dx = -slack; dx <= slack; dx += 2) for (int dy = -slack; dy <= slack; dy += 2) {
        if (ox + dx < 0 || oy + dy < 0 || ox + dx + tw > bmp.Width || oy + dy + th > bmp.Height) continue;
        var t = Thumb(bmp, ox + dx, oy + dy, tw, th);
        for (int k = 0; k < best.Length; k++) {
          double d = 0; var r = known[k];
          for (int i = 0; i < t.Length; i++) d += t[i] * r[i];
          if (d > best[k]) best[k] = d;
        }
      }
      int a = -1, b = -1;
      for (int k = 0; k < best.Length; k++) {
        if (a < 0 || best[k] > best[a]) { b = a; a = k; }
        else if (b < 0 || best[k] > best[b]) b = k;
      }
      if (a < 0) return "\"ok\":0,\"why\":\"no reference portraits\"";
      var inv = System.Globalization.CultureInfo.InvariantCulture;
      return "\"ok\":1,\"hero\":\"" + names[a] + "\",\"score\":" + best[a].ToString("F3", inv)
        + (b >= 0 ? ",\"second\":\"" + names[b] + "\",\"score2\":" + best[b].ToString("F3", inv) : "");
    }
  }
}
"@
[void][RowGrab]::SetProcessDPIAware()

$count = 0
if ($Refs -and (Test-Path -LiteralPath $Refs)) {
  foreach ($f in Get-ChildItem -LiteralPath $Refs -File) {
    if ($f.BaseName -notmatch '^[a-z_]+$') { continue }
    try { $count = [RowGrab]::AddRef($f.BaseName, $f.FullName) } catch { }
  }
}
[Console]::Out.WriteLine('{"t":"ready","refs":' + $count + '}')
[Console]::Out.Flush()

$lastOwner = -1
$isGame = $false
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { exit 0 }
  if (($null -ne $parent) -and $parent.HasExited) { exit 0 }
  $p = $line.Trim().Split(' ', 7)
  if ($p.Length -lt 2 -or $p[1] -notmatch '^\d+$') { continue }
  $answer = ''
  if (($p[0] -eq 'file' -or $p[0] -eq 'topfile') -and $p.Length -eq 7) {
    # file|topfile <id> <x> <y> <w> <h> <path>: a saved picture, for the test
    # rig; topfile compares the top of the portraits, as a top-bar tile is.
    $inv = [System.Globalization.CultureInfo]::InvariantCulture
    try { $answer = [RowGrab]::MatchFile($p[6], [double]::Parse($p[2], $inv), [double]::Parse($p[3], $inv), [double]::Parse($p[4], $inv), [double]::Parse($p[5], $inv), $(if ($p[0] -eq 'topfile') { 6 } else { $Slack }), ($p[0] -eq 'topfile')) }
    catch { $answer = '"ok":0,"why":"could not read the picture"' }
  } elseif ($p[0] -ne 'row' -and -not ($p[0] -eq 'seat' -and $p.Length -eq 3 -and $p[2] -match '^[0-9]$')) { continue }
  else { try {
    $x = 0; $y = 0; $w = 0; $h = 0
    $owner = [RowGrab]::Front([ref]$x, [ref]$y, [ref]$w, [ref]$h)
    if ($owner -ne $lastOwner) {
      $lastOwner = $owner
      $isGame = $false
      if ($owner -gt 0) {
        try { $isGame = (Get-Process -Id $owner -ErrorAction Stop).ProcessName -ieq $ProcessName } catch { $isGame = $false }
      }
    }
    if (-not $isGame) { $answer = '"ok":0,"why":"the game is not in front"' }
    elseif ($h -lt 400 -or $w -lt 600) { $answer = '"ok":0,"why":"the game window is too small"' }
    elseif ($p[0] -eq 'seat') { $answer = [RowGrab]::MatchSeat($x, $y, $w, $h, [int]$p[2], 6) }
    else { $answer = [RowGrab]::Match($x, $y, $w, $h, $Slack) }
  } catch {
    $answer = '"ok":0,"why":"grab failed"'
  } }
  [Console]::Out.WriteLine('{"t":"row","id":' + $p[1] + ',' + $answer + '}')
  [Console]::Out.Flush()
}
