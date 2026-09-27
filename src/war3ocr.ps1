param([switch]$Probe,[switch]$SelectRegion,[string]$ImagePath='', [string]$Region='0,0.18,0.7,0.40', [string]$Language='en-US', [int]$ParentId=0)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$null=[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.BitmapDecoder,Windows.Foundation,ContentType=WindowsRuntime]
$null=[Windows.Storage.Streams.InMemoryRandomAccessStream,Windows.Foundation,ContentType=WindowsRuntime]
$null=[Windows.Storage.Streams.DataWriter,Windows.Foundation,ContentType=WindowsRuntime]
$null=[Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]
$asTask=([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'})[0]
function Await($op,$type) { $t=$asTask.MakeGenericMethod($type).Invoke($null,@($op)); $t.GetAwaiter().GetResult() }
function Emit($v) { [Console]::WriteLine(($v | ConvertTo-Json -Compress -Depth 6)) }
$languages=@([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object {$_.LanguageTag})
if($Probe){ Emit @{kind='languages';languages=$languages};exit }
$engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new($Language))
if(!$engine){throw "OCR language unavailable: $Language. Installed: $($languages -join ', ')"}
Add-Type @'
using System; using System.Runtime.InteropServices;
public class OcrWindow {
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);
 [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h,ref Point p);
 public struct Rect {public int L,T,R,B;} public struct Point {public int X,Y;}
}
'@
$null=[OcrWindow]::SetProcessDPIAware()
function GameRect {
 $h=[OcrWindow]::GetForegroundWindow(); [uint32]$gamePid=0
 $null=[OcrWindow]::GetWindowThreadProcessId($h,[ref]$gamePid)
 $p=Get-Process -Id $gamePid -ErrorAction SilentlyContinue
 if(!$p -or $p.ProcessName -ne 'Warcraft III'){return $null}
 $r=New-Object OcrWindow+Rect; $pt=New-Object OcrWindow+Point
 $null=[OcrWindow]::GetClientRect($h,[ref]$r);$null=[OcrWindow]::ClientToScreen($h,[ref]$pt)
 return [Drawing.Rectangle]::new($pt.X,$pt.Y,$r.R,$r.B)
}
if($SelectRegion){
 Emit @{kind='status';text='Switch to Warcraft III within 5 seconds, then drag around visible chat. Esc cancels.'}
 Start-Sleep -Seconds 5
 $gameRect=GameRect
 if(!$gameRect){throw 'Warcraft III must be in the foreground for selection.'}
 $form=New-Object Windows.Forms.Form
 $form.FormBorderStyle='None';$form.StartPosition='Manual';$form.Bounds=$gameRect;$form.TopMost=$true
 $form.BackColor='Black';$form.Opacity=0.35;$form.Cursor='Cross';$form.KeyPreview=$true
 $script:origin=$null;$script:chosen=$null;$script:box=[Drawing.Rectangle]::Empty
 $form.Add_MouseDown({$script:origin=$_.Location})
 $form.Add_MouseMove({if($null -ne $script:origin){$script:box=[Drawing.Rectangle]::FromLTRB([Math]::Min($script:origin.X,$_.X),[Math]::Min($script:origin.Y,$_.Y),[Math]::Max($script:origin.X,$_.X),[Math]::Max($script:origin.Y,$_.Y));$form.Invalidate()}})
 $form.Add_Paint({$_.Graphics.DrawRectangle([Drawing.Pens]::Lime,$script:box)})
 $form.Add_MouseUp({if($script:box.Width -ge 80 -and $script:box.Height -ge 20){$script:chosen=$script:box;$form.Close()}})
 $form.Add_KeyDown({if($_.KeyCode -eq 'Escape'){$form.Close()}})
 $null=$form.ShowDialog();$form.Dispose()
 if($script:chosen){Emit @{kind='region';region=@(($script:chosen.X/$gameRect.Width),($script:chosen.Y/$gameRect.Height),($script:chosen.Width/$gameRect.Width),($script:chosen.Height/$gameRect.Height))}}
 exit
}
function Recognize($bitmap){
 $ms=New-Object IO.MemoryStream
 $stream=[Windows.Storage.Streams.InMemoryRandomAccessStream]::new()
 $writer=[Windows.Storage.Streams.DataWriter]::new($stream)
 $soft=$null
 try {
  $bitmap.Save($ms,[Drawing.Imaging.ImageFormat]::Png);$bytes=$ms.ToArray()
  $writer.WriteBytes($bytes);$null=Await ($writer.StoreAsync()) ([uint32]);$null=$writer.DetachStream();$stream.Seek(0)
  $decoder=Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $soft=Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $result=Await ($engine.RecognizeAsync($soft)) ([Windows.Media.Ocr.OcrResult])
  # OCR may return the colored player name as a separate line, even after
  # the message. Reassemble words by screen position before chat parsing.
  $rows=New-Object System.Collections.Generic.List[object]
  $words=@($result.Lines | ForEach-Object {$_.Words} | Sort-Object { $_.BoundingRect.Y + $_.BoundingRect.Height/2 })
  foreach($word in $words){
   $rect=$word.BoundingRect;$cy=$rect.Y+$rect.Height/2
   $row=$rows | Where-Object {[Math]::Abs($_.Y-$cy) -le [Math]::Max(5,[Math]::Min($_.Height,$rect.Height)*0.55)} | Select-Object -First 1
   if(!$row){$row=@{Y=$cy;Height=$rect.Height;Words=(New-Object System.Collections.Generic.List[object])};$rows.Add($row)}
   $row.Words.Add($word)
  }
  return @($rows | Sort-Object {$_.Y} | ForEach-Object {(@($_.Words | Sort-Object {$_.BoundingRect.X} | ForEach-Object {$_.Text}) -join ' ')})
 } finally {if($soft){$soft.Dispose()};$writer.Dispose();$stream.Dispose();$ms.Dispose()}
}
if($ImagePath){$bitmap=[Drawing.Bitmap]::FromFile($ImagePath);try{$sw=[Diagnostics.Stopwatch]::StartNew();$lines=Recognize $bitmap;Emit @{kind='frame';lines=@($lines);ocrMs=$sw.ElapsedMilliseconds}}finally{$bitmap.Dispose()};exit}
$roi=@($Region.Split(',') | ForEach-Object {[double]::Parse($_,[Globalization.CultureInfo]::InvariantCulture)})
if($roi.Count -ne 4 -or $roi[0] -lt 0 -or $roi[1] -lt 0 -or $roi[2] -le 0 -or $roi[3] -le 0 -or $roi[0]+$roi[2] -gt 1.001 -or $roi[1]+$roi[3] -gt 1.001){throw 'Invalid OCR region'}
Emit @{kind='ready';language=$Language;region=$roi}
while(!$ParentId -or (Get-Process -Id $ParentId -ErrorAction SilentlyContinue)){
 $r=GameRect
 if(!$r -or $r.Width -lt 100){Start-Sleep -Milliseconds 500;continue}
 $sw=[Diagnostics.Stopwatch]::StartNew()
 $w=[int]($r.Width*$roi[2]);$h=[int]($r.Height*$roi[3])
 $bitmap=New-Object Drawing.Bitmap($w,$h);$g=[Drawing.Graphics]::FromImage($bitmap)
 try {
  $g.CopyFromScreen(($r.X+[int]($r.Width*$roi[0])),($r.Y+[int]($r.Height*$roi[1])),0,0,$bitmap.Size)
  $lines=Recognize $bitmap
  Emit @{kind='frame';lines=@($lines);ocrMs=$sw.ElapsedMilliseconds;capturedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()}
 } catch {Emit @{kind='error';text=$_.Exception.Message};Start-Sleep -Seconds 2}
 finally {$g.Dispose();$bitmap.Dispose()}
 Start-Sleep -Milliseconds ([Math]::Max(50,500-$sw.ElapsedMilliseconds))
}
